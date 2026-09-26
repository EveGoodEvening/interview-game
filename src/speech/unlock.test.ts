// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../characters';
import { useSettingsStore } from '../store/settings';
import { resetSpeechAudioContext } from './audioLevel';
import { unlockSpeech } from './index';
import {
  audioResponse,
  FakeAudio,
  FakeSpeechSynthesis,
  installFetch,
  installObjectUrls,
  installSpeechSynthesis,
  makeSettings,
} from './testing/fakes';
import { clearTtsCache } from './tts/apiTts';
import { primedAudioElement, resetPrimedAudioElement, SILENT_WAV_DATA_URI } from './tts/audioPlayer';
import { resetBrowserSynthState } from './tts/browserSynth';
import { resetBrowserTtsState } from './tts/browserTts';
import { stopActiveVoice } from './tts/playback';
import { createTts } from './index';
import { isIosWebKit, MAX_SYNTH_PRIMES, resetSpeechUnlockState } from './unlock';

class FakeSpeechContext {
  static instances: FakeSpeechContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly sampleRate = 44_100;
  readonly destination = {};
  resumeCalls = 0;
  readonly started: number[] = [];
  constructor() {
    FakeSpeechContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(): object {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: (t: number) => this.started.push(t) };
  }
}

let synth: FakeSpeechSynthesis;

function setEngines(tts: 'browser' | 'api' | 'off', stt: 'browser' | 'api' | 'keyboard'): void {
  useSettingsStore.getState().update({ tts: { engine: tts }, stt: { engine: stt } });
}

beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSpeechSynthesis();
  installSpeechSynthesis(synth);
  FakeAudio.reset();
  vi.stubGlobal('Audio', FakeAudio);
  FakeSpeechContext.instances = [];
  vi.stubGlobal('AudioContext', FakeSpeechContext);
  resetSpeechUnlockState();
  resetPrimedAudioElement();
  resetSpeechAudioContext();
  resetBrowserSynthState();
  resetBrowserTtsState();
  setEngines('browser', 'keyboard');
});

afterEach(() => {
  stopActiveVoice();
  useSettingsStore.getState().resetSection('tts');
  useSettingsStore.getState().resetSection('stt');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

describe('isIosWebKit', () => {
  it('recognizes iPhone / iPad (also iPadOS with a Mac user agent) and nothing else', () => {
    expect(isIosWebKit({ userAgent: IPHONE_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isIosWebKit({ userAgent: IPHONE_UA.replace('iPhone', 'iPad'), maxTouchPoints: 5 })).toBe(true);
    expect(isIosWebKit({ userAgent: MAC_UA, maxTouchPoints: 5 })).toBe(true); // iPadOS 13+
    expect(isIosWebKit({ userAgent: MAC_UA, maxTouchPoints: 0 })).toBe(false); // macOS Safari
    expect(isIosWebKit({ userAgent: CHROME_UA, maxTouchPoints: 0 })).toBe(false);
    expect(isIosWebKit(undefined)).toBe(false);
  });
});

describe('unlockSpeech: speechSynthesis', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
  });

  it('speaks nothing outside iOS (other browsers only need an earlier user activation)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA);
    unlockSpeech();
    unlockSpeech();
    expect(synth.spoken).toHaveLength(0);
  });

  it('speaks one silent utterance inside the gesture, and nothing more once the engine reacted', async () => {
    unlockSpeech();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].text).toBe(' ');
    expect(synth.spoken[0].volume).toBe(0);
    await vi.advanceTimersByTimeAsync(0); // onstart
    synth.end();
    unlockSpeech();
    unlockSpeech();
    expect(synth.spoken).toHaveLength(1);
  });

  it('primes again on later gestures while the engine swallows speak() (iOS outside a gesture)', async () => {
    synth.mode = 'ignore';
    unlockSpeech();
    unlockSpeech();
    expect(synth.spoken).toHaveLength(2);
    // The engine finally reacts: priming stops.
    synth.mode = 'normal';
    unlockSpeech();
    await vi.advanceTimersByTimeAsync(0);
    synth.end();
    unlockSpeech();
    expect(synth.spoken).toHaveLength(3);
  });

  it("primes again after 'not-allowed' but not after other errors", async () => {
    unlockSpeech();
    synth.fail('not-allowed');
    unlockSpeech();
    expect(synth.spoken).toHaveLength(2);
    synth.cancel(); // 'interrupted': the engine took it
    await vi.advanceTimersByTimeAsync(0);
    unlockSpeech();
    expect(synth.spoken).toHaveLength(2);
  });

  it('gives up after a bounded number of attempts and never speaks over a line', () => {
    synth.mode = 'ignore';
    for (let i = 0; i < MAX_SYNTH_PRIMES + 5; i++) unlockSpeech();
    expect(synth.spoken).toHaveLength(MAX_SYNTH_PRIMES);

    resetSpeechUnlockState();
    synth.mode = 'normal';
    synth.spoken.length = 0;
    synth.speaking = true;
    unlockSpeech();
    expect(synth.spoken).toHaveLength(0);
  });

  it('lets the first interviewer line start on the voice the player chose after an unlock', async () => {
    // Before the gesture WebKit swallows the line; the voice is not blamed for it.
    synth.voices = [
      { voiceURI: 'Tingting', name: 'Tingting', lang: 'zh-CN', localService: true, default: false },
      { voiceURI: 'Sinji', name: 'Sinji', lang: 'zh-HK', localService: true, default: false },
    ];
    const settings = makeSettings({ tts: { engine: 'browser', browserVoice: { zh: 'Tingting' } } });
    synth.mode = 'ignore';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = createTts(settings).speak('第一句。', { lang: 'zh', character: CHARACTERS.yuki });
    await vi.advanceTimersByTimeAsync(4600);
    await first.done;
    synth.mode = 'normal';
    unlockSpeech();
    await vi.advanceTimersByTimeAsync(0);
    synth.end();
    createTts(settings).speak('第二句。', { lang: 'zh', character: CHARACTERS.yuki });
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.current?.voice?.name).toBe('Tingting');
  });
});

