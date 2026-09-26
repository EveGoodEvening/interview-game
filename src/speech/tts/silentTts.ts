/** The 'off' TTS engine: no sound, but `done` still resolves after a natural reading time. */
import type { Settings } from '../../types';
import { clamp } from '../env';
import type { TtsEngine } from '../types';
import { runUtterance, startSilentWait, stopActiveVoice } from './playback';
import { cleanForSpeech, isWideChar } from './textChunks';

export const MIN_READING_MS = 800;
/** Spoken Chinese ≈ 4–5 chars/s; reading along a bit faster. */
const CJK_CHARS_PER_SEC = 6;
/** ≈ 150 wpm × ~6 chars per word (incl. spaces). */
const LATIN_CHARS_PER_SEC = 15;

/**
 * Estimated time to speak/read `text` at `rate` (1 = normal): CJK chars at 6/s, everything else
 * at 15/s, divided by the rate, never below 800 ms. Empty text → 0.
 */
export function estimateReadingMs(text: string, rate = 1): number {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of clean) {
    if (isWideChar(ch)) cjk++;
    else other++;
  }
  const seconds = cjk / CJK_CHARS_PER_SEC + other / LATIN_CHARS_PER_SEC;
  const r = Number.isFinite(rate) && rate > 0 ? clamp(rate, 0.25, 4) : 1;
  return Math.round(Math.max(MIN_READING_MS, (seconds * 1000) / r));
}

export function createSilentTts(settings: Settings): TtsEngine {
  const userRate = settings.tts.rate;
  return {
    kind: 'off',
    isAvailable: () => true,
    speak: (text, opts) =>
      runUtterance(opts, (hooks) => {
        const ms = estimateReadingMs(cleanForSpeech(text), userRate * opts.character.voice.rate);
        return startSilentWait(ms, ms > 0 ? hooks.onStart : undefined);
      }),
    prefetch: () => {},
    stopAll: stopActiveVoice,
  };
}
