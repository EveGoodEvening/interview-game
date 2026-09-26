// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLM_PRESETS } from '../llm';
import { useGameStore } from '../store/game';
import { useSettingsStore } from '../store/settings';
import type { InterviewRecord } from '../types';
import { completionPercent } from './GalleryScreen';
import { recordRole, recordStats, RecordsScreen } from './RecordsScreen';
import { MiniCg } from './shared/MiniCg';
import { SetupScreen } from './SetupScreen';
import { INSTANT_POS, sliderToSpeed, speedToSlider, typedLength } from './settings/DisplayTab';
import { groupedPresets, presetGroup } from './settings/LlmTab';
import { createDraft } from './setup/model';
import { useSetupStore } from './setup/draft';
import { stepMenu, TitleScreen } from './TitleScreen';

vi.mock('../audio', () => ({
  playSfx: vi.fn(),
  playBgm: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioVolumes: vi.fn(),
}));

beforeEach(() => {
  useSettingsStore.getState().update({ display: { uiLang: 'en', reduceMotion: true } });
  useGameStore.setState({ screen: 'title', records: [], endings: {} });
  useSetupStore.setState({ ...createDraft('en'), initialized: false, direction: 1 });
});

afterEach(() => cleanup());

function rec(partial: Partial<InterviewRecord>): InterviewRecord {
  return {
    id: 'r',
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
      mainQuestions: 5,
      maxFollowUps: 2,
      answerTimeLimitSec: 0,
    },
    plan: null,
    transcript: [],
    report: { overallScore: 0, dimensions: [], strengths: [], improvements: [], questionReviews: [], summary: '', finalMessage: '' },
    ending: 'offer',
    finalScore: 80,
    affinity: 50,
    ...partial,
  };
}

describe('screen helpers', () => {
  it('title menu navigation skips disabled items and wraps', () => {
    const enabled = [true, false, true, true, true];
    expect(stepMenu(0, 1, enabled)).toBe(2);
    expect(stepMenu(2, -1, enabled)).toBe(0);
    expect(stepMenu(0, -1, enabled)).toBe(4);
    expect(stepMenu(4, 1, enabled)).toBe(0);
  });

  it('record stats and role', () => {
    expect(recordStats([])).toEqual({ count: 0, best: 0, average: 0 });
    expect(recordStats([rec({ finalScore: 90 }), rec({ finalScore: 61 })])).toEqual({ count: 2, best: 90, average: 76 });
    expect(recordRole(rec({}))).toBe('');
    const withPlan = rec({
      plan: {
        candidateName: '',
        targetRole: 'PM',
        summary: '',
        highlights: [],
        concerns: [],
        topics: [],
        opening: { speech: '', expression: 'smile' },
      },
    });
    expect(recordRole(withPlan)).toBe('PM');
  });

  it('gallery completion', () => {
    expect(completionPercent({})).toBe(0);
    expect(completionPercent({ 'yuki:offer': 1, 'ethan:perfect': 2, 'haru:rejected': 3 })).toBe(25);
    expect(completionPercent({ 'nobody:offer': 1 })).toBe(0);
  });

  it('text speed slider mapping round-trips', () => {
    expect(speedToSlider(0)).toBe(INSTANT_POS);
    expect(sliderToSpeed(INSTANT_POS)).toBe(0);
    expect(sliderToSpeed(speedToSlider(40))).toBe(40);
    expect(typedLength(10, 0, 0)).toBe(10);
    expect(typedLength(10, 20, 250)).toBe(5);
  });

  it('LLM presets: demo first, then international, Chinese, local/custom', () => {
    const ordered = groupedPresets(LLM_PRESETS).map(presetGroup);
    expect(ordered[0]).toBe('offline');
    const order = ['offline', 'global', 'cn', 'local'];
    for (let i = 1; i < ordered.length; i++) expect(order.indexOf(ordered[i])).toBeGreaterThanOrEqual(order.indexOf(ordered[i - 1]));
  });
});

