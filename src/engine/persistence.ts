/**
 * localStorage persistence (autosave, records, endings). Every accessor is wrapped in try/catch
 * and silently becomes a no-op when storage is missing (node tests, privacy modes) or full.
 * Loaded data is validated structurally (anything unusable is discarded rather than crashing the UI)
 * and then re-sanitised: missing or invalid fields get the same defaults a new session would have.
 */
import type {
  AnswerAssessment,
  DimensionKey,
  Expression,
  InterviewPlan,
  InterviewRecord,
  InterviewReport,
  InterviewSession,
  InterviewerTurn,
  SessionPhase,
  TranscriptEntry,
  TurnKind,
} from '../types';
import { CHARACTER_IDS, DIMENSION_KEYS, ENDING_IDS, EXPRESSIONS, LANGS } from '../types';
import { countReverseQuestions } from './qa';
import { INITIAL_AFFINITY, clamp } from './scoring';
import { sanitizeConfig } from './session';

export const STORAGE_KEYS = {
  session: 'igg.session.v1',
  records: 'igg.records.v1',
  endings: 'igg.endings.v1',
} as const;

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

export function readJson(key: string): unknown {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be written (no storage, quota exceeded, …). */
export function writeJson(key: string, value: unknown): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

// ───────────── validation ─────────────

const PHASES: readonly SessionPhase[] = ['preparing', 'intro', 'questioning', 'reverse', 'closing', 'evaluating', 'finished'];
const TURN_KINDS: readonly TurnKind[] = ['opening', 'main', 'followup', 'reverse_prompt', 'reverse_answer', 'closing'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function isEntry(v: unknown): v is TranscriptEntry {
  if (!isObj(v)) return false;
  if (typeof v.id !== 'string' || typeof v.text !== 'string' || typeof v.at !== 'number') return false;
  if (v.role === 'interviewer') return isObj(v.turn) && TURN_KINDS.includes(v.turn.kind as TurnKind) && typeof v.turn.question === 'string';
  if (v.role === 'candidate') return isObj(v.answer) && typeof v.answer.skipped === 'boolean';
  return false;
}

/** The fields a config cannot do without; everything else is filled in by sanitizeConfig. */
function isConfig(v: unknown): boolean {
  return (
    isObj(v) &&
    CHARACTER_IDS.includes(v.characterId as never) &&
    LANGS.includes(v.lang as never) &&
    (v.resumeText === undefined || typeof v.resumeText === 'string')
  );
}

function isPlan(v: unknown): boolean {
  return v === null || (isObj(v) && Array.isArray(v.topics) && isObj(v.opening) && typeof v.opening.speech === 'string');
}

/**
 * A session that can be resumed: identity, config, plan, phase and a well-formed transcript. Counters,
 * affinity and scores may be missing or invalid; `loadAutosave` re-derives / defaults them.
 */
export function isValidSession(v: unknown): v is InterviewSession {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    isConfig(v.config) &&
    isPlan(v.plan) &&
    PHASES.includes(v.phase as SessionPhase) &&
    Array.isArray(v.transcript) &&
    v.transcript.every(isEntry) &&
    (v.scores === undefined || Array.isArray(v.scores))
  );
}

export function isValidRecord(v: unknown): v is InterviewRecord {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.finishedAt === 'number' &&
    CHARACTER_IDS.includes(v.characterId as never) &&
    ENDING_IDS.includes(v.ending as never) &&
    typeof v.finalScore === 'number' &&
    isConfig(v.config) &&
    Array.isArray(v.transcript) &&
    isObj(v.report) &&
    typeof v.report.overallScore === 'number' &&
    Array.isArray(v.report.dimensions) &&
    Array.isArray(v.report.questionReviews)
  );
}

// ───────────── re-sanitising loaded data ─────────────
// Structural validation keeps out garbage; these fill in missing / invalid leaf values (saves from
// older or newer builds, hand-edited storage) so the UI and engine never see undefined or NaN.

