// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../store/game';
import { useSettingsStore } from '../../store/settings';
import { clearToasts, useToastStore } from '../ui/Toast';
import { Backlog } from './Backlog';
import { ErrorDialog } from './ErrorDialog';
import { PauseMenu } from './PauseMenu';
import { resetSeenEvents } from './seenEvents';
import { showStorageWarnings } from './useSceneEvents';

vi.mock('../../audio', () => ({ playSfx: vi.fn(), playBgm: vi.fn(), unlockAudio: vi.fn(), setAudioVolumes: vi.fn() }));

beforeEach(() => {
  useSettingsStore.getState().update({ display: { uiLang: 'en' } });
  resetSeenEvents();
  clearToasts();
});
afterEach(() => cleanup());

describe('ErrorDialog', () => {
  const props = () => ({ code: 'timeout', message: 'took too long', retrying: false, onRetry: vi.fn(), onSettings: vi.fn(), onSaveQuit: vi.fn(), onAbandon: vi.fn() });

  it('asks before abandoning the interview (like the pause menu)', () => {
    const p = props();
    render(<ErrorDialog {...p} />);
    fireEvent.click(screen.getByTestId('error-abandon'));
    expect(p.onAbandon).not.toHaveBeenCalled();
    expect(screen.getByText(/will not be saved/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('error-abandon-no'));
    expect(p.onAbandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('error-abandon'));
    fireEvent.click(screen.getByTestId('error-abandon-yes'));
    expect(p.onAbandon).toHaveBeenCalledTimes(1);
  });

  it('names the real Config tab in its hint', () => {
    render(<ErrorDialog {...props()} code="network" />);
    expect(screen.getByTestId('error-dialog').textContent).toContain('Config → AI Model');
    expect(screen.getByTestId('error-dialog').textContent).toContain('Use local relay');
  });
});

describe('Backlog', () => {
  const lines = [{ id: 'e1', role: 'interviewer' as const, text: 'Tell me about yourself.' }];

  it('disables ▶ replay while the mic is recording', () => {
    const onReplay = vi.fn();
    const { rerender } = render(<Backlog lines={lines} interviewer={{ name: 'Yuki', color: '#f7a' }} playerName="Me" onReplay={onReplay} replayDisabled onClose={vi.fn()} />);
    const replay = screen.getByRole('button', { name: /Replay this line/ }) as HTMLButtonElement;
    expect(replay.disabled).toBe(true);
    fireEvent.click(replay);
    expect(onReplay).not.toHaveBeenCalled();
    rerender(<Backlog lines={lines} interviewer={{ name: 'Yuki', color: '#f7a' }} playerName="Me" onReplay={onReplay} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Replay this line/ }));
    expect(onReplay).toHaveBeenCalledWith('Tell me about yourself.');
  });
});

/** An answer box plus an overlay that opens / closes like the interview scene's. */
function Scene({ which }: { which: 'menu' | 'backlog' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <textarea data-testid="answer" />
      <button type="button" data-testid="open" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} />
      {open &&
        (which === 'menu' ? (
          <PauseMenu onResume={() => setOpen(false)} onConfig={vi.fn()} onSaveQuit={vi.fn()} onAbandon={vi.fn()} />
        ) : (
          <Backlog lines={[]} interviewer={{ name: 'Yuki', color: '#f7a' }} playerName="Me" onReplay={vi.fn()} onClose={() => setOpen(false)} />
        ))}
    </div>
  );
}

describe('focus return', () => {
  for (const which of ['menu', 'backlog'] as const) {
    it(`gives the focus back to the answer box when the ${which} closes`, () => {
      render(<Scene which={which} />);
      const answer = screen.getByTestId('answer');
      answer.focus();
      act(() => screen.getByTestId('open').click());
      expect(document.activeElement).not.toBe(answer); // the overlay took the focus
      if (which === 'menu') act(() => screen.getByRole('button', { name: 'Resume' }).click());
      else act(() => screen.getByRole('button', { name: 'Close' }).click());
      expect(document.activeElement).toBe(answer);
    });
  }
});

describe('storage warnings', () => {
  const warning = (id: number): GameEvent => ({ id, type: 'storage_warning' });

  it('shows one localized notice per unseen warning streak, once', () => {
    expect(showStorageWarnings([warning(1)], 's1', 'en')).toBe(true);
    const items = useToastStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('warning');
    expect(items[0].title).toBe('Progress not saved');
    expect(items[0].message).toMatch(/only in this tab/);
    // Already shown: not again (e.g. after a remount).
    expect(showStorageWarnings([warning(1)], 's1', 'en')).toBe(false);
    expect(showStorageWarnings([warning(1), warning(2)], 's1', 'zh')).toBe(true);
    expect(useToastStore.getState().items.at(-1)?.title).toBe('进度没能保存');
  });
});
