/**
 * Pure timing math for the look-ahead scheduler ("A Tale of Two Clocks"): a coarse JS timer wakes
 * up every TICK_MS and schedules every step that falls inside the next LOOKAHEAD_SEC on the precise
 * AudioContext clock.
 */

/** How far ahead notes are scheduled (s). Generous, so React renders / GC pauses never cause gaps. */
export const LOOKAHEAD_SEC = 0.3;
/** Timer period (ms). */
export const TICK_MS = 60;
/** If the timer fell further behind than this (s), skip ahead instead of bursting late notes. */
export const MAX_LATENESS_SEC = 0.08;
/** Safety cap on steps scheduled in a single tick. */
export const MAX_STEPS_PER_TICK = 32;

export interface ClockState {
  /** Global step counter (not wrapped). */
  step: number;
  /** Unswung audio time of `step`. */
  time: number;
}

export interface DueStep {
  step: number;
  /** Audio time to play at (swing applied). */
  time: number;
}

export function stepDuration(bpm: number, stepsPerBeat: number): number {
  return 60 / bpm / stepsPerBeat;
}

/** Swing delays every odd step by `swing` × step duration (0 = straight, ~0.33 = triplet feel). */
export function swingOffset(step: number, stepDur: number, swing: number): number {
  return step % 2 === 1 ? swing * stepDur : 0;
}

/**
 * Collect the steps due in [now, now + lookahead). If the clock fell behind (background tab,
 * suspended context), it jumps forward on the step grid so the song position stays consistent
 * and no burst of stale notes is played.
 */
export function collectDueSteps(
  state: ClockState,
  now: number,
  stepDur: number,
  swing = 0,
  lookahead = LOOKAHEAD_SEC,
): { due: DueStep[]; next: ClockState } {
  let { step, time } = state;
  if (time < now - MAX_LATENESS_SEC) {
    const skipped = Math.ceil((now - time) / stepDur);
    step += skipped;
    time += skipped * stepDur;
  }
  const due: DueStep[] = [];
  const horizon = now + lookahead;
  while (time < horizon && due.length < MAX_STEPS_PER_TICK) {
    due.push({ step, time: time + swingOffset(step, stepDur, swing) });
    step++;
    time += stepDur;
  }
  return { due, next: { step, time } };
}

/** Deterministic PRNG (mulberry32) for humanisation — same song every time. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
