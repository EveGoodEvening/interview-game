import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Card.css';

export interface CardProps {
  children: ReactNode;
  title?: ReactNode;
  icon?: IconName;
  /** Right side of the header (buttons, chips). */
  actions?: ReactNode;
  /** Accent colour for the header icon / top ribbon (defaults to sakura). */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** Light paper panel with an optional header row. */
export function Card({ children, title, icon, actions, accent, className = '', style, 'data-testid': testId }: CardProps) {
  const vars = accent ? ({ ...style, '--card-accent': accent } as CSSProperties) : style;
  return (
    <section className={`gg-card ${className}`} style={vars} data-testid={testId}>
      {(title || actions) && (
        <header className="gg-card__head">
          {icon && (
            <span className="gg-card__icon">
              <Icon name={icon} size={16} />
            </span>
          )}
          {title && <h3 className="gg-card__title">{title}</h3>}
          {actions && <div className="gg-card__actions">{actions}</div>}
        </header>
      )}
      <div className="gg-card__body">{children}</div>
    </section>
  );
}
