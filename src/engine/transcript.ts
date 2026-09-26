/**
 * Read-only transcript queries shared by the engine, AI layer and selectors.
 */
import type { InterviewerTurn, TranscriptEntry, TurnKind } from '../types';

/** Interviewer turn kinds whose answers are scored. */
export const ASSESSABLE_KINDS: readonly TurnKind[] = ['opening', 'main', 'followup'];
/** Interviewer turn kinds that invite the candidate's own questions. */
export const REVERSE_KINDS: readonly TurnKind[] = ['reverse_prompt', 'reverse_answer'];

export function lastEntry(transcript: readonly TranscriptEntry[]): TranscriptEntry | null {
  return transcript.length > 0 ? transcript[transcript.length - 1] : null;
}

/** Index of the last interviewer entry at or before `before` (exclusive upper bound), or -1. */
export function lastInterviewerIndex(transcript: readonly TranscriptEntry[], before = transcript.length): number {
  for (let i = Math.min(before, transcript.length) - 1; i >= 0; i--) {
    if (transcript[i].role === 'interviewer') return i;
  }
  return -1;
}

export function lastInterviewerEntry(transcript: readonly TranscriptEntry[]): TranscriptEntry | null {
  const i = lastInterviewerIndex(transcript);
  return i >= 0 ? transcript[i] : null;
}

export function lastInterviewerTurn(transcript: readonly TranscriptEntry[]): InterviewerTurn | null {
  return lastInterviewerEntry(transcript)?.turn ?? null;
}

/**
 * The pending candidate reply: the last entry when it is a candidate entry, together with the
 * interviewer turn it answers. null when the transcript does not end with a candidate entry.
 */
export function pendingReply(
  transcript: readonly TranscriptEntry[],
): { entry: TranscriptEntry; answered: InterviewerTurn | null } | null {
  const last = lastEntry(transcript);
  if (!last || last.role !== 'candidate') return null;
  const qi = lastInterviewerIndex(transcript, transcript.length - 1);
  return { entry: last, answered: qi >= 0 ? (transcript[qi].turn ?? null) : null };
}

export function isSkipped(entry: TranscriptEntry): boolean {
  return entry.answer?.skipped === true;
}
