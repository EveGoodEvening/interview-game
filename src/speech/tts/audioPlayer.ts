/**
 * Plays an audio URL through an <audio> element. When the speech AudioContext is running, the
 * element is routed MediaElementSource → AnalyserNode → Gain → destination so lip-sync gets the
 * real amplitude (the analyser sits before the gain, so volume does not shrink the mouth).
 * Otherwise the element plays directly with `volume` and lip-sync is synthetic.
 *
 * iOS / iPadOS WebKit only lets script play an element that was first played (or loaded) inside a
 * user gesture. primeAudioElement() — called by unlockSpeech() from the app's gesture handler —
 * creates one such element; playbacks reuse it whenever it is free (only one voice plays at a
 * time), and fall back to a fresh element otherwise. A MediaElementSource can be created only once
 * per element, so the primed element keeps its analyser route for its whole life.
 */
import { getSpeechAudioContext, ensureContextRunning, startAnalyserLevel, TTS_LEVEL_OPTIONS } from '../audioLevel';
import { clamp, clamp01, safeCall } from '../env';
import { createSyntheticLipSync, type SyntheticLipSync } from './lipSync';

export type AudioOutcome = 'ended' | 'stopped' | 'error';

export interface AudioPlayback {
  readonly result: Promise<AudioOutcome>;
  /** True once audio actually started playing. */
  readonly started: boolean;
  stop(): void;
}

export interface PlayAudioOptions {
  volume: number;
  /** Playback speed (pitch preserved). */
  rate: number;
  onStart?: () => void;
  onLevel?: (level: number) => void;
}

/** No `playing` event within this time → error (lets the caller fall back). */
const START_TIMEOUT_MS = 10_000;
/** Safety end timer = duration / rate + this. */
const END_GRACE_MS = 3000;

/** The priming play() is abandoned after this long. */
const PRIME_TIMEOUT_MS = 2000;
/** 50 ms of 8 kHz 8-bit mono silence (WAV) used to unlock the element inside a gesture. */
export const SILENT_WAV_DATA_URI = `data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACA${'gICA'.repeat(133)}`;

interface AudioRoute {
  readonly analyser: AnalyserNode;
  readonly ctx: AudioContext;
  setVolume(volume: number): void;
  disconnect(): void;
}