function sanitizeEntry(e: TranscriptEntry): TranscriptEntry {
  if (e.role === 'interviewer' && e.turn) {
    const t = e.turn as Partial<InterviewerTurn> & Pick<InterviewerTurn, 'kind' | 'question'>;
    const a = isObj(t.assessment) ? (t.assessment as Partial<AnswerAssessment>) : null;
    const turn: InterviewerTurn = {
      ...t,
      reaction: str(t.reaction),
      expression: EXPRESSIONS.includes(t.expression as Expression) ? (t.expression as Expression) : 'neutral',
      topicIndex: num(t.topicIndex) ? Math.round(t.topicIndex) : null,
      assessment: a && num(a.score) ? { score: a.score, comment: str(a.comment), affinityDelta: num(a.affinityDelta) ? a.affinityDelta : 0 } : null,
    };
    return { ...e, turn };
  }
  if (e.role === 'candidate' && e.answer) {
    const ans = e.answer as Partial<NonNullable<TranscriptEntry['answer']>> & { skipped: boolean };
    return { ...e, answer: { ...ans, via: ans.via === 'voice' ? 'voice' : 'text', durationSec: num(ans.durationSec) ? Math.max(0, ans.durationSec) : 0 } };
  }
  return e;
}

function sanitizePlan(p: InterviewPlan | null): InterviewPlan | null {
  if (!p) return null;
  const opening = p.opening as Partial<InterviewPlan['opening']> & { speech: string };
  return {
    ...p,
    candidateName: str(p.candidateName),
    targetRole: str(p.targetRole),
    summary: str(p.summary),
    highlights: strList(p.highlights),
    concerns: strList(p.concerns),
    topics: (p.topics as unknown[]).filter(isObj).map((t) => ({ ...t, title: str(t.title), goal: str(t.goal) })),
    opening: { ...opening, expression: EXPRESSIONS.includes(opening.expression as Expression) ? (opening.expression as Expression) : 'neutral' },
  };
}

function sanitizeScores(scores: unknown[]): InterviewSession['scores'] {
  return scores
    .filter((x): x is Record<string, unknown> => isObj(x) && typeof x.entryId === 'string' && num(x.score))
    .map((x) => ({ ...x, entryId: x.entryId as string, score: x.score as number, comment: str(x.comment) }));
}

/** A stored counter (at least `min`), or `fallback` when it is missing / not a number. */
const intOr = (v: unknown, fallback: number, min = 0) => (num(v) ? Math.max(min, Math.round(v)) : fallback);

/** Progress counters as `applyTurn` would have left them, recomputed from the transcript. */
function countersFrom(transcript: readonly TranscriptEntry[]) {
  let currentTopicIndex = -1;
  let mainAsked = 0;
  let followUpsOnCurrent = 0;
  for (const e of transcript) {
    if (e.turn?.kind === 'main') {
      mainAsked += 1;
      followUpsOnCurrent = 0;
      currentTopicIndex = e.turn.topicIndex ?? currentTopicIndex + 1;
    } else if (e.turn?.kind === 'followup') followUpsOnCurrent += 1;
  }
  return { currentTopicIndex, mainAsked, followUpsOnCurrent, reverseAsked: countReverseQuestions(transcript) };
}

function sanitizeSession(v: InterviewSession): InterviewSession {
  const plan = sanitizePlan(v.plan);
  const config = sanitizeConfig(v.config);
  const transcript = v.transcript.map(sanitizeEntry);
  const derived = countersFrom(transcript);
  return {
    ...v,
    createdAt: num(v.createdAt) ? v.createdAt : 0,
    // The plan fixes the number of topics once it exists.
    config: plan && !num(v.config.mainQuestions) && plan.topics.length > 0 ? { ...config, mainQuestions: plan.topics.length } : config,
    plan,
    transcript,
    affinity: num(v.affinity) ? Math.round(clamp(v.affinity, 0, 100)) : INITIAL_AFFINITY,
    currentTopicIndex: intOr(v.currentTopicIndex, derived.currentTopicIndex, -1),
    mainAsked: intOr(v.mainAsked, derived.mainAsked),
    followUpsOnCurrent: intOr(v.followUpsOnCurrent, derived.followUpsOnCurrent),
    reverseAsked: intOr(v.reverseAsked, derived.reverseAsked),
    scores: Array.isArray(v.scores) ? sanitizeScores(v.scores) : [],
    report: null,
    ending: null,
    finalScore: null,
  };
}

