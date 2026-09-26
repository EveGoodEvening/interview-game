import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './FieldRow.css';

export interface FieldRowProps {
  label: ReactNode;
  /** Secondary line under the label. */
  hint?: ReactNode;
  /** Rendered by a function so the control can reference the label id (aria-labelledby). */
  children: ReactNode | ((labelId: string) => ReactNode);
  /** Extra content below the control (notes, results). */
  below?: ReactNode;
  /** Label column width in px (default 240). */
  labelWidth?: number;
  className?: string;
  'data-testid'?: string;
}

/** Galgame "config" row: label on the left, control on the right. */
export function FieldRow({ label, hint, children, below, labelWidth, className = '', 'data-testid': testId }: FieldRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div
      className={`gg-row ${className}`}
      style={labelWidth ? { gridTemplateColumns: `${labelWidth}px 1fr` } : undefined}
      data-testid={testId}
    >
      <div className="gg-row__label">
        <span className="gg-row__title" id={labelId}>
          {label}
        </span>
        {hint && <span className="gg-row__hint">{hint}</span>}
      </div>
      <div className="gg-row__control">
        {typeof children === 'function' ? children(labelId) : children}
        {below && <div className="gg-row__below">{below}</div>}
      </div>
    </div>
  );
}

export interface FieldSectionProps {
  title: ReactNode;
  icon?: IconName;
  /** Right-aligned header content (e.g. a status chip). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Section header with a ribbon rule, grouping several FieldRows. */
export function FieldSection({ title, icon = 'sakura', aside, children, className = '' }: FieldSectionProps) {
  return (
    <section className={`gg-section ${className}`}>
      <header className="gg-section__head">
        <Icon name={icon} size={16} className="gg-section__icon" />
        <h3 className="gg-section__title">{title}</h3>
        <span className="gg-section__rule" aria-hidden="true" />
        {aside && <div className="gg-section__aside">{aside}</div>}
      </header>
      <div className="gg-section__body">{children}</div>
    </section>
  );
}
