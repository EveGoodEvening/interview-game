/**
 * Game / interview session store (zustand).
 * OWNER: brain agent. UI agents rely on every exported name and signature below.
 *
 * The store orchestrates; the rules live in src/engine (pure, unit-tested) and the interviewer
 * brain in src/ai. Async steps (prepare / turn / evaluate) are guarded against stale results with
 * a request sequence number + AbortController, so abandoning or restarting mid-request is safe.
 */
import { create } from 'zustand';
import { getCharacter } from '../characters';
import {
  REVERSE_KINDS,
  addRecord,
  applyAnswer,
  applyEndReverse,
  applyPlan,
  applySkip,
  applyTurn,
  beginEvaluation,
  clearAutosave,
  coerceTurn,
  createRecord,
  createSession,
  finishSession,
  lastEntry,
  lastInterviewerTurn,
  loadAutosave,
  loadEndings,
  loadRecords,
  MAX_RECORDS,
  nextDirective,
  saveAutosave,
  saveEndings,
  saveRecords,
  unlockEnding,
} from '../engine';
import { LlmError } from '../llm/types';
import type {
  AnswerVia,
  CharacterId,
  EndingId,
  InterviewConfig,
  InterviewRecord,
  InterviewReport,
  InterviewSession,
  InterviewerAI,
  LlmSettings,
  ScreenId,
  SessionPhase,
  Stage,
  TurnContext,
} from '../types';
import { getSettings } from './settings';

/** One-shot UI effects. The UI keeps track of ids it has already shown. */
export type GameEvent =
  | { id: number; type: 'affinity'; delta: number; value: number }
  /**
   * Show a chapter title card before the next interviewer line. The UI builds the localized label
   * from phase/topicIndex (e.g. "第二幕 · {topicTitle}"); topicTitle comes from the plan (interview language).
   */
  | { id: number; type: 'chapter'; phase: SessionPhase; topicIndex: number | null; topicTitle: string | null }
  /** The finished interview's ending (`recordId` = the new InterviewRecord's id). */
  | { id: number; type: 'ending_unlocked'; recordId: string; characterId: CharacterId; ending: EndingId; firstTime: boolean }
  /**
   * An autosave write failed (storage full / unavailable): progress is kept in memory for this tab
   * only. Emitted once per failure streak (again after a successful write, or for a new session).
   */
  | { id: number; type: 'storage_warning' };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A GameEvent before the store assigns its id. */
export type NewGameEvent = DistributiveOmit<GameEvent, 'id'>;

export interface GameState {
  screen: ScreenId;
  /** Where Settings returns to. */
  previousScreen: ScreenId | null;
  session: InterviewSession | null;
  stage: Stage;
  /** Most recent finished interview (Result screen). */
  lastRecord: InterviewRecord | null;
  /** Finished interviews, newest first (persisted, max 30). */
  records: InterviewRecord[];
  /** `${characterId}:${endingId}` → timestamp first unlocked (persisted). */
  endings: Record<string, number>;
  /** Recent UI events (max 20), oldest first. Ids increase monotonically for the app's lifetime. */
  events: GameEvent[];

  navigate: (screen: ScreenId) => void;
  openSettings: () => void;
  closeSettings: () => void;

  /** Create a session, call ai.prepare(), then present the opening line. */
  startInterview: (config: InterviewConfig) => Promise<void>;
  /** UI finished presenting the current interviewer entry (all pages shown / voiced). */
  interviewerDone: () => void;
  /** Candidate answered the current question. Empty text counts as a skip. */
  submitAnswer: (text: string, meta: { via: AnswerVia; durationSec: number }) => Promise<void>;
  /** Candidate skips the current question (recorded as skipped, scored low). In the reverse Q&A this ends it. */
  skipQuestion: () => Promise<void>;
  /** Reverse Q&A: candidate has no (more) questions → closing. */
  endReverseQA: () => Promise<void>;
  /** Retry the failed step shown in stage 'error' (re-creates the AI if the LLM settings changed). */
  retry: () => Promise<void>;
  /** Leave the interview and delete the autosave. */
  abandonInterview: () => void;
  /** Leave to title but keep the autosave for "Continue". */
  suspendInterview: () => void;
  hasAutosave: () => boolean;
  /** Load the autosaved session and continue where it left off. */
  resumeAutosave: () => Promise<void>;
  deleteRecord: (id: string) => void;
  /** Open a stored record on the Result screen. */
  viewRecord: (id: string) => void;
  /** Delete every stored record (Settings → Data). Unlocked endings are kept. */
  clearRecords: () => void;
  /** Forget unlocked endings (Settings → Data). */
  clearEndings: () => void;
  /**
   * Delete the saved (suspended) interview (Settings → Data): cancels requests, clears the autosave
   * and drops a resumable in-memory session, so "Continue" disappears. No-op while a live interview
   * is on screen (the Interview screen, or Settings opened from it).
   */
  discardSavedInterview: () => void;
}

