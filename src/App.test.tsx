// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unlockAudio } from './audio';
import { unlockSpeech } from './speech';
import { useSettingsStore } from './store/settings';
import App from './App';

vi.mock('./audio', () => ({
  playSfx: vi.fn(),
  playBgm: vi.fn(),
  stopBgm: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioVolumes: vi.fn(),
}));

vi.mock('./speech', () => ({ unlockSpeech: vi.fn() }));

vi.mock('./llm/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm/http')>()),
  detectProxy: () => Promise.resolve(false),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // keeps the background prefetch from starting
  useSettingsStore.getState().update({ display: { uiLang: 'en', reduceMotion: true } });
  vi.mocked(unlockAudio).mockClear();
  vi.mocked(unlockSpeech).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('App: unlocking audio and speech on a user gesture', () => {
  it('primes speech (iOS/Safari) together with the audio engine, but not on Esc', async () => {
    render(<App />);
    // The speech module is its own chunk; it is fetched at startup so the first gesture can prime it.
    await act(async () => {
      await import('./speech');
      await Promise.resolve();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(unlockAudio).not.toHaveBeenCalled();
    expect(unlockSpeech).not.toHaveBeenCalled();

    fireEvent.pointerUp(window);
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    expect(unlockSpeech).toHaveBeenCalledTimes(1);

    fireEvent.touchEnd(window);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(unlockSpeech).toHaveBeenCalledTimes(3);
  });
});
