/**
 * Environment helpers for the speech module.
 * Nothing here touches `window` / `navigator` at import time, so the whole module is safe to
 * import in node (tests, SSR, the server bundle).
 */
import { useSettingsStore } from '../store/settings';
import type { AudioSettings, Lang } from '../types';

/** BCP-47 tag used for synthesis and recognition in each interview language. */
export const SPEECH_LANG_TAG: Readonly<Record<Lang, string>> = { zh: 'zh-CN', en: 'en-US' };

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/** Monotonic milliseconds (falls back to Date.now where performance is unavailable). */
export function nowMs(): number {
  const perf = globalThis.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Effective relay usage for a speech request: the user asked for it AND the relay was not
 * detected as missing (DESIGN §2: `settings.useProxy && proxyAvailable !== false`).
 */
export function effectiveUseProxy(requested: boolean): boolean {
  return requested && useSettingsStore.getState().proxyAvailable !== false;
}

/** Voice volume 0–1 = audio.voice × audio.master, 0 when muted. */
export function voiceVolume(audio: AudioSettings): number {
  if (audio.muted) return 0;
  return clamp01(audio.voice * audio.master);
}

/** Voice volume from the live settings store, read at speak time. */
export function currentVoiceVolume(fallback?: AudioSettings): number {
  const audio = useSettingsStore.getState().settings?.audio ?? fallback;
  return audio ? voiceVolume(audio) : 1;
}

/** Call a user-supplied callback without letting it break the engine. */
export function safeCall<A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A): void {
  if (!fn) return;
  try {
    fn(...args);
  } catch (err) {
    console.error('[speech] callback threw', err);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}

/** `navigator.mediaDevices` when present (undefined in node and insecure contexts). */
export function getMediaDevices(): MediaDevices | undefined {
  const nav = globalThis.navigator as Navigator | undefined;
  return nav?.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function' ? nav.mediaDevices : undefined;
}