describe('unlockSpeech: <audio> for API TTS', () => {
  it('plays muted silence on one reusable element, then frees it', async () => {
    unlockSpeech();
    expect(FakeAudio.instances).toHaveLength(1);
    const el = FakeAudio.last as FakeAudio & { muted?: boolean };
    expect(primedAudioElement()).toBe(el);
    expect(el.src).toBe(SILENT_WAV_DATA_URI);
    expect(el.muted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el.src).toBe('');
    expect(el.muted).toBe(false);
    unlockSpeech();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(el.src).toBe('');
  });

  it('primes the same element again when the priming play() was refused', async () => {
    FakeAudio.rejectPlay = true;
    unlockSpeech();
    await vi.advanceTimersByTimeAsync(0);
    const playSpy = vi.spyOn(FakeAudio.prototype, 'play');
    FakeAudio.rejectPlay = false;
    unlockSpeech();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    unlockSpeech();
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('API TTS plays on the primed element (no new element outside the gesture)', async () => {
    const urls = installObjectUrls();
    installFetch(() => audioResponse());
    try {
      unlockSpeech();
      await vi.advanceTimersByTimeAsync(0);
      const primedEl = FakeAudio.last;
      const tts = createTts(
        makeSettings({
          tts: { engine: 'api', apiPresetId: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'k', apiModel: 'tts-1', useProxy: false },
        }),
      );
      const handle = tts.speak('Hello there.', { lang: 'en', character: CHARACTERS.yuki });
      await vi.advanceTimersByTimeAsync(400);
      expect(FakeAudio.instances).toHaveLength(1);
      expect(primedEl.src).toMatch(/^blob:/);
      primedEl.finish();
      await handle.done;
      expect(primedEl.src).toBe('');
      // Free again for the next line.
      const next = tts.speak('Next line.', { lang: 'en', character: CHARACTERS.yuki });
      await vi.advanceTimersByTimeAsync(400);
      expect(FakeAudio.instances).toHaveLength(1);
      expect(primedEl.src).toMatch(/^blob:/);
      next.stop();
      await next.done;
    } finally {
      clearTtsCache();
      urls.restore();
    }
  });
});

describe('unlockSpeech: speech AudioContext', () => {
  it('creates no context for browser TTS + keyboard answers', () => {
    unlockSpeech();
    expect(FakeSpeechContext.instances).toHaveLength(0);
  });

  it('creates and starts the context inside the gesture when API TTS or a mic engine is used', () => {
    for (const [tts, stt] of [
      ['api', 'keyboard'],
      ['browser', 'browser'],
    ] as const) {
      resetSpeechAudioContext();
      resetSpeechUnlockState();
      FakeSpeechContext.instances = [];
      setEngines(tts, stt);
      unlockSpeech();
      expect(FakeSpeechContext.instances).toHaveLength(1);
      const ctx = FakeSpeechContext.instances[0];
      expect(ctx.resumeCalls).toBe(1);
      expect(ctx.started).toEqual([0]);
      unlockSpeech();
      expect(FakeSpeechContext.instances).toHaveLength(1);
      expect(ctx.started).toEqual([0]);
    }
  });

  it('resumes an existing context on a gesture (e.g. after an iOS interruption)', () => {
    setEngines('api', 'keyboard');
    unlockSpeech();
    const ctx = FakeSpeechContext.instances[0];
    setEngines('browser', 'keyboard');
    ctx.state = 'suspended';
    unlockSpeech();
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');
  });
});
