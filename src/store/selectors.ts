/**
 * Derived data for the UI. Pure functions of the session / stage / record.
 * OWNER: brain agent. Keep signatures stable.
 */
import { getCharacter } from '../characters';
import { MAX_REVERSE_QUESTIONS } from '../engine/directive';
import { type QAPair, type ReverseQA, pairQuestionsAndAnswers, reverseQuestions } from '../engine/qa';
import { contentUnits, splitSentences } from '../engine/text';
import { REVERSE_KINDS } from '../engine/transcript';
import type { CharacterDef, InterviewRecord, InterviewSession, InterviewerTurn, Lang, Stage, TranscriptEntry } from '../types';

export type { QAPair, ReverseQA } from '../engine/qa';
export { MAX_REVERSE_QUESTIONS } from '../engine/directive';

/** Dimension scores in `InterviewReport.dimensions` are on a 0–100 scale (like overallScore). */
export const DIMENSION_SCORE_MAX = 100;
/** Question review scores are on a 0–10 scale. */
export const QUESTION_SCORE_MAX = 10;

/** The most recent interviewer entry (the question currently being answered). */
export function currentInterviewerEntry(session: InterviewSession | null): TranscriptEntry | null {
  if (!session) return null;
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    if (session.transcript[i].role === 'interviewer') return session.transcript[i];
  }
  return null;
}

export interface ProgressInfo {
  /** 0 during opening/self-intro, 1..total for main topics. */
  mainIndex: number;
  mainTotal: number;
  isFollowUp: boolean;
  phase: InterviewSession['phase'];
  /** Title of the current plan topic, if any. */
  topicTitle: string | null;
}

export function progressInfo(session: InterviewSession | null): ProgressInfo | null {
  if (!session) return null;
  const entry = currentInterviewerEntry(session);
  const topicIndex = session.currentTopicIndex;
  const inTopic = session.phase === 'questioning' && topicIndex >= 0;
  return {
    mainIndex: session.mainAsked,
    mainTotal: session.plan?.topics.length ?? session.config.mainQuestions,
    isFollowUp: entry?.turn?.kind === 'followup',
    phase: session.phase,
    topicTitle: inTopic ? (session.plan?.topics[topicIndex]?.title ?? null) : null,
  };
}

/** The interviewer turn of the current (last) interviewer entry. */
export function currentTurn(session: InterviewSession | null): InterviewerTurn | null {
  return currentInterviewerEntry(session)?.turn ?? null;
}

/**
 * Text to pin on the QuestionCard while the candidate answers: the turn's `question`
 * (falls back to the full line). '' when there is no pending question (e.g. after closing).
 */
export function currentQuestionText(session: InterviewSession | null): string {
  const entry = currentInterviewerEntry(session);
  if (!entry || entry.turn?.kind === 'closing') return '';
  return entry.turn?.question.trim() || entry.text;
}

/** The interviewer entry the stage is presenting (stage 'interviewer'), or null. */
export function presentingEntry(session: InterviewSession | null, stage: Stage): TranscriptEntry | null {
  if (!session || stage.kind !== 'interviewer') return null;
  return session.transcript.find((e) => e.id === stage.entryId) ?? null;
}

/** Character of the session (null without a session). */
export function sessionCharacter(session: InterviewSession | null): CharacterDef | null {
  return session ? getCharacter(session.config.characterId) : null;
}

/** True while the candidate is being asked for their own questions (show "No more questions"). */
export function isReverseQA(session: InterviewSession | null): boolean {
  const kind = currentTurn(session)?.kind;
  return kind !== undefined && REVERSE_KINDS.includes(kind);
}

/** Candidate questions still allowed in the reverse Q&A (0 outside of it). */
export function reverseQuestionsLeft(session: InterviewSession | null): number {
  if (!session || !isReverseQA(session)) return 0;
  return Math.max(0, MAX_REVERSE_QUESTIONS - session.reverseAsked);
}

/** Whether "Skip question" makes sense right now (answer stage, not in the reverse Q&A). */
export function canSkip(session: InterviewSession | null, stage: Stage): boolean {
  return stage.kind === 'answer' && session !== null && !isReverseQA(session);
}

/** Answer time limit for the current question in seconds (0 = unlimited; never applied to reverse Q&A). */
export function answerTimeLimit(session: InterviewSession | null): number {
  if (!session || isReverseQA(session)) return 0;
  return session.config.answerTimeLimitSec;
}

/**
 * Player-visible Q&A list (self-intro, main and follow-up questions with the answers), in order.
 * Pass `withScores` only for post-interview views — scores are private during the interview.
 */
export function qaList(source: Pick<InterviewSession, 'transcript' | 'scores'> | null, withScores = false): QAPair[] {
  if (!source) return [];
  const pairs = pairQuestionsAndAnswers(source.transcript, withScores ? source.scores : []);
  return withScores ? pairs : pairs.map((p) => ({ ...p, score: null, comment: '' }));
}

/** The candidate's own questions from the reverse Q&A, with the interviewer's answers. */
export function reverseQAList(source: Pick<InterviewSession, 'transcript'> | null): ReverseQA[] {
  return source ? reverseQuestions(source.transcript) : [];
}

/** Record → the Q&A pairs with in-interview scores (for the Result / Records screens). */
export function recordQA(record: InterviewRecord): QAPair[] {
  return pairQuestionsAndAnswers(record.transcript, []).map((p, i) => ({
    ...p,
    score: record.report.questionReviews[i]?.score ?? p.score,
  }));
}

/**
 * Split interviewer speech into dialogue-box pages at sentence boundaries: at most ~70 CJK
 * characters or ~140 Latin characters per page. A single over-long sentence is split at commas.
 */
export function speechPages(text: string, lang: Lang): string[] {
  const limit = lang === 'zh' ? 70 : 140;
  const size = (s: string) => (lang === 'zh' ? contentUnits(s) : s.length);
  const pieces: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (size(sentence) <= limit) {
      pieces.push(sentence);
      continue;
    }
    let buf = '';
    for (const part of sentence.split(/(?<=[，,；;：:])/)) {
      if (buf && size(buf + part) > limit) {
        pieces.push(buf.trim());
        buf = '';
      }
      buf += part;
    }
    if (buf.trim()) pieces.push(buf.trim());
  }
  const pages: string[] = [];
  let page = '';
  for (const piece of pieces) {
    const joined = page ? (lang === 'zh' ? page + piece : `${page} ${piece}`) : piece;
    if (page && size(joined) > limit) {
      pages.push(page);
      page = piece;
    } else page = joined;
  }
  if (page) pages.push(page);
  return pages;
}

/**
 * Dialogue pages for an interviewer turn: reaction pages first, then the question as its own
 * final page(s) (the last page is what gets pinned).
 */
export function turnPages(turn: InterviewerTurn, lang: Lang): string[] {
  return [...speechPages(turn.reaction, lang), ...speechPages(turn.question, lang)];
}
