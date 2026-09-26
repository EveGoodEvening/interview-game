// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../characters';
import { createTts } from '../index';
import { makeSettings } from '../testing/fakes';
import { stopActiveVoice } from './playback';
import { estimateReadingMs, MIN_READING_MS } from './silentTts';

describe('estimateReadingMs', () => {
  it('uses ~6 CJK chars/s and ~15 Latin chars/s with an 800 ms floor', () => {
    expect(estimateReadingMs('')).toBe(0);
    expect(estimateReadingMs('好')).toBe(MIN_READING_MS);
    expect(estimateReadingMs('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')).toBe(5000); // 30 chars
    expect(estimateReadingMs('x'.repeat(30))).toBe(2000);
    expect(estimateReadingMs('一二三四五六' + 'x'.repeat(15))).toBe(2000);
  });

  it('scales by rate', () => {
    const text = 'x'.repeat(60); // 4 s
    expect(estimateReadingMs(text, 2)).toBe(2000);
    expect(estimateReadingMs(text, 0.5)).toBe(8000);
    expect(estimateReadingMs(text, Number.NaN)).toBe(4000);
    expect(estimateReadingMs('hi', 4)).toBe(MIN_READING_MS);
  });
});

describe("TTS engine 'off'", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopActiveVoice();
    vi.useRealTimers();
  });

  const settings = makeSettings({ tts: { engine: 'off', rate: 1 } });
  const yuki = CHARACTERS.yuki; // voice.rate = 1

  it('is always available and resolves done after the reading time', async () => {
    const engine = createTts(settings);
    expect(engine.kind).toBe('off');
    expect(engine.isAvailable()).toBe(true);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const handle = engine.speak('x'.repeat(45), { lang: 'en', character: yuki, onStart, onEnd }); // 3 s
    let done = false;
    void handle.done.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('applies user rate × character rate', async () => {
    const fast = createTts(makeSettings({ tts: { engine: 'off', rate: 2 } }));
    const handle = fast.speak('x'.repeat(60), { lang: 'en', character: yuki }); // 4 s / 2
    let done = false;
    void handle.done.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1950);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });

  it('stop() resolves immediately and a new speak() stops the previous one', async () => {
    const engine = createTts(settings);
    const first = engine.speak('第一句话说得比较长一些。', { lang: 'zh', character: yuki });
    const onEnd = vi.fn();
    const second = engine.speak('第二句。', { lang: 'zh', character: yuki, onEnd });
    await expect(first.done).resolves.toBeUndefined();
    second.stop();
    await expect(second.done).resolves.toBeUndefined();
    expect(onEnd).toHaveBeenCalledTimes(1);
    second.stop(); // idempotent
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('empty text resolves right away without onStart', async () => {
    const engine = createTts(settings);
    const onStart = vi.fn();
    const handle = engine.speak('  🙂 ', { lang: 'zh', character: yuki, onStart });
    await vi.advanceTimersByTimeAsync(1);
    await expect(handle.done).resolves.toBeUndefined();
    expect(onStart).not.toHaveBeenCalled();
  });
});