/** Max events kept in state. */
export const MAX_EVENTS = 20;

// ───────────────────────── AI factory (injectable for tests) ─────────────────────────

export type InterviewerAIFactory = (llm: LlmSettings) => InterviewerAI | Promise<InterviewerAI>;

/**
 * The interviewer brain (demo banks, prompts, zod schemas, LLM clients) is a separate chunk:
 * it is loaded on the first interview (or prefetched by the app shell), keeping the title fast.
 */
type AIModule = typeof import('../ai');
let aiModule: AIModule | null = null;
function loadAIModule(): Promise<AIModule> {
  return import('../ai').then((m) => (aiModule = m));
}

/** Synchronous once the chunk is loaded, so requests start in the same tick (abort races stay simple). */
const defaultAIFactory: InterviewerAIFactory = (llm) =>
  aiModule ? aiModule.createInterviewerAI(llm) : loadAIModule().then((m) => m.createInterviewerAI(llm));
let aiFactory: InterviewerAIFactory = defaultAIFactory;

/** Fetch the interviewer code ahead of time (idle prefetch). Never rejects. */
export function preloadInterviewerAI(): Promise<void> {
  return loadAIModule().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Replace how the store creates its interviewer (tests, debugging). Pass null to restore the
 * default (`createInterviewerAI(getSettings().llm)`).
 */
export function setInterviewerAIFactory(factory: InterviewerAIFactory | null): void {
  aiFactory = factory ?? defaultAIFactory;
  runtime.ai = null;
  runtime.aiKey = '';
}

/** Non-serialisable runtime state, kept outside zustand. */
const runtime = {
  ai: null as InterviewerAI | null,
  aiKey: '',
  controller: null as AbortController | null,
  /** Incremented for every request and every cancellation; results from older requests are dropped. */
  seq: 0,
  eventSeq: 0,
  /** The last autosave write failed (a storage_warning was already emitted for this streak). */
  storageFailing: false,
};

/**
 * Full configs (untruncated résumé) of the interviews finished during this page session, by record
 * id. Persisted records keep only the first MAX_RECORD_RESUME_CHARS of the résumé; "Try again"
 * should not silently run on that shortened copy.
 */
const fullConfigs = new Map<string, InterviewConfig>();

/**
 * In-memory full config of a record finished during this page session (including the untruncated
 * résumé), or null when the record was loaded from storage (only its truncated config exists).
 */
export function fullConfigFor(recordId: string): InterviewConfig | null {
  const config = fullConfigs.get(recordId);
  return config ? { ...config } : null;
}

function rememberFullConfig(recordId: string, config: InterviewConfig): void {
  fullConfigs.set(recordId, config);
  // Bounded like the records list (oldest first in Map insertion order).
  while (fullConfigs.size > MAX_RECORDS) fullConfigs.delete(fullConfigs.keys().next().value as string);
}

/**
 * Current interviewer for the session; created from the LLM settings, re-created when they change.
 * Returns synchronously whenever possible (cached, or the factory is synchronous) — only the very
 * first creation may have to wait for the interviewer chunk. Throws / rejects like the factory.
 */
function ensureAI(fresh: boolean): InterviewerAI | Promise<InterviewerAI> {
  const llm = getSettings().llm;
  const key = JSON.stringify(llm);
  if (!fresh && runtime.ai && runtime.aiKey === key) return runtime.ai;
  runtime.ai = null;
  runtime.aiKey = key;
  const factory = aiFactory;
  // Only cache the result if nothing replaced the factory or the settings meanwhile.
  const keep = (ai: InterviewerAI) => {
    if (runtime.aiKey === key && aiFactory === factory) runtime.ai = ai;
    return ai;
  };
  const made = factory(llm);
  return made instanceof Promise ? made.then(keep) : keep(made);
}

function beginRequest(): { seq: number; signal: AbortSignal } {
  runtime.controller?.abort();
  const controller = new AbortController();
  runtime.controller = controller;
  runtime.seq += 1;
  return { seq: runtime.seq, signal: controller.signal };
}

function cancelRequests(): void {
  runtime.controller?.abort();
  runtime.controller = null;
  runtime.seq += 1;
}

function errorStage(err: unknown, retry: 'prepare' | 'turn' | 'evaluate'): Stage {
  const code = err instanceof LlmError ? err.code : 'unknown';
  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'error', code, message, retry };
}

