// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAutosave } from '../../engine/persistence';
import { createSession } from '../../engine/session';
import { applyLlmPreset } from '../../llm';
import { useGameStore } from '../../store/game';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../store/settings';
import type { InterviewConfig } from '../../types';
import { useSetupStore } from '../setup/draft';
import { createDraft, sampleResume, SETUP_STORAGE_KEY } from '../setup/model';
import { DataTab, isInLiveInterview } from './DataTab';
import { LlmTab } from './LlmTab';
import { VoiceTab } from './VoiceTab';

vi.mock('../../audio', () => ({
  playSfx: vi.fn(),
  playBgm: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioVolumes: vi.fn(),
}));

const speech = vi.hoisted(() => ({
  voicesChanged: null as ((voices: SpeechSynthesisVoice[]) => void) | null,
  unsubscribe: () => {},
}));

vi.mock('../../speech', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../speech')>();
  return {
    ...actual,
    isBrowserTtsSupported: () => true,
    // The first load times out with nothing, like a cold Edge / Linux speech-dispatcher start.
    listBrowserVoices: () => Promise.resolve([]),
    onBrowserVoicesChanged: (cb: (voices: SpeechSynthesisVoice[]) => void) => {
      speech.voicesChanged = cb;
      return () => {
        speech.voicesChanged = null;
        speech.unsubscribe();
      };
    },
  };
});

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, localService: false, default: false } as SpeechSynthesisVoice;
}

const CONFIG: InterviewConfig = {
  characterId: 'yuki',
  lang: 'en',
  resumeText: 'Jane Doe · jane@example.com · Staff engineer',
  resumeFileName: 'resume.txt',
  targetRole: 'Staff Backend Engineer',
  jobDescription: '',
  style: 'behavioral',
  difficulty: 'normal',
  mainQuestions: 5,
  maxFollowUps: 2,
  answerTimeLimitSec: 0,
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().update({ display: { uiLang: 'en', reduceMotion: true } });
  useGameStore.setState({ screen: 'settings', previousScreen: 'title', session: null, stage: { kind: 'idle' }, records: [], endings: {} });
  useSetupStore.setState({ ...createDraft('en'), initialized: false, direction: 1 });
});

afterEach(() => cleanup());

