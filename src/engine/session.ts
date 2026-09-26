/**
 * Pure session state transitions. Every function returns a new session object (no mutation),
 * together with whatever the store needs to emit UI events.
 */
import type {
  AnswerVia,
  Difficulty,
  InterviewConfig,
  InterviewPlan,
  InterviewSession,
  InterviewStyle,
  InterviewerTurn,
  SessionPhase,
  TranscriptEntry,
  TurnDirective,
  TurnKind,
} from '../types';
import { CANNED } from './canned';
import { newId } from './ids';
import {
  INITIAL_AFFINITY,
  MAX_REVERSE_AFFINITY_DELTA,
  SKIP_AFFINITY_PENALTY,
  clampAffinity,
  clampAffinityDelta,
  clampScore,
} from './scoring';
import { joinSpeech, splitReactionQuestion } from './text';
import { ASSESSABLE_KINDS, REVERSE_KINDS, isSkipped, lastEntry, pendingReply } from './transcript';

/** Longest candidate answer kept in the transcript (characters). */
export const MAX_ANSWER_CHARS = 8000;
export const MIN_MAIN_QUESTIONS = 1;
export const MAX_MAIN_QUESTIONS = 12;
export const MAX_FOLLOW_UPS = 3;
/** Résumé cap for sessions (matches resume/MAX_RESUME_CHARS). */
export const MAX_SESSION_RESUME_CHARS = 20000;

/** Chapter card to show before the next interviewer line. */
export interface ChapterInfo {
  phase: SessionPhase;
  topicIndex: number | null;
  topicTitle: string | null;
}