function isResumable(session: InterviewSession | null): session is InterviewSession {
  return session !== null && session.phase !== 'finished';
}

/**
 * Autosave `session` (or clear the autosave once it is finished). Returns a storage_warning event
 * the first time a write fails in a row; a successful write ends the failure streak.
 */
function persistSession(session: InterviewSession): NewGameEvent | null {
  if (session.phase === 'finished') {
    clearAutosave();
    return null;
  }
  if (saveAutosave(session)) {
    runtime.storageFailing = false;
    return null;
  }
  if (runtime.storageFailing) return null;
  runtime.storageFailing = true;
  return { type: 'storage_warning' };
}

/**
 * The session "Continue" should resume: the in-memory one when it is at least as new as the stored
 * autosave (same interview and not behind it, or the stored save is an older interview — e.g. the
 * newer session's writes failed), otherwise the stored one.
 */
function pickResumable(current: InterviewSession | null, stored: InterviewSession | null): InterviewSession | null {
  if (!isResumable(current)) return stored;
  if (!stored) return current;
  if (stored.id === current.id) return stored.transcript.length > current.transcript.length ? stored : current;
  return (stored.createdAt ?? 0) > (current.createdAt ?? 0) ? stored : current;
}

/** The interview is on screen (or behind Settings opened from it). */
function isLiveInterview(state: Pick<GameState, 'screen' | 'previousScreen' | 'session'>): boolean {
  if (!isResumable(state.session)) return false;
  return state.screen === 'interview' || (state.screen === 'settings' && state.previousScreen === 'interview');
}

// ───────────────────────── store ─────────────────────────

