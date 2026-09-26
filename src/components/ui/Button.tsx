import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { playSfx } from '../../audio';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Sound on click ('confirm' default for primary, 'click' otherwise; null = silent). */
  sfx?: 'click' | 'confirm' | 'cancel' | null;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon (e.g. 'next'). */
  iconEnd?: IconName;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  children?: ReactNode;
  /** React 19: refs are plain props on function components. */
  ref?: Ref<HTMLButtonElement>;
}

const ICON_SIZE = { sm: 14, md: 17, lg: 20 } as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  sfx,
  icon,
  iconEnd,
  loading = false,
  className = '',
  onClick,
  onMouseEnter,
  disabled,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const sound = sfx === undefined ? (variant === 'primary' ? 'confirm' : 'click') : sfx;
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`gg-btn gg-btn--${variant} gg-btn--${size}${loading ? ' gg-btn--loading' : ''} ${className}`}
      onMouseEnter={(e) => {
        if (!isDisabled) playSfx('hover');
        onMouseEnter?.(e);
      }}
      onClick={(e) => {
        if (sound) playSfx(sound);
        onClick?.(e);
      }}
    >
      {loading ? <Spinner size={ICON_SIZE[size]} /> : icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={ICON_SIZE[size]} />}
    </button>
  );
}
