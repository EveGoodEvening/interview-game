// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../characters';
import { useSettingsStore } from '../../store/settings';
import { createTts, listBrowserVoices, onBrowserVoicesChanged } from '../index';
import { FakeSpeechSynthesis, installSpeechSynthesis, makeSettings, makeVoice, type FakeUtterance } from '../testing/fakes';
import { resetBrowserSynthState, VOICE_WATCH_POLL_FOR_MS } from './browserSynth';
import { PREFERRED_VOICE_STRIKES, resetBrowserTtsState, resetVoiceFailures, VOICE_BACKOFF_MS } from './browserTts';
import { stopActiveVoice } from './playback';

const yuki = CHARACTERS.yuki;
const ethan = CHARACTERS.ethan;

const VOICES = [
  makeVoice('Google 普通话（中国大陆）', 'zh-CN', { localService: false }),
  makeVoice('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'),
  makeVoice('Microsoft Kangkang - Chinese (Simplified, PRC)', 'zh-CN'),
  makeVoice('Google US English', 'en-US', { localService: false }),
  makeVoice('Microsoft David - English (United States)', 'en-US'),
];

let synth: FakeSpeechSynthesis;

function isDone(p: Promise<void>): () => boolean {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return () => done;
}

function lastUtterance(): FakeUtterance {
  const u = synth.spoken[synth.spoken.length - 1];
  if (!u) throw new Error('nothing spoken');
  return u;
}

beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSpeechSynthesis();
  synth.voices = [...VOICES];
  installSpeechSynthesis(synth);
  resetBrowserSynthState();
  resetBrowserTtsState();
});