function sanitizeReport(r: InterviewReport): InterviewReport {
  const dims = (r.dimensions as unknown[]).filter(
    (d): d is Record<string, unknown> => isObj(d) && DIMENSION_KEYS.includes(d.key as DimensionKey) && num(d.score),
  );
  return {
    ...r,
    dimensions: dims.map((d) => ({ ...d, key: d.key as DimensionKey, score: d.score as number, comment: str(d.comment) })),
    strengths: strList(r.strengths),
    improvements: strList(r.improvements),
    questionReviews: (r.questionReviews as unknown[]).filter(isObj).map((q) => ({
      ...q,
      question: str(q.question),
      answerSummary: str(q.answerSummary),
      score: num(q.score) ? q.score : 0,
      feedback: str(q.feedback),
      betterAnswer: str(q.betterAnswer),
    })),
    summary: str(r.summary),
    finalMessage: str(r.finalMessage),
  };
}

function sanitizeRecord(v: InterviewRecord): InterviewRecord {
  const config = sanitizeConfig(v.config);
  return {
    ...v,
    lang: LANGS.includes(v.lang) ? v.lang : config.lang,
    config,
    plan: isPlan(v.plan ?? null) ? sanitizePlan(v.plan ?? null) : null,
    transcript: v.transcript.filter(isEntry).map(sanitizeEntry),
    report: sanitizeReport(v.report),
    affinity: num(v.affinity) ? Math.round(clamp(v.affinity, 0, 100)) : INITIAL_AFFINITY,
  };
}

// ───────────── autosave ─────────────

/** The stored session (re-sanitised), or null. Unusable or finished saves are deleted. */
export function loadAutosave(): InterviewSession | null {
  const v = readJson(STORAGE_KEYS.session);
  if (!v) return null;
  if (!isValidSession(v) || v.phase === 'finished') {
    removeKey(STORAGE_KEYS.session);
    return null;
  }
  return sanitizeSession(v);
}

/** Returns false when the session could not be written (storage full or unavailable). */
export function saveAutosave(session: InterviewSession): boolean {
  return writeJson(STORAGE_KEYS.session, session);
}

export function clearAutosave(): void {
  removeKey(STORAGE_KEYS.session);
}

// ───────────── records & endings ─────────────

export function loadRecords(): InterviewRecord[] {
  const v = readJson(STORAGE_KEYS.records);
  if (!Array.isArray(v)) return [];
  return v
    .filter(isValidRecord)
    .map(sanitizeRecord)
    .sort((a, b) => b.finishedAt - a.finishedAt);
}

/** Save records; when the quota is exceeded, drop the oldest ones until it fits. */
export function saveRecords(records: readonly InterviewRecord[]): number {
  for (let n = records.length; n >= 0; n = n > 5 ? n - 5 : n - 1) {
    if (writeJson(STORAGE_KEYS.records, records.slice(0, n))) return n;
    if (n === 0) break;
  }
  return 0;
}

export function loadEndings(): Record<string, number> {
  const v = readJson(STORAGE_KEYS.endings);
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, ts] of Object.entries(v)) {
    const [cid, eid] = k.split(':');
    if (typeof ts === 'number' && CHARACTER_IDS.includes(cid as never) && ENDING_IDS.includes(eid as never)) out[k] = ts;
  }
  return out;
}

export function saveEndings(endings: Record<string, number>): void {
  writeJson(STORAGE_KEYS.endings, endings);
}
