/**
 * Browser STT via the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 *
 * - `continuous` + `interimResults`; `onPartial` gets final + interim text of the whole answer.
 * - Chrome ends a session after some silence (or ~60 s): while listening we restart it
 *   automatically. Sessions that die immediately without results back off exponentially and,
 *   after several in a row, the session fails (usually the service is unreachable).
 * - A parallel getUserMedia stream feeds the level meter; it is released on stop/cancel.
 * - stop() resolves with the final text after the recognizer's last onend (Chrome flushes
 *   final results on stop), with a 1500 ms safety timeout.
 * - Android Chrome's continuous mode re-delivers results (the same final segment again, growing
 *   versions of it, "final" repeats with confidence 0): on Android only, such repeats are collapsed
 *   (dedupeAndroidResults). Desktop results are used exactly as delivered.
 */
import type { Lang } from '../../types';
import { errorMessage, nowMs, safeCall, SPEECH_LANG_TAG } from '../env';
import { SttError, type ListenOptions, type ListenSession, type SttEngine } from '../types';
import { mapRecognitionError, NETWORK_HINT } from './errors';
import { openMicrophone, releaseStream, startMicMeter, type MicMeter } from './micLevel';

// lib.dom has no SpeechRecognition interface — minimal structural typings.
export interface RecognitionAlternativeLike {
  readonly transcript: string;
  /** 0–1. Android Chrome reports 0 for the provisional repeats of its continuous mode. */
  readonly confidence?: number;
}
export interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternativeLike | undefined;
}
export interface RecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: RecognitionResultLike | undefined;
}
export interface RecognitionResultEventLike {
  readonly resultIndex?: number;
  readonly results: RecognitionResultListLike;
}
export interface RecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: RecognitionErrorEventLike) => void) | null;
  onresult: ((ev: RecognitionResultEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

/** Wait this long for the first `start` event before assuming the recognizer is listening. */
const START_TIMEOUT_MS = 5000;
/** stop() resolves at the latest this long after being called. */
export const STOP_TIMEOUT_MS = 1500;
/** A session that ends sooner than this without any result counts as an immediate failure. */
const IMMEDIATE_END_MS = 1000;
const MAX_IMMEDIATE_FAILURES = 5;
const RESTART_BASE_MS = 250;
const RESTART_MAX_MS = 4000;

export function getRecognitionCtor(): RecognitionCtor | null {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

export function isBrowserSttSupported(): boolean {
  return getRecognitionCtor() !== null;
}

const ENDS_WITH_PUNCT = /[\p{P}]$/u;
const STARTS_WITH_PUNCT = /^[\p{P}]/u;
const LATIN_EDGE = /[A-Za-z0-9]/;

/**
 * Join recognized segments. English: single spaces. Chinese: segments come without punctuation
 * (one per pause), so they are separated with "，" unless punctuation is already there; a space
 * is used between two Latin words ("React" + "Hooks").
 */
export function joinTranscript(parts: readonly string[], lang: Lang): string {
  const clean = parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lang === 'en') return clean.join(' ');
  let out = '';
  for (const part of clean) {
    if (!out) out = part;
    else if (ENDS_WITH_PUNCT.test(out) || STARTS_WITH_PUNCT.test(part)) out += part;
    else if (LATIN_EDGE.test(out[out.length - 1]) && LATIN_EDGE.test(part[0])) out += ` ${part}`;
    else out += `，${part}`;
  }
  return out;
}

/** Android (Chrome) user agent: its continuous recognition repeats results (see dedupeAndroidResults). */
export function isAndroidUserAgent(ua: string | undefined = (globalThis.navigator as Navigator | undefined)?.userAgent): boolean {
  return typeof ua === 'string' && /\bAndroid\b/i.test(ua);
}

/** Comparison key of a recognized segment: case, spaces and punctuation are ignored. */
function segmentKey(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/**
 * Indexes of `parts` to keep when consecutive segments repeat: a segment equal to the previous one
 * or a shorter replay of it is dropped, and a longer version of the previous segment ("我负责" →
 * "我负责订单系统") replaces it. `previous` is the last segment of an earlier recognizer session;
 * only an exact repeat of it is dropped.
 */
export function keepDistinctSegments(parts: readonly string[], previous = ''): number[] {
  const kept: number[] = [];
  let lastKey = segmentKey(previous);
  for (let i = 0; i < parts.length; i++) {
    const key = segmentKey(parts[i]);
    if (!key || key === lastKey) continue;
    if (kept.length > 0) {
      if (lastKey.startsWith(key)) continue;
      if (key.startsWith(lastKey)) kept.pop();
    }
    kept.push(i);
    lastKey = key;
  }
  return kept;
}

export interface FinalSegment {
  readonly text: string;
  readonly confidence?: number;
}

/**
 * Collapse Android Chrome's repeated results for one recognizer session. A "final" result with
 * confidence 0 is dropped when it repeats (or is the start of) a confirmed final of the session or
 * repeats the last segment of the previous session; otherwise it is kept, so nothing is lost on a
 * device that reports 0 for everything. Then consecutive repeats are collapsed
 * (keepDistinctSegments), the interim text included: an interim that grows the last final replaces it.
 */
export function dedupeAndroidResults(
  finals: readonly FinalSegment[],
  interim: string,
  previous = '',
): { finals: string[]; interim: string } {
  const prevKey = segmentKey(previous);
  const confirmedKeys = finals.filter((f) => f.confidence !== 0).map((f) => segmentKey(f.text));
  const kept = finals
    .filter((f) => {
      if (f.confidence !== 0) return true;
      const key = segmentKey(f.text);
      return key !== prevKey && !confirmedKeys.some((k) => k.startsWith(key));
    })
    .map((f) => f.text);
  const parts = interim ? [...kept, interim] : kept;
  const keep = keepDistinctSegments(parts, previous);
  return {
    finals: keep.filter((i) => i < kept.length).map((i) => kept[i]),
    interim: interim && keep.includes(parts.length - 1) ? interim : '',
  };
}

type State = 'starting' | 'listening' | 'restarting' | 'stopping' | 'ended';

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: SttError) => void;
}

function isInvalidStateError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'InvalidStateError';
}

