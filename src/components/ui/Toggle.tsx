import { playSfx } from '../../audio';
import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no visible <label>. */
  ariaLabel?: string;
  /** id of the element that labels this switch. */
  ariaLabelledBy?: string;
  /** Small text inside the track, e.g. ['ON', 'OFF']. */
  onText?: string;
  offText?: string;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

/** Pill-shaped on/off switch (role="switch"). */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  onText,
  offText,
  id,
  className = '',
  'data-testid': testId,
}: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      data-testid={testId}
      className={`gg-toggle${checked ? ' gg-toggle--on' : ''} ${className}`}
      onClick={() => {
        playSfx('click');
        onChange(!checked);
      }}
    >
      <span className="gg-toggle__track">
        {(onText || offText) && <span className="gg-toggle__text">{checked ? onText : offText}</span>}
        <span className="gg-toggle__knob" />
      </span>
    </button>
  );
}
