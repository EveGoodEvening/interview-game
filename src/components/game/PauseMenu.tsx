import { useState } from 'react';
import { useT } from '../../i18n';
import { Button } from '../ui/Button';
import { useReturnFocus } from './useReturnFocus';
import './PauseMenu.css';

export interface PauseMenuProps {
  onResume: () => void;
  onConfig: () => void;
  onSaveQuit: () => void;
  onAbandon: () => void;
}

/**
 * Esc menu: Resume · Config · Save & quit to title · Abandon (with inline confirmation).
 * The scene is paused while it is open; closing it gives the focus back (e.g. to the answer box).
 */
export function PauseMenu({ onResume, onConfig, onSaveQuit, onAbandon }: PauseMenuProps) {
  const t = useT();
  useReturnFocus();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  return (
    <div className="pmenu" role="dialog" aria-modal="true" aria-label={t('interview.menu.title')} data-testid="pause-menu" onMouseDown={(e) => e.target === e.currentTarget && onResume()}>
      <div className="pmenu__panel">
        <span className="pmenu__kicker">PAUSE</span>
        <h2 className="pmenu__title">{t('interview.menu.title')}</h2>
        <div className="pmenu__items">
          <Button variant="primary" size="lg" onClick={onResume} autoFocus>
            {t('interview.menu.resume')}
          </Button>
          <Button size="lg" onClick={onConfig}>
            {t('interview.menu.config')}
          </Button>
          <Button size="lg" onClick={onSaveQuit}>
            {t('interview.menu.saveQuit')}
          </Button>
          {confirmAbandon ? (
            <div className="pmenu__confirm" role="alert">
              <p>{t('interview.menu.abandonConfirm')}</p>
              <div className="pmenu__confirm-row">
                <Button variant="danger" onClick={onAbandon} sfx="cancel">
                  {t('interview.menu.abandonYes')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmAbandon(false)}>
                  {t('interview.menu.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="lg" className="pmenu__danger" onClick={() => setConfirmAbandon(true)}>
              {t('interview.menu.abandon')}
            </Button>
          )}
        </div>
        <p className="pmenu__keys">{t('interview.menu.keys')}</p>
      </div>
    </div>
  );
}
