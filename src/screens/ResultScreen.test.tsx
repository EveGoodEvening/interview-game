// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSeenEvents } from '../components/game/seenEvents';
import { useGameStore, type GameEvent } from '../store/game';
import { useSettingsStore } from '../store/settings';
import type { InterviewConfig, InterviewRecord } from '../types';
import { ResultScreen } from './ResultScreen';
import { useSetupStore } from './setup/draft';

vi.mock('../audio', () => ({ playSfx: vi.fn(), playBgm: vi.fn(), unlockAudio: vi.fn(), setAudioVolumes: vi.fn() }));

/** Full configs "still in memory" (store/game.ts keeps them for records finished this page session). */
const fullConfigs = new Map<string, InterviewConfig>();
vi.mock('../store/game', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/game')>();
  return { ...actual, fullConfigFor: (id: string) => fullConfigs.get(id) ?? null };
});

function record(id: string): InterviewRecord {
  return {
    id,
    finishedAt: 0,
    characterId: 'yuki',
    lang: 'en',
    config: {
      characterId: 'yuki',
      lang: 'en',
      resumeText: '',
      resumeFileName: '',
      targetRole: '',
      jobDescription: '',
      style: 'behavioral',
      difficulty: 'normal',
      mainQuestions: 3,
      maxFollowUps: 1,
      answerTimeLimitSec: 0,
    },
    plan: null,
    transcript: [],
    report: { overallScore: 70, dimensions: [], strengths: [], improvements: [], questionReviews: [], summary: 'ok', finalMessage: 'Bye!' },
    ending: 'offer',
    finalScore: 76,
    affinity: 70,
  };
}

const unlock = (id: number, recordId: string): GameEvent => ({ id, type: 'ending_unlocked', recordId, characterId: 'yuki', ending: 'offer', firstTime: true });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

beforeEach(() => {
  resetSeenEvents();
  fullConfigs.clear();
  useSettingsStore.getState().update({ display: { uiLang: 'en', reduceMotion: true }, tts: { engine: 'off' } });
});

afterEach(() => cleanup());

describe('ResultScreen', () => {
  it('shows the ending-unlocked toast once for the interview that just finished, never again on remount', async () => {
    const rec = record('r1');
    useGameStore.setState({ lastRecord: rec, events: [unlock(1, 'r1')] });
    const first = render(<ResultScreen from="interview" />);
    await flush();
    expect(screen.getAllByTestId('result-toast')).toHaveLength(1);
    expect(screen.getByTestId('screen-ResultScreen').dataset.view).toBe('cg');
    first.unmount();
    render(<ResultScreen from="interview" />);
    await flush();
    expect(screen.queryByTestId('result-toast')).toBeNull();
  });

  it('ignores unlock events of other records', async () => {
    useGameStore.setState({ lastRecord: record('r2'), events: [unlock(1, 'other')] });
    render(<ResultScreen from="interview" />);
    await flush();
    expect(screen.queryByTestId('result-toast')).toBeNull();
  });

  it('opens a record from Records / Gallery straight on the report, without the toast', async () => {
    useGameStore.setState({ lastRecord: record('r3'), events: [unlock(1, 'r3')] });
    render(<ResultScreen from="records" />);
    await flush();
    expect(screen.getByTestId('screen-ResultScreen').dataset.view).toBe('report');
    expect(screen.getByTestId('report-view')).toBeTruthy();
    expect(screen.queryByTestId('result-toast')).toBeNull();
    act(() => screen.getByTestId('result-back-source').click());
    expect(useGameStore.getState().screen).toBe('records');
  });

  it('pages long parting words (never one overflowing box) and opens the report after the last page', async () => {
    const long =
      'Thank you for walking me through the checkout migration today. I especially liked how you measured the latency before changing anything. ' +
      'Your answer on the incident review was honest, and that matters a lot to us. We will talk it over as a team this week. ' +
      'Whatever happens, keep writing down the numbers behind your work, because they tell your story better than adjectives. Take care on the way home.';
    const rec = record('r-long');
    rec.report = { ...rec.report, finalMessage: long };
    useGameStore.setState({ lastRecord: rec, events: [] });
    render(<ResultScreen from="interview" />);
    await flush();
    const counter = screen.getByTestId('result-page');
    const total = Number(counter.textContent!.split('/')[1]);
    expect(total).toBeGreaterThan(1);
    const text = () => document.querySelector('.res-dialogue .dlg-text .gg-visually-hidden')!.textContent!;
    const seen: string[] = [];
    for (let i = 1; i <= total; i++) {
      expect(counter.textContent).toBe(`${i}/${total}`);
      // Every page fits the box: at most ~140 Latin characters (70 units).
      expect(text().length).toBeLessThanOrEqual(150);
      seen.push(text());
      expect(screen.getByTestId('screen-ResultScreen').dataset.view).toBe('cg');
      act(() => fireEvent.click(screen.getByTestId('screen-ResultScreen')));
    }
    expect(seen.join(' ')).toBe(long);
    expect(screen.getByTestId('screen-ResultScreen').dataset.view).toBe('report');
  });

  it('"Try again" prefills Setup with the full config when it is still in memory', async () => {
    const rec = record('r-full');
    rec.config = { ...rec.config, resumeText: 'Short copy…', characterId: 'haru' };
    fullConfigs.set('r-full', { ...rec.config, resumeText: 'The whole résumé, well past 4000 characters in real life.' });
    useGameStore.setState({ lastRecord: rec, events: [] });
    render(<ResultScreen from="records" />);
    await flush();
    act(() => screen.getByTestId('result-try-again').click());
    expect(useGameStore.getState().screen).toBe('setup');
    // The next Setup visit consumes the prefill, whatever screen it is entered from.
    useSetupStore.getState().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    expect(useSetupStore.getState().resume.text).toBe('The whole résumé, well past 4000 characters in real life.');
    expect(useSetupStore.getState().characterId).toBe('haru');
  });

  it('"Try again" falls back to the record\'s own config for a record loaded from storage', async () => {
    const rec = record('r-stored');
    rec.config = { ...rec.config, resumeText: 'Stored résumé text of the reviewed record', characterId: 'ethan' };
    useGameStore.setState({ lastRecord: rec, events: [] });
    render(<ResultScreen from="gallery" />);
    await flush();
    act(() => screen.getByTestId('result-try-again').click());
    useSetupStore.getState().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    expect(useSetupStore.getState().resume.text).toBe('Stored résumé text of the reviewed record');
    expect(useSetupStore.getState().characterId).toBe('ethan');
  });

  it('each report tab has its own scroll container, so a newly opened tab starts at the top', async () => {
    useGameStore.setState({ lastRecord: record('r-tabs'), events: [] });
    render(<ResultScreen from="records" />);
    await flush();
    const overview = screen.getByTestId('report-panel-overview');
    overview.scrollTop = 240; // read down to the strengths
    act(() => screen.getByTestId('report-tab-questions').click());
    const questions = screen.getByTestId('report-panel-questions');
    expect(questions).not.toBe(overview);
    expect(questions.scrollTop).toBe(0);
    act(() => screen.getByTestId('report-tab-overview').click());
    expect(screen.getByTestId('report-panel-overview').scrollTop).toBe(0);
  });
});

