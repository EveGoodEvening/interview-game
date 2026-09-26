/**
 * Finished-interview records and ending unlocks.
 */
import type { CharacterId, EndingId, InterviewRecord, InterviewReport, InterviewSession } from '../types';
import { newId } from './ids';
import { computeEnding, computeFinalScore } from './scoring';
import { truncate } from './text';

export const MAX_RECORDS = 30;
export const MAX_RECORD_RESUME_CHARS = 4000;

/** Store the report in the session, compute the final score and ending, mark it finished. */
export function finishSession(session: InterviewSession, report: InterviewReport): InterviewSession {
  const finalScore = computeFinalScore(report.overallScore, session.affinity);
  return { ...session, report, finalScore, ending: computeEnding(finalScore, session.affinity), phase: 'finished' };
}

/** Build the persisted record for a finished session (résumé truncated to 4000 chars). */
export function createRecord(session: InterviewSession, now = Date.now()): InterviewRecord {
  if (!session.report || session.finalScore === null || !session.ending) {
    throw new Error('createRecord: session is not finished');
  }
  return {
    id: newId('r'),
    finishedAt: now,
    characterId: session.config.characterId,
    lang: session.config.lang,
    config: { ...session.config, resumeText: truncate(session.config.resumeText, MAX_RECORD_RESUME_CHARS) },
    plan: session.plan,
    transcript: session.transcript,
    report: session.report,
    ending: session.ending,
    finalScore: session.finalScore,
    affinity: session.affinity,
  };
}

/** Newest first, de-duplicated by id, at most MAX_RECORDS. */
export function addRecord(records: readonly InterviewRecord[], record: InterviewRecord): InterviewRecord[] {
  return [record, ...records.filter((r) => r.id !== record.id)].slice(0, MAX_RECORDS);
}

export function endingKey(characterId: CharacterId, ending: EndingId): string {
  return `${characterId}:${ending}`;
}

/** Record the first unlock time of an ending. `firstTime` is false when it was already unlocked. */
export function unlockEnding(
  endings: Readonly<Record<string, number>>,
  characterId: CharacterId,
  ending: EndingId,
  now = Date.now(),
): { endings: Record<string, number>; firstTime: boolean } {
  const key = endingKey(characterId, ending);
  if (endings[key] !== undefined) return { endings: { ...endings }, firstTime: false };
  return { endings: { ...endings, [key]: now }, firstTime: true };
}
