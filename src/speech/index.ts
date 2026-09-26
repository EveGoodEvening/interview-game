/**
 * Speech public API (TTS + STT).
 * OWNER: speech agent. Keep exported signatures stable.
 *
 * TTS engines: 'browser' (speechSynthesis), 'api' (OpenAI-compatible /audio/speech, falls back to
 * the browser voice per utterance), 'off' (silent, paced by reading time). Only one voice plays at a
 * time across all engines. STT engines: 'browser' (Web Speech recognition), 'api' (MediaRecorder →
 * /audio/transcriptions), 'keyboard' (no speech; start() rejects).
 * Nothing touches browser globals at import time.
 */
import type { Settings } from '../types';
import { delay, safeCall } from './env';
import { openMicrophone, releaseStream, startMicMeter } from './stt/micLevel';
import { createApiStt } from './stt/apiStt';
import { createBrowserStt } from './stt/browserStt';
import { createApiTts } from './tts/apiTts';
import { loadVoices, watchVoiceList } from './tts/browserSynth';
import { createBrowserTts } from './tts/browserTts';
import { createSilentTts } from './tts/silentTts';
import type { SttEngine, TtsEngine } from './types';
import { SttError } from './types';

export * from './types';
export { isBrowserTtsSupported } from './tts/browserSynth';
export { isBrowserSttSupported } from './stt/browserStt';
export { estimateReadingMs } from './tts/silentTts';
export { cleanForSpeech, splitIntoChunks } from './tts/textChunks';
export { guessVoiceGender, pickVoice, rankVoices } from './tts/voicePicker';
export { resolveApiVoice } from './tts/apiTts';
export { stopActiveVoice } from './tts/playback';
export { resetVoiceFailures } from './tts/browserTts';
export { retryTranscription } from './stt/apiStt';
export { unlockSpeech } from './unlock';
export { voiceVolume } from './env';

/** How long listBrowserVoices() waits for the browser to load its voices. */
const VOICE_LIST_TIMEOUT_MS = 2000;

/** Create a TTS engine for the current settings ('off' returns a silent engine). */
export function createTts(settings: Settings): TtsEngine {
  switch (settings.tts.engine) {
    case 'api':
      return createApiTts(settings);
    case 'browser':
      return createBrowserTts(settings);
    case 'off':
    default:
      return createSilentTts(settings);
  }
}

function createKeyboardStt(): SttEngine {
  return {
    kind: 'keyboard',
    isAvailable: () => false,
    start: async () => {
      throw new SttError('not-supported', 'Keyboard mode: speech recognition is turned off.');
    },
  };
}

/** Create an STT engine for the current settings ('keyboard' returns an engine whose start() rejects). */
export function createStt(settings: Settings): SttEngine {
  switch (settings.stt.engine) {
    case 'browser':
      return createBrowserStt();
    case 'api':
      return createApiStt(settings);
    case 'keyboard':
    default:
      return createKeyboardStt();
  }
}

/** Browser speechSynthesis voices (waits for voiceschanged; [] if unsupported). */
export async function listBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return loadVoices(VOICE_LIST_TIMEOUT_MS);
}

/**
 * Subscribe to changes of the browser voice list (voices that load after listBrowserVoices()'s
 * timeout, Edge online voices added later, Safari without `voiceschanged`). `cb` gets the full
 * fresh list; it is never called with an initial empty list. Returns the unsubscribe function.
 */
export function onBrowserVoicesChanged(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  return watchVoiceList(cb);
}

/** Quick mic check for the settings screen: resolves with peak level after `ms`. Rejects with SttError. */
export async function testMicrophone(ms = 2000, onLevel?: (level: number) => void): Promise<number> {
  const stream = await openMicrophone();
  let peak = 0;
  const meter = startMicMeter(stream, (level) => {
    if (level > peak) peak = level;
    safeCall(onLevel, level);
  });
  try {
    await delay(ms);
  } finally {
    meter.stop();
    releaseStream(stream);
  }
  return peak;
}
