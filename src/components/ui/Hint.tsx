import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Hint.css';

export type HintKind = 'info' | 'tip' | 'success' | 'warn' | 'error';

const ICONS: Record<HintKind, IconName> = {
  info: 'info',
  tip: 'sparkle',
  success: 'check',
  warn: 'warn',
  error: 'warn',
};

export interface HintProps {
  kind?: HintKind;
  children: ReactNode;
  /** Optional trailing action (e.g. a "Configure" button). */
  action?: ReactNode;
  icon?: IconName | null;
  compact?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Inline callout: a coloured note with an icon (info / tip / success / warning / error). */
export function Hint({ kind = 'info', children, action, icon, compact = false, className = '', 'data-testid': testId }: HintProps) {
  const iconName = icon === null ? null : (icon ?? ICONS[kind]);
  return (
    <div
      className={`gg-hint gg-hint--${kind}${compact ? ' gg-hint--compact' : ''} ${className}`}
      role={kind === 'error' ? 'alert' : undefined}
      data-testid={testId}
    >
      {iconName && <Icon name={iconName} size={compact ? 14 : 16} className="gg-hint__icon" />}
      <div className="gg-hint__text">{children}</div>
      {action && <div className="gg-hint__action">{action}</div>}
    </div>
  );
}

export interface TooltipProps {
  /** Tooltip text. */
  text: string;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
}

/** Hover / focus bubble. Renders inside the stage (CSS only, no portal). */
export function Tooltip({ text, children, placement = 'top', className = '' }: TooltipProps) {
  return (
    <span className={`gg-tip gg-tip--${placement} ${className}`} data-tip={text}>
      {children}
    </span>
  );
}

/** Small circled "?" with a tooltip, placed next to a label. */
export function HelpDot({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span className="gg-help-dot" tabIndex={0} aria-label={text} role="note">
        ?
      </span>
    </Tooltip>
  );
}
