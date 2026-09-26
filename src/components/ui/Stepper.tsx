import { Fragment } from 'react';
import { playSfx } from '../../audio';
import { Icon } from './Icon';
import './Stepper.css';

export interface StepperStep {
  label: string;
  /** Small caption under the label (e.g. "STEP 1"). */
  caption?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** 0-based index of the active step. */
  current: number;
  /** Highest step index the user may jump to (defaults to `current`). */
  maxReachable?: number;
  onStepClick?: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}

export type StepState = 'done' | 'current' | 'upcoming';

export function stepState(index: number, current: number): StepState {
  if (index < current) return 'done';
  return index === current ? 'current' : 'upcoming';
}

/** Horizontal progress stepper: ① ── ② ── ③ with labels. */
export function Stepper({ steps, current, maxReachable = current, onStepClick, ariaLabel, className = '' }: StepperProps) {
  return (
    <nav className={`gg-stepper ${className}`} aria-label={ariaLabel}>
      <ol className="gg-stepper__list">
        {steps.map((step, i) => {
          const state = stepState(i, current);
          const clickable = !!onStepClick && i !== current && i <= maxReachable;
          return (
            <Fragment key={i}>
              {i > 0 && <li className={`gg-stepper__bar${i <= current ? ' gg-stepper__bar--done' : ''}`} aria-hidden="true" />}
              <li className={`gg-stepper__step gg-stepper__step--${state}`}>
                <button
                  type="button"
                  className="gg-stepper__btn"
                  disabled={!clickable}
                  aria-current={state === 'current' ? 'step' : undefined}
                  onClick={() => {
                    if (!clickable) return;
                    playSfx('click');
                    onStepClick?.(i);
                  }}
                  data-testid={`step-${i}`}
                >
                  <span className="gg-stepper__dot">{state === 'done' ? <Icon name="check" size={16} strokeWidth={3} /> : i + 1}</span>
                  <span className="gg-stepper__text">
                    {step.caption && <span className="gg-stepper__caption">{step.caption}</span>}
                    <span className="gg-stepper__label">{step.label}</span>
                  </span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
