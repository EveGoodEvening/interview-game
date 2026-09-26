/** MediaRecorder wrapper used by the API STT engine. */
import { nowMs } from '../env';

/** Preferred container/codec order: Chrome/Edge/Firefox → webm/opus, Safari → mp4 (AAC). */
export const RECORDER_MIME_CANDIDATES: readonly string[] = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

const STOP_TIMEOUT_MS = 2000;
const TIMESLICE_MS = 250;

export function isRecorderSupported(): boolean {
  return typeof globalThis.MediaRecorder === 'function';
}

/** First supported candidate, or '' to let the browser choose. */
export function pickRecorderMimeType(isSupported: (type: string) => boolean = defaultIsTypeSupported): string {
  for (const type of RECORDER_MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function defaultIsTypeSupported(type: string): boolean {
  return isRecorderSupported() && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type);
}

/** "audio/webm;codecs=opus" → "audio/webm". */
export function baseMimeType(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

/** File extension the transcription endpoint will recognise for a recorder MIME type. */
export function extensionForMime(mime: string): string {
  const base = baseMimeType(mime);
  if (base.includes('webm')) return 'webm';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return 'mp4';
  if (base.includes('ogg') || base.includes('opus')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  return 'webm';
}

export interface Recording {
  blob: Blob;
  /** Container type without codec parameters, e.g. "audio/webm". */
  mimeType: string;
  durationMs: number;
}

export class AudioRecorder {
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private startedAt: number | null = null;
  private stopPromise: Promise<Recording> | null = null;
  private cancelled = false;
  /** Fired when the recorder fails mid-recording. */
  onError: ((err: unknown) => void) | null = null;

  constructor(stream: MediaStream, mimeType: string = pickRecorderMimeType()) {
    this.recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.recorder.addEventListener('dataavailable', (ev: BlobEvent) => {
      if (!this.cancelled && ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    });
    this.recorder.addEventListener('error', (ev: Event) => {
      const err = (ev as Event & { error?: unknown }).error ?? ev;
      this.onError?.(err);
    });
  }

  start(): void {
    this.startedAt = nowMs();
    this.recorder.start(TIMESLICE_MS);
  }

  get mimeType(): string {
    return baseMimeType(this.recorder.mimeType || 'audio/webm');
  }

  /** Stop and collect the recording (resolves even if the recorder never fires `stop`). */
  stop(): Promise<Recording> {
    if (this.stopPromise) return this.stopPromise;
    const durationMs = this.startedAt === null ? 0 : nowMs() - this.startedAt;
    this.stopPromise = new Promise<Recording>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.recorder.removeEventListener('stop', finish);
        const type = this.mimeType;
        resolve({ blob: new Blob(this.chunks, { type }), mimeType: type, durationMs });
      };
      const timer = setTimeout(finish, STOP_TIMEOUT_MS);
      if (this.recorder.state === 'inactive') {
        finish();
        return;
      }
      this.recorder.addEventListener('stop', finish);
      try {
        this.recorder.stop();
      } catch {
        finish();
      }
    });
    return this.stopPromise;
  }

  /** Stop and discard everything. */
  cancel(): void {
    this.cancelled = true;
    this.chunks.length = 0;
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
  }
}
