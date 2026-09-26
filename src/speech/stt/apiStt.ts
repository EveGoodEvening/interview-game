/**
 * API STT: record with MediaRecorder, then POST multipart `{base}/audio/transcriptions`
 * (OpenAI / Groq / SiliconFlow / any OpenAI-compatible endpoint). No live partials: the UI
 * shows a timer and the level meter while recording.
 */
import { apiUrl, proxyHeaders } from '../../llm/http';
import type { Lang, Settings, SttSettings } from '../../types';
import { effectiveUseProxy, errorMessage, getMediaDevices, safeCall } from '../env';
import { bearer, HttpTimeoutError, readErrorMessage, requestWithTimeout } from '../httpUtil';
import { SttError, type ListenOptions, type ListenSession, type SttEngine } from '../types';
import { openMicrophone, releaseStream, startMicMeter, type MicMeter } from './micLevel';
import { AudioRecorder, baseMimeType, extensionForMime, isRecorderSupported, type Recording } from './recorder';

/** Recordings shorter than this are rejected as 'no-speech' (accidental taps). */
export const MIN_RECORDING_MS = 300;
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

type SttApiConfig = Pick<SttSettings, 'apiBaseUrl' | 'apiKey' | 'apiModel' | 'useProxy'>;

export function isApiSttConfigured(cfg: Pick<SttSettings, 'apiBaseUrl' | 'apiModel'>): boolean {
  return cfg.apiBaseUrl.trim() !== '' && cfg.apiModel.trim() !== '';
}

