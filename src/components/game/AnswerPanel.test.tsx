// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SttError, type ListenOptions, type ListenSession, type SttEngine } from '../../speech';
import { useSettingsStore } from '../../store/settings';
import { AnswerPanel, clearAnswerDrafts, type AnswerPanelProps } from './AnswerPanel';

vi.mock('../../audio', () => ({ playSfx: vi.fn(), playBgm: vi.fn(), unlockAudio: vi.fn(), setAudioVolumes: vi.fn() }));

const keyboardStt: SttEngine = {
  kind: 'keyboard',
  isAvailable: () => false,
  start: () => Promise.reject(new Error('keyboard')),
};

/** A controllable fake voice engine. */
function fakeVoiceStt(finalText: string) {
  let opts: ListenOptions | null = null;
  const session: ListenSession = { stop: vi.fn(async () => finalText), cancel: vi.fn() };
  const engine: SttEngine = {
    kind: 'browser',
    isAvailable: () => true,
    start: vi.fn(async (o: ListenOptions) => {
      opts = o;
      return session;
    }),
  };
  return { engine, session, partial: (text: string) => opts?.onPartial?.(text) };
}

function setup(overrides: Partial<AnswerPanelProps> = {}) {
  const props: AnswerPanelProps = {
    stt: keyboardStt,
    lang: 'en',
    autoSubmit: false,
    reverse: false,
    timeUp: false,
    hotkeysEnabled: true,
    startedAt: Date.now() - 42_000,
    draftKey: 'q1',
    onSubmit: vi.fn(),
    onSkip: vi.fn(),
    onEndReverse: vi.fn(),
    onRepeatQuestion: vi.fn(),
    onMicStart: vi.fn(),
    ...overrides,
  };
  const utils = render(<AnswerPanel {...props} />);
  return { props, ...utils };
}

beforeEach(() => {
  useSettingsStore.getState().update({ display: { uiLang: 'en' } });
  clearAnswerDrafts();
});
afterEach(() => {
  cleanup();
});

describe('AnswerPanel — keyboard flow', () => {
  it('shows a textarea and keeps Submit disabled until something is typed', () => {
    setup();
    expect(screen.getByTestId('answer-panel').dataset.mode).toBe('keyboard');
    const submit = screen.getByTestId('answer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'I led the migration.' } });
    expect(submit.disabled).toBe(false);
  });

  it('submits the trimmed text with Ctrl+Enter, via text, with the answer duration', () => {
    const { props } = setup();
    const textarea = screen.getByTestId('answer-textarea');
    fireEvent.change(textarea, { target: { value: '  First we measured, then we shipped.  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    const [text, meta] = (props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(text).toBe('First we measured, then we shipped.');
    expect(meta.via).toBe('text');
    expect(meta.durationSec).toBeGreaterThanOrEqual(42);
    // Submitting twice is impossible.
    fireEvent.click(screen.getByTestId('answer-submit'));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits with the button', () => {
    const { props } = setup();
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'Button answer' } });
    fireEvent.click(screen.getByTestId('answer-submit'));
    expect(props.onSubmit).toHaveBeenCalledWith('Button answer', expect.objectContaining({ via: 'text' }));
  });

  it('keeps a typed draft across remounts for the same question', () => {
    const first = setup();
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'half-written thought' } });
    first.unmount();
    setup();
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('half-written thought');
  });

  it('asks for confirmation before skipping', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('answer-skip'));
    expect(props.onSkip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('answer-skip-yes'));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it('opens the skip confirmation when the quick menu asks for it', () => {
    const { props, rerender } = setup({ skipRequest: 0 });
    expect(screen.queryByTestId('answer-skip-yes')).toBeNull();
    rerender(<AnswerPanel {...props} skipRequest={1} />);
    expect(screen.getByTestId('answer-skip-yes')).toBeTruthy();
  });

  it('offers "No more questions" instead of Skip in the reverse Q&A', () => {
    const { props } = setup({ reverse: true });
    expect(screen.queryByTestId('answer-skip')).toBeNull();
    fireEvent.click(screen.getByTestId('answer-end-reverse'));
    expect(props.onEndReverse).toHaveBeenCalledTimes(1);
  });

  it('repeats the question on request', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('answer-repeat'));
    expect(props.onRepeatQuestion).toHaveBeenCalledTimes(1);
  });

  it('when time is up: submits what was typed, or skips when empty', () => {
    const typed = setup();
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'Out of time but here it is' } });
    typed.rerender(<AnswerPanel {...typed.props} timeUp />);
    expect(typed.props.onSubmit).toHaveBeenCalledWith('Out of time but here it is', expect.anything());
    typed.unmount();

    clearAnswerDrafts();
    const empty = setup({ draftKey: 'q2' });
    empty.rerender(<AnswerPanel {...empty.props} timeUp />);
    expect(empty.props.onSkip).toHaveBeenCalledTimes(1);
    expect(empty.props.onSubmit).not.toHaveBeenCalled();
  });

  it('falls back to the keyboard with a hint when the voice engine is unavailable', () => {
    const unavailable: SttEngine = { kind: 'browser', isAvailable: () => false, start: vi.fn() };
    setup({ stt: unavailable });
    expect(screen.getByTestId('answer-panel').dataset.mode).toBe('keyboard');
    expect(screen.getByRole('status').textContent).toMatch(/isn’t available/);
    expect(unavailable.start).not.toHaveBeenCalled();
  });
});