class BrowserListenSession implements ListenSession {
  private readonly rec: RecognitionLike;
  private readonly opts: ListenOptions;
  /** Collapse Android Chrome's repeated results (see dedupeAndroidResults). */
  private readonly android = isAndroidUserAgent();
  private state: State = 'starting';
  private stream: MediaStream | null;
  private meter: MicMeter | null = null;
  private meterDropped = false;
  /** Text of recognizer sessions that already ended. */
  private readonly committed: string[] = [];
  private sessionFinals: string[] = [];
  private interim = '';
  private lastPartial = '';
  private sessionStartedAt: number | null = null;
  private sessionHadResult = false;
  private immediateFailures = 0;
  private lastError: SttError | null = null;
  private fatal: SttError | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private startWaiter: Waiter<void> | null = null;
  private stopWaiter: Waiter<string> | null = null;
  private stopPromise: Promise<string> | null = null;

  constructor(Ctor: RecognitionCtor, opts: ListenOptions, stream: MediaStream | null) {
    this.opts = opts;
    this.stream = stream;
    this.rec = new Ctor();
    this.rec.lang = SPEECH_LANG_TAG[opts.lang];
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;
    this.rec.onstart = () => this.handleStart();
    this.rec.onresult = (ev) => this.handleResult(ev);
    this.rec.onerror = (ev) => this.handleError(ev.error, ev.message ?? '');
    this.rec.onend = () => this.handleEnd();
  }