/** Extract the text from a transcription response (JSON `{text}` or plain text). */
export function parseTranscription(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  let text = trimmed;
  try {
    const data: unknown = JSON.parse(trimmed);
    if (typeof data === 'string') text = data;
    else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      text = typeof obj.text === 'string' ? obj.text : typeof obj.transcript === 'string' ? obj.transcript : '';
    }
  } catch {
    /* plain text body */
  }
  // SenseVoice-style tags such as <|zh|><|NEUTRAL|>.
  return text.replace(/<\|[^|>]*\|>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * SttError for a non-2xx transcription response. The provider's reason is kept in the message
 * (the UI shows it as a details line) and the status in `status`:
 * 401/403 (key) and 404 (base URL / model) → 'config'; 429 (rate limit), 5xx and the rest → 'api'.
 */
export function transcriptionHttpError(status: number, reason: string, recording?: Blob): SttError {
  const detail = reason ? `: ${reason}` : '';
  const opts = { status, recording };
  if (status === 401 || status === 403) {
    return new SttError(
      'config',
      `The transcription service rejected the request (HTTP ${status})${detail}. Check the API key in Config → Voice.`,
      opts,
    );
  }
  if (status === 404) {
    return new SttError(
      'config',
      `The transcription endpoint was not found (HTTP 404)${detail}. Check the base URL and model in Config → Voice.`,
      opts,
    );
  }
  if (status === 429) {
    return new SttError('api', `The transcription service is rate-limiting requests (HTTP 429)${detail}. Wait a moment and retry.`, opts);
  }
  if (status >= 500) {
    return new SttError('api', `The transcription service had a server error (HTTP ${status})${detail}. Retry in a moment.`, opts);
  }
  return new SttError('api', `Transcription failed (HTTP ${status})${detail}.`, opts);
}

/**
 * POST the recording and return the transcript. Rejects with SttError; every failure after the
 * request was attempted (except a cancel) carries the recording in `SttError.recording`.
 */
export async function transcribeRecording(
  recording: Pick<Recording, 'blob' | 'mimeType'>,
  cfg: SttApiConfig,
  lang: Lang,
  signal?: AbortSignal,
): Promise<string> {
  const useProxy = effectiveUseProxy(cfg.useProxy);
  const url = apiUrl(cfg.apiBaseUrl, '/audio/transcriptions', useProxy);
  const form = new FormData();
  form.append('file', recording.blob, `answer.${extensionForMime(recording.mimeType)}`);
  form.append('model', cfg.apiModel.trim());
  form.append('language', lang);
  form.append('response_format', 'json');
  const init: RequestInit = {
    method: 'POST',
    // No Content-Type: the browser sets the multipart boundary.
    headers: { ...bearer(cfg.apiKey), ...proxyHeaders(useProxy) },
    body: form,
  };
  const kept = recording.blob;
  try {
    return await requestWithTimeout(
      url,
      init,
      TRANSCRIBE_TIMEOUT_MS,
      async (res) => {
        if (!res.ok) throw transcriptionHttpError(res.status, await readErrorMessage(res), kept);
        return parseTranscription(await res.text());
      },
      signal,
    );
  } catch (err) {
    if (err instanceof SttError) throw err;
    if (signal?.aborted) throw new SttError('aborted', 'Transcription was cancelled.', { cause: err });
    if (err instanceof HttpTimeoutError) {
      throw new SttError(
        'network',
        `The transcription service did not answer in time (${err.message}). The recording was kept: retry, or check the network / base URL.`,
        { cause: err, recording: kept },
      );
    }
    const hint = useProxy
      ? ' Check the network and the base URL (and that the local relay is running).'
      : ' Direct browser requests are often blocked by CORS; enable the local relay in Settings, and check the base URL.';
    throw new SttError('network', `Could not reach the transcription service: ${errorMessage(err)}.${hint}`, {
      cause: err,
      recording: kept,
    });
  }
}

/**
 * Transcribe a recording again (the `SttError.recording` of a failed API transcription) with the
 * current STT API settings, so the player does not have to record the answer again.
 * Rejects with SttError (same codes as ListenSession.stop(); a failure again carries `recording`).
 */
export async function retryTranscription(settings: Settings, recording: Blob, lang: Lang, signal?: AbortSignal): Promise<string> {
  const cfg = settings.stt;
  if (!isApiSttConfigured(cfg)) {
    throw new SttError('config', 'The speech-to-text API is not configured: set its base URL and model in Settings.', { recording });
  }
  if (!recording || recording.size === 0) throw new SttError('no-speech', 'There is no recording to transcribe.');
  const mimeType = baseMimeType(recording.type || 'audio/webm');
  return transcribeRecording({ blob: recording, mimeType }, cfg, lang, signal);
}

class ApiListenSession implements ListenSession {
  private readonly recorder: AudioRecorder;
  private readonly cfg: SttApiConfig;
  private readonly opts: ListenOptions;
  private readonly abortCtl = new AbortController();
  private stream: MediaStream | null;
  private meter: MicMeter | null;
  private stopPromise: Promise<string> | null = null;
  private cancelled = false;

  constructor(recorder: AudioRecorder, stream: MediaStream, cfg: SttApiConfig, opts: ListenOptions) {
    this.recorder = recorder;
    this.stream = stream;
    this.cfg = cfg;
    this.opts = opts;
    this.meter = startMicMeter(stream, opts.onLevel);
    recorder.onError = (err) =>
      this.fail(new SttError('no-microphone', `Recording failed: ${errorMessage(err)}`, { cause: err }));
    for (const track of stream.getTracks()) track.addEventListener('ended', this.onTrackEnded);
  }

  stop(): Promise<string> {
    this.stopPromise ??= this.finish();
    return this.stopPromise;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.abortCtl.abort();
    this.recorder.cancel();
    this.release();
  }

  private async finish(): Promise<string> {
    const recording = await this.recorder.stop();
    this.release();
    if (this.cancelled) throw new SttError('aborted', 'Listening was cancelled.');
    if (recording.durationMs < MIN_RECORDING_MS || recording.blob.size === 0) {
      throw new SttError('no-speech', 'The recording was too short.');
    }
    return transcribeRecording(recording, this.cfg, this.opts.lang, this.abortCtl.signal);
  }

  /** The microphone went away mid-recording (unplugged, permission revoked). */
  private readonly onTrackEnded = (): void => {
    this.fail(new SttError('no-microphone', 'The microphone was disconnected.'));
  };

  private fail(err: SttError): void {
    if (this.cancelled || this.stopPromise) return;
    safeCall(this.opts.onError, err);
  }

  private release(): void {
    this.meter?.stop();
    this.meter = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.removeEventListener('ended', this.onTrackEnded);
    }
    releaseStream(this.stream);
    this.stream = null;
  }
}

export function createApiStt(settings: Settings): SttEngine {
  const cfg = settings.stt;
  return {
    kind: 'api',
    isAvailable: () => isApiSttConfigured(cfg) && isRecorderSupported() && getMediaDevices() !== undefined,
    async start(opts) {
      if (!isApiSttConfigured(cfg)) {
        throw new SttError('config', 'The speech-to-text API is not configured: set its base URL and model in Settings.');
      }
      if (!isRecorderSupported()) {
        throw new SttError('not-supported', 'This browser cannot record audio (MediaRecorder is unavailable).');
      }
      const stream = await openMicrophone();
      let recorder: AudioRecorder;
      try {
        recorder = new AudioRecorder(stream);
        recorder.start();
      } catch (err) {
        releaseStream(stream);
        throw new SttError('not-supported', `Audio recording could not start: ${errorMessage(err)}`, { cause: err });
      }
      return new ApiListenSession(recorder, stream, cfg, opts);
    },
  };
}
