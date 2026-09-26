// Runs in the default node environment: no window, speechSynthesis, AudioContext or MediaRecorder.
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../characters';
import { createDefaultSettings } from '../store/settings';
import type { Settings } from '../types';
import * as speech from './index';

const base = createDefaultSettings('en');
const withEngines = (tts: Settings['tts']['engine'], stt: Settings['stt']['engine']): Settings => ({
  ...base,
  tts: { ...base.tts, engine: tts },
  stt: { ...base.stt, engine: stt },
});

describe('speech module in node (SSR-safe)', () => {
  it('imports without touching browser globals and reports no support', async () => {
    expect(typeof globalThis.window).toBe('undefined');
    expect(speech.isBrowserTtsSupported()).toBe(false);
    expect(speech.isBrowserSttSupported()).toBe(false);
    await expect(speech.listBrowserVoices()).resolves.toEqual([]);
  });

  it('creates every engine kind', () => {
    for (const tts of ['browser', 'api', 'off'] as const) {
      const engine = speech.createTts(withEngines(tts, 'keyboard'));
      expect(engine.kind).toBe(tts);
    }
    for (const stt of ['browser', 'api', 'keyboard'] as const) {
      const engine = speech.createStt(withEngines('off', stt));
      expect(engine.kind).toBe(stt);
      expect(engine.isAvailable()).toBe(false);
    }
  });

  it('browser TTS degrades to a silent wait and done never rejects', async () => {
    const engine = speech.createTts(withEngines('browser', 'keyboard'));
    expect(engine.isAvailable()).toBe(false);
    const handle = engine.speak('ok', { lang: 'en', character: CHARACTERS.haru });
    handle.stop();
    await expect(handle.done).resolves.toBeUndefined();
  });

  it('unlockSpeech, onBrowserVoicesChanged and retryTranscription are safe without a browser', async () => {
    expect(() => speech.unlockSpeech()).not.toThrow();
    const unsubscribe = speech.onBrowserVoicesChanged(() => {
      throw new Error('never called');
    });
    unsubscribe();
    const recording = new Blob(['x'], { type: 'audio/webm' });
    const unconfigured = withEngines('off', 'api');
    unconfigured.stt = { ...unconfigured.stt, apiBaseUrl: '' };
    await expect(speech.retryTranscription(unconfigured, recording, 'zh')).rejects.toMatchObject({ code: 'config', recording });
  });

  it('STT engines reject with SttError instead of throwing synchronously', async () => {
    await expect(speech.createStt(withEngines('off', 'browser')).start({ lang: 'zh' })).rejects.toBeInstanceOf(speech.SttError);
    await expect(speech.createStt(withEngines('off', 'keyboard')).start({ lang: 'zh' })).rejects.toBeInstanceOf(speech.SttError);
    await expect(speech.testMicrophone(10)).rejects.toMatchObject({ code: 'not-supported' });
  });
});
