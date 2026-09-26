import { useEffect, useMemo, useState } from 'react';
import { CHARACTERS } from '../../characters';
import { Button } from '../../components/ui/Button';
import { FieldRow, FieldSection } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { Segmented } from '../../components/ui/Segmented';
import { Select, type SelectOption } from '../../components/ui/Select';
import { Slider } from '../../components/ui/Slider';
import { TextField } from '../../components/ui/TextField';
import { Toggle } from '../../components/ui/Toggle';
import { translate, useT, useUiLang } from '../../i18n';
import { applySttPreset, applyTtsPreset, findSttPreset, findTtsPreset, presetVoiceFor, STT_PRESETS, TTS_PRESETS } from '../../llm';
import { isBrowserSttSupported, isBrowserTtsSupported, listBrowserVoices, onBrowserVoicesChanged, rankVoices } from '../../speech';
import { useSettingsStore } from '../../store/settings';
import {
  CHARACTER_IDS,
  LANGS,
  type CharacterId,
  type Lang,
  type SttEngineKind,
  type SttSettings,
  type TtsEngineKind,
  type TtsSettings,
} from '../../types';
import { isGoogleChrome } from '../shared/browser';
import { MicTest } from '../shared/MicTest';
import { useTtsPreview } from '../shared/useTtsPreview';
import { ProxyToggle } from './ProxyToggle';

function updateTts(tts: Partial<TtsSettings>) {
  useSettingsStore.getState().update({ tts });
}

function updateStt(stt: Partial<SttSettings>) {
  useSettingsStore.getState().update({ stt });
}

/** Browser voices usable for `lang`, best matches first (for the character's gender), one per voiceURI. */
export function voicesFor<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI' | 'localService' | 'default'>>(
  voices: readonly V[],
  lang: Lang,
  gender: 'female' | 'male',
): V[] {
  const seen = new Set<string>();
  return rankVoices(voices, lang, gender).filter((v) => !seen.has(v.voiceURI) && (seen.add(v.voiceURI), true));
}

/**
 * The browser's voices (null while loading). Keeps listening after the first load, so voices that
 * arrive late (after the load's timeout) or are added later (Edge's online voices) show up without
 * re-opening the tab.
 */