describe('AnswerPanel — voice flow', () => {
  it('records, shows the live transcript, then lets the player edit and submit via voice', async () => {
    const stt = fakeVoiceStt('We migrated leaf components first.');
    const { props } = setup({ stt: stt.engine });
    expect(screen.getByTestId('answer-panel').dataset.mode).toBe('voice');

    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    expect(props.onMicStart).toHaveBeenCalled();
    expect(stt.engine.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en' }));
    expect(screen.getByTestId('answer-panel').dataset.phase).toBe('listening');

    act(() => stt.partial('We migrated leaf'));
    expect(screen.getByTestId('answer-live').textContent).toBe('We migrated leaf');

    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    expect(stt.session.stop).toHaveBeenCalled();
    expect(screen.getByTestId('answer-panel').dataset.phase).toBe('review');
    const textarea = screen.getByTestId('answer-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('We migrated leaf components first.');

    fireEvent.change(textarea, { target: { value: 'We migrated leaf components first, behind a flag.' } });
    fireEvent.click(screen.getByTestId('answer-submit'));
    expect(props.onSubmit).toHaveBeenCalledWith('We migrated leaf components first, behind a flag.', expect.objectContaining({ via: 'voice' }));
  });

  it('toggles the mic with the M key and auto-submits when enabled', async () => {
    const stt = fakeVoiceStt('Auto submitted answer');
    const { props } = setup({ stt: stt.engine, autoSubmit: true });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'm' });
    });
    expect(screen.getByTestId('answer-panel').dataset.phase).toBe('listening');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'M' });
    });
    expect(props.onSubmit).toHaveBeenCalledWith('Auto submitted answer', expect.objectContaining({ via: 'voice' }));
  });

  it('shows a friendly error when nothing was recognised and releases the mic on unmount', async () => {
    const stt = fakeVoiceStt('');
    const { unmount } = setup({ stt: stt.engine });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    expect(screen.getByTestId('answer-panel').dataset.phase).toBe('error');
    expect(screen.getByRole('status').textContent).toMatch(/didn’t catch that/);

    // Start again, then unmount while listening → the session is cancelled.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    unmount();
    expect(stt.session.cancel).toHaveBeenCalled();
  });

  it('can switch from voice to typing', () => {
    const stt = fakeVoiceStt('x');
    setup({ stt: stt.engine });
    fireEvent.click(screen.getByTestId('answer-use-keyboard'));
    expect(screen.getByTestId('answer-panel').dataset.mode).toBe('keyboard');
    expect(screen.getByTestId('answer-use-voice')).toBeTruthy();
  });
});

/** A fake engine whose every take is scripted: `takes[i]` is what stop() resolves with (or an error to reject with). */
function scriptedStt(takes: (string | Error)[], kind: SttEngine['kind'] = 'browser') {
  let opts: ListenOptions | null = null;
  let n = 0;
  const sessions: ListenSession[] = [];
  const engine: SttEngine = {
    kind,
    isAvailable: () => true,
    start: vi.fn(async (o: ListenOptions) => {
      opts = o;
      const take = takes[n++] ?? '';
      const session: ListenSession = {
        stop: vi.fn(async () => {
          if (take instanceof Error) throw take;
          return take;
        }),
        cancel: vi.fn(),
      };
      sessions.push(session);
      return session;
    }),
  };
  return { engine, sessions, partial: (text: string) => opts?.onPartial?.(text) };
}

const panel = () => screen.getByTestId('answer-panel');
const clickMic = () =>
  act(async () => {
    fireEvent.click(screen.getByTestId('mic-button'));
  });

