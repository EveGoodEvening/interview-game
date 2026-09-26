import { useEffect, useState, type CSSProperties } from 'react';
import { CharacterPortrait } from '../../art';
import { CHARACTERS } from '../../characters';
import { FieldRow, FieldSection } from '../../components/ui/FieldRow';
import { Icon } from '../../components/ui/Icon';
import { Segmented } from '../../components/ui/Segmented';
import { Slider } from '../../components/ui/Slider';
import { TextField } from '../../components/ui/TextField';
import { Toggle } from '../../components/ui/Toggle';
import { useT, useUiLang } from '../../i18n';
import { useSettingsStore } from '../../store/settings';
import type { DisplaySettings, Lang } from '../../types';
import './DisplayTab.css';

/** Slider position used for "instant" text (settings value 0). */
export const INSTANT_POS = 110;
const SPEED_MIN = 10;
const SPEED_STEP = 5;

export function speedToSlider(textSpeed: number): number {
  return textSpeed <= 0 ? INSTANT_POS : Math.min(INSTANT_POS - SPEED_STEP, Math.max(SPEED_MIN, textSpeed));
}

export function sliderToSpeed(pos: number): number {
  return pos >= INSTANT_POS ? 0 : pos;
}

function updateDisplay(display: Partial<DisplaySettings>) {
  useSettingsStore.getState().update({ display });
}

/** Characters shown after `elapsedMs` at `cps` characters per second (0 = instant). */
export function typedLength(total: number, cps: number, elapsedMs: number): number {
  if (cps <= 0) return total;
  return Math.min(total, Math.floor((elapsedMs / 1000) * cps));
}

/** Looping typewriter line that shows the current text speed and box opacity. */
function DialoguePreview({ text, cps, opacity, name }: { text: string; cps: number; opacity: number; name: string }) {
  const t = useT();
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const chars = Array.from(text);

  useEffect(() => {
    let raf = 0;
    let restart: ReturnType<typeof setTimeout> | undefined;
    const start = performance.now();
    const tick = (now: number) => {
      const n = typedLength(chars.length, cps, now - start);
      setShown(n);
      if (n < chars.length) raf = requestAnimationFrame(tick);
      else restart = setTimeout(() => setRun((r) => r + 1), 1800);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (restart) clearTimeout(restart);
    };
  }, [cps, run, chars.length, text]);

  const done = shown >= chars.length;
  return (
    <div className="cfg-dlg" style={{ '--cfg-dlg-alpha': opacity } as CSSProperties} aria-label={t('settings.display.previewName')}>
      <div className="cfg-dlg__scene" aria-hidden="true">
        <CharacterPortrait characterId="yuki" expression="smile" size={132} shape="rounded" className="cfg-dlg__portrait" />
      </div>
      <div className="cfg-dlg__box">
        <span className="cfg-dlg__plate">{name}</span>
        <p className="cfg-dlg__text">
          {chars.slice(0, shown).join('')}
          {done && <span className="cfg-dlg__next">▼</span>}
        </p>
      </div>
      <button type="button" className="cfg-dlg__replay" onClick={() => setRun((r) => r + 1)}>
        <Icon name="refresh" size={13} />
        {t('settings.display.replay')}
      </button>
    </div>
  );
}

/** Config → Display. */
export function DisplayTab() {
  const t = useT();
  const lang = useUiLang();
  const display = useSettingsStore((s) => s.settings.display);
  const playerName = useSettingsStore((s) => s.settings.playerName);
  const speedPos = speedToSlider(display.textSpeed);

  return (
    <div className="cfg-tab" data-testid="settings-display">
      <FieldSection title={t('settings.display.section')} icon="monitor">
        <FieldRow label={t('settings.display.uiLang')} hint={t('settings.display.uiLangHint')}>
          {(id) => (
            <Segmented<Lang>
              ariaLabelledBy={id}
              value={display.uiLang}
              onChange={(uiLang) => updateDisplay({ uiLang })}
              options={[
                { value: 'zh', label: t('common.lang.zh') },
                { value: 'en', label: t('common.lang.en') },
              ]}
              data-testid="display-lang"
            />
          )}
        </FieldRow>
        <FieldRow label={t('settings.display.playerName')} hint={t('settings.display.playerNameHint')}>
          {(id) => (
            <TextField
              aria-labelledby={id}
              value={playerName}
              maxLength={16}
              onChange={(name) => useSettingsStore.getState().update({ playerName: name })}
              placeholder={t('settings.display.playerNamePlaceholder')}
              data-testid="display-player-name"
            />
          )}
        </FieldRow>
      </FieldSection>

      <FieldSection title={t('settings.display.text')} icon="book">
        <DialoguePreview
          text={t('settings.display.previewLine')}
          cps={display.textSpeed}
          opacity={display.boxOpacity}
          name={CHARACTERS.yuki.name[lang]}
        />
        <FieldRow label={t('settings.display.textSpeed')}>
          {(id) => (
            <Slider
              ariaLabelledBy={id}
              min={SPEED_MIN}
              max={INSTANT_POS}
              step={SPEED_STEP}
              value={speedPos}
              onChange={(pos) => updateDisplay({ textSpeed: sliderToSpeed(pos) })}
              format={(pos) =>
                pos >= INSTANT_POS ? t('settings.display.textSpeedInstant') : t('settings.display.textSpeedValue', { n: pos })
              }
              data-testid="display-speed"
            />
          )}
        </FieldRow>
        <FieldRow label={t('settings.display.boxOpacity')}>
          {(id) => (
            <Slider
              ariaLabelledBy={id}
              min={0.3}
              max={1}
              step={0.05}
              value={display.boxOpacity}
              onChange={(boxOpacity) => updateDisplay({ boxOpacity })}
              format={(v) => `${Math.round(v * 100)}%`}
              data-testid="display-opacity"
            />
          )}
        </FieldRow>
        <FieldRow label={t('settings.display.autoAdvance')} hint={t('settings.display.autoAdvanceHint')}>
          {(id) => (
            <Toggle
              ariaLabelledBy={id}
              checked={display.autoAdvance}
              onChange={(autoAdvance) => updateDisplay({ autoAdvance })}
              onText={t('common.on')}
              offText={t('common.off')}
              data-testid="display-auto"
            />
          )}
        </FieldRow>
        <FieldRow label={t('settings.display.autoDelay')}>
          {(id) => (
            <Slider
              ariaLabelledBy={id}
              min={0}
              max={3000}
              step={100}
              value={display.autoDelayMs}
              disabled={!display.autoAdvance}
              onChange={(autoDelayMs) => updateDisplay({ autoDelayMs })}
              format={(v) => t('settings.display.autoDelayValue', { n: (v / 1000).toFixed(1) })}
            />
          )}
        </FieldRow>
        <FieldRow label={t('settings.display.reduceMotion')} hint={t('settings.display.reduceMotionHint')}>
          {(id) => (
            <Toggle
              ariaLabelledBy={id}
              checked={display.reduceMotion}
              onChange={(reduceMotion) => updateDisplay({ reduceMotion })}
              onText={t('common.on')}
              offText={t('common.off')}
              data-testid="display-reduce-motion"
            />
          )}
        </FieldRow>
      </FieldSection>
    </div>
  );
}
