// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../characters';
import { useSettingsStore } from '../../store/settings';
import type { Settings, TtsSettings } from '../../types';
import { createTts } from '../index';
import {
  audioResponse,
  FakeAudio,
  FakeSpeechSynthesis,
  installFetch,
  installObjectUrls,
  installSpeechSynthesis,
  jsonResponse,
  makeSettings,
  makeVoice,
} from '../testing/fakes';
import { clearTtsCache, resolveApiVoice } from './apiTts';
import { resetBrowserSynthState } from './browserSynth';
import { resetBrowserTtsState } from './browserTts';
import { stopActiveVoice } from './playback';

const yuki = CHARACTERS.yuki;
const ethan = CHARACTERS.ethan;

const apiSettings = (tts: Partial<TtsSettings> = {}): Settings =>
  makeSettings({
    tts: {
      engine: 'api',
      apiPresetId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      apiModel: 'gpt-4o-mini-tts',
      apiVoice: '',
      useProxy: false,
      rate: 1,
      ...tts,
    },
  });

let urls: ReturnType<typeof installObjectUrls>;
let synth: FakeSpeechSynthesis;

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudio.reset();
  vi.stubGlobal('Audio', FakeAudio);
  urls = installObjectUrls();
  synth = new FakeSpeechSynthesis();
  synth.voices = [makeVoice('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'), makeVoice('Samantha', 'en-US')];
  installSpeechSynthesis(synth);
  resetBrowserSynthState();
  resetBrowserTtsState();
  useSettingsStore.setState({ proxyAvailable: null });
});

afterEach(() => {
  stopActiveVoice();
  clearTtsCache();
  urls.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resolveApiVoice', () => {
  const base = { apiPresetId: 'openai', apiBaseUrl: 'https://api.openai.com/v1', apiModel: 'tts-1', apiVoice: '' };
  it("uses the character's default voice for the preset", () => {
    expect(resolveApiVoice(base, yuki)).toBe('nova');
    expect(resolveApiVoice({ ...base, apiPresetId: 'custom', apiBaseUrl: 'http://localhost:8880/v1' }, ethan)).toBe('onyx');
    expect(
      resolveApiVoice(
        { apiPresetId: 'siliconflow', apiBaseUrl: 'https://api.siliconflow.cn/v1', apiModel: 'FunAudioLLM/CosyVoice2-0.5B', apiVoice: '' },
        yuki,
      ),
    ).toBe('FunAudioLLM/CosyVoice2-0.5B:anna');
  });

  it('prefers settings.apiVoice and prefixes bare SiliconFlow voice names with the model', () => {
    expect(resolveApiVoice({ ...base, apiVoice: 'alloy' }, yuki)).toBe('alloy');
    const sf = { apiPresetId: 'siliconflow', apiBaseUrl: 'https://api.siliconflow.cn/v1', apiModel: 'fishaudio/fish-speech-1.5', apiVoice: '' };
    expect(resolveApiVoice({ ...sf, apiVoice: 'bella' }, yuki)).toBe('fishaudio/fish-speech-1.5:bella');
    expect(resolveApiVoice({ ...sf, apiVoice: 'speech:my-voice:abc' }, yuki)).toBe('speech:my-voice:abc');
    expect(resolveApiVoice(sf, ethan)).toBe('fishaudio/fish-speech-1.5:alex');
  });
});

