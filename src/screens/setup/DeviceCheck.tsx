import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CHARACTERS } from '../../characters';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Hint } from '../../components/ui/Hint';
import { Icon, type IconName } from '../../components/ui/Icon';
import { translate, useT, useUiLang } from '../../i18n';
import { findLlmPreset, findSttPreset, findTtsPreset, getLlmConfigIssue, testLlmConnection, type ConnectionTestResult } from '../../llm';
import { isBrowserSttSupported, isBrowserTtsSupported } from '../../speech';
import { useGameStore } from '../../store/game';
import { setSettingsTab } from '../settings/tabState';
import { useSettingsStore } from '../../store/settings';
import { isGoogleChrome, isSecureForMic } from '../shared/browser';
import { llmErrorText } from '../shared/llmText';
import { MicTest } from '../shared/MicTest';
import { useTtsPreview } from '../shared/useTtsPreview';
import { useSetupStore } from './draft';
import './DeviceCheck.css';

function CheckItem({ icon, title, status, children }: { icon: IconName; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="dev-item">
      <div className="dev-item__head">
        <span className="dev-item__icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="dev-item__title">{title}</span>
        <span className="dev-item__status">{status}</span>
      </div>
      <div className="dev-item__body">{children}</div>
    </div>
  );
}

function LlmCheck() {
  const t = useT();
  const lang = useUiLang();
  const llm = useSettingsStore((s) => s.settings.llm);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const issue = getLlmConfigIssue(llm);
  const preset = findLlmPreset(llm.presetId);
  const presetLabel = preset?.label[lang] ?? llm.presetId;
  const configure = () => {
    setSettingsTab('llm');
    useGameStore.getState().openSettings();
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const runTest = () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTesting(true);
    setResult(null);
    void testLlmConnection(llm, { signal: ctrl.signal }).then((r) => {
      if (ctrl.signal.aborted) return;
      setTesting(false);
      setResult(r);
    });
  };

  const status =
    issue === 'demo' ? (
      <Chip tone="gold" size="sm">
        {t('setup.dev.llmDemoChip')}
      </Chip>
    ) : issue ? (
      <Chip tone="danger" size="sm" icon="warn">
        {t(`setup.dev.llmIssue.${issue}`)}
      </Chip>
    ) : (
      <Chip tone="mint" size="sm" icon="check">
        {t('setup.dev.llmReady')}
      </Chip>
    );

  const configureBtn = (
    <Button size="sm" variant="secondary" icon="sliders" onClick={configure} data-testid="device-configure">
      {t('common.configure')}
    </Button>
  );

  return (
    <CheckItem
      icon="chip"
      title={t('setup.dev.llm')}
      status={
        <>
          {status}
          {issue && configureBtn}
        </>
      }
    >
      {issue === 'demo' ? (
        <Hint kind="tip" compact>
          {t('setup.dev.llmDemo')}
        </Hint>
      ) : issue ? (
        <Hint kind="error" compact>
          {t(`setup.dev.llmIssue.${issue}`)}
        </Hint>
      ) : (
        <>
          <div className="dev-llm__line">
            <span className="dev-llm__preset">{presetLabel}</span>
            {llm.model && <code className="dev-llm__model">{llm.model}</code>}
          </div>
          <div className="dev-row">
            <Button size="sm" icon="refresh" loading={testing} onClick={runTest} data-testid="device-llm-test">
              {t('setup.dev.llmTest')}
            </Button>
            {configureBtn}
            {result && (
              <span className={`dev-result ${result.ok ? 'dev-result--ok' : 'dev-result--bad'}`}>
                {result.ok ? t('setup.dev.llmOk', { ms: result.latencyMs }) : llmErrorText(t, result.code)}
              </span>
            )}
          </div>
        </>
      )}
    </CheckItem>
  );
}

