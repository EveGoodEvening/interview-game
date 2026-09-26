import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import './Stars.css';

export interface StarsProps {
  value: number;
  max?: number;
  size?: number;
  /** Colour of filled stars (default gold). */
  color?: string;
  label?: string;
  className?: string;
}

/** Read-only star rating, e.g. interviewer strictness ★★★☆☆. */
export function Stars({ value, max = 5, size = 14, color, label, className = '' }: StarsProps) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  const style = color ? ({ '--stars-c': color } as CSSProperties) : undefined;
  return (
    <span className={`gg-stars ${className}`} style={style} role="img" aria-label={label ?? `${filled}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Icon key={i} name="star" size={size} className={i < filled ? 'gg-stars__on' : 'gg-stars__off'} />
      ))}
    </span>
  );
}