describe('API TTS', () => {
  it('POSTs {model,input,voice,response_format} and plays the audio, resolving on end', async () => {
    const { requests } = installFetch(() => audioResponse());
    const engine = createTts(apiSettings({}));
    expect(engine.kind).toBe('api');
    expect(engine.isAvailable()).toBe(true);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const levels: number[] = [];
    const handle = engine.speak('Hello **there**!', {
      lang: 'en',
      character: yuki,
      volume: 0.4,
      onStart,
      onEnd,
      onLevel: (l) => levels.push(l),
    });
    await vi.advanceTimersByTimeAsync(400);

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(req.init.method).toBe('POST');
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-interview-proxy']).toBeUndefined();
    expect(JSON.parse(String(req.init.body))).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'Hello there!',
      voice: 'nova',
      response_format: 'mp3',
    });

    const audio = FakeAudio.last;
    expect(audio.src).toBe(urls.created[0]);
    expect(audio.volume).toBeCloseTo(0.4); // no Web Audio in jsdom → element volume
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(levels.some((l) => l > 0)).toBe(true); // synthetic lip-sync fallback

    let done = false;
    void handle.done.then(() => {
      done = true;
    });
    audio.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(levels[levels.length - 1]).toBe(0);
  });

  it('routes through the relay only when it is available', async () => {
    const { requests } = installFetch(() => audioResponse());
    useSettingsStore.setState({ proxyAvailable: true });
    const engine = createTts(apiSettings({ useProxy: true }));
    engine.speak('Via relay.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(10);
    expect(requests[0].url).toBe(`${location.origin}/api/proxy/https/api.openai.com/v1/audio/speech`);
    expect((requests[0].init.headers as Record<string, string>)['x-interview-proxy']).toBe('1');

    useSettingsStore.setState({ proxyAvailable: false });
    engine.speak('Direct now.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(10);
    expect(requests[1].url).toBe('https://api.openai.com/v1/audio/speech');
  });

  it('uses the SiliconFlow character voice for the siliconflow preset', async () => {
    const { requests } = installFetch(() => audioResponse());
    const engine = createTts(
      apiSettings({ apiPresetId: 'siliconflow', apiBaseUrl: 'https://api.siliconflow.cn/v1', apiModel: 'FunAudioLLM/CosyVoice2-0.5B' }),
    );
    engine.speak('你好。', { lang: 'zh', character: ethan });
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(String(requests[0].init.body)).voice).toBe('FunAudioLLM/CosyVoice2-0.5B:alex');
  });

  it('caches audio: prefetch then speak fetches once, and replays reuse the blob', async () => {
    const { fetch } = installFetch(() => audioResponse());
    const engine = createTts(apiSettings({}));
    engine.prefetch('Next page.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    const h1 = engine.speak('Next page.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(10);
    FakeAudio.last.finish();
    await h1.done;
    const h2 = engine.speak('Next page.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(10);
    FakeAudio.last.finish();
    await h2.done;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances).toHaveLength(2);

    // A different character voice is a different cache entry.
    engine.speak('Next page.', { lang: 'en', character: ethan });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 20 cached clips and revokes evicted object URLs', async () => {
    installFetch(() => audioResponse());
    const engine = createTts(apiSettings({}));
    for (let i = 0; i < 22; i++) {
      const h = engine.speak(`Line number ${i}.`, { lang: 'en', character: yuki });
      await vi.advanceTimersByTimeAsync(5);
      FakeAudio.last.finish();
      await h.done;
    }
    expect(urls.created).toHaveLength(22);
    expect(urls.revoked).toEqual([urls.created[0], urls.created[1]]);
  });

  it('falls back to browser TTS for the utterance when the API fails (warns once)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFetch(() => jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401));
    const engine = createTts(apiSettings({}));
    const onFallback = vi.fn();
    const onStart = vi.fn();
    const handle = engine.speak('你好，请做个自我介绍。', { lang: 'zh', character: yuki, onFallback, onStart });
    await vi.advanceTimersByTimeAsync(200);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0].message).toContain('401');
    expect(onFallback.mock.calls[0][0].message).toContain('Incorrect API key');
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].text).toBe('你好，请做个自我介绍。');
    expect(onStart).toHaveBeenCalledTimes(1);
    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.done).resolves.toBeUndefined();

    engine.speak('第二句。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(200);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('skips the API for a while after a hard failure (no request per page)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch } = installFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const engine = createTts(apiSettings({}));
    engine.speak('One.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(200);
    engine.speak('Two.', { lang: 'en', character: yuki });
    engine.prefetch('Three.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(synth.spoken.map((u) => u.text)).toEqual(['One.', 'Two.']);
  });

  it('falls back when the endpoint returns JSON instead of audio, or playback is blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFetch(() => jsonResponse({ message: 'model not found' }, 200));
    const engine = createTts(apiSettings({}));
    engine.speak('Json body.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.spoken.map((u) => u.text)).toEqual(['Json body.']);

    installFetch(() => audioResponse());
    FakeAudio.rejectPlay = true;
    const engine2 = createTts(apiSettings({ apiModel: 'tts-1' }));
    engine2.speak('Autoplay blocked.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.spoken.map((u) => u.text)).toEqual(['Json body.', 'Autoplay blocked.']);
  });

  it('stop() during the request resolves immediately and never plays', async () => {
    let respond: (r: Response) => void = () => {};
    installFetch(() => new Promise<Response>((r) => (respond = r)));
    const engine = createTts(apiSettings({}));
    const onEnd = vi.fn();
    const handle = engine.speak('Slow network.', { lang: 'en', character: yuki, onEnd });
    await vi.advanceTimersByTimeAsync(10);
    handle.stop();
    await expect(handle.done).resolves.toBeUndefined();
    expect(onEnd).toHaveBeenCalledTimes(1);
    respond(audioResponse());
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(synth.spoken).toHaveLength(0);
  });

  it('is unavailable (and speaks with the browser voice) when not configured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch } = installFetch(() => audioResponse());
    const engine = createTts(apiSettings({ apiBaseUrl: '' }));
    expect(engine.isAvailable()).toBe(false);
    engine.speak('Not configured.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).not.toHaveBeenCalled();
    expect(synth.spoken.map((u) => u.text)).toEqual(['Not configured.']);
  });
});
