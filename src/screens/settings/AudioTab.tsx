import { playSfx, unlockAudio, type SfxName } from '../../audio';
import { FieldRow, FieldSection } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { Icon } from '../../components/ui/Icon';
import { Slider } from '../../components/ui/Slider';
import { Toggle } from '../../components/ui/Toggle';
import { useT } from '../../i18n';
import { useSettingsStore } from '../../store/settings';
import type { AudioSettings } from '../../types';
import './AudioTab.css';

type Channel = Exclude<keyof AudioSettings, 'muted'>;
const CHANNELS: readonly { key: Channel; icon: 'speaker' | 'music' | 'sparkle' | 'mic'; sfx: SfxName | null }[] = [
  { key: 'master', icon: 'speaker', sfx: 'confirm' },
  { key: 'bgm', icon: 'music', sfx: null },
  { key: 'sfx', icon: 'sparkle', sfx: 'click' },
  { key: 'voice', icon: 'mic', sfx: null },
];

/** Config → Sound. Volumes apply live (App calls setAudioVolumes on every change). */
export function AudioTab() {
  const t = useT();
  const audio = useSettingsStore((s) => s.settings.audio);
  const update = (patch: Partial<AudioSettings>) => useSettingsStore.getState().update({ audio: patch });

  return (
    <div className="cfg-tab" data-testid="settings-audio">
      <FieldSection title={t('settings.audio.section')} icon="music">
        <FieldRow label={t('settings.audio.mute')} hint={t('settings.audio.muteHint')}>
          {(id) => (
            <Toggle
              ariaLabelledBy={id}
              checked={audio.muted}
              onChange={(muted) => update({ muted })}
              onText={t('common.on')}
              offText={t('common.off')}
              data-testid="audio-mute"
            />
          )}
        </FieldRow>
        {CHANNELS.map(({ key, icon, sfx }) => (
          <FieldRow
            key={key}
            label={
              <span className="cfg-audio__label">
                <Icon name={icon} size={15} />
                {t(`settings.audio.${key}`)}
              </span>
            }
          >
            {(id) => (
              <Slider
                ariaLabelledBy={id}
                className={audio.muted ? 'cfg-audio__muted' : ''}
                min={0}
                max={100}
                step={1}
                value={Math.round(audio[key] * 100)}
                onChange={(v) => update({ [key]: v / 100 })}
                onCommit={() => {
                  unlockAudio();
                  if (sfx) playSfx(sfx);
                }}
                format={(v) => t('settings.audio.value', { n: v })}
                data-testid={`audio-${key}`}
              />
            )}
          </FieldRow>
        ))}
        <Hint kind="tip" compact>
          {t('settings.audio.note')}
        </Hint>
      </FieldSection>
    </div>
  );
}
