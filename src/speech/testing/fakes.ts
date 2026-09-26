/**
 * Hand-written fakes of the browser speech / media APIs for the speech unit tests.
 * Test-only: never imported by app code.
 */
import { vi } from 'vitest';
import { createDefaultSettings, type DeepPartial } from '../../store/settings';
import type { Settings } from '../../types';
import type { VoiceLike } from '../tts/voicePicker';

// ───────────── settings ─────────────

export function makeSettings(patch: DeepPartial<Settings> = {}): Settings {
  const base = createDefaultSettings('zh');
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k];
      out[k] =
        v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
          ? merge(cur as Record<string, unknown>, v as Record<string, unknown>)
          : v;
    }
    return out;
  };
  return merge(base as unknown as Record<string, unknown>, patch as Record<string, unknown>) as unknown as Settings;
}

// ───────────── speechSynthesis ─────────────

export function makeVoice(name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike {
  return { voiceURI: extra.voiceURI ?? name, name, lang, localService: extra.localService ?? true, default: extra.default ?? false };
}

type Handler<E> = ((ev: E) => void) | null;

export class FakeUtterance {
  text: string;
  lang = '';
  voice: VoiceLike | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: Handler<object> = null;
  onend: Handler<object> = null;
  onerror: Handler<{ error: string }> = null;
  onboundary: Handler<{ name?: string; charIndex: number }> = null;
  onpause: Handler<object> = null;
  onresume: Handler<object> = null;
  onmark: Handler<object> = null;
  constructor(text = '') {
    this.text = text;
  }
}

/**
 * speechSynthesis fake. By default an utterance starts (onstart) on a microtask once it is at the
 * head of the queue and stays "speaking" until the test calls end() / fail().
 * mode 'ignore' swallows utterances (never speaking, no events) like a broken engine.
 */
export class FakeSpeechSynthesis extends EventTarget {
  voices: VoiceLike[] = [];
  speaking = false;
  pending = false;
  paused = false;
  mode: 'normal' | 'ignore' = 'normal';
  readonly spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  private queue: FakeUtterance[] = [];
  cancelCount = 0;
  pauseCount = 0;
  resumeCount = 0;

  getVoices(): VoiceLike[] {
    return this.voices;
  }

  setVoices(voices: VoiceLike[]): void {
    this.voices = voices;
    this.dispatchEvent(new Event('voiceschanged'));
  }

  speak(u: FakeUtterance): void {
    this.spoken.push(u);
    if (this.mode === 'ignore') return;
    this.queue.push(u);
    if (!this.current) this.advance();
    else this.pending = true;
  }

  cancel(): void {
    this.cancelCount++;
    const all = [this.current, ...this.queue].filter((u): u is FakeUtterance => u !== null);
    this.current = null;
    this.queue = [];
    this.speaking = false;
    this.pending = false;
    for (const u of all) queueMicrotask(() => u.onerror?.({ error: 'interrupted' }));
  }

  pause(): void {
    this.pauseCount++;
    this.paused = true;
  }

  resume(): void {
    this.resumeCount++;
    this.paused = false;
  }

  /** Finish the current utterance normally. */
  end(): void {
    const u = this.current;
    if (!u) return;
    this.advance();
    u.onend?.({});
  }

  /** Fail the current utterance with an error code. */
  fail(code: string): void {
    const u = this.current;
    if (!u) return;
    this.advance();
    u.onerror?.({ error: code });
  }

  /** Stop speaking without firing any event (Chrome's lost-onend bug). */
  endSilently(): void {
    this.advance();
  }

  boundary(): void {
    this.current?.onboundary?.({ name: 'word', charIndex: 0 });
  }

  private advance(): void {
    const next = this.queue.shift() ?? null;
    this.current = next;
    this.speaking = next !== null;
    this.pending = this.queue.length > 0;
    if (next) {
      queueMicrotask(() => {
        if (this.current === next) next.onstart?.({});
      });
    }
  }
}

export function installSpeechSynthesis(synth: FakeSpeechSynthesis): void {
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
}

// ───────────── SpeechRecognition ─────────────

/** A recognition result: text, isFinal and the alternative's confidence (default 0.9). */
export type FakeResult = [text: string, isFinal: boolean, confidence?: number];

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  /** How stop() behaves: 'end' fires onend on the next tick; 'hang' never ends. */
  static stopBehavior: 'end' | 'hang' = 'end';
  /** Whether start() fires onstart automatically. */
  static autoStart = true;

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: Handler<Event> = null;
  onend: Handler<Event> = null;
  onerror: Handler<{ error: string; message?: string }> = null;
  onresult: Handler<{ resultIndex: number; results: unknown }> = null;
  running = false;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  static reset(): void {
    FakeRecognition.instances = [];
    FakeRecognition.stopBehavior = 'end';
    FakeRecognition.autoStart = true;
  }

  static get last(): FakeRecognition {
    const r = FakeRecognition.instances[FakeRecognition.instances.length - 1];
    if (!r) throw new Error('no recognizer created');
    return r;
  }

  start(): void {
    if (this.running) throw Object.assign(new Error('already started'), { name: 'InvalidStateError' });
    this.running = true;
    this.startCalls++;
    if (FakeRecognition.autoStart) queueMicrotask(() => this.onstart?.(new Event('start')));
  }

  stop(): void {
    this.stopCalls++;
    if (FakeRecognition.stopBehavior === 'end') setTimeout(() => this.end(), 0);
  }

  abort(): void {
    this.abortCalls++;
    if (this.running) setTimeout(() => this.end(), 0);
  }

  // test controls
  emitStart(): void {
    this.onstart?.(new Event('start'));
  }

  emitResults(results: FakeResult[], resultIndex = 0): void {
    const list = results.map(([text, isFinal, confidence = 0.9]) => Object.assign([{ transcript: text, confidence }], { isFinal }));
    this.onresult?.({ resultIndex, results: list });
  }

  emitError(error: string, message = ''): void {
    this.onerror?.({ error, message });
  }

  end(): void {
    if (!this.running) return;
    this.running = false;
    this.onend?.(new Event('end'));
  }
}

