// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store/settings';
import {
  answerClockKey,
  CLOCK_START_CAP_MS,
  clockElapsedMs,
  clockRemainingMs,
  ensureClock,
  pauseClock,
  peekClock,
  resetAnswerClocks,
  resumeClock,
  startClock,
  useAnswerClock,
  type AnswerClockHandle,
  type AnswerClockOptions,
} from './answerClock';
import { AnswerTimer } from './Hud';

const T0 = 1_000_000;

beforeEach(() => {
  resetAnswerClocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('answer clock (pure)', () => {
  it('waits, runs, pauses without counting the pause, and resumes from the remaining time', () => {
    const key = answerClockKey('s1', 'q1');
    const c0 = ensureClock(key, T0);
    expect(c0.startedAt).toBeNull();
    expect(clockRemainingMs(c0, 60, T0 + 5000)).toBe(60_000); // not started: full limit

    startClock(key, T0 + 1000);
    expect(clockElapsedMs(peekClock(key)!, T0 + 11_000)).toBe(10_000);

    pauseClock(key, T0 + 11_000);
    // Frozen while paused.
    expect(clockElapsedMs(peekClock(key)!, T0 + 71_000)).toBe(10_000);
    resumeClock(key, T0 + 71_000);
    expect(clockElapsedMs(peekClock(key)!, T0 + 76_000)).toBe(15_000);
    expect(clockRemainingMs(peekClock(key)!, 60, T0 + 76_000)).toBe(45_000);
  });

  it('starting while paused starts from zero; a new session drops the old clocks', () => {
    const key = answerClockKey('s1', 'q1');
    ensureClock(key, T0);
    pauseClock(key, T0);
    startClock(key, T0 + 3000);
    resumeClock(key, T0 + 9000);
    expect(clockElapsedMs(peekClock(key)!, T0 + 9000)).toBe(0);

    ensureClock(answerClockKey('s2', 'q1'), T0);
    expect(peekClock(key)).toBeNull();
  });
});

interface HarnessProps {
  clockKey: string | null;
  opts: AnswerClockOptions;
  out: { current: AnswerClockHandle | null };
}
function Harness({ clockKey, opts, out }: HarnessProps) {
  out.current = useAnswerClock(clockKey, opts);
  return null;
}

function mount(opts: Partial<AnswerClockOptions> = {}, key = answerClockKey('s1', 'q1')) {
  const out: { current: AnswerClockHandle | null } = { current: null };
  const onTimeUp = vi.fn();
  const full: AnswerClockOptions = { paused: false, voiceBusy: false, limitSec: 10, onTimeUp, ...opts };
  const utils = render(<Harness clockKey={key} opts={full} out={out} />);
  const update = (patch: Partial<AnswerClockOptions>) => utils.rerender(<Harness clockKey={key} opts={{ ...full, ...patch }} out={out} />);
  return { out, onTimeUp, update, key, ...utils };
}

describe('useAnswerClock', () => {
  it('never runs out while paused, then resumes from the remaining time', () => {
    const { onTimeUp, update } = mount({ limitSec: 10 });
    act(() => vi.advanceTimersByTime(4000));
    update({ paused: true }); // pause menu
    act(() => vi.advanceTimersByTime(60_000));
    expect(onTimeUp).not.toHaveBeenCalled();
    update({ paused: false });
    act(() => vi.advanceTimersByTime(5900));
    expect(onTimeUp).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onTimeUp).toHaveBeenCalledTimes(1);
  });

  it('a trip to Config (unmount → remount) neither resets nor spends the countdown', () => {
    const first = mount({ limitSec: 10 });
    act(() => vi.advanceTimersByTime(6000));
    first.unmount(); // Config
    act(() => vi.advanceTimersByTime(120_000));
    const again = mount({ limitSec: 10 }, first.key);
    expect(clockRemainingMs(again.out.current!.clock!, 10, Date.now())).toBe(4000);
    act(() => vi.advanceTimersByTime(3900));
    expect(again.onTimeUp).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(again.onTimeUp).toHaveBeenCalledWith(first.key);
  });

  it('starts only when the question has been voiced — or when the player starts answering', () => {
    const { out, update, onTimeUp } = mount({ voiceBusy: true, limitSec: 5 });
    act(() => vi.advanceTimersByTime(4000));
    expect(out.current!.clock!.startedAt).toBeNull();
    update({ voiceBusy: false }); // the interviewer finished the question
    expect(out.current!.clock!.startedAt).toBe(T0 + 4000);
    act(() => vi.advanceTimersByTime(5000));
    expect(onTimeUp).toHaveBeenCalledTimes(1);

    resetAnswerClocks();
    const other = mount({ voiceBusy: true }, answerClockKey('s1', 'q2'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => other.out.current!.start()); // the player pressed the mic / typed
    expect(other.out.current!.clock!.startedAt).toBe(Date.now());
  });

  it('starts anyway after the cap when the voice never reports its end', () => {
    const { out } = mount({ voiceBusy: true });
    act(() => vi.advanceTimersByTime(CLOCK_START_CAP_MS - 10));
    expect(out.current!.clock!.startedAt).toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(out.current!.clock!.startedAt).not.toBeNull();
  });

  it('forgets a clock once its question is answered (key changes)', () => {
    const { key, rerender, out } = mount();
    expect(peekClock(key)).not.toBeNull();
    rerender(<Harness clockKey={null} opts={{ paused: false, voiceBusy: false, limitSec: 10, onTimeUp: vi.fn() }} out={out} />);
    expect(peekClock(key)).toBeNull();
  });
});

describe('AnswerTimer (HUD)', () => {
  it('shows the full limit while waiting, counts down while running, and freezes while paused', () => {
    useSettingsStore.getState().update({ display: { uiLang: 'en' } });
    const { getByTestId, rerender } = render(<AnswerTimer startedAt={null} limitSec={60} />);
    expect(getByTestId('hud-timer').dataset.state).toBe('waiting');
    expect(getByTestId('hud-timer').textContent).toContain('01:00');
    act(() => vi.advanceTimersByTime(5000));
    expect(getByTestId('hud-timer').textContent).toContain('01:00');

    rerender(<AnswerTimer startedAt={Date.now()} limitSec={60} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(getByTestId('hud-timer').textContent).toContain('00:50');

    const startedAt = Date.now() - 10_000;
    rerender(<AnswerTimer startedAt={startedAt} pausedAt={Date.now()} limitSec={60} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(getByTestId('hud-timer').dataset.state).toBe('paused');
    expect(getByTestId('hud-timer').textContent).toContain('00:50');
  });
});
