import type { CharacterDef, Lang, TtsEngineKind, SttEngineKind } from '../types';

export interface SpeakOptions {
  lang: Lang;
  character: CharacterDef;
  /** Voice volume 0–1 (already multiplied by master). */
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  /** Mouth openness 0–1 at ~30–60 Hz while speaking (real amplitude for API audio, synthetic for browser TTS). */
  onLevel?: (level: number) => void;
  /**
   * The configured voice failed for this utterance and a fallback was used (API → browser voice,
   * browser voice → silent reading-time wait). Useful for a settings "preview" to show the reason.
   */
  onFallback?: (error: Error) => void;
}

export interface SpeechHandle {
  /**
   * Resolves when speech ends, is stopped, or fails (never rejects). onEnd fires exactly once
   * right before it resolves; onStart fires at most once (also for the silent fallbacks).
   */
  done: Promise<void>;
  stop: () => void;
}

export interface TtsEngine {
  readonly kind: TtsEngineKind;
  isAvailable: () => boolean;
  /** Speak text. Starting a new utterance stops the previous one. */
  speak: (text: string, opts: SpeakOptions) => SpeechHandle;
  /** Warm the cache for text that will be spoken soon (API engine); no-op otherwise. */
  prefetch: (text: string, opts: Pick<SpeakOptions, 'lang' | 'character'>) => void;
  stopAll: () => void;
}

export type SttErrorCode = 'not-supported' | 'permission-denied' | 'no-microphone' | 'no-speech' | 'network' | 'api' | 'aborted' | 'config';

export interface SttErrorOptions {
  cause?: unknown;
  /** The recorded answer, kept when an API transcription failed after recording (see `recording`). */
  recording?: Blob;
  /** HTTP status of a failed transcription request (401, 429, 503…). */
  status?: number;
}

export class SttError extends Error {
  readonly code: SttErrorCode;
  /**
   * API engine only: the recorded audio when the transcription request failed after recording
   * ('api' / 'network' / 'config'). Pass it to `retryTranscription()` instead of re-recording.
   */
  readonly recording?: Blob;
  /**
   * HTTP status of a failed transcription request. Codes: 401/403/404 → 'config' (key / base URL /
   * model), 429 → 'api' (rate limit), 5xx and other statuses → 'api'; no status for 'network'
   * (unreachable, CORS, timeout). `message` carries the English technical detail incl. the provider's reason.
   */
  readonly status?: number;
  constructor(code: SttErrorCode, message: string, opts: SttErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'SttError';
    this.code = code;
    if (opts.recording !== undefined) this.recording = opts.recording;
    if (opts.status !== undefined) this.status = opts.status;
  }
}

export interface ListenOptions {
  lang: Lang;
  /** Live (interim) transcript, browser engine only. Full text so far. */
  onPartial?: (text: string) => void;
  /** Microphone input level 0–1 for the waveform UI. */
  onLevel?: (level: number) => void;
  /** Fired if recognition dies mid-session (network, permission revoked…). */
  onError?: (err: SttError) => void;
}

export interface ListenSession {
  /**
   * Stop listening and resolve with the final transcript ('' if nothing recognised). Rejects with
   * SttError (API engine: 'no-speech' for recordings < 300 ms; for request failures 'config'
   * (HTTP 401/403/404), 'api' (429, 5xx, other statuses) or 'network' (unreachable / CORS /
   * timeout), each carrying `recording` for retryTranscription(); browser engine: only when the
   * session died with an error and nothing was recognised).
   * Idempotent: repeated calls return the same promise.
   */
  stop: () => Promise<string>;
  /** Abort without a result. */
  cancel: () => void;
}

export interface SttEngine {
  readonly kind: SttEngineKind;
  isAvailable: () => boolean;
  /** Request the mic and start listening. Rejects with SttError. */
  start: (opts: ListenOptions) => Promise<ListenSession>;
}