// ───────────── getUserMedia / MediaStream ─────────────

export class FakeTrack extends EventTarget {
  readonly kind = 'audio';
  readyState: 'live' | 'ended' = 'live';
  readonly stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}

export class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
  get allStopped(): boolean {
    return this.tracks.every((t) => t.stop.mock.calls.length > 0);
  }
}

export function domError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

/** Install navigator.mediaDevices.getUserMedia; returns the mock and the streams it handed out. */
export function installGetUserMedia(impl?: () => Promise<FakeStream>): { getUserMedia: ReturnType<typeof vi.fn>; streams: FakeStream[] } {
  const streams: FakeStream[] = [];
  const getUserMedia = vi.fn(
    impl ??
      (async () => {
        const s = new FakeStream();
        streams.push(s);
        return s;
      }),
  );
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
  return { getUserMedia, streams };
}

export function uninstallGetUserMedia(): void {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
}

// ───────────── MediaRecorder ─────────────

export class FakeMediaRecorder extends EventTarget {
  static supported = ['audio/webm;codecs=opus', 'audio/webm'];
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  readonly mimeType: string;
  readonly stream: unknown;
  timeslice: number | undefined;
  /** Bytes produced when stopped. */
  payload = 'fake-audio-bytes';

  constructor(stream: unknown, opts?: { mimeType?: string }) {
    super();
    this.stream = stream;
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.timeslice = timeslice;
    this.dispatchEvent(new Event('start'));
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    setTimeout(() => {
      const data = new Blob([this.payload], { type: this.mimeType });
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
      this.dispatchEvent(new Event('stop'));
    }, 0);
  }
}

// ───────────── <audio> ─────────────

export class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  /** Make play() reject like an autoplay block. */
  static rejectPlay = false;

  src = '';
  preload = '';
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  duration = Number.NaN;
  paused = true;

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  static reset(): void {
    FakeAudio.instances = [];
    FakeAudio.rejectPlay = false;
  }

  static get last(): FakeAudio {
    const a = FakeAudio.instances[FakeAudio.instances.length - 1];
    if (!a) throw new Error('no audio element created');
    return a;
  }

  play(): Promise<void> {
    if (FakeAudio.rejectPlay) return Promise.reject(domError('NotAllowedError', 'autoplay blocked'));
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {}

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  /** Test control: playback reached the end. */
  finish(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

// ───────────── fetch ─────────────

export interface RecordedRequest {
  url: string;
  init: RequestInit;
}

export function installFetch(respond: (req: RecordedRequest) => Response | Promise<Response>): {
  fetch: ReturnType<typeof vi.fn>;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const req = { url: String(url), init };
    requests.push(req);
    return respond(req);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, requests };
}

export function audioResponse(bytes = 64): Response {
  return new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** URL.createObjectURL / revokeObjectURL stubs (jsdom lacks them). Call restore() afterwards. */
export function installObjectUrls(): { created: string[]; revoked: string[]; restore: () => void } {
  const created: string[] = [];
  const revoked: string[] = [];
  const original = {
    create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  };
  let n = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => {
      const url = `blob:fake/${++n}`;
      created.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revoked.push(url);
    },
  });
  const restore = (): void => {
    for (const [key, desc] of [
      ['createObjectURL', original.create],
      ['revokeObjectURL', original.revoke],
    ] as const) {
      if (desc) Object.defineProperty(URL, key, desc);
      else delete (URL as unknown as Record<string, unknown>)[key];
    }
  };
  return { created, revoked, restore };
}