describe('AnswerPanel — pausing', () => {
  it('stops a recording when the game pauses: what was heard becomes an editable draft, never auto-submitted', async () => {
    const stt = scriptedStt(['I scaled the checkout service']);
    const { props, rerender } = setup({ stt: stt.engine, autoSubmit: true });
    await clickMic();
    expect(panel().dataset.phase).toBe('listening');
    await act(async () => {
      rerender(<AnswerPanel {...props} paused hotkeysEnabled={false} />);
    });
    expect(stt.sessions[0].stop).toHaveBeenCalled();
    expect(panel().dataset.phase).toBe('review');
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('I scaled the checkout service');
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/stopped for the pause/);
    // The mic can't be restarted behind the pause menu.
    expect((screen.getByTestId('mic-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores the time limit while paused and applies it on resume', () => {
    const { props, rerender } = setup();
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'half an answer' } });
    rerender(<AnswerPanel {...props} paused hotkeysEnabled={false} timeUp />);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onSkip).not.toHaveBeenCalled();
    rerender(<AnswerPanel {...props} timeUp />);
    expect(props.onSubmit).toHaveBeenCalledWith('half an answer', expect.anything());
  });

  it('gives the focus back to the answer box after the pause (keyboard mode)', () => {
    const { props, rerender } = setup();
    const textarea = screen.getByTestId('answer-textarea');
    rerender(<AnswerPanel {...props} paused hotkeysEnabled={false} />);
    textarea.blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<AnswerPanel {...props} />);
    expect(document.activeElement).toBe(textarea);
  });
});

describe('AnswerPanel — adding to an answer', () => {
  it('pressing the mic again adds the new take to the edited answer instead of replacing it', async () => {
    const stt = scriptedStt(['I lead the order platform', 'I also mentored two interns']);
    setup({ stt: stt.engine });
    await clickMic();
    await clickMic();
    const textarea = () => screen.getByTestId('answer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea(), { target: { value: 'I lead the order platform, cutting latency from 320 ms to 80 ms.' } });

    await clickMic();
    expect(panel().dataset.phase).toBe('listening');
    // While listening the answer so far stays visible, with a separator before the new words.
    act(() => stt.partial('I also'));
    const live = screen.getByTestId('answer-live');
    expect(live.textContent).toContain('cutting latency from 320 ms to 80 ms.');
    expect(live.textContent).toContain('I also');
    expect(live.querySelector('.ans__live-sep')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/adding to your answer/);

    await clickMic();
    expect(textarea().value).toBe('I lead the order platform, cutting latency from 320 ms to 80 ms.\nI also mentored two interns');
  });

  it('adds to a typed answer after "Use voice"; only Re-record replaces the answer', async () => {
    const stt = scriptedStt(['and then we shipped it', 'a completely new answer']);
    setup({ stt: stt.engine });
    fireEvent.click(screen.getByTestId('answer-use-keyboard'));
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'We measured first' } });
    fireEvent.click(screen.getByTestId('answer-use-voice'));
    expect(screen.getByTestId('mic-button').getAttribute('aria-label')).toBe('Add more');
    await clickMic();
    await clickMic();
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('We measured first\nand then we shipped it');

    await act(async () => {
      fireEvent.click(screen.getByTestId('answer-rerecord'));
    });
    await clickMic();
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('a completely new answer');
  });

  it('a voice answer survives a remount (trip to Config): editable, submittable, and the mic adds to it', async () => {
    const stt = scriptedStt(['My name is Zhang', 'and I build backends']);
    const first = setup({ stt: stt.engine });
    await clickMic();
    await clickMic();
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'My name is Zhang Xiaoming' } });
    first.unmount();

    const again = setup({ stt: stt.engine });
    expect(panel().dataset.mode).toBe('voice');
    expect(panel().dataset.phase).toBe('review');
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('My name is Zhang Xiaoming');
    expect((screen.getByTestId('answer-submit') as HTMLButtonElement).disabled).toBe(false);
    await clickMic();
    await clickMic();
    fireEvent.click(screen.getByTestId('answer-submit'));
    expect(again.props.onSubmit).toHaveBeenCalledWith('My name is Zhang Xiaoming\nand I build backends', expect.objectContaining({ via: 'voice' }));
  });

  it('a recording cut off by a remount (quick-menu Config) keeps its live transcript as the draft', async () => {
    const stt = fakeVoiceStt('ignored');
    const first = setup({ stt: stt.engine, autoSubmit: true });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mic-button'));
    });
    act(() => stt.partial('I rebuilt the checkout'));
    expect(panel().dataset.phase).toBe('listening');
    first.unmount();
    expect(stt.session.cancel).toHaveBeenCalled();
    expect(stt.session.stop).not.toHaveBeenCalled();
    expect(first.props.onSubmit).not.toHaveBeenCalled();

    setup({ stt: stt.engine, autoSubmit: true });
    expect(panel().dataset.phase).toBe('review');
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('I rebuilt the checkout');
  });

  it('remembers "Type instead" across a remount', () => {
    const stt = scriptedStt([]);
    const first = setup({ stt: stt.engine });
    fireEvent.click(screen.getByTestId('answer-use-keyboard'));
    first.unmount();
    setup({ stt: stt.engine });
    expect(panel().dataset.mode).toBe('keyboard');
  });
});

