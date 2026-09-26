/**
 * Synthetic mouth movement for voices whose real amplitude we cannot read
 * (speechSynthesis, or <audio> without Web Audio): a syllable-rate oscillation with a slower
 * phrase envelope, plus pulses on word-boundary events.
 */
import { clamp01 } from '../env';
import { startFrameLoop } from '../frameLoop';

export interface SyntheticLipSync {
  /** The mouth moves while true and eases shut while false. */
  setSpeaking(on: boolean): void;
  /** Extra opening on a word boundary (onboundary). */
  pulse(strength?: number): void;
  /** Stop animating and report 0. Idempotent. */
  stop(): void;
}

const TAU = Math.PI * 2;

/** Target openness at time `t` seconds while speaking (pure; exported for tests). */
export function syntheticMouthTarget(t: number, boundary: number): number {
  const syllable = Math.abs(Math.sin(t * TAU * 3.9)); // ≈ 7.8 openings per second
  const phrase = 0.6 + 0.4 * Math.sin(t * TAU * 0.83 + 1.3);
  const jitter = 0.85 + 0.15 * Math.sin(t * TAU * 11.3 + 0.4);
  return clamp01(0.12 + 0.62 * syllable * phrase * jitter + 0.45 * boundary);
}

const NOOP: SyntheticLipSync = { setSpeaking: () => {}, pulse: () => {}, stop: () => {} };

export function createSyntheticLipSync(onLevel?: (level: number) => void): SyntheticLipSync {
  if (!onLevel) return NOOP;
  const emit = onLevel;
  let speaking = false;
  let stopped = false;
  let level = 0;
  let boundary = 0;
  let t = Math.random() * 10;
  let stopLoop: (() => void) | null = null;

  const tick = (dt: number): void => {
    t += dt / 1000;
    boundary *= Math.exp(-dt / 110);
    const target = speaking ? syntheticMouthTarget(t, boundary) : 0;
    const k = target > level ? 0.55 : 0.3;
    // Frame-rate independent exponential approach.
    level += (target - level) * (1 - Math.pow(1 - k, dt / 16.67));
    if (!speaking && level < 0.01) {
      level = 0;
      emit(0);
      stopLoop?.();
      stopLoop = null;
      return;
    }
    emit(clamp01(level));
  };

  const ensureLoop = (): void => {
    if (!stopLoop && !stopped) stopLoop = startFrameLoop(tick);
  };

  return {
    setSpeaking(on) {
      if (stopped) return;
      speaking = on;
      if (on) ensureLoop();
    },
    pulse(strength = 0.8) {
      if (stopped) return;
      boundary = Math.min(1, boundary + strength);
      ensureLoop();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      speaking = false;
      stopLoop?.();
      stopLoop = null;
      level = 0;
      emit(0);
    },
  };
}