const INTERVIEW_STYLES: readonly InterviewStyle[] = ['behavioral', 'technical', 'mixed'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

function toInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Clamp numeric options, trim free text and replace missing / unknown values with defaults so the
 * rest of the engine can trust the config. Also applied to configs loaded from storage (autosaves
 * and records from older builds or edited by hand), so it must accept partial objects.
 */
export function sanitizeConfig(config: InterviewConfig): InterviewConfig {
  return {
    ...config,
    resumeText: str(config.resumeText).slice(0, MAX_SESSION_RESUME_CHARS),
    resumeFileName: str(config.resumeFileName).trim(),
    targetRole: str(config.targetRole).trim(),
    jobDescription: str(config.jobDescription).trim(),
    style: oneOf(config.style, INTERVIEW_STYLES, 'mixed'),
    difficulty: oneOf(config.difficulty, DIFFICULTIES, 'normal'),
    mainQuestions: Math.min(MAX_MAIN_QUESTIONS, Math.max(MIN_MAIN_QUESTIONS, toInt(config.mainQuestions, 5))),
    maxFollowUps: Math.min(MAX_FOLLOW_UPS, Math.max(0, toInt(config.maxFollowUps, 2))),
    answerTimeLimitSec: Math.max(0, toInt(config.answerTimeLimitSec, 0)),
  };
}

export function createSession(config: InterviewConfig, now = Date.now()): InterviewSession {
  return {
    id: newId('s'),
    createdAt: now,
    config: sanitizeConfig(config),
    plan: null,
    phase: 'preparing',
    transcript: [],
    currentTopicIndex: -1,
    mainAsked: 0,
    followUpsOnCurrent: 0,
    reverseAsked: 0,
    affinity: INITIAL_AFFINITY,
    scores: [],
    report: null,
    ending: null,
    finalScore: null,
  };
}

export function makeInterviewerEntry(turn: InterviewerTurn, session: InterviewSession, now = Date.now()): TranscriptEntry {
  return {
    id: newId('e'),
    role: 'interviewer',
    text: joinSpeech([turn.reaction, turn.question], session.config.lang),
    turn,
    at: now,
  };
}

export function makeCandidateEntry(
  text: string,
  meta: { via: AnswerVia; durationSec: number; skipped: boolean },
  now = Date.now(),
): TranscriptEntry {
  return {
    id: newId('e'),
    role: 'candidate',
    text,
    answer: { via: meta.via, durationSec: Math.max(0, Math.round(meta.durationSec * 10) / 10), skipped: meta.skipped },
    at: now,
  };
}

/** The opening line as an interviewer turn: greeting in `reaction`, self-intro request in `question`. */
export function openingTurn(plan: InterviewPlan, session: InterviewSession): InterviewerTurn {
  const lang = session.config.lang;
  const split = splitReactionQuestion(plan.opening.speech, lang);
  return {
    kind: 'opening',
    reaction: split.reaction,
    question: split.question || CANNED.selfIntro[lang],
    expression: plan.opening.expression,
    topicIndex: null,
    assessment: null,
  };
}

/** Store the plan, enter the intro phase and append the opening line. */
export function applyPlan(
  session: InterviewSession,
  plan: InterviewPlan,
  now = Date.now(),
): { session: InterviewSession; entry: TranscriptEntry; chapter: ChapterInfo } {
  const entry = makeInterviewerEntry(openingTurn(plan, session), session, now);
  return {
    session: { ...session, plan, phase: 'intro', transcript: [...session.transcript, entry] },
    entry,
    chapter: { phase: 'intro', topicIndex: null, topicTitle: null },
  };
}

/** Append the candidate's answer. */
export function applyAnswer(
  session: InterviewSession,
  text: string,
  meta: { via: AnswerVia; durationSec: number },
  now = Date.now(),
): { session: InterviewSession; entry: TranscriptEntry } {
  const entry = makeCandidateEntry(text.trim().slice(0, MAX_ANSWER_CHARS), { ...meta, skipped: false }, now);
  return { session: { ...session, transcript: [...session.transcript, entry] }, entry };
}

/**
 * Append a skipped answer. A skipped *question* scores 0 and costs affinity immediately (the AI is
 * not asked to judge it). In the reverse Q&A a skip means "no more questions" and has no penalty.
 */
export function applySkip(
  session: InterviewSession,
  opts: { text?: string; now?: number } = {},
): { session: InterviewSession; entry: TranscriptEntry; affinityDelta: number } {
  const now = opts.now ?? Date.now();
  const answered = pendingQuestionKind(session);
  const entry = makeCandidateEntry(opts.text ?? '', { via: 'text', durationSec: 0, skipped: true }, now);
  let next: InterviewSession = { ...session, transcript: [...session.transcript, entry] };
  let affinityDelta = 0;
  if (answered && ASSESSABLE_KINDS.includes(answered)) {
    const affinity = clampAffinity(session.affinity + SKIP_AFFINITY_PENALTY);
    affinityDelta = affinity - session.affinity;
    next = {
      ...next,
      affinity,
      scores: [...next.scores, { entryId: entry.id, score: 0, comment: '' }],
    };
  }
  return { session: next, entry, affinityDelta };
}

/** Kind of the interviewer turn awaiting an answer (the last entry), or null. */
export function pendingQuestionKind(session: InterviewSession): TurnKind | null {
  const last = lastEntry(session.transcript);
  return last?.role === 'interviewer' ? (last.turn?.kind ?? null) : null;
}

/** Synthetic "no more questions" entry for endReverseQA (recorded as a skipped reply). */
export function applyEndReverse(session: InterviewSession, now = Date.now()) {
  return applySkip(session, { text: CANNED.noMoreQuestions[session.config.lang], now });
}

/**
 * Apply an interviewer turn (already coerced to its directive): record the assessment of the
 * candidate's latest reply, update affinity, counters and phase, and append the entry.
 */
export function applyTurn(
  session: InterviewSession,
  turn: InterviewerTurn,
  directive: TurnDirective,
  now = Date.now(),
): { session: InterviewSession; entry: TranscriptEntry; chapter: ChapterInfo | null; affinityDelta: number } {
  let next: InterviewSession = { ...session };
  let affinityDelta = 0;

  // 1) Assessment of the reply this turn responds to.
  const reply = pendingReply(session.transcript);
  if (reply && turn.assessment && !isSkipped(reply.entry)) {
    const answeredKind = reply.answered?.kind ?? null;
    const alreadyScored = session.scores.some((s) => s.entryId === reply.entry.id);
    if (answeredKind && ASSESSABLE_KINDS.includes(answeredKind) && !alreadyScored) {
      next.scores = [
        ...session.scores,
        { entryId: reply.entry.id, score: clampScore(turn.assessment.score), comment: turn.assessment.comment },
      ];
      const affinity = clampAffinity(session.affinity + clampAffinityDelta(turn.assessment.affinityDelta));
      affinityDelta = affinity - session.affinity;
      next.affinity = affinity;
    } else if (answeredKind && REVERSE_KINDS.includes(answeredKind)) {
      const affinity = clampAffinity(
        session.affinity + clampAffinityDelta(turn.assessment.affinityDelta, MAX_REVERSE_AFFINITY_DELTA),
      );
      affinityDelta = affinity - session.affinity;
      next.affinity = affinity;
    }
  }

  // 2) Counters, phase and chapter card.
  let chapter: ChapterInfo | null = null;
  switch (turn.kind) {
    case 'main': {
      const ti = turn.topicIndex ?? Math.max(0, session.currentTopicIndex + 1);
      next = { ...next, phase: 'questioning', currentTopicIndex: ti, mainAsked: session.mainAsked + 1, followUpsOnCurrent: 0 };
      chapter = { phase: 'questioning', topicIndex: ti, topicTitle: session.plan?.topics[ti]?.title ?? null };
      break;
    }
    case 'followup':
      next = { ...next, phase: 'questioning', followUpsOnCurrent: session.followUpsOnCurrent + 1 };
      break;
    case 'reverse_prompt':
      next = { ...next, phase: 'reverse' };
      chapter = { phase: 'reverse', topicIndex: null, topicTitle: null };
      break;
    case 'reverse_answer':
      next = { ...next, phase: 'reverse', reverseAsked: session.reverseAsked + 1 };
      break;
    case 'closing': {
      // The 3rd reverse question is answered inside the closing turn.
      const answeredQuestion =
        directive.type === 'closing' &&
        reply !== null &&
        !isSkipped(reply.entry) &&
        reply.answered !== null &&
        REVERSE_KINDS.includes(reply.answered.kind);
      next = { ...next, phase: 'closing', reverseAsked: session.reverseAsked + (answeredQuestion ? 1 : 0) };
      chapter = { phase: 'closing', topicIndex: null, topicTitle: null };
      break;
    }
    case 'opening':
      next = { ...next, phase: 'intro' };
      break;
  }

  const entry = makeInterviewerEntry(turn, session, now);
  next.transcript = [...session.transcript, entry];
  return { session: next, entry, chapter, affinityDelta };
}

/** Enter the evaluation phase (after the closing line has been presented). */
export function beginEvaluation(session: InterviewSession): InterviewSession {
  return { ...session, phase: 'evaluating' };
}
