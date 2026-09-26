// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from './ConfirmButton';
import { litBars, LevelMeter } from './LevelMeter';
import { ChunkLoadError } from './chunkLoader';
import { ScreenErrorBoundary } from './ScreenLoader';
import { Segmented } from './Segmented';
import { Select } from './Select';
import { Slider, snapToStep } from './Slider';
import { needsRotateHint, StageFrame } from './StageFrame';
import { Stepper, stepState } from './Stepper';
import { nextTabIndex, Tabs } from './Tabs';
import { TextField } from './TextField';
import { clearToasts, dismissToast, toast, ToastHost, useToastStore } from './Toast';
import { Toggle } from './Toggle';
import { useGameStore } from '../../store/game';
import { useSettingsStore } from '../../store/settings';

vi.mock('../../audio', () => ({
  playSfx: vi.fn(),
  playBgm: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioVolumes: vi.fn(),
}));

afterEach(() => {
  cleanup();
  clearToasts();
  vi.useRealTimers();
});

describe('Toggle', () => {
  it('is a switch that flips its value', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} ariaLabel="mute" />);
    const sw = screen.getByRole('switch', { name: 'mute' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} disabled ariaLabel="relay" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Slider', () => {
  it('snaps and clamps to the grid', () => {
    expect(snapToStep(0.33, 0, 1, 0.05)).toBe(0.35);
    expect(snapToStep(7, 3, 12, 1)).toBe(7);
    expect(snapToStep(99, 3, 12, 1)).toBe(12);
    expect(snapToStep(Number.NaN, 3, 12, 1)).toBe(3);
    expect(snapToStep(0.1 + 0.2, 0, 2, 0.1)).toBe(0.3);
  });

  it('never snaps above an off-grid max', () => {
    // e.g. a provider that accepts temperatures in [0, 2): 1.99 must not round up to 2.0.
    expect(snapToStep(1.99, 0, 1.99, 0.1)).toBe(1.9);
    expect(snapToStep(5, 0, 1.99, 0.1)).toBe(1.9);
    expect(snapToStep(1.2, 0, 1, 0.1)).toBe(1);
    expect(snapToStep(0.97, 0, 1, 0.1)).toBe(1);
    expect(snapToStep(1, 1, 1, 0.1)).toBe(1);
  });

  it('reports snapped values and shows the formatted bubble', () => {
    const onChange = vi.fn();
    render(<Slider value={5} min={3} max={12} onChange={onChange} format={(v) => `${v} Qs`} ariaLabel="questions" />);
    expect(screen.getByText('5 Qs')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'questions' }), { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith(9);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'easy', label: 'Easy' },
    { value: 'normal', label: 'Normal', disabled: true },
    { value: 'hard', label: 'Hard' },
  ];

  it('selects on click and marks the checked radio', () => {
    const onChange = vi.fn();
    render(<Segmented value="easy" options={options} onChange={onChange} ariaLabel="difficulty" />);
    expect(screen.getByRole('radio', { name: 'Easy' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
    expect(onChange).toHaveBeenCalledWith('hard');
  });

  it('arrow keys skip disabled options', () => {
    const onChange = vi.fn();
    render(<Segmented value="easy" options={options} onChange={onChange} ariaLabel="difficulty" />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('hard');
  });
});

describe('Tabs', () => {
  it('wraps indices', () => {
    expect(nextTabIndex(0, -1, 5)).toBe(4);
    expect(nextTabIndex(4, 1, 5)).toBe(0);
    expect(nextTabIndex(0, 1, 0)).toBe(-1);
  });

  it('moves with arrow keys in vertical orientation', () => {
    const onChange = vi.fn();
    const items = [
      { id: 'llm', label: 'LLM' },
      { id: 'voice', label: 'Voice' },
    ];
    render(<Tabs items={items} value="llm" onChange={onChange} orientation="vertical" ariaLabel="tabs" />);
    expect(screen.getByRole('tab', { name: 'LLM' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('voice');
  });
});

describe('Stepper', () => {
  it('derives step states', () => {
    expect(stepState(0, 1)).toBe('done');
    expect(stepState(1, 1)).toBe('current');
    expect(stepState(2, 1)).toBe('upcoming');
  });

  it('only lets the user jump to reachable steps', () => {
    const onStepClick = vi.fn();
    render(<Stepper steps={[{ label: 'A' }, { label: 'B' }, { label: 'C' }]} current={0} maxReachable={1} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByTestId('step-2'));
    expect(onStepClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('step-1'));
    expect(onStepClick).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('step-0').getAttribute('aria-current')).toBe('step');
  });
});

describe('TextField', () => {
  it('reveals a secret with the eye button', () => {
    render(<TextField value="sk-abc" onChange={() => {}} secret aria-label="key" />);
    const input = screen.getByLabelText('key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button'));
    expect(input.type).toBe('text');
  });

  it('emits plain string values and renders suggestions', () => {
    const onChange = vi.fn();
    const { container } = render(<TextField value="" onChange={onChange} suggestions={['a', 'b', 'a']} aria-label="model" />);
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'gpt' } });
    expect(onChange).toHaveBeenCalledWith('gpt');
    expect(container.querySelectorAll('datalist option')).toHaveLength(2);
  });
});

describe('Select', () => {
  it('keeps an unknown current value visible', () => {
    render(<Select value="custom-voice" options={[{ value: '', label: 'Auto' }]} onChange={() => {}} ariaLabel="voice" />);
    const select = screen.getByRole('combobox', { name: 'voice' }) as HTMLSelectElement;
    expect(select.value).toBe('custom-voice');
    expect(select.options).toHaveLength(2);
  });
});

describe('ConfirmButton', () => {
  it('asks inline before confirming', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Clear" question="Really?" confirmLabel="Yes" cancelLabel="No" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Really?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });
});

describe('LevelMeter', () => {
  it('lights bars on a curve', () => {
    expect(litBars(0, 10)).toBe(0);
    expect(litBars(0.01, 10)).toBe(1);
    expect(litBars(0.25, 10)).toBe(5);
    expect(litBars(4, 10)).toBe(10);
    const { container } = render(<LevelMeter level={1} bars={6} />);
    expect(container.querySelectorAll('.gg-meter__bar--on')).toHaveLength(6);
  });
});

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers());

  it('shows, auto-dismisses and removes toasts', () => {
    render(<ToastHost />);
    act(() => {
      toast('Saved', { kind: 'success', durationMs: 1000 });
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useToastStore.getState().items[0]?.leaving).toBe(true);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('keeps at most four visible and can be dismissed manually', () => {
    act(() => {
      for (let i = 0; i < 6; i++) toast(`t${i}`, { durationMs: 0 });
    });
    expect(useToastStore.getState().items.filter((i) => !i.leaving)).toHaveLength(4);
    const id = useToastStore.getState().items.at(-1)!.id;
    act(() => {
      dismissToast(id);
      vi.advanceTimersByTime(400);
    });
    expect(useToastStore.getState().items.some((i) => i.id === id)).toBe(false);
  });
});

describe('ScreenErrorBoundary', () => {
  const { navigate, suspendInterview, screen: initialScreen } = useGameStore.getState();
  beforeEach(() => {
    useSettingsStore.getState().update({ display: { uiLang: 'en' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useGameStore.setState({ navigate, suspendInterview, screen: initialScreen });
  });

  it('retries a failed chunk in place (no reload) and remounts the screen', () => {
    let fail = true;
    function Screen() {
      if (fail) throw new TypeError('Failed to fetch dynamically imported module: http://localhost/assets/SetupScreen-x.js');
      return <p>setup screen</p>;
    }
    const onRetry = vi.fn(() => {
      fail = false;
    });
    render(
      <ScreenErrorBoundary onRetry={onRetry}>
        <Screen />
      </ScreenErrorBoundary>,
    );
    expect(screen.getByTestId('screen-error').textContent).toContain('This screen failed to load');
    expect(screen.getByTestId('screen-error-reload')).toBeTruthy();
    fireEvent.click(screen.getByTestId('screen-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('setup screen')).toBeTruthy();
    expect(screen.queryByTestId('screen-error')).toBeNull();
  });

  it('offers only Title / Reload for a render crash; Title suspends a live interview', () => {
    function Broken(): never {
      throw new Error('boom');
    }
    const suspendInterview = vi.fn();
    const navigate = vi.fn();
    useGameStore.setState({ screen: 'interview', suspendInterview, navigate });
    render(
      <ScreenErrorBoundary>
        <Broken />
      </ScreenErrorBoundary>,
    );
    expect(screen.queryByTestId('screen-error-retry')).toBeNull();
    expect(screen.getByTestId('screen-error').textContent).toContain('Something went wrong');
    fireEvent.click(screen.getByTestId('screen-error-title'));
    expect(suspendInterview).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    useGameStore.setState({ screen: 'records' });
    fireEvent.click(screen.getByTestId('screen-error-title'));
    expect(navigate).toHaveBeenCalledWith('title');
  });

  it('asks for a reload when the chunk is reachable but can no longer be imported', () => {
    function Screen(): never {
      throw new ChunkLoadError('Failed to fetch dynamically imported module: http://localhost/assets/RecordsScreen-x.js', true);
    }
    render(
      <ScreenErrorBoundary onRetry={vi.fn()}>
        <Screen />
      </ScreenErrorBoundary>,
    );
    expect(screen.queryByTestId('screen-error-retry')).toBeNull();
    expect(screen.getByTestId('screen-error').textContent).toContain('the page has to be reloaded');
    expect(screen.getByTestId('screen-error-reload').className).toContain('gg-btn--primary');
    expect(screen.getByTestId('screen-error-title')).toBeTruthy();
  });
});

describe('StageFrame', () => {
  const size = { w: window.innerWidth, h: window.innerHeight };
  function resize(w: number, h: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    window.dispatchEvent(new Event('resize'));
  }
  beforeEach(() => useSettingsStore.getState().update({ display: { uiLang: 'en' } }));
  afterEach(() => resize(size.w, size.h));

  it('flags upright, narrow screens only', () => {
    expect(needsRotateHint({ width: 390, height: 844 })).toBe(true);
    expect(needsRotateHint({ width: 360, height: 640 })).toBe(true);
    expect(needsRotateHint({ width: 844, height: 390 })).toBe(false);
    expect(needsRotateHint({ width: 1280, height: 720 })).toBe(false);
    // A tall desktop window still shows the stage at a readable size.
    expect(needsRotateHint({ width: 900, height: 1000 })).toBe(false);
  });

  it('shows a dismissable "rotate your device" overlay on a portrait phone, keeping the stage', () => {
    resize(390, 844);
    render(
      <StageFrame>
        <p>stage content</p>
      </StageFrame>,
    );
    const hint = screen.getByTestId('rotate-hint');
    expect(hint.textContent).toContain('Rotate your device');
    expect(screen.getByText('stage content')).toBeTruthy();
    expect(screen.getByTestId('stage').style.transform).toContain(`scale(${390 / 1280})`);

    // Turning the phone hides it; turning it back shows it again until dismissed.
    act(() => resize(844, 390));
    expect(screen.queryByTestId('rotate-hint')).toBeNull();
    expect(screen.getByTestId('stage').style.transform).toContain(`scale(${390 / 720})`);
    act(() => resize(390, 844));
    expect(screen.getByTestId('rotate-hint')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rotate-dismiss'));
    expect(screen.queryByTestId('rotate-hint')).toBeNull();
    act(() => resize(391, 844));
    expect(screen.queryByTestId('rotate-hint')).toBeNull();
    expect(screen.getByText('stage content')).toBeTruthy();
  });

  it('keeps keys pressed on the overlay away from the screen underneath', () => {
    resize(390, 844);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(
        <StageFrame>
          <p>stage content</p>
        </StageFrame>,
      );
      fireEvent.keyDown(screen.getByTestId('rotate-dismiss'), { key: 'Enter' });
      expect(onWindowKey).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByTestId('rotate-hint'), { key: 'Escape' });
      expect(screen.queryByTestId('rotate-hint')).toBeNull();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