describe('TitleScreen', () => {
  it('disables Continue without an autosave and moves the selection with arrows', () => {
    useGameStore.setState({ hasAutosave: () => false });
    render(<TitleScreen />);
    expect((screen.getByTestId('title-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('title-records').className).toContain('ts-menu__item--selected');
    fireEvent.click(screen.getByTestId('title-gallery'));
    expect(useGameStore.getState().screen).toBe('gallery');
  });
});

describe('SetupScreen', () => {
  it('validates the résumé step before moving on', () => {
    render(<SetupScreen from="title" />);
    fireEvent.click(screen.getByTestId('char-card-ethan'));
    expect(useSetupStore.getState().options.style).toBe('technical');
    fireEvent.click(screen.getByTestId('setup-next'));
    expect(useSetupStore.getState().step).toBe(1);

    fireEvent.click(screen.getByTestId('setup-next'));
    expect(useSetupStore.getState().step).toBe(1);
    expect(screen.getByText('Upload or paste your résumé first.')).toBeTruthy();

    fireEvent.change(screen.getByTestId('resume-text'), { target: { value: 'A'.repeat(120) } });
    fireEvent.click(screen.getByTestId('setup-next'));
    expect(useSetupStore.getState().step).toBe(2);
  });

  it('uses the sample résumé in the interview language', () => {
    render(<SetupScreen from="title" />);
    fireEvent.click(screen.getByTestId('setup-next'));
    fireEvent.click(screen.getByTestId('resume-sample'));
    const { resume } = useSetupStore.getState();
    expect(resume.source).toBe('sample');
    expect((screen.getByTestId('resume-text') as HTMLTextAreaElement).value).toBe(resume.text);
  });
});

describe('SetupScreen: Try again from a saved record', () => {
  it('opens the résumé step with a re-upload warning when the record shortened the résumé', () => {
    const shortened = `${'Shipped payment services at scale. '.repeat(120).slice(0, 3999).trimEnd()}…`;
    const record = rec({ id: 'r-old', config: { ...rec({}).config, resumeText: shortened, resumeFileName: 'cv.pdf' } });
    useGameStore.setState({ lastRecord: record });
    render(<SetupScreen from="result" />);
    expect(useSetupStore.getState().step).toBe(1);
    const warning = screen.getByTestId('resume-warning-record_truncated');
    expect(warning.textContent).toContain('first 4,000 characters');
    expect(warning.textContent).toContain('Upload or paste the full résumé again');
    expect((screen.getByTestId('resume-text') as HTMLTextAreaElement).value).toBe(shortened);
  });
});

describe('ending thumbnails', () => {
  it('MiniCg is a still frame by default: no petals, no blinking portrait, animation kill switch on', () => {
    const { container } = render(<MiniCg characterId="yuki" ending="offer" />);
    const root = container.querySelector('.mcg') as HTMLElement;
    expect(root.classList.contains('mcg--still')).toBe(true);
    expect(container.querySelector('.sp-layer')).toBeNull();
    expect(container.querySelector('.bg-still')).toBeTruthy();
    expect(container.querySelector('.cp-portrait--still')).toBeTruthy();
  });

  it('MiniCg can still animate when asked (the large CG)', () => {
    const { container } = render(<MiniCg characterId="haru" ending="offer" still={false} />);
    expect(container.querySelector('.mcg--still')).toBeNull();
    expect(container.querySelector('.sp-layer')).toBeTruthy();
  });

  it('Records renders every card with a still thumbnail', () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      rec({ id: `r${i}`, ending: (['perfect', 'offer', 'pending', 'rejected'] as const)[i % 4] }),
    );
    useGameStore.setState({ screen: 'records', records });
    const { container } = render(<RecordsScreen />);
    expect(container.querySelectorAll('.rec-card')).toHaveLength(30);
    expect(container.querySelectorAll('.mcg--still')).toHaveLength(30);
    expect(container.querySelectorAll('.sp-layer')).toHaveLength(0);
    expect(container.querySelectorAll('.cp-portrait:not(.cp-portrait--still)')).toHaveLength(0);
  });
});
