import { useRef, type KeyboardEvent } from 'react';
import { playSfx } from '../../audio';
import { Icon, type IconName } from './Icon';
import './Segmented.css';

export interface SegmentedOption<V extends string | number = string> {
  value: V;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** Tooltip (title attribute). */
  hint?: string;
  /** Small badge text next to the label, e.g. "default". */
  badge?: string;
}

export interface SegmentedProps<V extends string | number = string> {
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Stretch segments to fill the row. */
  block?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Radio group styled as a pill of segments (arrow keys move the selection). */
export function Segmented<V extends string | number = string>({
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  size = 'md',
  disabled = false,
  block = false,
  className = '',
  'data-testid': testId,
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const pick = (index: number) => {
    const opt = options[index];
    if (!opt || opt.disabled || disabled) return;
    if (opt.value !== value) {
      playSfx('click');
      onChange(opt.value);
    }
    refs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = options.length;
    let i = selectedIndex < 0 ? 0 : selectedIndex;
    for (let step = 0; step < n; step++) {
      i = (((i + delta) % n) + n) % n;
      if (!options[i]?.disabled) break;
    }
    pick(i);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-disabled={disabled || undefined}
      className={`gg-seg gg-seg--${size}${block ? ' gg-seg--block' : ''}${disabled ? ' gg-seg--disabled' : ''} ${className}`}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        const focusable = checked || (selectedIndex < 0 && i === 0);
        return (
          <button
            key={String(opt.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={focusable ? 0 : -1}
            disabled={disabled || opt.disabled}
            title={opt.hint}
            className={`gg-seg__opt${checked ? ' gg-seg__opt--on' : ''}`}
            onClick={() => pick(i)}
            data-value={String(opt.value)}
          >
            {opt.icon && <Icon name={opt.icon} size={size === 'sm' ? 14 : 16} />}
            <span>{opt.label}</span>
            {opt.badge && <span className="gg-seg__badge">{opt.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