function TtsCheck() {
  const t = useT();
  const lang = useUiLang();
  const tts = useSettingsStore((s) => s.settings.tts);
  const characterId = useSetupStore((s) => s.characterId);
  const interviewLang = useSetupStore((s) => s.options.lang);
  const { speakingId, speak, stop } = useTtsPreview();
  const [fallback, setFallback] = useState<string | null>(null);
  const character = CHARACTERS[characterId];
  const unsupported = tts.engine === 'browser' && !isBrowserTtsSupported();
  const engineLabel =
    tts.engine === 'api'
      ? t('setup.dev.tts.api', { preset: findTtsPreset(tts.apiPresetId)?.label[lang] ?? tts.apiPresetId })
      : t(`setup.dev.tts.${tts.engine}`);

  const test = () => {
    if (speakingId) {
      stop();
      return;
    }
    setFallback(null);
    speak('greeting', {
      text: translate(interviewLang, 'setup.greeting', { name: character.name[interviewLang] }),
      lang: interviewLang,
      character,
      onFallback: (err) => setFallback(err.message),
    });
  };

  return (
    <CheckItem
      icon="speaker"
      title={t('setup.dev.tts')}
      status={
        <Chip tone="neutral" size="sm">
          {engineLabel}
        </Chip>
      }
    >
      {tts.engine === 'off' ? (
        <Hint kind="info" compact>
          {t('common.tts.off')}
        </Hint>
      ) : (
        <div className="dev-row">
          <Button size="sm" icon={speakingId ? 'stop' : 'play'} onClick={test} disabled={unsupported} data-testid="device-tts-test">
            {speakingId ? t('common.stop') : t('setup.dev.ttsTest')}
          </Button>
          {speakingId && (
            <span className="dev-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}
      {unsupported && (
        <Hint kind="warn" compact>
          {t('common.tts.unsupported')}
        </Hint>
      )}
      {fallback && (
        <Hint kind="warn" compact>
          {t('common.tts.fallback', { reason: fallback })}
        </Hint>
      )}
    </CheckItem>
  );
}

function SttCheck() {
  const t = useT();
  const lang = useUiLang();
  const stt = useSettingsStore((s) => s.settings.stt);
  const presetLabel = findSttPreset(stt.apiPresetId)?.label[lang] ?? stt.apiPresetId;
  const engineLabel = stt.engine === 'api' ? t('setup.dev.stt.api', { preset: presetLabel }) : t(`setup.dev.stt.${stt.engine}`);

  let note: { kind: 'info' | 'warn'; text: string };
  if (stt.engine === 'keyboard') note = { kind: 'info', text: t('setup.dev.sttNote.keyboard') };
  else if (stt.engine === 'api') {
    note = stt.apiKey.trim()
      ? { kind: 'info', text: t('setup.dev.sttNote.api', { preset: presetLabel }) }
      : { kind: 'warn', text: t('setup.dev.sttNote.apiNoKey') };
  } else if (!isBrowserSttSupported()) note = { kind: 'warn', text: t('setup.dev.sttNote.unsupported') };
  else if (isGoogleChrome()) note = { kind: 'info', text: t('setup.dev.sttNote.chrome') };
  else note = { kind: 'info', text: t('setup.dev.sttNote.browser') };

  return (
    <>
      {stt.engine !== 'keyboard' && (
        <CheckItem icon="mic" title={t('setup.dev.mic')}>
          <MicTest compact data-testid="device-mic-test" />
          {!isSecureForMic() && (
            <Hint kind="warn" compact>
              {t('setup.dev.insecure')}
            </Hint>
          )}
        </CheckItem>
      )}
      <CheckItem
        icon={stt.engine === 'keyboard' ? 'keyboard' : 'wave'}
        title={t('setup.dev.stt')}
        status={
          <Chip tone="neutral" size="sm">
            {engineLabel}
          </Chip>
        }
      >
        <Hint
          kind={note.kind}
          compact
          action={
            note.kind === 'warn' ? (
              <Button
                size="sm"
                icon="sliders"
                onClick={() => {
                  setSettingsTab('voice');
                  useGameStore.getState().openSettings();
                }}
              >
                {t('common.configure')}
              </Button>
            ) : undefined
          }
        >
          {note.text}
        </Hint>
      </CheckItem>
    </>
  );
}

/** Right column of step 3: LLM status, voice test, mic test, recognition notes. */
export function DeviceCheck() {
  const t = useT();
  return (
    <section className="dev" aria-label={t('setup.dev.heading')} data-testid="device-check">
      <header className="dev__head">
        <Icon name="check" size={16} strokeWidth={3} className="dev__head-icon" />
        <h2 className="dev__title">{t('setup.dev.heading')}</h2>
      </header>
      <div className="dev__list gg-scroll">
        <LlmCheck />
        <TtsCheck />
        <SttCheck />
      </div>
    </section>
  );
}