  /** Start the first recognizer session; resolves once it listens, rejects with SttError. */
  begin(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // No `start` event yet (and no error): assume it listens, but keep the state so a pending
      // restart still happens and the real `start` event switches to 'listening'.
      const timer = setTimeout(() => this.resolveStart(), START_TIMEOUT_MS);
      this.startWaiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.startRecognizer();
    });
  }

  stop(): Promise<string> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise<string>((resolve, reject) => {
      this.stopWaiter = { resolve, reject };
    });
    this.releaseMic();
    if (this.state === 'ended') {
      this.settleStop();
    } else if (this.state !== 'listening') {
      // Between sessions (restart pending) or not started yet: nothing more will arrive.
      this.endNow();
      this.settleStop();
      this.abortRecognizer();
    } else {
      this.state = 'stopping';
      try {
        this.rec.stop();
        this.stopTimer = setTimeout(() => {
          if (this.state !== 'stopping') return;
          // The recognizer never delivered its final onend: keep what we have and kill it.
          this.endNow();
          this.settleStop();
          this.abortRecognizer();
        }, STOP_TIMEOUT_MS);
      } catch {
        this.endNow();
        this.settleStop();
        this.abortRecognizer();
      }
    }
    return this.stopPromise;
  }

  cancel(): void {
    const wasEnded = this.state === 'ended';
    this.state = 'ended';
    this.clearTimers();
    this.detach();
    this.releaseMic();
    if (!wasEnded) this.abortRecognizer();
    const aborted = new SttError('aborted', 'Listening was cancelled.');
    const stopWaiter = this.stopWaiter;
    const startWaiter = this.startWaiter;
    this.stopWaiter = null;
    this.startWaiter = null;
    stopWaiter?.reject(aborted);
    startWaiter?.reject(aborted);
  }

  // ── recognizer events ──

  private handleStart(): void {
    this.sessionStartedAt = nowMs();
    this.sessionHadResult = false;
    if (this.state === 'starting' || this.state === 'restarting') this.markListening();
  }

  private handleResult(ev: RecognitionResultEventLike): void {
    if (this.state === 'ended') return;
    // `results` holds every result of this recognizer session, so the session's text is rebuilt from it.
    const finals: FinalSegment[] = [];
    let interim = '';
    const { results } = ev;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;
      const alt = result[0];
      const text = alt?.transcript ?? '';
      if (result.isFinal) {
        if (text.trim()) finals.push({ text: text.trim(), confidence: alt?.confidence });
      } else interim += text;
    }
    interim = interim.replace(/\s+/g, ' ').trim();
    if (finals.length > 0 || interim) {
      this.sessionHadResult = true;
      this.immediateFailures = 0;
    }
    if (this.android) {
      const clean = dedupeAndroidResults(finals, interim, this.committed[this.committed.length - 1]);
      this.sessionFinals = clean.finals;
      this.interim = clean.interim;
    } else {
      this.sessionFinals = finals.map((f) => f.text);
      this.interim = interim;
    }
    this.emitPartial();
  }

  private handleError(code: string, detail: string): void {
    if (this.state === 'ended') return;
    // Our own abort() after the stop timeout.
    if (code === 'aborted' && this.state === 'stopping') return;
    const err = mapRecognitionError(code, detail);
    if (!err) return; // 'no-speech': onend follows and we restart
    this.lastError = err;
    // Some platforms (Android) cannot share the mic with our meter stream: drop the meter, retry.
    if (err.code === 'no-microphone' && this.stream && !this.meterDropped) {
      this.meterDropped = true;
      this.releaseMic();
      return;
    }
    if (this.state === 'stopping') {
      this.fatal = err; // keep what we have; onend (or the timeout) settles stop()
      return;
    }
    this.die(err);
  }

  private handleEnd(): void {
    if (this.state === 'ended') return;
    if (this.state === 'stopping') {
      this.endNow();
      this.settleStop();
      return;
    }
    this.commitSession();
    const lived = this.sessionStartedAt === null ? 0 : nowMs() - this.sessionStartedAt;
    const immediate = !this.sessionHadResult && lived < IMMEDIATE_END_MS;
    this.immediateFailures = immediate ? this.immediateFailures + 1 : 0;
    if (this.immediateFailures >= MAX_IMMEDIATE_FAILURES) {
      this.die(
        this.lastError ?? new SttError('network', `Speech recognition keeps stopping right after it starts. ${NETWORK_HINT}`),
      );
      return;
    }
    const backoff =
      this.immediateFailures === 0 ? 0 : Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** (this.immediateFailures - 1));
    if (this.state !== 'starting') this.state = 'restarting';
    this.restartTimer = setTimeout(() => this.restart(), backoff);
  }

  // ── internals ──

  private markListening(): void {
    this.state = 'listening';
    this.resolveStart();
  }

  private resolveStart(): void {
    const waiter = this.startWaiter;
    this.startWaiter = null;
    waiter?.resolve();
    if (!this.meter && this.stream && !this.meterDropped) this.meter = startMicMeter(this.stream, this.opts.onLevel);
  }

  private restart(): void {
    this.restartTimer = null;
    if (this.state !== 'restarting' && this.state !== 'starting') return;
    this.sessionFinals = [];
    this.interim = '';
    this.sessionStartedAt = null;
    this.sessionHadResult = false;
    this.startRecognizer();
  }

  private startRecognizer(): void {
    try {
      this.rec.start();
    } catch (err) {
      if (isInvalidStateError(err)) return; // still running; its onend will follow
      const failure = new SttError('not-supported', `Speech recognition could not start: ${errorMessage(err)}`, { cause: err });
      this.lastError = failure;
      if (this.state === 'starting') this.die(failure);
      else this.handleEnd();
    }
  }

  private die(err: SttError): void {
    if (this.state === 'ended') return;
    this.fatal = err;
    this.endNow();
    this.abortRecognizer();
    const startWaiter = this.startWaiter;
    if (startWaiter) {
      this.startWaiter = null;
      startWaiter.reject(err);
      return;
    }
    if (this.stopWaiter) {
      this.settleStop();
      return;
    }
    safeCall(this.opts.onError, err);
  }

  /** Move the current session's text into `committed` and stop everything except a pending stop(). */
  private endNow(): void {
    this.commitSession();
    this.state = 'ended';
    this.clearTimers();
    this.releaseMic();
  }

  private settleStop(): void {
    const waiter = this.stopWaiter;
    if (!waiter) return;
    this.stopWaiter = null;
    this.clearTimers();
    this.detach();
    this.releaseMic();
    const text = this.text();
    if (!text && this.fatal) waiter.reject(this.fatal);
    else waiter.resolve(text);
  }

  private commitSession(): void {
    const parts = [...this.sessionFinals];
    if (this.interim) parts.push(this.interim);
    if (parts.length) this.committed.push(...parts);
    this.sessionFinals = [];
    this.interim = '';
  }

  private text(): string {
    return joinTranscript([...this.committed, ...this.sessionFinals, this.interim], this.opts.lang);
  }

  private emitPartial(): void {
    const full = this.text();
    if (full === this.lastPartial) return;
    this.lastPartial = full;
    safeCall(this.opts.onPartial, full);
  }

  private clearTimers(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.restartTimer = null;
    this.stopTimer = null;
  }

  private detach(): void {
    this.rec.onstart = null;
    this.rec.onresult = null;
    this.rec.onerror = null;
    this.rec.onend = null;
  }

  private abortRecognizer(): void {
    try {
      this.rec.abort();
    } catch {
      /* ignore */
    }
  }

  private releaseMic(): void {
    this.meter?.stop();
    this.meter = null;
    releaseStream(this.stream);
    this.stream = null;
  }
}

export function createBrowserStt(): SttEngine {
  return {
    kind: 'browser',
    isAvailable: isBrowserSttSupported,
    async start(opts) {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        throw new SttError(
          'not-supported',
          'This browser has no built-in speech recognition. Use Chrome or Edge, or switch the recognition engine to "API" or keyboard.',
        );
      }
      // The mic stream drives the level meter and surfaces permission problems early.
      let stream: MediaStream | null = null;
      try {
        stream = await openMicrophone();
      } catch (err) {
        // Anything else (e.g. no getUserMedia): no level meter, but the recognizer may still work.
        if (err instanceof SttError && (err.code === 'permission-denied' || err.code === 'no-microphone')) throw err;
      }
      let session: BrowserListenSession;
      try {
        session = new BrowserListenSession(Ctor, opts, stream);
      } catch (err) {
        releaseStream(stream);
        throw new SttError('not-supported', `Speech recognition is unavailable: ${errorMessage(err)}`, { cause: err });
      }
      await session.begin();
      return session;
    },
  };
}