afterEach(() => {
  stopActiveVoice();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('browser TTS', () => {
  const settings = makeSettings({ tts: { engine: 'browser', rate: 1 } });

  it('speaks with the auto-picked voice, character pitch/rate and volume; done resolves on end', async () => {
    const engine = createTts(settings);
    expect(engine.kind).toBe('browser');
    expect(engine.isAvailable()).toBe(true);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const levels: number[] = [];
    const handle = engine.speak('你好，欢迎来到星辰科技。', {
      lang: 'zh',
      character: ethan,
      volume: 0.5,
      onStart,
      onEnd,
      onLevel: (l) => levels.push(l),
    });
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(100);
    expect(synth.spoken).toHaveLength(1);
    const u = lastUtterance();
    expect(u.text).toBe('你好，欢迎来到星辰科技。');
    expect(u.voice?.name).toContain('Kangkang'); // male zh voice for Ethan
    expect(u.lang).toBe('zh-CN');
    expect(u.pitch).toBeCloseTo(0.85);
    expect(u.rate).toBeCloseTo(0.95);
    expect(u.volume).toBe(0.5);
    expect(onStart).toHaveBeenCalledTimes(1);

    synth.boundary();
    await vi.advanceTimersByTimeAsync(200);
    expect(levels.some((l) => l > 0.1)).toBe(true);
    expect(done()).toBe(false);

    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(done()).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(levels[levels.length - 1]).toBe(0);
  });

  it('reads the volume from the settings store at speak time when not given', async () => {
    const engine = createTts(settings);
    useSettingsStore.getState().update({ audio: { voice: 0.5, master: 0.5, muted: false } });
    engine.speak('Hello there.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().volume).toBeCloseTo(0.25);
    expect(lastUtterance().voice?.name).toBe('Google US English');
    useSettingsStore.getState().update({ audio: { muted: true } });
    engine.speak('Muted now.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().volume).toBe(0);
    useSettingsStore.getState().resetSection('audio');
  });

  it('uses the explicit voice from settings when it exists', async () => {
    const engine = createTts(makeSettings({ tts: { engine: 'browser', browserVoice: { zh: 'Microsoft Huihui - Chinese (Simplified, PRC)' } } }));
    engine.speak('你好。', { lang: 'zh', character: ethan });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Huihui');
  });

  it('speaks long text chunk by chunk and resolves after the last chunk', async () => {
    const engine = createTts(settings);
    const sentence = 'This is a fairly long sentence that is used to check how chunking behaves in the engine.';
    const handle = engine.speak(Array.from({ length: 5 }, () => sentence).join(' '), { lang: 'en', character: yuki });
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(100);
    const chunksSeen: string[] = [];
    for (let i = 0; i < 10 && !done(); i++) {
      chunksSeen.push(lastUtterance().text);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(done()).toBe(true);
    expect(chunksSeen.length).toBeGreaterThanOrEqual(3);
    for (const c of chunksSeen) expect(c.length).toBeLessThanOrEqual(180);
  });

  it('a new speak() cancels the previous utterance and resolves its done', async () => {
    const engine = createTts(settings);
    const onEnd1 = vi.fn();
    const first = engine.speak('第一句。', { lang: 'zh', character: yuki, onEnd: onEnd1 });
    await vi.advanceTimersByTimeAsync(100);
    const firstDone = isDone(first.done);
    const second = engine.speak('第二句。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(0);
    expect(firstDone()).toBe(true);
    expect(onEnd1).toHaveBeenCalledTimes(1);
    expect(synth.cancelCount).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(lastUtterance().text).toBe('第二句。');
    const secondDone = isDone(second.done);
    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(secondDone()).toBe(true);
  });

  it('stop() cancels speech and resolves done; stopAll() stops the active voice', async () => {
    const engine = createTts(settings);
    const handle = engine.speak('Stop me.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    handle.stop();
    await expect(handle.done).resolves.toBeUndefined();
    expect(synth.speaking).toBe(false);

    const other = engine.speak('And me.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    engine.stopAll();
    await expect(other.done).resolves.toBeUndefined();
  });

  it("treats an external cancel ('interrupted') as a normal stop, not a failure", async () => {
    const engine = createTts(settings);
    const onFallback = vi.fn();
    const handle = engine.speak('Interrupted line.', { lang: 'en', character: yuki, onFallback });
    await vi.advanceTimersByTimeAsync(100);
    synth.cancel(); // someone else cancels speechSynthesis
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.done).resolves.toBeUndefined();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('retries a failed chunk with the next best voice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createTts(settings);
    const onFallback = vi.fn();
    const handle = engine.speak('你好。', { lang: 'zh', character: yuki, onFallback });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Google 普通话');
    synth.fail('network');
    await vi.advanceTimersByTimeAsync(150);
    expect(synth.spoken).toHaveLength(2);
    expect(lastUtterance().voice?.name).toContain('Huihui');
    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.done).resolves.toBeUndefined();
    expect(onFallback).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    // The failed voice is skipped for a while (also by a fresh engine)…
    engine.speak('再见。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Huihui');
    synth.end();
    createTts(settings).speak('再见。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Huihui');
    synth.end();
    await vi.advanceTimersByTimeAsync(0);

    // …but not for the page lifetime: after the back-off it is the first choice again.
    await vi.advanceTimersByTimeAsync(VOICE_BACKOFF_MS);
    engine.speak('又见面了。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Google 普通话');
  });

  it('resetVoiceFailures() makes a failed voice the first choice again at once', async () => {
    const engine = createTts(settings);
    engine.speak('你好。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    synth.fail('synthesis-failed');
    await vi.advanceTimersByTimeAsync(150);
    expect(lastUtterance().voice?.name).toContain('Huihui');
    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    resetVoiceFailures();
    engine.speak('再见。', { lang: 'zh', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toContain('Google 普通话');
  });

  describe('the voice chosen in Settings', () => {
    const XIAOXIAO = 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)';
    const chosen = makeSettings({ tts: { engine: 'browser', rate: 1, browserVoice: { zh: XIAOXIAO } } });

    beforeEach(() => {
      synth.voices = [makeVoice(XIAOXIAO, 'zh-CN', { localService: false }), ...VOICES];
    });

    async function speakLine(engine: ReturnType<typeof createTts>, text: string): Promise<string | undefined> {
      const before = synth.spoken.length;
      engine.speak(text, { lang: 'zh', character: yuki });
      await vi.advanceTimersByTimeAsync(100);
      return synth.spoken[before]?.voice?.name;
    }

    it('survives one transient error: later lines and a preview use it again', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = createTts(chosen);
      expect(await speakLine(engine, '第一句。')).toBe(XIAOXIAO);
      synth.fail('synthesis-failed');
      await vi.advanceTimersByTimeAsync(150);
      // This line is retried with another voice…
      expect(synth.spoken).toHaveLength(2);
      expect(lastUtterance().voice?.name).not.toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
      // …but the next lines go back to the player's choice, in the interview and in a preview.
      expect(await speakLine(engine, '第二句。')).toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
      expect(await speakLine(createTts(chosen), '预览。')).toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
    });

    it(`is given up by an engine after ${PREFERRED_VOICE_STRIKES} failures in a row, not by a fresh engine`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = createTts(chosen);
      for (let i = 0; i < PREFERRED_VOICE_STRIKES; i++) {
        expect(await speakLine(engine, `第${i}句。`)).toBe(XIAOXIAO);
        synth.fail('network');
        await vi.advanceTimersByTimeAsync(150);
        synth.end(); // the retry with another voice works
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(await speakLine(engine, '下一句。')).not.toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
      // Previewing (or re-selecting) the voice creates a fresh engine, which tries it first.
      expect(await speakLine(createTts(chosen), '预览。')).toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(0);
      // This engine keeps skipping it until the back-off expires.
      expect(await speakLine(engine, '再下一句。')).not.toBe(XIAOXIAO);
      synth.end();
      await vi.advanceTimersByTimeAsync(VOICE_BACKOFF_MS);
      expect(await speakLine(engine, '很久以后。')).toBe(XIAOXIAO);
    });

    it('is not blamed when the engine never starts (iOS before unlockSpeech)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      synth.mode = 'ignore';
      const engine = createTts(chosen);
      const first = engine.speak('第一句。', { lang: 'zh', character: yuki });
      await vi.advanceTimersByTimeAsync(4600);
      expect(synth.spoken.map((u) => u.voice?.name)).toEqual([XIAOXIAO]);
      await first.done;
      synth.mode = 'normal';
      for (let i = 0; i < 3; i++) {
        expect(await speakLine(engine, `第${i}句。`)).toBe(XIAOXIAO);
        synth.end();
        await vi.advanceTimersByTimeAsync(0);
      }
    });
  });

  it('continues silently for the reading time when the engine never starts, without blaming the voice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    synth.mode = 'ignore';
    const engine = createTts(settings);
    const onStart = vi.fn();
    const onFallback = vi.fn();
    const handle = engine.speak('x'.repeat(150), { lang: 'en', character: yuki, onStart, onFallback }); // ~10 s reading
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(4600); // no start → degrade (another voice would not start either)
    expect(synth.spoken).toHaveLength(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(2500); // remaining ≈ 10 s − the ~4.4 s already spent on the chunk
    expect(done()).toBe(true);

    // The engine starts working (e.g. unlocked by a gesture): the best voice is used again.
    synth.mode = 'normal';
    engine.speak('Hello again.', { lang: 'en', character: yuki });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toBe('Google US English');
  });

  it('does not hang when onend never fires (watchdog)', async () => {
    const engine = createTts(settings);
    const handle = engine.speak('Lost end event.', { lang: 'en', character: yuki });
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(100);
    synth.endSilently();
    await vi.advanceTimersByTimeAsync(1000);
    expect(done()).toBe(true);
  });

  it('gives up on a voice that starts but never finishes (stalled network voice)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createTts(settings);
    const handle = engine.speak('Short line.', { lang: 'en', character: yuki }); // 800 ms reading → stall after ~10.4 s
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastUtterance().voice?.name).toBe('Google US English');
    await vi.advanceTimersByTimeAsync(11_000);
    expect(synth.spoken).toHaveLength(2); // retried with the next voice
    expect(lastUtterance().voice?.name).toContain('David');
    synth.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(done()).toBe(true);
  });

  it('keeps long utterances alive with resume()', async () => {
    const engine = createTts(settings);
    engine.speak('A long line that keeps going.', { lang: 'en', character: ethan }); // David (local voice)
    await vi.advanceTimersByTimeAsync(10_500);
    expect(synth.resumeCount).toBeGreaterThanOrEqual(1);
    expect(synth.pauseCount).toBe(0);
    engine.speak('Network voice.', { lang: 'en', character: yuki }); // Google US English (remote)
    await vi.advanceTimersByTimeAsync(10_500);
    expect(synth.pauseCount).toBeGreaterThanOrEqual(1);
  });

  it('waits for voiceschanged before picking a voice', async () => {
    synth.voices = [];
    const engine = createTts(settings);
    engine.speak('你好。', { lang: 'zh', character: ethan });
    await vi.advanceTimersByTimeAsync(50);
    expect(synth.spoken).toHaveLength(0);
    synth.setVoices([...VOICES]);
    await vi.advanceTimersByTimeAsync(150);
    expect(lastUtterance().voice?.name).toContain('Kangkang');
  });

  it('listBrowserVoices resolves with [] after the timeout when no voices load', async () => {
    synth.voices = [];
    const p = listBrowserVoices();
    await vi.advanceTimersByTimeAsync(2100);
    await expect(p).resolves.toEqual([]);
  });
});

describe('onBrowserVoicesChanged', () => {
  const names = (voices: readonly { name: string }[]) => voices.map((v) => v.name);

  it('reports voices that load after listBrowserVoices() gave up, and later additions', async () => {
    synth.voices = [];
    const listed = listBrowserVoices();
    await vi.advanceTimersByTimeAsync(2100);
    await expect(listed).resolves.toEqual([]);

    const cb = vi.fn();
    const unsubscribe = onBrowserVoicesChanged(cb);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled(); // never called with the initial empty list

    synth.setVoices(VOICES.slice(0, 2)); // local voices first…
    expect(cb).toHaveBeenCalledTimes(1);
    expect(names(cb.mock.calls[0][0])).toEqual(names(VOICES.slice(0, 2)));
    synth.setVoices([...VOICES]); // …then Edge-style online voices
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toHaveLength(VOICES.length);
    synth.setVoices([...VOICES]); // same list again: no call
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    synth.setVoices(VOICES.slice(0, 1));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('finds voices that arrive without a voiceschanged event (polling), then stops polling', async () => {
    synth.voices = [];
    const cb = vi.fn();
    const unsubscribe = onBrowserVoicesChanged(cb);
    synth.voices = [...VOICES]; // no event
    await vi.advanceTimersByTimeAsync(600);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toHaveLength(VOICES.length);
    const timers = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(VOICE_WATCH_POLL_FOR_MS);
    expect(vi.getTimerCount()).toBeLessThan(timers);
    synth.voices = VOICES.slice(0, 1); // no event, no polling any more
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb).toHaveBeenCalledTimes(1);
    synth.setVoices(VOICES.slice(0, 2)); // the event still works
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('delivers a list that was already there when subscribing once (the subscriber may have read [])', async () => {
    const cb = vi.fn();
    const unsubscribe = onBrowserVoicesChanged(cb);
    await vi.advanceTimersByTimeAsync(600);
    expect(cb).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe(); // idempotent
  });
});

describe('browser TTS without speechSynthesis', () => {
  it('is unavailable and paces with a silent reading-time wait', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('speechSynthesis', undefined);
    const engine = createTts(makeSettings({ tts: { engine: 'browser', rate: 1 } }));
    expect(engine.isAvailable()).toBe(false);
    const onFallback = vi.fn();
    const handle = engine.speak('x'.repeat(30), { lang: 'en', character: yuki, onFallback }); // 2 s
    const done = isDone(handle.done);
    await vi.advanceTimersByTimeAsync(1900);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done()).toBe(true);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('onBrowserVoicesChanged is a no-op', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('speechSynthesis', undefined);
    const cb = vi.fn();
    const unsubscribe = onBrowserVoicesChanged(cb);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(cb).not.toHaveBeenCalled();
  });
});
