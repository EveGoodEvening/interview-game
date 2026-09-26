/**
 * API TTS: OpenAI-compatible `POST {base}/audio/speech` → mp3, played through audioPlayer.ts
 * with real-amplitude lip-sync. Audio is cached (LRU, 20 entries, shared by all engine
 * instances) so prefetch() makes the next page instant. When the API fails, that utterance
 * falls back to browser TTS; after hard failures (auth, 404, network, timeout) or two failures
 * in a row the API is skipped for a short cool-down so every page does not wait on it.
 */
import { apiUrl, proxyHeaders } from '../../llm/http';
import type { CharacterDef, Settings, TtsSettings } from '../../types';
import { currentVoiceVolume, effectiveUseProxy, errorMessage, nowMs } from '../env';
import { bearer, HttpStatusError, HttpTimeoutError, readErrorMessage, requestWithTimeout } from '../httpUtil';
import type { TtsEngine } from '../types';
import { canPlayAudioElements, playAudioUrl, type AudioPlayback } from './audioPlayer';
import { AudioBlobCache, type BlobLease } from './blobCache';
import { PreferredVoiceStrikes, startBrowserPlayback } from './browserTts';
import { deferred, runUtterance, startSilentWait, stopActiveVoice, type Playback, type PlaybackHooks } from './playback';
import { cleanForSpeech } from './textChunks';

export const TTS_REQUEST_TIMEOUT_MS = 20_000;
const COOLDOWN_MS = 45_000;
const CACHE_SIZE = 20;

const sharedCache = new AudioBlobCache(CACHE_SIZE);

type ApiTtsConfig = Pick<TtsSettings, 'apiPresetId' | 'apiBaseUrl' | 'apiKey' | 'apiModel' | 'apiVoice' | 'useProxy'>;

function isSiliconFlow(cfg: Pick<TtsSettings, 'apiPresetId' | 'apiBaseUrl'>): boolean {
  return cfg.apiPresetId === 'siliconflow' || /siliconflow/i.test(cfg.apiBaseUrl);
}

/**
 * Voice id for the request: settings.apiVoice, or the character's default for the preset
 * (siliconflow → voice.siliconflowVoice, openai / custom → voice.openaiVoice). SiliconFlow
 * system voices are addressed as "model:voice", so a bare name gets the model prefix and a
 * default voice follows the configured model.
 */
export function resolveApiVoice(
  cfg: Pick<TtsSettings, 'apiPresetId' | 'apiBaseUrl' | 'apiModel' | 'apiVoice'>,
  character: CharacterDef,
): string {
  const explicit = cfg.apiVoice.trim();
  if (!isSiliconFlow(cfg)) return explicit || character.voice.openaiVoice;
  const model = cfg.apiModel.trim();
  if (explicit) return explicit.includes(':') || !model ? explicit : `${model}:${explicit}`;
  const fallback = character.voice.siliconflowVoice;
  const name = fallback.slice(fallback.lastIndexOf(':') + 1);
  return model && name ? `${model}:${name}` : fallback;
}

/** Cache key: endpoint-scoped `model|voice|text`. */
export function ttsCacheKey(cfg: Pick<TtsSettings, 'apiBaseUrl' | 'apiModel'>, voice: string, text: string): string {
  return `${cfg.apiBaseUrl.trim()}|${cfg.apiModel.trim()}|${voice}|${text}`;
}

export function isApiTtsConfigured(cfg: Pick<TtsSettings, 'apiBaseUrl' | 'apiModel'>): boolean {
  return cfg.apiBaseUrl.trim() !== '' && cfg.apiModel.trim() !== '';
}

/** POST /audio/speech and return the mp3 Blob. Throws HttpStatusError / HttpTimeoutError / TypeError. */
export async function fetchSpeechAudio(cfg: ApiTtsConfig, voice: string, text: string): Promise<Blob> {
  const useProxy = effectiveUseProxy(cfg.useProxy);
  const url = apiUrl(cfg.apiBaseUrl, '/audio/speech', useProxy);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(cfg.apiKey), ...proxyHeaders(useProxy) },
    body: JSON.stringify({ model: cfg.apiModel.trim(), input: text, voice, response_format: 'mp3' }),
  };
  return requestWithTimeout(url, init, TTS_REQUEST_TIMEOUT_MS, async (res) => {
    if (!res.ok) {
      throw new HttpStatusError(res.status, `TTS request failed (HTTP ${res.status}): ${await readErrorMessage(res)}`);
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('json') || type.startsWith('text/')) {
      throw new HttpStatusError(res.status, `TTS endpoint returned ${type} instead of audio: ${await readErrorMessage(res)}`);
    }
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('TTS endpoint returned empty audio');
    return blob;
  });
}

function isHardFailure(err: unknown): boolean {
  if (err instanceof HttpTimeoutError) return true;
  if (err instanceof HttpStatusError) return [401, 403, 404].includes(err.status);
  return err instanceof TypeError; // fetch network / CORS failure
}

