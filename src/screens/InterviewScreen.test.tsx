// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnswerClocks } from '../components/game/answerClock';
import { clearAnswerDrafts } from '../components/game/AnswerPanel';
import { resetSeenEvents } from '../components/game/seenEvents';
import { clearToasts, useToastStore } from '../components/ui/Toast';
import { makeConfig, makePlan } from '../engine/__fixtures__/builders';
import { applyPlan, createSession } from '../engine/session';
import { useGameStore } from '../store/game';
import { useSettingsStore } from '../store/settings';
import type { InterviewSession, Stage } from '../types';
import { InterviewScreen } from './InterviewScreen';

vi.mock('../audio', () => ({ playSfx: vi.fn(), playBgm: vi.fn(), unlockAudio: vi.fn(), setAudioVolumes: vi.fn() }));
// The art is irrelevant here (and has its own blink / idle timers).
vi.mock('../art', () => ({ CharacterSprite: () => null, OfficeBackground: () => null }));

const actions = {
  skipQuestion: vi.fn(async () => {}),
  submitAnswer: vi.fn(async () => {}),
  endReverseQA: vi.fn(async () => {}),
  interviewerDone: vi.fn(),
  openSettings: vi.fn(),
  suspendInterview: vi.fn(),
  abandonInterview: vi.fn(),
};

function session(limitSec: number): InterviewSession {
  return applyPlan(createSession(makeConfig({ lang: 'en', answerTimeLimitSec: limitSec })), makePlan(3)).session;
}

function mount(s: InterviewSession, stage: Stage) {
  useGameStore.setState({ session: s, stage, events: [], screen: 'interview', ...actions });
  return render(<InterviewScreen />);
}

const esc = () => act(() => void fireEvent.keyDown(window, { key: 'Escape' }));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const timer = () => screen.getByTestId('hud-timer');

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(actions)) fn.mockClear();
  resetAnswerClocks();
  clearAnswerDrafts();
  resetSeenEvents();
  clearToasts();
  useSettingsStore.getState().update({
    display: { uiLang: 'en', reduceMotion: true, textSpeed: 40, autoAdvance: false },
    tts: { engine: 'off' },
    stt: { engine: 'keyboard' },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InterviewScreen — pausing', () => {
  it('the pause menu freezes the answer countdown: nothing is skipped or submitted behind it', () => {
    mount(session(4), { kind: 'answer' });
    wait(1000);
    esc();
    expect(screen.getByTestId('pause-menu')).toBeTruthy();
    expect(timer().dataset.state).toBe('paused');
    const frozen = timer().textContent;
    wait(30_000);
    expect(actions.skipQuestion).not.toHaveBeenCalled();
    expect(actions.submitAnswer).not.toHaveBeenCalled();
    expect(timer().textContent).toBe(frozen);

    act(() => screen.getByRole('button', { name: 'Resume' }).click());
    wait(2900);
    expect(actions.skipQuestion).not.toHaveBeenCalled();
    wait(200);
    expect(actions.skipQuestion).toHaveBeenCalledTimes(1);
  });

  it('the backlog pauses the countdown too, and a typed answer is not auto-submitted behind it', () => {
    mount(session(4), { kind: 'answer' });
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'half an answer' } });
    act(() => screen.getByRole('button', { name: /^Log/ }).click());
    expect(screen.getByTestId('backlog')).toBeTruthy();
    wait(20_000);
    expect(actions.submitAnswer).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: 'Close' }).click());
    wait(4100);
    expect(actions.submitAnswer).toHaveBeenCalledWith('half an answer', expect.objectContaining({ via: 'text' }));
  });

  it('a trip to Config resumes the countdown from the remaining time (no reset, no time spent)', () => {
    const s = session(10);
    const first = mount(s, { kind: 'answer' });
    wait(6000);
    first.unmount(); // openSettings swaps the screen
    wait(60_000);
    mount(s, { kind: 'answer' });
    expect(timer().textContent).toContain('00:04');
    wait(3900);
    expect(actions.skipQuestion).not.toHaveBeenCalled();
    wait(200);
    expect(actions.skipQuestion).toHaveBeenCalledTimes(1);
  });

  it('holds the interviewer line (no hand-over to the answer stage) while the menu is open', () => {
    const base = session(0);
    const last = base.transcript[base.transcript.length - 1];
    // A one-page question: it hands over on its own shortly after it is typed.
    const opening = { ...last, text: 'Tell me about yourself?', turn: { ...last.turn!, reaction: '', question: 'Tell me about yourself?' } };
    const s = { ...base, transcript: [...base.transcript.slice(0, -1), opening] };
    mount(s, { kind: 'interviewer', entryId: opening.id });
    esc();
    wait(30_000);
    expect(actions.interviewerDone).not.toHaveBeenCalled();
    esc();
    wait(1000);
    expect(actions.interviewerDone).toHaveBeenCalledTimes(1);
  });

  it('announces a failed autosave write once', () => {
    const s = session(0);
    mount(s, { kind: 'answer' });
    act(() => useGameStore.setState({ events: [{ id: 7, type: 'storage_warning' }] }));
    expect(useToastStore.getState().items.map((i) => i.title)).toEqual(['Progress not saved']);
    act(() => useGameStore.setState({ events: [{ id: 7, type: 'storage_warning' }] }));
    expect(useToastStore.getState().items).toHaveLength(1);
  });
});
