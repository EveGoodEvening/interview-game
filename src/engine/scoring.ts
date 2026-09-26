/**
 * Deterministic scoring rules (DESIGN §3 "Scoring & affinity").
 */
import type { EndingId, InterviewSession, InterviewerTurn, TranscriptEntry } from '../types';

export const INITIAL_AFFINITY = 50;
/** Affinity change applied when the candidate skips a question. */
export const SKIP_AFFINITY_PENALTY = -6;
/** Max |affinityDelta| per assessed answer. */
export const MAX_AFFINITY_DELTA = 10;
/** Max |affinityDelta| for reverse-Q&A utterances (the candidate's own questions are not scored). */
export const MAX_REVERSE_AFFINITY_DELTA = 5;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampScore(score: number): number {
  return Math.round(clamp(score, 0, 10));
}

export function clampAffinity(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

export function clampAffinityDelta(delta: number, max = MAX_AFFINITY_DELTA): number {
  return Math.round(clamp(delta, -max, max));
}

/** `finalScore = round(0.8 * overallScore + 0.2 * affinity)`. */
export function computeFinalScore(overallScore: number, affinity: number): number {
  return Math.round(0.8 * clamp(overallScore, 0, 100) + 0.2 * clamp(affinity, 0, 100));
}

/** perfect (≥ 90 and affinity ≥ 80) · offer (≥ 75) · pending (≥ 60) · rejected. */
export function computeEnding(finalScore: number, affinity: number): EndingId {
  if (finalScore >= 90 && affinity >= 80) return 'perfect';
  if (finalScore >= 75) return 'offer';
  if (finalScore >= 60) return 'pending';
  return 'rejected';
}

/**
 * The 0–10 answer rubric mapped onto the 0–100 overall scale. Linear ×10 is too harsh against the
 * ending bands (a candidate who is "specific and solid" (7) on every answer would only reach
 * "pending"), so the anchors are: 5 "adequate" ≈ 55 (borderline), 6 ≈ 65 (pending), 7 "specific
 * and solid" ≈ 75 (offer), 9 "exceptional" ≈ 92 (perfect with high affinity).
 */
const OVERALL_CURVE = [0, 10, 20, 32, 44, 55, 65, 75, 84, 92, 100] as const;

/** Mean answer score (0–10) → overall score (0–100), piecewise linear between the anchors. */
export function answerMeanToOverall(mean: number): number {
  const x = clamp(mean, 0, 10);
  const i = Math.min(9, Math.floor(x));
  return Math.round(OVERALL_CURVE[i] + (OVERALL_CURVE[i + 1] - OVERALL_CURVE[i]) * (x - i));
}

/**
 * Mean in-interview answer score (0–10), or null when nothing was scored.
 * With the transcript, answers are first averaged per topic (the self-introduction is its own group)
 * and then across topics: follow-ups are asked mostly after weak answers, so a flat mean would count
 * a weak topic two or three times and a solid one (no follow-up needed) only once.
 */
export function meanAnswerScore(scores: InterviewSession['scores'], transcript?: readonly TranscriptEntry[]): number | null {
  if (scores.length === 0) return null;
  if (!transcript) return scores.reduce((sum, s) => sum + clamp(s.score, 0, 10), 0) / scores.length;
  const indexById = new Map(transcript.map((e, i) => [e.id, i]));
  const groups = new Map<string, number[]>();
  for (const s of scores) {
    const i = indexById.get(s.entryId);
    const q = i === undefined ? null : lastInterviewerTurnBefore(transcript, i);
    let key = `entry:${s.entryId}`;
    if (q?.kind === 'opening') key = 'intro';
    else if (q && (q.kind === 'main' || q.kind === 'followup') && q.topicIndex !== null) key = `topic:${q.topicIndex}`;
    const list = groups.get(key) ?? [];
    list.push(clamp(s.score, 0, 10));
    groups.set(key, list);
  }
  const means = [...groups.values()].map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  return means.reduce((a, b) => a + b, 0) / means.length;
}

function lastInterviewerTurnBefore(transcript: readonly TranscriptEntry[], index: number): InterviewerTurn | null {
  for (let i = index - 1; i >= 0; i--) if (transcript[i].role === 'interviewer') return transcript[i].turn ?? null;
  return null;
}

/**
 * The overall score (0–100) the in-interview evidence points to, or null when nothing was scored:
 * the (per-topic) mean answer score mapped through the rubric curve.
 */
export function referenceOverall(scores: InterviewSession['scores'], transcript?: readonly TranscriptEntry[]): number | null {
  const mean = meanAnswerScore(scores, transcript);
  return mean === null ? null : answerMeanToOverall(mean);
}

/** Ending the session is heading towards if the report agreed with the per-answer scores. */
export function projectedEnding(scores: InterviewSession['scores'], affinity: number, transcript?: readonly TranscriptEntry[]): EndingId {
  const ref = referenceOverall(scores, transcript) ?? 0;
  return computeEnding(computeFinalScore(ref, affinity), affinity);
}

/**
 * Keep an evaluator's overall score honest and consistent with the in-character final message:
 * 1) within ±`maxDrift` of the per-answer reference (when there is one);
 * 2) inside the band of overall scores that yields `ending` (when given), so the ending stamp
 *    matches the tone of the parting words that were written for it.
 */
export function alignOverallScore(
  overall: number,
  opts: { reference: number | null; affinity: number; ending?: EndingId | null; maxDrift?: number },
): number {
  let value = Math.round(clamp(overall, 0, 100));
  const drift = opts.maxDrift ?? 15;
  if (opts.reference !== null) value = Math.round(clamp(value, opts.reference - drift, opts.reference + drift));
  value = clamp(value, 0, 100);
  if (opts.ending) {
    const target = opts.ending;
    if (computeEnding(computeFinalScore(value, opts.affinity), opts.affinity) !== target) {
      let best: number | null = null;
      for (let o = 0; o <= 100; o++) {
        if (computeEnding(computeFinalScore(o, opts.affinity), opts.affinity) !== target) continue;
        if (best === null || Math.abs(o - value) < Math.abs(best - value)) best = o;
      }
      if (best !== null) value = best;
    }
  }
  return value;
}
