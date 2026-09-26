/**
 * Pair interviewer questions with the candidate's answers (for the report, prompts and UI).
 */
import type { InterviewSession, Lang, TranscriptEntry, TurnKind } from '../types';
import { MAX_REVERSE_QUESTIONS } from './directive';
import { ASSESSABLE_KINDS, REVERSE_KINDS } from './transcript';

export interface QAPair {
  /** 1-based position among the listed pairs. */
  number: number;
  kind: TurnKind;
  topicIndex: number | null;
  questionEntryId: string;
  /** The pinned question (falls back to the full interviewer text). */
  question: string;
  /** Full interviewer line (reaction + question). */
  questionFull: string;
  answerEntryId: string | null;
  /** '' when unanswered or skipped. */
  answer: string;
  answered: boolean;
  skipped: boolean;
  durationSec: number;
  /** In-interview score (0–10) and private note, when the answer was assessed. */
  score: number | null;
  comment: string;
}

export interface ReverseQA {
  question: string;
  questionEntryId: string;
  /** The interviewer's reply ('' if not answered yet). */
  answer: string;
}

/**
 * Every assessable question (self-intro, main, follow-up) with its answer, in order.
 * Questions that were never answered (e.g. an interrupted session) are included with `answered: false`
 * only when `includeUnanswered` is set.
 */
export function pairQuestionsAndAnswers(
  transcript: readonly TranscriptEntry[],
  scores: InterviewSession['scores'] = [],
  opts: { kinds?: readonly TurnKind[]; includeUnanswered?: boolean } = {},
): QAPair[] {
  const kinds = opts.kinds ?? ASSESSABLE_KINDS;
  const scoreById = new Map(scores.map((s) => [s.entryId, s]));
  const out: QAPair[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const q = transcript[i];
    if (q.role !== 'interviewer' || !q.turn || !kinds.includes(q.turn.kind)) continue;
    const a = transcript[i + 1]?.role === 'candidate' ? transcript[i + 1] : null;
    if (!a && !opts.includeUnanswered) continue;
    const skipped = a?.answer?.skipped === true;
    const scored = a ? scoreById.get(a.id) : undefined;
    out.push({
      number: out.length + 1,
      kind: q.turn.kind,
      topicIndex: q.turn.topicIndex,
      questionEntryId: q.id,
      question: q.turn.question.trim() || q.text,
      questionFull: q.text,
      answerEntryId: a?.id ?? null,
      answer: a && !skipped ? a.text : '',
      answered: a !== null,
      skipped,
      durationSec: a?.answer?.durationSec ?? 0,
      score: scored ? scored.score : skipped ? 0 : null,
      comment: scored?.comment ?? '',
    });
  }
  return out;
}

/** Question text for report reviews: follow-ups are labelled so they read in context. */
export function reviewQuestionLabel(pair: Pick<QAPair, 'kind' | 'question'>, lang: Lang): string {
  if (pair.kind !== 'followup') return pair.question;
  return lang === 'zh' ? `追问：${pair.question}` : `Follow-up: ${pair.question}`;
}

/** The candidate's questions from the reverse Q&A with the interviewer's replies. */
export function reverseQuestions(transcript: readonly TranscriptEntry[]): ReverseQA[] {
  const out: ReverseQA[] = [];
  for (let i = 1; i < transcript.length; i++) {
    const c = transcript[i];
    const prev = transcript[i - 1];
    if (c.role !== 'candidate' || c.answer?.skipped) continue;
    if (prev.role !== 'interviewer' || !prev.turn || !REVERSE_KINDS.includes(prev.turn.kind)) continue;
    const reply = transcript[i + 1]?.role === 'interviewer' ? transcript[i + 1] : null;
    out.push({ question: c.text, questionEntryId: c.id, answer: reply?.turn?.reaction ?? reply?.text ?? '' });
  }
  return out;
}

/**
 * How many questions the candidate actually asked in the reverse Q&A. A reply counts when the
 * interviewer answered it with a `reverse_answer` turn, or when it was the last allowed question and
 * the closing turn answered it. A spoken "no, that's all" (the model chose to close early) and the
 * "No more questions" button do not count.
 */
export function countReverseQuestions(transcript: readonly TranscriptEntry[]): number {
  let asked = 0;
  for (let i = 1; i < transcript.length; i++) {
    const c = transcript[i];
    const prev = transcript[i - 1];
    if (c.role !== 'candidate' || c.answer?.skipped) continue;
    if (prev.role !== 'interviewer' || !prev.turn || !REVERSE_KINDS.includes(prev.turn.kind)) continue;
    const reply = transcript[i + 1];
    const kind = reply?.role === 'interviewer' ? reply.turn?.kind : undefined;
    if (kind === 'reverse_answer' || (kind === 'closing' && asked + 1 >= MAX_REVERSE_QUESTIONS)) asked++;
  }
  return asked;
}
