import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Chip.css';

export type ChipTone = 'sakura' | 'lavender' | 'sky' | 'mint' | 'gold' | 'danger' | 'neutral';

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  /** Custom accent (hex) — overrides `tone`, e.g. a character's theme colour. */
  color?: string;
  variant?: 'soft' | 'solid' | 'outline';
  icon?: IconName;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

/** Small rounded label (style tags, status badges, file names…). */
export function Chip({ children, tone = 'sakura', color, variant = 'soft', icon, size = 'md', className = '', title }: ChipProps) {
  const style = color ? ({ '--chip-c': color } as CSSProperties) : undefined;
  return (
    <span className={`gg-chip gg-chip--${tone} gg-chip--${variant} gg-chip--${size} ${className}`} style={style} title={title}>
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
    </span>
  );
}