describe('Voice tab', () => {
  it('shows browser voices that arrive after the first load gave up, and stops listening on unmount', async () => {
    useSettingsStore.getState().update({ tts: { engine: 'browser' } });
    const unsubscribe = vi.fn();
    speech.unsubscribe = unsubscribe;
    const { unmount } = render(<VoiceTab />);
    await act(async () => {});
    const zh = screen.getByTestId('tts-voice-zh') as HTMLSelectElement;
    expect(zh.textContent).not.toContain('Xiaoxiao');
    expect(screen.getAllByText('No voice found for this language; the default voice will be used.').length).toBeGreaterThan(0);

    act(() => speech.voicesChanged?.([voice('Microsoft Xiaoxiao Online (Natural)', 'zh-CN'), voice('Microsoft Aria Online (Natural)', 'en-US')]));
    expect((screen.getByTestId('tts-voice-zh') as HTMLSelectElement).textContent).toContain('Xiaoxiao');
    expect((screen.getByTestId('tts-voice-en') as HTMLSelectElement).textContent).toContain('Aria');

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('LLM tab temperature', () => {
  function useLlm(presetId: string, patch: Partial<typeof DEFAULT_SETTINGS.llm> = {}) {
    const llm = { ...applyLlmPreset(DEFAULT_SETTINGS.llm, presetId), apiKey: 'sk-test', ...patch };
    useSettingsStore.getState().update({ llm });
  }

  it('limits the slider to what the provider accepts and shows a clamped value', () => {
    useLlm('zhipu', { temperature: 1.5 });
    render(<LlmTab />);
    const slider = screen.getByTestId('llm-temperature') as HTMLInputElement;
    expect(slider.max).toBe('1');
    expect(slider.value).toBe('1');
    expect(screen.getByTestId('llm-temperature-row').textContent).toContain('accepts 0.0–1.0 only');
  });

  it('keeps the full OpenAI range elsewhere', () => {
    useLlm('deepseek', { temperature: 1.5 });
    render(<LlmTab />);
    const slider = screen.getByTestId('llm-temperature') as HTMLInputElement;
    expect(slider.max).toBe('2');
    expect(slider.value).toBe('1.5');
  });

  it('replaces the slider with a note for fixed-temperature models', () => {
    useLlm('openai', { model: 'gpt-5' });
    render(<LlmTab />);
    expect(screen.queryByTestId('llm-temperature')).toBeNull();
    expect(screen.getByTestId('llm-temperature-fixed').textContent).toContain('fixed temperature');
  });
});

describe('Data tab', () => {
  function confirm(testId: string) {
    fireEvent.click(screen.getByTestId(testId));
    fireEvent.click(screen.getByTestId(`${testId}-yes`));
  }

  it('deletes the unfinished interview (autosave + resumable in-memory session)', () => {
    const session = createSession(CONFIG);
    saveAutosave(session);
    useGameStore.setState({ session, stage: { kind: 'idle' } });
    render(<DataTab />);
    expect(screen.getByTestId('data-saved-row').textContent).toContain('Continue resumes');
    confirm('data-delete-saved');
    expect(localStorage.getItem('igg.session.v1')).toBeNull();
    expect(useGameStore.getState().session).toBeNull();
    expect(useGameStore.getState().hasAutosave()).toBe(false);
    expect((screen.getByTestId('data-delete-saved') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('data-saved-row').textContent).toContain('No unfinished interview');
  });

  it('cannot delete the interview Config was opened from', () => {
    const session = createSession(CONFIG);
    saveAutosave(session);
    useGameStore.setState({ session, previousScreen: 'interview', stage: { kind: 'answer' } as never });
    expect(isInLiveInterview(useGameStore.getState())).toBe(true);
    render(<DataTab />);
    expect((screen.getByTestId('data-delete-saved') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('data-erase-all') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('data-saved-row').textContent).toContain('Abandon interview');
    expect(localStorage.getItem('igg.session.v1')).not.toBeNull();
  });

  it('clears the setup wizard data: remembered options / role / JD and the loaded résumé', () => {
    localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ characterId: 'ethan', options: { targetRole: 'Staff Backend Engineer' } }));
    useSetupStore.setState({ resume: sampleResume('en'), step: 2, initialized: true, options: { ...createDraft('en').options, targetRole: 'Staff Backend Engineer' } });
    render(<DataTab />);
    confirm('data-clear-setup');
    expect(localStorage.getItem(SETUP_STORAGE_KEY)).toBeNull();
    const setup = useSetupStore.getState();
    expect(setup.resume.text).toBe('');
    expect(setup.options.targetRole).toBe('');
    expect(setup.step).toBe(0);
    expect(setup.initialized).toBe(false);
  });

  it('erases everything at once', () => {
    const session = createSession(CONFIG);
    saveAutosave(session);
    localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ characterId: 'ethan' }));
    useSettingsStore.getState().update({ llm: { apiKey: 'sk-secret' } });
    useGameStore.setState({ endings: { 'yuki:offer': 1 } });
    render(<DataTab />);
    confirm('data-erase-all');
    expect(localStorage.getItem('igg.session.v1')).toBeNull();
    expect(localStorage.getItem(SETUP_STORAGE_KEY)).toBeNull();
    expect(useGameStore.getState().endings).toEqual({});
    expect(useSettingsStore.getState().settings.llm.apiKey).toBe('');
  });

  it('says what "Reset settings" keeps', () => {
    render(<DataTab />);
    expect(screen.getByText(/records, endings, the autosave and setup data are kept/)).toBeTruthy();
  });
});
