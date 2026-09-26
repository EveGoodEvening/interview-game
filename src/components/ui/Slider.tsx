import type { CSSProperties } from 'react';
import './Slider.css';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Fired once the user releases the thumb / key (e.g. to play a test sound). */
  onCommit?: (value: number) => void;
  /** Text for the value bubble; `null` hides the bubble. */
  format?: ((value: number) => string) | null;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Clamp and snap `value` to the slider's grid (min, min + step, …). The result never exceeds `max`,
 * even when `max` is off the grid (e.g. max 1.99 with step 0.1 tops out at 1.9, like a native range input).
 */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  // Avoid 0.30000000000000004-style artefacts.
  const decimals = Math.max((String(step).split('.')[1] ?? '').length, (String(min).split('.')[1] ?? '').length);
  const round = (n: number) => Number(n.toFixed(decimals));
  const top = max > min ? round(min + Math.floor((max - min) / step + 1e-9) * step) : min;
  const snapped = round(min + Math.round((clamped - min) / step) * step);
  return Math.min(top, snapped);
}

/** Range slider with a filled track and a value bubble. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format = (v) => String(v),
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  id,
  className = '',
  'data-testid': testId,
}: SliderProps) {
  const safe = snapToStep(value, min, max, step);
  const pct = max > min ? ((safe - min) / (max - min)) * 100 : 0;
  const text = format ? format(safe) : null;
  return (
    <div className={`gg-slider${disabled ? ' gg-slider--disabled' : ''} ${className}`}>
      <input
        id={id}
        type="range"
        className="gg-slider__input"
        min={min}
        max={max}
        step={step}
        value={safe}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-valuetext={text ?? undefined}
        data-testid={testId}
        style={{ '--gg-slider-pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(snapToStep(Number(e.currentTarget.value), min, max, step))}
        onPointerUp={(e) => onCommit?.(snapToStep(Number(e.currentTarget.value), min, max, step))}
        onKeyUp={(e) => onCommit?.(snapToStep(Number(e.currentTarget.value), min, max, step))}
      />
      {text !== null && (
        <output className="gg-slider__value" aria-hidden="true">
          {text}
        </output>
      )}
    </div>
  );
}
