// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypewriter, type TypewriterOptions } from './useTypewriter';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(text: string, opts: TypewriterOptions) {
  return renderHook(({ t, o }: { t: string; o: TypewriterOptions }) => useTypewriter(t, o), { initialProps: { t: text, o: opts } });
}

describe('useTypewriter', () => {
  it('reveals characters over time at the given speed', () => {
    const { result } = setup('你好，世界！', { cps: 10 });
    expect(result.current.visible).toBe('');
    expect(result.current.hidden).toBe('你好，世界！');
    expect(result.current.done).toBe(false);
    act(() => void vi.advanceTimersByTime(320));
    expect(result.current.count).toBe(3);
    expect(result.current.visible + result.current.hidden).toBe('你好，世界！');
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.visible).toBe('你好，世界！');
    expect(result.current.done).toBe(true);
  });

  it('shows everything instantly when cps is 0 or instant is set', () => {
    expect(setup('instant text', { cps: 0 }).result.current.done).toBe(true);
    const { result } = setup('reduce motion', { cps: 30, instant: true });
    expect(result.current.visible).toBe('reduce motion');
  });

  it('complete() reveals the rest immediately and stays complete', () => {
    const { result } = setup('Hello there, candidate.', { cps: 5 });
    act(() => void vi.advanceTimersByTime(250));
    expect(result.current.done).toBe(false);
    act(() => result.current.complete());
    expect(result.current.done).toBe(true);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.visible).toBe('Hello there, candidate.');
  });

  it('does not reveal anything while paused, then continues', () => {
    const { result, rerender } = setup('暂停测试', { cps: 20, paused: true });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.count).toBe(0);
    rerender({ t: '暂停测试', o: { cps: 20, paused: false } });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.done).toBe(true);
  });

  it('restarts from zero when the text changes', () => {
    const { result, rerender } = setup('first page', { cps: 100 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.done).toBe(true);
    rerender({ t: 'second page', o: { cps: 100 } });
    expect(result.current.count).toBe(0);
    expect(result.current.visible).toBe('');
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.visible).toBe('second page');
  });

  it('never splits surrogate pairs', () => {
    const { result } = setup('𠮷野家', { cps: 10 });
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current.visible).toBe('𠮷');
  });

  it('blips every few visible characters, skipping spaces and punctuation', () => {
    const onBlip = vi.fn();
    const { result } = setup('ab, cd. ef gh', { cps: 1000, onBlip, blipEvery: 3 });
    act(() => void vi.advanceTimersByTime(20));
    expect(result.current.done).toBe(true);
    // All 8 letters arrive in one tick → one blip for that tick.
    expect(onBlip).toHaveBeenCalledTimes(1);

    onBlip.mockClear();
    const slow = setup('abcdefghi', { cps: 10, onBlip, blipEvery: 3 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(slow.result.current.done).toBe(true);
    expect(onBlip).toHaveBeenCalledTimes(3);
  });
});
