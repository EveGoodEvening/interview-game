import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Button, type ButtonProps } from './Button';
import type { IconName } from './Icon';
import './ConfirmButton.css';

export interface ConfirmButtonProps {
  /** Label of the initial button. */
  label: string;
  /** Question shown while confirming, e.g. "Delete all records?". */
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  icon?: IconName;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  disabled?: boolean;
  /** Auto-cancel after this many ms (default 6 s). */
  timeoutMs?: number;
  className?: string;
  'data-testid'?: string;
}

/** Two-step inline confirmation (no window.confirm): click → "Sure? [Yes] [Cancel]". */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  cancelLabel,
  onConfirm,
  icon,
  size = 'md',
  variant = 'secondary',
  disabled = false,
  timeoutMs = 6000,
  className = '',
  'data-testid': testId,
}: ConfirmButtonProps) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asking) return;
    yesRef.current?.focus();
    const timer = window.setTimeout(() => setAsking(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [asking, timeoutMs]);

  if (!asking) {
    return (
      <Button
        size={size}
        variant={variant}
        icon={icon}
        disabled={disabled}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setAsking(true);
        }}
        data-testid={testId}
      >
        {label}
      </Button>
    );
  }
  return (
    <span className={`gg-confirm ${className}`} role="group" aria-label={question} onClick={(e) => e.stopPropagation()}>
      <span className="gg-confirm__q">{question}</span>
      <Button
        ref={yesRef}
        size={size}
        variant="danger"
        sfx="confirm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        data-testid={testId ? `${testId}-yes` : undefined}
      >
        {confirmLabel ?? t('common.yes')}
      </Button>
      <Button
        size={size}
        variant="secondary"
        sfx="cancel"
        onClick={() => setAsking(false)}
        data-testid={testId ? `${testId}-no` : undefined}
      >
        {cancelLabel ?? t('common.cancel')}
      </Button>
    </span>
  );
}
