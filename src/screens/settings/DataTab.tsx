import { useState } from 'react';
import { ConfirmButton } from '../../components/ui/ConfirmButton';
import { FieldRow, FieldSection } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { useGameStore, type GameState } from '../../store/game';
import { useSettingsStore } from '../../store/settings';
import type { Settings } from '../../types';
import { useSetupStore } from '../setup/draft';
import { clearPersistedSetup } from '../setup/model';

const RESETTABLE: readonly Exclude<keyof Settings, 'version'>[] = ['playerName', 'llm', 'tts', 'stt', 'display', 'audio'];

/** Config was opened from an interview that is still going on (it cannot be deleted from here). */
export function isInLiveInterview(s: Pick<GameState, 'screen' | 'previousScreen' | 'session'>): boolean {
  if (!s.session || s.session.phase === 'finished') return false;
  return s.screen === 'interview' || (s.screen === 'settings' && s.previousScreen === 'interview');
}

/** Forget the wizard's remembered options / target role / JD (`igg.setup.v1`) and its in-memory draft. */
export function clearSetupData(): void {
  clearPersistedSetup();
  useSetupStore.getState().reset();
}

/**
 * Config → Data: clear records / endings, reset settings, delete the saved (unfinished) interview and
 * the setup wizard's data, or erase everything at once; plus the privacy note.
 */
export function DataTab() {
  const t = useT();
  const count = useGameStore((s) => s.records.length);
  const endingsCount = useGameStore((s) => Object.keys(s.endings).length);
  const live = useGameStore(isInLiveInterview);
  const [hasSaved, setHasSaved] = useState(() => useGameStore.getState().hasAutosave());

  const clearRecords = () => {
    useGameStore.getState().clearRecords();
    toast(t('settings.data.clearedRecords'), { kind: 'success' });
  };

  const clearEndings = () => {
    useGameStore.getState().clearEndings();
    toast(t('settings.data.clearedEndings'), { kind: 'success' });
  };

  const resetSettings = () => {
    const { resetSection } = useSettingsStore.getState();
    for (const section of RESETTABLE) resetSection(section);
  };

  const resetAll = () => {
    resetSettings();
    toast(t('settings.data.resetDone'), { kind: 'success' });
  };

  const deleteSaved = () => {
    const game = useGameStore.getState();
    game.discardSavedInterview();
    setHasSaved(game.hasAutosave());
    toast(t('settings.data.deletedSaved'), { kind: 'success' });
  };

  const clearSetup = () => {
    clearSetupData();
    toast(t('settings.data.clearedSetup'), { kind: 'success' });
  };

  const eraseAll = () => {
    const game = useGameStore.getState();
    game.discardSavedInterview();
    game.clearRecords();
    game.clearEndings();
    clearSetupData();
    resetSettings();
    setHasSaved(game.hasAutosave());
    toast(t('settings.data.erasedAll'), { kind: 'success' });
  };

  const savedHint = live ? t('settings.data.savedLive') : hasSaved ? t('settings.data.savedHint') : t('settings.data.savedNone');

  return (
    <div className="cfg-tab" data-testid="settings-data">
      <FieldSection title={t('settings.data.section')} icon="database">
        <FieldRow label={t('settings.data.records')} hint={t('settings.data.recordsHint', { n: count })}>
          <div>
            <ConfirmButton
              label={t('settings.data.clearRecords')}
              question={t('settings.data.clearRecordsQ', { n: count })}
              icon="trash"
              disabled={count === 0}
              onConfirm={clearRecords}
              data-testid="data-clear-records"
            />
          </div>
        </FieldRow>
        <FieldRow label={t('settings.data.endings')} hint={t('settings.data.endingsHint', { n: endingsCount })}>
          <div>
            <ConfirmButton
              label={t('settings.data.clearEndings')}
              question={t('settings.data.clearEndingsQ')}
              icon="trash"
              disabled={endingsCount === 0}
              onConfirm={clearEndings}
              data-testid="data-clear-endings"
            />
          </div>
        </FieldRow>
        <FieldRow label={t('settings.data.saved')} hint={savedHint} data-testid="data-saved-row">
          <div>
            <ConfirmButton
              label={t('settings.data.deleteSaved')}
              question={t('settings.data.deleteSavedQ')}
              icon="trash"
              disabled={live || !hasSaved}
              onConfirm={deleteSaved}
              data-testid="data-delete-saved"
            />
          </div>
        </FieldRow>
        <FieldRow label={t('settings.data.setup')} hint={t('settings.data.setupHint')}>
          <div>
            <ConfirmButton
              label={t('settings.data.clearSetup')}
              question={t('settings.data.clearSetupQ')}
              icon="trash"
              onConfirm={clearSetup}
              data-testid="data-clear-setup"
            />
          </div>
        </FieldRow>
        <FieldRow label={t('settings.data.reset')} hint={t('settings.data.resetHint')}>
          <div>
            <ConfirmButton
              label={t('settings.data.resetBtn')}
              question={t('settings.data.resetQ')}
              icon="refresh"
              onConfirm={resetAll}
              data-testid="data-reset"
            />
          </div>
        </FieldRow>
        <FieldRow
          label={t('settings.data.eraseAll')}
          hint={live ? t('settings.data.eraseAllLive') : t('settings.data.eraseAllHint')}
          data-testid="data-erase-row"
        >
          <div>
            <ConfirmButton
              label={t('settings.data.eraseAllBtn')}
              question={t('settings.data.eraseAllQ')}
              icon="trash"
              variant="danger"
              disabled={live}
              onConfirm={eraseAll}
              data-testid="data-erase-all"
            />
          </div>
        </FieldRow>
      </FieldSection>
      <FieldSection title={t('settings.data.privacyTitle')} icon="lock">
        <Hint kind="info">{t('settings.data.privacy')}</Hint>
      </FieldSection>
    </div>
  );
}
