import { FieldRow } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { Toggle } from '../../components/ui/Toggle';
import { useT } from '../../i18n';
import { useSettingsStore } from '../../store/settings';

export interface ProxyToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** Provider allows direct browser calls (false → warn when the relay is off). */
  corsOk?: boolean;
  testId?: string;
}

/** "Use local relay" row: disabled with an explanation when the relay was not detected. */
export function ProxyToggle({ label, value, onChange, corsOk = true, testId }: ProxyToggleProps) {
  const t = useT();
  const available = useSettingsStore((s) => s.proxyAvailable);
  const unavailable = available === false;
  const noteKey = unavailable
    ? 'settings.llm.proxyUnavailable'
    : available === null
      ? 'settings.llm.proxyChecking'
      : !value && !corsOk
        ? 'settings.llm.corsWarn'
        : null;
  const note = noteKey ? (
    <Hint kind={available === null ? 'info' : 'warn'} compact>
      {t(noteKey)}
    </Hint>
  ) : undefined;
  return (
    <FieldRow label={label} hint={t('settings.llm.proxyHint')} below={note}>
      {(id) => (
        <Toggle
          ariaLabelledBy={id}
          checked={value && !unavailable}
          disabled={unavailable}
          onChange={onChange}
          onText={t('common.on')}
          offText={t('common.off')}
          data-testid={testId}
        />
      )}
    </FieldRow>
  );
}