/** One API utterance: fetch (via cache) → play; on failure hand over to `fallback`. */
class ApiSpeech implements Playback {
  readonly done: Promise<void>;
  private readonly resolveDone: () => void;
  private readonly load: () => Promise<BlobLease>;
  private readonly play: (url: string) => AudioPlayback;
  private readonly fallback: (err: Error) => Playback;
  private finished = false;
  private inner: { stop(): void } | null = null;

  constructor(
    load: () => Promise<BlobLease>,
    play: (url: string) => AudioPlayback,
    fallback: (err: Error) => Playback,
  ) {
    const d = deferred();
    this.done = d.promise;
    this.resolveDone = d.resolve;
    this.load = load;
    this.play = play;
    this.fallback = fallback;
    void this.run();
  }

  stop(): void {
    if (this.finished) return;
    const inner = this.inner;
    this.finish();
    inner?.stop();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.inner = null;
    this.resolveDone();
  }

  private async run(): Promise<void> {
    let lease: BlobLease;
    try {
      lease = await this.load();
    } catch (err) {
      return this.handOver(err instanceof Error ? err : new Error(errorMessage(err)));
    }
    if (this.finished) {
      lease.release();
      return;
    }
    const playback = this.play(lease.url);
    this.inner = playback;
    const outcome = await playback.result;
    lease.release();
    if (this.finished) return;
    if (outcome === 'error' && !playback.started) return this.handOver(new Error('The synthesized audio could not be played'));
    this.finish();
  }

  private async handOver(err: Error): Promise<void> {
    if (this.finished) return;
    const fb = this.fallback(err);
    this.inner = fb;
    await fb.done;
    this.finish();
  }
}

export function createApiTts(settings: Settings): TtsEngine {
  const cfg = settings.tts;
  const configured = isApiTtsConfigured(cfg);
  let blockedUntil = 0;
  let failureStreak = 0;
  let lastError: Error | null = null;
  let warned = false;
  /** The browser fallback's failure count of the chosen browser voice (see PreferredVoiceStrikes). */
  const browserStrikes = new PreferredVoiceStrikes();

  const noteSuccess = (): void => {
    failureStreak = 0;
    blockedUntil = 0;
  };
  const noteFailure = (err: unknown): void => {
    failureStreak += 1;
    lastError = err instanceof Error ? err : new Error(errorMessage(err));
    if (isHardFailure(err) || failureStreak >= 2) blockedUntil = nowMs() + COOLDOWN_MS;
  };
  const fetchAudio = (voice: string, text: string) => async (): Promise<Blob> => {
    try {
      const blob = await fetchSpeechAudio(cfg, voice, text);
      noteSuccess();
      return blob;
    } catch (err) {
      noteFailure(err);
      throw err;
    }
  };

  return {
    kind: 'api',
    isAvailable: () => configured && canPlayAudioElements(),
    speak(text, opts) {
      const clean = cleanForSpeech(text);
      return runUtterance(opts, (hooks: PlaybackHooks) => {
        const volume = opts.volume ?? currentVoiceVolume(settings.audio);
        const fallback = (err: Error): Playback => {
          if (!warned) {
            warned = true;
            console.warn('[speech] TTS API unavailable, using browser speech instead:', err.message);
          }
          hooks.onFallback(err);
          return startBrowserPlayback({
            ...hooks,
            text: clean,
            lang: opts.lang,
            character: opts.character,
            volume,
            userRate: cfg.rate,
            voiceURI: cfg.browserVoice?.[opts.lang] ?? '',
            strikes: browserStrikes,
          });
        };
        if (!clean) return startSilentWait(0);
        if (!configured) return fallback(new Error('TTS API is not configured (base URL / model)'));
        if (!canPlayAudioElements()) return fallback(new Error('Audio playback is not available'));
        const voice = resolveApiVoice(cfg, opts.character);
        const key = ttsCacheKey(cfg, voice, clean);
        if (nowMs() < blockedUntil && !sharedCache.has(key)) {
          return fallback(lastError ?? new Error('TTS API temporarily disabled after errors'));
        }
        return new ApiSpeech(
          () => sharedCache.acquire(key, fetchAudio(voice, clean)),
          (url) =>
            playAudioUrl(url, {
              volume,
              rate: cfg.rate * opts.character.voice.rate,
              onStart: hooks.onStart,
              onLevel: hooks.onLevel,
            }),
          fallback,
        );
      });
    },
    prefetch(text, opts) {
      const clean = cleanForSpeech(text);
      if (!clean || !configured || nowMs() < blockedUntil) return;
      const voice = resolveApiVoice(cfg, opts.character);
      sharedCache.load(ttsCacheKey(cfg, voice, clean), fetchAudio(voice, clean)).catch(() => undefined);
    },
    stopAll: stopActiveVoice,
  };
}

/** Test helper: empty the shared audio cache. */
export function clearTtsCache(): void {
  sharedCache.clear();
}
