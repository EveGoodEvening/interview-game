import { useT } from '../../i18n';
import { Button } from '../ui/Button';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Modal } from '../ui/Modal';
import { errorCopy, friendlyErrorCode } from './labels';
import './ErrorDialog.css';

export interface ErrorDialogProps {
  code: string;
  /** Raw error message (shown under "Details"). */
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onSettings: () => void;
  onSaveQuit: () => void;
  onAbandon: () => void;
}

/**
 * Friendly, localized error modal for stage 'error'. Not dismissable: the player picks a way forward.
 * Abandoning (which deletes the interview and its autosave) asks for confirmation, like the pause menu.
 */
export function ErrorDialog({ code, message, retrying, onRetry, onSettings, onSaveQuit, onAbandon }: ErrorDialogProps) {
  const t = useT();
  const copy = errorCopy(code, t);
  const known = friendlyErrorCode(code);
  return (
    <Modal
      open
      width={600}
      className="errdlg"
      title={
        <span className="errdlg__title">
          <span className="errdlg__icon" aria-hidden="true">
            !
          </span>
          {copy.title}
        </span>
      }
      footer={
        <div className="errdlg__foot">
          <ConfirmButton
            label={t('interview.error.abandon')}
            question={t('interview.menu.abandonConfirm')}
            confirmLabel={t('interview.menu.abandonYes')}
            cancelLabel={t('interview.menu.cancel')}
            onConfirm={onAbandon}
            variant="ghost"
            size="sm"
            className="errdlg__abandon"
            data-testid="error-abandon"
          />
          <span className="errdlg__spacer" />
          <Button onClick={onSettings}>{t('interview.error.settings')}</Button>
          <Button onClick={onSaveQuit}>{t('interview.error.saveQuit')}</Button>
          <Button variant="primary" onClick={onRetry} disabled={retrying} data-testid="error-retry" autoFocus>
            {retrying ? t('interview.error.retrying') : t('interview.error.retry')}
          </Button>
        </div>
      }
    >
      <div className="errdlg__body" data-testid="error-dialog" data-code={known}>
        <p className="errdlg__message">{copy.message}</p>
        <p className="errdlg__hint">{copy.hint}</p>
        {message && (
          <details className="errdlg__details">
            <summary>{t('interview.error.details')}</summary>
            <pre>
              [{code}] {message}
            </pre>
          </details>
        )}
      </div>
    </Modal>
  );
}