describe('AnswerPanel — speech errors', () => {
  it('keeps a recording whose API transcription failed, says why, and retries it without re-recording', async () => {
    const recording = new Blob(['audio'], { type: 'audio/webm' });
    const failure = new SttError('api', 'The transcription service is rate-limiting requests (HTTP 429): Rate limit reached.', { status: 429, recording });
    const stt = scriptedStt([failure], 'api');
    const onRetryTranscription = vi.fn(async (blob: Blob) => (blob === recording ? 'Recovered answer' : ''));
    const { props } = setup({ stt: stt.engine, onRetryTranscription });
    await clickMic();
    await clickMic();

    expect(panel().dataset.phase).toBe('error');
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/rate-limiting you \(429\)/);
    expect(status.getAttribute('title')).toContain('Rate limit reached');
    expect(screen.getByTestId('answer-live').textContent).toMatch(/recording is kept/);
    expect(screen.getByTestId('answer-live').textContent).toContain('HTTP 429');
    // Switching to the keyboard is one click away.
    expect(screen.getByTestId('answer-use-keyboard')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('answer-retry-transcription'));
    });
    expect(onRetryTranscription).toHaveBeenCalledWith(recording, expect.any(AbortSignal));
    expect(panel().dataset.phase).toBe('review');
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('Recovered answer');
    expect(screen.queryByTestId('answer-retry-transcription')).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('a failed take keeps the answer typed so far and the recording across a remount', async () => {
    const recording = new Blob(['audio'], { type: 'audio/webm' });
    const failure = new SttError('network', 'Could not reach the transcription service: Failed to fetch.', { recording });
    const stt = scriptedStt([failure], 'api');
    const first = setup({ stt: stt.engine, onRetryTranscription: vi.fn(async () => 'x') });
    fireEvent.click(screen.getByTestId('answer-use-keyboard'));
    fireEvent.change(screen.getByTestId('answer-textarea'), { target: { value: 'Typed part' } });
    fireEvent.click(screen.getByTestId('answer-use-voice'));
    await clickMic();
    await clickMic();
    expect((screen.getByTestId('answer-textarea') as HTMLTextAreaElement).value).toBe('Typed part');
    expect(screen.getByRole('status').textContent).toMatch(/Couldn’t reach the speech-to-text endpoint/);
    expect(screen.getByRole('status').textContent).not.toMatch(/Chrome/);
    first.unmount();

    setup({ stt: stt.engine, onRetryTranscription: vi.fn(async () => 'x') });
    expect(screen.getByTestId('answer-retry-transcription')).toBeTruthy();
  });

  it('never calls a pending permission prompt "unsupported": explains it and lets the player cancel', async () => {
    vi.useFakeTimers();
    const permissions = { query: vi.fn(async () => ({ state: 'prompt' })) };
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: permissions });
    try {
      let resolveStart: (s: ListenSession) => void = () => {};
      const session: ListenSession = { stop: vi.fn(async () => 'late but fine'), cancel: vi.fn() };
      const engine: SttEngine = { kind: 'browser', isAvailable: () => true, start: vi.fn(() => new Promise<ListenSession>((r) => (resolveStart = r))) };
      setup({ stt: engine });
      await clickMic();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(panel().dataset.phase).toBe('starting');
      expect(screen.getByRole('status').textContent).toMatch(/Allow microphone access/);
      expect(screen.getByRole('status').textContent).not.toMatch(/can’t do speech recognition/);
      // The player finally allows it: the session is used.
      await act(async () => {
        resolveStart(session);
      });
      expect(panel().dataset.phase).toBe('listening');
      expect(session.cancel).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'permissions');
      vi.useRealTimers();
    }
  });
});
