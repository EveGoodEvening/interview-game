/**
 * Glue between low-level audio outputs ("playbacks") and the public SpeechHandle.
 *
 * Every engine's speak() goes through runUtterance(), which
 *  - owns the global voice channel: one interviewer voice at a time across all engine
 *    instances, so a new utterance always stops the previous one;
 *  - guarantees `done` never rejects, `onStart` fires at most once, `onEnd` fires exactly once
 *    (natural end, stop, or failure) and the mouth level returns to 0;
 *  - shields the engine from exceptions thrown by user callbacks.
 */
import { safeCall } from '../env';
import type { SpeakOptions, SpeechHandle } from '../types';

/** A running piece of (possibly silent) speech output. Low-level: does not own the voice channel. */
export interface Playback {
  /** Resolves when output ends, is stopped, or fails. Never rejects. */
  readonly done: Promise<void>;
  stop(): void;
}

export interface PlaybackHooks {
  onStart: () => void;
  onLevel: (level: number) => void;
  onFallback: (error: Error) => void;
}

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let channelOwner: { stop: () => void } | null = null;

/** Stop whatever utterance currently owns the voice channel (any engine). */
export function stopActiveVoice(): void {
  const owner = channelOwner;
  channelOwner = null;
  owner?.stop();
}

/** Wrap a low-level playback into a SpeechHandle (see module doc). */
export function runUtterance(opts: SpeakOptions, start: (hooks: PlaybackHooks) => Playback): SpeechHandle {
  const done = deferred();
  let finished = false;
  let started = false;
  let inner: Playback | null = null;

  const token = { stop: (): void => stop() };

  function finish(): void {
    if (finished) return;
    finished = true;
    inner = null;
    if (channelOwner === token) channelOwner = null;
    safeCall(opts.onLevel, 0);
    safeCall(opts.onEnd);
    done.resolve();
  }

  function stop(): void {
    if (finished) return;
    const current = inner;
    finish();
    current?.stop();
  }

  // Claim the channel first so the previous utterance is silenced before we start.
  const previous = channelOwner;
  channelOwner = token;
  previous?.stop();

  const hooks: PlaybackHooks = {
    onStart: () => {
      if (finished || started) return;
      started = true;
      safeCall(opts.onStart);
    },
    onLevel: (level) => {
      if (!finished) safeCall(opts.onLevel, level);
    },
    onFallback: (error) => {
      if (!finished) safeCall(opts.onFallback, error);
    },
  };

  try {
    const playback = start(hooks);
    if (finished) playback.stop();
    else {
      inner = playback;
      playback.done.then(finish, finish);
    }
  } catch (err) {
    console.error('[speech] failed to start speech', err);
    finish();
  }

  return { done: done.promise, stop };
}

/** A timer that stands in for speech (TTS off, or a voice that failed). */
export function startSilentWait(ms: number, onStart?: () => void): Playback {
  const done = deferred();
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done.resolve();
  };
  const timer = setTimeout(finish, Math.max(0, ms));
  if (onStart) {
    queueMicrotask(() => {
      if (!finished) onStart();
    });
  }
  return { done: done.promise, stop: finish };
}
