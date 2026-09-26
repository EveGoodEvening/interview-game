import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Extra class on the panel. */
  className?: string;
}

/** Stage-level modal dialog (renders inside the scaled stage, not a portal). Esc closes. */
export function Modal({ open, title, onClose, children, footer, width = 640, className = '' }: ModalProps) {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Move focus into the dialog (unless a child already took it, e.g. autoFocus) and restore it on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return (
    <div className="gg-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={panelRef}
        className={`gg-modal gg-panel ${className}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
      >
        {title !== undefined && (
          <div className="gg-modal__head">
            <h2 className="gg-modal__title" id={titleId}>
              <Icon name="sakura" size={18} className="gg-modal__title-icon" />
              {title}
            </h2>
            {onClose && (
              <button type="button" className="gg-modal__close" aria-label={t('common.close')} onClick={onClose}>
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        )}
        <div className="gg-modal__body gg-scroll">{children}</div>
        {footer && <div className="gg-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
