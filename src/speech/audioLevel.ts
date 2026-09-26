/**
 * Audio level metering shared by TTS lip-sync (API audio) and the microphone meter:
 * one lazily created AudioContext for the speech module, RMS extraction from an AnalyserNode,
 * and a smoother that turns raw RMS into a lively 0–1 value for the UI.
 */
import { clamp01, delay } from './env';
import { startFrameLoop } from './frameLoop';

type AudioContextCtor = new () => AudioContext;

let sharedContext: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** The speech module's AudioContext (created on first use), or null when Web Audio is unavailable. */
export function getSpeechAudioContext(): AudioContext | null {
  if (sharedContext && contextState(sharedContext) !== 'closed') return sharedContext;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    sharedContext = null;
  }
  return sharedContext;
}

/** The speech module's AudioContext if one was created (and not closed); never creates one. */
export function peekSpeechAudioContext(): AudioContext | null {
  return sharedContext && contextState(sharedContext) !== 'closed' ? sharedContext : null;
}

/** Test helper: forget the speech AudioContext. */
export function resetSpeechAudioContext(): void {
  sharedContext = null;
}

/** Read `state` without TypeScript keeping a stale narrowing across awaits. */
function contextState(ctx: AudioContext): string {
  return ctx.state;
}

/**
 * Try to get the context running (browsers keep it suspended until a user gesture).
 * Resolves false if it is still not running after `timeoutMs`.
 */
export async function ensureContextRunning(ctx: AudioContext, timeoutMs = 300): Promise<boolean> {
  const state = contextState(ctx);
  if (state === 'running') return true;
  if (state === 'closed') return false;
  try {
    await Promise.race([ctx.resume(), delay(timeoutMs)]);
  } catch {
    return false;
  }
  return contextState(ctx) === 'running';
}

/** Root-mean-square of 8-bit time-domain samples (128 = silence), 0–1. */
export function rmsOfByteSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export interface LevelSmootherOptions {
  /** RMS below this is treated as silence. */
  floor: number;
  /** Lower bound of the adaptive peak, so quiet noise is not stretched to full scale. */
  minPeak: number;
  /** Per-frame decay of the adaptive peak (≈60 fps). */
  peakDecay: number;
  /** Smoothing factor when the level rises (0–1, higher = snappier). */
  attack: number;
  /** Smoothing factor when the level falls. */
  release: number;
  /** Exponent applied to the normalized value (<1 lifts quiet parts). */
  curve: number;
}

export const TTS_LEVEL_OPTIONS: LevelSmootherOptions = {
  floor: 0.01,
  minPeak: 0.12,
  peakDecay: 0.996,
  attack: 0.6,
  release: 0.25,
  curve: 0.7,
};

export const MIC_LEVEL_OPTIONS: LevelSmootherOptions = {
  floor: 0.012,
  minPeak: 0.06,
  peakDecay: 0.997,
  attack: 0.55,
  release: 0.18,
  curve: 0.65,
};

/** Normalizes raw RMS against a slowly decaying peak, then applies attack/release smoothing. */
export class LevelSmoother {
  private peak: number;
  private level = 0;
  private readonly opts: LevelSmootherOptions;

  constructor(opts: LevelSmootherOptions = TTS_LEVEL_OPTIONS) {
    this.opts = opts;
    this.peak = opts.minPeak;
  }

  next(rms: number): number {
    const o = this.opts;
    const raw = Number.isFinite(rms) ? Math.max(0, rms) : 0;
    this.peak = Math.max(raw, this.peak * o.peakDecay, o.minPeak);
    const normalized = raw <= o.floor ? 0 : clamp01((raw - o.floor) / (this.peak - o.floor));
    const target = Math.pow(normalized, o.curve);
    const k = target > this.level ? o.attack : o.release;
    this.level += (target - this.level) * k;
    if (this.level < 0.002) this.level = 0;
    return clamp01(this.level);
  }

  reset(): void {
    this.level = 0;
    this.peak = this.opts.minPeak;
  }
}

/**
 * Poll an AnalyserNode every animation frame and report a smoothed 0–1 level.
 * Returns a stop function (which reports a final 0).
 */
export function startAnalyserLevel(
  analyser: AnalyserNode,
  onLevel: (level: number) => void,
  opts: LevelSmootherOptions = TTS_LEVEL_OPTIONS,
): () => void {
  const smoother = new LevelSmoother(opts);
  const buffer = new Uint8Array(analyser.fftSize);
  const stopLoop = startFrameLoop(() => {
    analyser.getByteTimeDomainData(buffer);
    onLevel(smoother.next(rmsOfByteSamples(buffer)));
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopLoop();
    onLevel(0);
  };
}