export const useGameStore = create<GameState>()((set, get) => {
  const withEvents = (events: GameEvent[], added: NewGameEvent[]): GameEvent[] =>
    added.length === 0 ? events : [...events, ...added.map((e) => ({ ...e, id: ++runtime.eventSeq }) as GameEvent)].slice(-MAX_EVENTS);

  /** Apply a session change (plus extra state and events) and autosave it. */
  const commit = (session: InterviewSession, extra: Partial<GameState> = {}, events: NewGameEvent[] = []) => {
    const warning = persistSession(session);
    const added = warning ? [...events, warning] : events;
    set((s) => ({ ...extra, session, events: withEvents(s.events, added) }));
  };

  const isCurrent = (seq: number, sessionId: string) => seq === runtime.seq && get().session?.id === sessionId;

  const settle = (seq: number) => {
    if (seq === runtime.seq) runtime.controller = null;
  };

  async function runPrepare(freshAI = false): Promise<void> {
    const session = get().session;
    if (!session) return;
    set({ stage: { kind: 'loading', reason: 'preparing' } });
    const { seq, signal } = beginRequest();
    try {
      const made = ensureAI(freshAI);
      const ai = made instanceof Promise ? await made : made;
      const plan = await ai.prepare(session.config, getCharacter(session.config.characterId), signal);
      if (!isCurrent(seq, session.id)) return;
      const { session: next, entry, chapter } = applyPlan(get().session ?? session, plan);
      commit(next, { stage: { kind: 'interviewer', entryId: entry.id } }, [{ type: 'chapter', ...chapter }]);
    } catch (err) {
      if (isCurrent(seq, session.id)) set({ stage: errorStage(err, 'prepare') });
    } finally {
      settle(seq);
    }
  }

  async function runTurn(freshAI = false): Promise<void> {
    const session = get().session;
    if (!session?.plan) return;
    const directive = nextDirective(session);
    if (!directive) {
      // Nothing to respond to (transcript ends with the interviewer): wait for the answer.
      set({ stage: { kind: 'answer' } });
      return;
    }
    set({ stage: { kind: 'loading', reason: 'thinking' } });
    const { seq, signal } = beginRequest();
    try {
      const made = ensureAI(freshAI);
      const ai = made instanceof Promise ? await made : made;
      const plan = session.plan;
      const ctx: TurnContext = {
        config: session.config,
        character: getCharacter(session.config.characterId),
        plan,
        transcript: session.transcript,
        directive,
        progress: {
          mainAsked: session.mainAsked,
          mainTotal: plan.topics.length,
          followUpsOnCurrent: session.followUpsOnCurrent,
          maxFollowUps: session.config.maxFollowUps,
          reverseAsked: session.reverseAsked,
        },
      };
      const raw = await ai.nextTurn(ctx, signal);
      if (!isCurrent(seq, session.id)) return;
      const current = get().session ?? session;
      const turn = coerceTurn(raw, directive, plan, current.config.lang);
      const { session: next, entry, chapter, affinityDelta } = applyTurn(current, turn, directive);
      const events: NewGameEvent[] = [];
      if (affinityDelta !== 0) events.push({ type: 'affinity', delta: affinityDelta, value: next.affinity });
      if (chapter) events.push({ type: 'chapter', ...chapter });
      commit(next, { stage: { kind: 'interviewer', entryId: entry.id } }, events);
    } catch (err) {
      if (isCurrent(seq, session.id)) set({ stage: errorStage(err, 'turn') });
    } finally {
      settle(seq);
    }
  }

  function finish(report: InterviewReport): void {
    const current = get().session;
    if (!current) return;
    const finished = finishSession(current, report);
    const record = createRecord(finished);
    // Free the autosave's space first so the record has the best chance to fit.
    clearAutosave();
    const records = addRecord(get().records, record);
    saveRecords(records);
    const { endings, firstTime } = unlockEnding(get().endings, record.characterId, record.ending);
    saveEndings(endings);
    // Stored records keep a truncated résumé; the in-memory copy keeps the full config ("Try again").
    rememberFullConfig(record.id, finished.config);
    const onInterview = get().screen === 'interview';
    set((s) => ({
      session: finished,
      lastRecord: { ...record, config: finished.config },
      records,
      endings,
      stage: { kind: 'ended' },
      // Don't yank the player out of Settings; return there → Result.
      ...(onInterview ? { screen: 'result' as ScreenId } : { previousScreen: 'result' as ScreenId }),
      events: withEvents(s.events, [{ type: 'ending_unlocked', recordId: record.id, characterId: record.characterId, ending: record.ending, firstTime }]),
    }));
  }

  async function runEvaluate(freshAI = false): Promise<void> {
    const loaded = get().session;
    const plan = loaded?.plan;
    if (!loaded || !plan) return;
    const session = loaded.phase === 'evaluating' ? loaded : beginEvaluation(loaded);
    if (session !== loaded) commit(session);
    set({ stage: { kind: 'loading', reason: 'evaluating' } });
    const { seq, signal } = beginRequest();
    try {
      const made = ensureAI(freshAI);
      const ai = made instanceof Promise ? await made : made;
      const report = await ai.evaluate(
        {
          config: session.config,
          character: getCharacter(session.config.characterId),
          plan,
          transcript: session.transcript,
          scores: session.scores,
          affinity: session.affinity,
        },
        signal,
      );
      if (!isCurrent(seq, session.id)) return;
      finish(report);
    } catch (err) {
      if (isCurrent(seq, session.id)) set({ stage: errorStage(err, 'evaluate') });
    } finally {
      settle(seq);
    }
  }

  /** Decide what to do with a session that was just loaded (resume rules, DESIGN §3). */
  async function continueSession(session: InterviewSession): Promise<void> {
    if (!session.plan || session.phase === 'preparing') return runPrepare(true);
    if (session.phase === 'evaluating') return runEvaluate(true);
    const last = lastEntry(session.transcript);
    if (!last) {
      const { session: next, entry, chapter } = applyPlan(session, session.plan);
      commit(next, { stage: { kind: 'interviewer', entryId: entry.id } }, [{ type: 'chapter', ...chapter }]);
      return;
    }
    if (last.role === 'candidate') return runTurn(true);
    // Warm up a fresh interviewer; a failure surfaces with the next request (retry path) instead.
    try {
      const made = ensureAI(true);
      if (made instanceof Promise) made.catch(() => {});
    } catch {
      // (same)
    }
    // A closing line is re-presented (it leads to the evaluation); any other question is pinned for an answer.
    set({ stage: last.turn?.kind === 'closing' ? { kind: 'interviewer', entryId: last.id } : { kind: 'answer' } });
  }

  return {
    screen: 'title',
    previousScreen: null,
    session: null,
    stage: { kind: 'idle' },
    lastRecord: null,
    records: loadRecords(),
    endings: loadEndings(),
    events: [],

    navigate: (screen) => set({ screen }),
    openSettings: () => set((s) => (s.screen === 'settings' ? {} : { previousScreen: s.screen, screen: 'settings' })),
    closeSettings: () => set((s) => ({ screen: s.previousScreen ?? 'title', previousScreen: null })),

    startInterview: async (config) => {
      cancelRequests();
      const session = createSession(config);
      runtime.storageFailing = false;
      // The new interview replaces the saved one: free its space first, and never leave an older
      // interview behind as "Continue" when this one cannot be saved.
      clearAutosave();
      const warning = persistSession(session);
      set({ session, screen: 'interview', previousScreen: null, stage: { kind: 'loading', reason: 'preparing' }, events: withEvents([], warning ? [warning] : []) });
      await runPrepare(true);
    },

    interviewerDone: () => {
      const { stage, session } = get();
      if (stage.kind !== 'interviewer' || !session) return;
      const entry = session.transcript.find((e) => e.id === stage.entryId);
      if (entry?.turn?.kind === 'closing') {
        void runEvaluate();
        return;
      }
      set({ stage: { kind: 'answer' } });
    },

    submitAnswer: async (text, meta) => {
      const { stage, session } = get();
      if (stage.kind !== 'answer' || !session?.plan) return;
      const clean = (text ?? '').trim();
      if (!clean) return get().skipQuestion();
      const { session: next } = applyAnswer(session, clean, meta);
      commit(next, { stage: { kind: 'loading', reason: 'thinking' } });
      await runTurn();
    },

    skipQuestion: async () => {
      const { stage, session } = get();
      if (stage.kind !== 'answer' || !session?.plan) return;
      const pendingKind = lastInterviewerTurn(session.transcript)?.kind;
      if (pendingKind && REVERSE_KINDS.includes(pendingKind)) return get().endReverseQA();
      const { session: next, affinityDelta } = applySkip(session);
      commit(
        next,
        { stage: { kind: 'loading', reason: 'thinking' } },
        affinityDelta !== 0 ? [{ type: 'affinity', delta: affinityDelta, value: next.affinity }] : [],
      );
      await runTurn();
    },

    endReverseQA: async () => {
      const { stage, session } = get();
      if (stage.kind !== 'answer' || !session?.plan) return;
      const pendingKind = lastInterviewerTurn(session.transcript)?.kind;
      if (!pendingKind || !REVERSE_KINDS.includes(pendingKind)) return;
      const { session: next } = applyEndReverse(session);
      commit(next, { stage: { kind: 'loading', reason: 'thinking' } });
      await runTurn();
    },

    retry: async () => {
      const stage = get().stage;
      if (stage.kind !== 'error' || !get().session) return;
      if (stage.retry === 'prepare') await runPrepare();
      else if (stage.retry === 'turn') await runTurn();
      else await runEvaluate();
    },

    abandonInterview: () => {
      cancelRequests();
      clearAutosave();
      set({ session: null, stage: { kind: 'idle' }, screen: 'title', previousScreen: null });
    },

    suspendInterview: () => {
      cancelRequests();
      const session = get().session;
      // A failed write is reported, but "Continue" in this tab still resumes the in-memory session.
      const warning = isResumable(session) ? persistSession(session) : null;
      set((s) => ({ screen: 'title', previousScreen: null, stage: { kind: 'idle' }, events: withEvents(s.events, warning ? [warning] : []) }));
    },

    hasAutosave: () => loadAutosave() !== null || isResumable(get().session),

    resumeAutosave: async () => {
      const saved = pickResumable(get().session, loadAutosave());
      if (!saved) return;
      cancelRequests();
      runtime.ai = null;
      runtime.storageFailing = false;
      set({ session: saved, screen: 'interview', previousScreen: null, stage: { kind: 'idle' }, events: [] });
      await continueSession(saved);
    },

    deleteRecord: (id) => {
      const records = get().records.filter((r) => r.id !== id);
      saveRecords(records);
      fullConfigs.delete(id);
      set((s) => ({ records, lastRecord: s.lastRecord?.id === id ? null : s.lastRecord }));
    },

    viewRecord: (id) => {
      const rec = get().records.find((r) => r.id === id) ?? null;
      if (!rec) return;
      // Finished during this page session → the full config (untruncated résumé) is still known.
      const full = fullConfigs.get(id);
      set({ lastRecord: full ? { ...rec, config: full } : rec, screen: 'result' });
    },

    clearRecords: () => {
      saveRecords([]);
      fullConfigs.clear();
      set({ records: [], lastRecord: null });
    },

    clearEndings: () => {
      saveEndings({});
      set({ endings: {} });
    },

    discardSavedInterview: () => {
      const state = get();
      if (isLiveInterview(state)) return;
      cancelRequests();
      clearAutosave();
      if (isResumable(state.session)) set({ session: null, stage: { kind: 'idle' } });
    },
  };
});