function routeThroughAnalyser(ctx: AudioContext, el: HTMLAudioElement): AudioRoute {
  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  const gain = ctx.createGain();
  source.connect(analyser);
  analyser.connect(gain);
  gain.connect(ctx.destination);
  return {
    analyser,
    ctx,
    setVolume: (volume) => {
      gain.gain.value = clamp01(volume);
    },
    disconnect: () => {
      for (const node of [source, analyser, gain]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}

// ───────────── the gesture-unlocked element ─────────────

interface PrimedElement {
  readonly el: HTMLAudioElement;
  /** Bound for good once created (one MediaElementSource per element). */
  route: AudioRoute | null;
  /** Priming or playing. */
  busy: boolean;
  /** A play() on it succeeded (inside a gesture): script may play it from now on. */
  unlocked: boolean;
}

let primed: PrimedElement | null = null;

function resetElement(el: HTMLAudioElement): void {
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch {
    /* ignore */
  }
}

/**
 * Create the reusable <audio> element and play a muted blip of silence on it. Must run inside a
 * user gesture to count (iOS). Cheap and idempotent: once a priming play() succeeded later calls
 * do nothing; a rejected or unsettled one is tried again on the next call. A no-op without
 * HTMLAudioElement (node).
 */
export function primeAudioElement(): void {
  if (!canPlayAudioElements()) return;
  if (!primed) {
    try {
      primed = { el: new Audio(), route: null, busy: false, unlocked: false };
    } catch {
      return;
    }
  }
  const entry = primed;
  if (entry.unlocked || entry.busy) return;
  const { el } = entry;
  entry.busy = true;
  let settled = false;
  const settle = (unlocked: boolean): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (unlocked) entry.unlocked = true;
    if (primed !== entry) return;
    resetElement(el);
    el.muted = false;
    entry.busy = false;
  };
  // Some engines never settle play() for a muted element: free it anyway (and prime again later).
  const timer = setTimeout(() => settle(false), PRIME_TIMEOUT_MS);
  try {
    el.muted = true;
    el.preload = 'auto';
    el.src = SILENT_WAV_DATA_URI;
    const played = el.play();
    if (played && typeof played.then === 'function') {
      played.then(
        () => settle(true),
        () => settle(false),
      );
    } else settle(true); // old engines: play() returns nothing and cannot report a refusal
  } catch {
    settle(false);
  }
}

/** Test helper: forget the primed element. */
export function resetPrimedAudioElement(): void {
  primed?.route?.disconnect();
  primed = null;
}

/** Test helper: the primed element, if any. */
export function primedAudioElement(): HTMLAudioElement | null {
  return primed?.el ?? null;
}

interface ElementLease {
  readonly el: HTMLAudioElement;
  readonly route: AudioRoute | null;
  release(): void;
}

/**
 * An element for one playback: the primed one when it is free and usable with `ctx` (the running
 * speech context, or null to play without an analyser), else a fresh element.
 */
function acquireElement(ctx: AudioContext | null): ElementLease {
  const entry = primed;
  if (entry && !entry.busy && (!entry.route || entry.route.ctx === ctx)) {
    // A routed element plays only through its context: unusable while that context is not running.
    if (!entry.route && ctx) {
      try {
        entry.route = routeThroughAnalyser(ctx, entry.el);
      } catch {
        entry.route = null;
      }
    }
    entry.busy = true;
    return {
      el: entry.el,
      route: entry.route,
      release: () => {
        resetElement(entry.el);
        entry.busy = false;
      },
    };
  }
  const el = new Audio();
  let route: AudioRoute | null = null;
  if (ctx) {
    try {
      route = routeThroughAnalyser(ctx, el);
    } catch {
      route = null;
    }
  }
  return {
    el,
    route,
    release: () => {
      resetElement(el);
      route?.disconnect();
    },
  };
}

class ElementPlayback implements AudioPlayback {
  readonly result: Promise<AudioOutcome>;
  private resolveResult: (outcome: AudioOutcome) => void = () => {};
  private readonly url: string;
  private readonly opts: PlayAudioOptions;
  private readonly rate: number;
  private lease: ElementLease | null = null;
  private finished = false;
  private isStarted = false;
  private stopLevel: (() => void) | null = null;
  private lip: SyntheticLipSync | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, opts: PlayAudioOptions) {
    this.result = new Promise<AudioOutcome>((resolve) => {
      this.resolveResult = resolve;
    });
    this.url = url;
    this.opts = opts;
    this.rate = clamp(opts.rate, 0.5, 2);
    void this.begin();
  }

  get started(): boolean {
    return this.isStarted;
  }

  stop(): void {
    this.finish('stopped');
  }

  private async begin(): Promise<void> {
    const ctx = getSpeechAudioContext();
    const running = ctx !== null && (await ensureContextRunning(ctx));
    if (this.finished) return;
    let lease: ElementLease;
    try {
      lease = acquireElement(running ? ctx : null);
    } catch (err) {
      console.warn('[speech] could not create an audio element', err);
      this.finish('error');
      return;
    }
    this.lease = lease;
    const { el, route } = lease;
    el.addEventListener('playing', this.onPlaying);
    el.addEventListener('ended', this.onEnded);
    el.addEventListener('error', this.onError);
    el.muted = false;
    el.preload = 'auto';
    el.src = this.url;
    try {
      // The media load algorithm resets playbackRate to defaultPlaybackRate: set both.
      el.defaultPlaybackRate = this.rate;
      el.playbackRate = this.rate;
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    } catch {
      /* unsupported rate: play at 1× */
    }
    route?.setVolume(this.opts.volume);
    el.volume = route ? 1 : clamp01(this.opts.volume);
    this.startTimer = setTimeout(() => this.finish('error'), START_TIMEOUT_MS);
    try {
      await el.play();
    } catch (err) {
      if (!this.finished) {
        console.warn('[speech] audio playback failed', err);
        this.finish('error');
      }
    }
  }

  private readonly onPlaying = (): void => {
    const lease = this.lease;
    if (this.finished || this.isStarted || !lease) return;
    this.isStarted = true;
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    safeCall(this.opts.onStart);
    const onLevel = this.opts.onLevel;
    if (onLevel) {
      if (lease.route) this.stopLevel = startAnalyserLevel(lease.route.analyser, onLevel, TTS_LEVEL_OPTIONS);
      else {
        this.lip = createSyntheticLipSync(onLevel);
        this.lip.setSpeaking(true);
      }
    }
    const duration = lease.el.duration;
    if (Number.isFinite(duration) && duration > 0) {
      this.endTimer = setTimeout(() => this.finish('ended'), (duration / this.rate) * 1000 + END_GRACE_MS);
    }
  };

  private readonly onEnded = (): void => this.finish('ended');

  private readonly onError = (): void => this.finish('error');

  private finish(outcome: AudioOutcome): void {
    if (this.finished) return;
    this.finished = true;
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.stopLevel?.();
    this.lip?.stop();
    const lease = this.lease;
    this.lease = null;
    if (lease) {
      lease.el.removeEventListener('playing', this.onPlaying);
      lease.el.removeEventListener('ended', this.onEnded);
      lease.el.removeEventListener('error', this.onError);
      lease.release();
    }
    this.resolveResult(outcome);
  }
}

export function canPlayAudioElements(): boolean {
  return typeof globalThis.Audio === 'function';
}

/** Play `url`; the result never rejects ('error' when it could not be played). */
export function playAudioUrl(url: string, opts: PlayAudioOptions): AudioPlayback {
  if (!canPlayAudioElements()) {
    return { result: Promise.resolve('error'), started: false, stop: () => {} };
  }
  try {
    return new ElementPlayback(url, opts);
  } catch (err) {
    console.warn('[speech] could not create an audio element', err);
    return { result: Promise.resolve('error'), started: false, stop: () => {} };
  }
}