function useBrowserVoices(): SpeechSynthesisVoice[] | null {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    // Once a change arrived, it is at least as fresh as the first load's answer.
    let changed = false;
    listBrowserVoices().then(
      (v) => alive && !changed && setVoices(v),
      () => alive && !changed && setVoices([]),
    );
    const unsubscribe = onBrowserVoicesChanged((v) => {
      if (!alive) return;
      changed = true;
      setVoices(v);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return voices;
}

function TtsSection() {
  const t = useT();
  const uiLang = useUiLang();
  const settings = useSettingsStore((s) => s.settings);
  const tts = settings.tts;
  const voices = useBrowserVoices();
  const [previewChar, setPreviewChar] = useState<CharacterId>('yuki');
  const [fallback, setFallback] = useState<string | null>(null);
  const { speakingId, speak, stop } = useTtsPreview();
  const character = CHARACTERS[previewChar];
  const ttsPreset = findTtsPreset(tts.apiPresetId);
  const browserSupported = isBrowserTtsSupported();

  const preview = (lang: Lang, id: string) => {
    if (speakingId === id) {
      stop();
      return;
    }
    setFallback(null);
    speak(id, {
      text: translate(lang, 'settings.tts.sample'),
      lang,
      character,
      settings: useSettingsStore.getState().settings,
      onFallback: (err) => setFallback(err.message),
    });
  };

  const voiceOptions = useMemo(() => {
    const out = {} as Record<Lang, SelectOption[]>;
    for (const lang of LANGS) {
      const list = voices ? voicesFor(voices, lang, character.voice.gender) : [];
      out[lang] = [
        { value: '', label: t('settings.tts.voiceAuto') },
        ...list.map((v) => ({
          value: v.voiceURI,
          label: `${v.name} · ${v.lang}${v.localService ? '' : ` · ${t('settings.tts.voiceOnline')}`}`,
        })),
      ];
    }
    return out;
  }, [voices, character.voice.gender, t]);

  const previewButton = (lang: Lang, id: string, withLang = false) => (
    <Button size="sm" icon={speakingId === id ? 'stop' : 'play'} onClick={() => preview(lang, id)} data-testid={`tts-preview-${id}`}>
      {speakingId === id ? t('common.stop') : t('common.preview')}
      {withLang && ` · ${t(`common.lang.short.${lang}`)}`}
    </Button>
  );

  return (
    <FieldSection title={t('settings.tts.section')} icon="speaker">
      <FieldRow label={t('settings.tts.engine')} hint={t('settings.tts.engineHint')}>
        {(id) => (
          <Segmented<TtsEngineKind>
            ariaLabelledBy={id}
            value={tts.engine}
            onChange={(engine) => {
              stop();
              updateTts({ engine });
            }}
            options={(['browser', 'api', 'off'] as const).map((e) => ({ value: e, label: t(`settings.tts.engine.${e}`) }))}
            data-testid="tts-engine"
          />
        )}
      </FieldRow>

      {tts.engine !== 'off' && (
        <FieldRow label={t('settings.tts.previewAs')}>
          {(id) => (
            <Segmented<CharacterId>
              ariaLabelledBy={id}
              size="sm"
              value={previewChar}
              onChange={setPreviewChar}
              options={CHARACTER_IDS.map((c) => ({ value: c, label: CHARACTERS[c].name[uiLang] }))}
            />
          )}
        </FieldRow>
      )}

      {tts.engine === 'browser' && (
        <>
          {!browserSupported && (
            <Hint kind="warn" compact>
              {t('common.tts.unsupported')}
            </Hint>
          )}
          {LANGS.map((lang) => (
            <FieldRow
              key={lang}
              label={t(`settings.tts.voice.${lang}`)}
              hint={t('settings.tts.voiceHint')}
              below={
                voices && voiceOptions[lang].length === 1 ? (
                  <Hint kind="info" compact>
                    {t('settings.tts.noVoices')}
                  </Hint>
                ) : undefined
              }
            >
              {(id) => (
                <div className="cfg-inline">
                  <Select
                    ariaLabelledBy={id}
                    value={tts.browserVoice[lang]}
                    options={voices ? voiceOptions[lang] : [{ value: tts.browserVoice[lang], label: t('settings.tts.loadingVoices') }]}
                    onChange={(uri) => updateTts({ browserVoice: { ...tts.browserVoice, [lang]: uri } })}
                    disabled={!browserSupported || voices === null}
                    data-testid={`tts-voice-${lang}`}
                  />
                  {previewButton(lang, `browser-${lang}`)}
                </div>
              )}
            </FieldRow>
          ))}
        </>
      )}

      {tts.engine === 'api' && (
        <>
          <FieldRow label={t('settings.tts.apiPreset')}>
            {(id) => (
              <Select
                ariaLabelledBy={id}
                value={tts.apiPresetId}
                options={TTS_PRESETS.map((p) => ({ value: p.id, label: p.label[uiLang] }))}
                onChange={(pid) => useSettingsStore.getState().update({ tts: applyTtsPreset(tts, pid) })}
                data-testid="tts-preset"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.tts.apiBase')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                type="url"
                mono
                value={tts.apiBaseUrl}
                onChange={(apiBaseUrl) => updateTts({ apiBaseUrl })}
                placeholder="https://api.example.com/v1"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.tts.apiKey')} hint={t('settings.llm.apiKeyHint')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                secret
                mono
                value={tts.apiKey}
                onChange={(apiKey) => updateTts({ apiKey })}
                placeholder="sk-…"
                data-testid="tts-key"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.tts.apiModel')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                mono
                value={tts.apiModel}
                onChange={(apiModel) => updateTts({ apiModel })}
                suggestions={ttsPreset?.models}
              />
            )}
          </FieldRow>
          <FieldRow
            label={t('settings.tts.apiVoice')}
            hint={t('settings.tts.apiVoiceHint')}
            below={
              <Hint kind="info" compact>
                {t('settings.tts.apiFallbackNote')}
              </Hint>
            }
          >
            {(id) => (
              <div className="cfg-inline">
                <TextField
                  aria-labelledby={id}
                  mono
                  value={tts.apiVoice}
                  onChange={(apiVoice) => updateTts({ apiVoice })}
                  suggestions={ttsPreset?.voices}
                  placeholder={t('settings.tts.apiVoicePlaceholder', { voice: presetVoiceFor(tts.apiPresetId, character.voice) })}
                />
                {previewButton('zh', 'api-zh', true)}
                {previewButton('en', 'api-en', true)}
              </div>
            )}
          </FieldRow>
          <ProxyToggle
            label={t('settings.tts.proxy')}
            value={tts.useProxy}
            onChange={(useProxy) => updateTts({ useProxy })}
            corsOk={false}
          />
        </>
      )}

      {tts.engine !== 'off' && (
        <FieldRow label={t('settings.tts.rate')}>
          {(id) => (
            <Slider
              ariaLabelledBy={id}
              min={0.5}
              max={2}
              step={0.05}
              value={tts.rate}
              onChange={(rate) => updateTts({ rate })}
              format={(v) => t('settings.tts.rateValue', { n: v.toFixed(2) })}
              data-testid="tts-rate"
            />
          )}
        </FieldRow>
      )}

      {fallback && (
        <Hint kind="warn" compact>
          {t('common.tts.fallback', { reason: fallback })}
        </Hint>
      )}
    </FieldSection>
  );
}

function sttNote(t: ReturnType<typeof useT>, engine: SttEngineKind): { kind: 'info' | 'warn'; text: string } {
  if (engine === 'keyboard') return { kind: 'info', text: t('settings.stt.note.keyboard') };
  if (engine === 'api') return { kind: 'info', text: t('settings.stt.note.api') };
  if (!isBrowserSttSupported()) return { kind: 'warn', text: t('settings.stt.note.unsupported') };
  if (isGoogleChrome()) return { kind: 'warn', text: t('settings.stt.note.chrome') };
  return { kind: 'info', text: t('settings.stt.note.browser') };
}

function SttSection() {
  const t = useT();
  const uiLang = useUiLang();
  const stt = useSettingsStore((s) => s.settings.stt);
  const sttPreset = findSttPreset(stt.apiPresetId);
  const note = sttNote(t, stt.engine);

  return (
    <FieldSection title={t('settings.stt.section')} icon="mic">
      <FieldRow
        label={t('settings.stt.engine')}
        hint={t('settings.stt.engineHint')}
        below={
          <Hint kind={note.kind} compact>
            {note.text}
          </Hint>
        }
      >
        {(id) => (
          <Segmented<SttEngineKind>
            ariaLabelledBy={id}
            value={stt.engine}
            onChange={(engine) => updateStt({ engine })}
            options={(['browser', 'api', 'keyboard'] as const).map((e) => ({ value: e, label: t(`settings.stt.engine.${e}`) }))}
            data-testid="stt-engine"
          />
        )}
      </FieldRow>

      {stt.engine === 'api' && (
        <>
          <FieldRow label={t('settings.stt.apiPreset')}>
            {(id) => (
              <Select
                ariaLabelledBy={id}
                value={stt.apiPresetId}
                options={STT_PRESETS.map((p) => ({ value: p.id, label: p.label[uiLang] }))}
                onChange={(pid) => useSettingsStore.getState().update({ stt: applySttPreset(stt, pid) })}
                data-testid="stt-preset"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.stt.apiBase')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                type="url"
                mono
                value={stt.apiBaseUrl}
                onChange={(apiBaseUrl) => updateStt({ apiBaseUrl })}
                placeholder="https://api.example.com/v1"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.stt.apiKey')} hint={t('settings.llm.apiKeyHint')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                secret
                mono
                value={stt.apiKey}
                onChange={(apiKey) => updateStt({ apiKey })}
                placeholder="sk-…"
                data-testid="stt-key"
              />
            )}
          </FieldRow>
          <FieldRow label={t('settings.stt.apiModel')}>
            {(id) => (
              <TextField
                aria-labelledby={id}
                mono
                value={stt.apiModel}
                onChange={(apiModel) => updateStt({ apiModel })}
                suggestions={sttPreset?.models}
              />
            )}
          </FieldRow>
          <ProxyToggle
            label={t('settings.stt.proxy')}
            value={stt.useProxy}
            onChange={(useProxy) => updateStt({ useProxy })}
            corsOk={false}
          />
        </>
      )}

      {stt.engine !== 'keyboard' && (
        <>
          <FieldRow label={t('settings.stt.mic')}>
            <MicTest data-testid="settings-mic-test" />
          </FieldRow>
          <FieldRow label={t('settings.stt.autoSubmit')} hint={t('settings.stt.autoSubmitHint')}>
            {(id) => (
              <Toggle
                ariaLabelledBy={id}
                checked={stt.autoSubmit}
                onChange={(autoSubmit) => updateStt({ autoSubmit })}
                onText={t('common.on')}
                offText={t('common.off')}
                data-testid="stt-autosubmit"
              />
            )}
          </FieldRow>
        </>
      )}
    </FieldSection>
  );
}

/** Config → Voice (TTS + STT). */
export function VoiceTab() {
  return (
    <div className="cfg-tab" data-testid="settings-voice">
      <TtsSection />
      <SttSection />
    </div>
  );
}
