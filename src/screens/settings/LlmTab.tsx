import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { FieldRow, FieldSection } from '../../components/ui/FieldRow';
import { Hint } from '../../components/ui/Hint';
import { Icon } from '../../components/ui/Icon';
import { Segmented } from '../../components/ui/Segmented';
import { Select, type SelectOption } from '../../components/ui/Select';
import { Slider } from '../../components/ui/Slider';
import { TextField } from '../../components/ui/TextField';
import { toast } from '../../components/ui/Toast';
import { Toggle } from '../../components/ui/Toggle';
import { useT, useUiLang } from '../../i18n';
import {
  applyLlmPreset,
  findLlmPreset,
  getLlmConfigIssue,
  getTemperatureRange,
  isLlmError,
  listModels,
  llmNeedsKey,
  LLM_PRESETS,
  testLlmConnection,
  type ConnectionTestResult,
  type LlmPreset,
} from '../../llm';
import { useSettingsStore } from '../../store/settings';
import type { Effort, LlmSettings } from '../../types';
import { llmErrorText } from '../shared/llmText';
import { ProxyToggle } from './ProxyToggle';
import './LlmTab.css';

type PresetGroup = 'offline' | 'global' | 'cn' | 'local';
const GROUP_ORDER: readonly PresetGroup[] = ['offline', 'global', 'cn', 'local'];
const PRESET_GROUP: Readonly<Record<string, PresetGroup>> = {
  demo: 'offline',
  anthropic: 'global',
  openai: 'global',
  openrouter: 'global',
  deepseek: 'cn',
  qwen: 'cn',
  moonshot: 'cn',
  zhipu: 'cn',
  siliconflow: 'cn',
  ollama: 'local',
};

export function presetGroup(p: Pick<LlmPreset, 'id' | 'protocol'>): PresetGroup {
  return PRESET_GROUP[p.id] ?? (p.protocol === 'demo' ? 'offline' : 'local');
}

/** Presets ordered by group (stable within a group). */
export function groupedPresets(presets: readonly LlmPreset[]): LlmPreset[] {
  return [...presets].sort((a, b) => GROUP_ORDER.indexOf(presetGroup(a)) - GROUP_ORDER.indexOf(presetGroup(b)));
}

function update(llm: Partial<LlmSettings>) {
  useSettingsStore.getState().update({ llm });
}

function TestConnection({ llm }: { llm: LlmSettings }) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  // A result only describes the settings it was produced with.
  useEffect(() => {
    abortRef.current?.abort();
    setTesting(false);
    setResult(null);
  }, [llm.presetId, llm.baseUrl, llm.apiKey, llm.model, llm.useProxy, llm.protocol]);

  const run = () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTesting(true);
    setResult(null);
    setShowDetail(false);
    void testLlmConnection(llm, { signal: ctrl.signal }).then((r) => {
      if (ctrl.signal.aborted) return;
      setTesting(false);
      setResult(r);
    });
  };

  return (
    <div className="cfg-test">
      <Button variant="primary" icon="refresh" loading={testing} onClick={run} data-testid="llm-test">
        {testing ? t('settings.llm.testing') : t('settings.llm.test')}
      </Button>
      {result && (
        <div
          className={`cfg-test__result ${result.ok ? 'cfg-test__result--ok' : 'cfg-test__result--bad'}`}
          data-testid="llm-test-result"
          role="status"
        >
          <div className="cfg-test__title">
            <Icon name={result.ok ? 'check' : 'warn'} size={16} strokeWidth={2.6} />
            {result.ok ? t('settings.llm.testOk') : t('settings.llm.testFail')}
            {result.latencyMs > 0 && (
              <Chip size="sm" tone={result.ok ? 'mint' : 'danger'}>
                {t('settings.llm.latency', { ms: result.latencyMs })}
              </Chip>
            )}
          </div>
          {result.ok && llm.protocol === 'demo' ? (
            <div className="cfg-test__body">{t('settings.llm.demoTestOk')}</div>
          ) : result.ok ? (
            <div className="cfg-test__body">
              {result.message && <div>{t('settings.llm.reply', { text: result.message })}</div>}
              {result.model && <div>{t('settings.llm.modelUsed', { model: result.model })}</div>}
            </div>
          ) : (
            <div className="cfg-test__body">
              <div>{llmErrorText(t, result.code)}</div>
              {(result.detail || result.message) && (
                <button type="button" className="cfg-test__more" onClick={() => setShowDetail((s) => !s)} aria-expanded={showDetail}>
                  {t('common.details')} {showDetail ? '▴' : '▾'}
                </button>
              )}
              {showDetail && <pre className="cfg-test__detail">{[result.message, result.detail].filter(Boolean).join('\n')}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Sampling temperature for OpenAI-compatible providers. The slider covers only the range the
 * provider / model accepts (e.g. 0–1 for Kimi and GLM); models with a fixed temperature get a note
 * instead, since the game sends none for them. A stored value outside the range is shown (and sent)
 * clamped, and kept as is for providers that accept it.
 */
function TemperatureRow({ llm }: { llm: LlmSettings }) {
  const t = useT();
  const range = getTemperatureRange(llm);
  if (!range) {
    return (
      <FieldRow label={t('settings.llm.temperature')} hint={t('settings.llm.temperatureHint')} data-testid="llm-temperature-row">
        <Hint kind="info" compact data-testid="llm-temperature-fixed">
          {t('settings.llm.temperatureFixed')}
        </Hint>
      </FieldRow>
    );
  }
  const narrowed = range.min > 0 || range.max < 2;
  const value = Math.min(range.max, Math.max(range.min, llm.temperature));
  return (
    <FieldRow
      label={t('settings.llm.temperature')}
      hint={narrowed ? t('settings.llm.temperatureRange', { min: range.min.toFixed(1), max: range.max.toFixed(1) }) : t('settings.llm.temperatureHint')}
      data-testid="llm-temperature-row"
    >
      {(id) => (
        <Slider
          ariaLabelledBy={id}
          min={range.min}
          max={range.max}
          step={0.1}
          value={value}
          onChange={(temperature) => update({ temperature })}
          format={(v) => v.toFixed(1)}
          data-testid="llm-temperature"
        />
      )}
    </FieldRow>
  );
}

/** Config → AI model. */
export function LlmTab() {
  const t = useT();
  const lang = useUiLang();
  const llm = useSettingsStore((s) => s.settings.llm);
  const preset = findLlmPreset(llm.presetId);
  const issue = getLlmConfigIssue(llm);
  const [fetched, setFetched] = useState<{ base: string; models: string[] } | null>(null);
  const [fetching, setFetching] = useState(false);

  const presetOptions: SelectOption[] = useMemo(
    () =>
      groupedPresets(LLM_PRESETS).map((p) => ({
        value: p.id,
        label: p.label[lang],
        group: t(`settings.llm.group.${presetGroup(p)}`),
      })),
    [lang, t],
  );

  const suggestions = useMemo(() => {
    const list = [...(preset?.models ?? [])];
    if (fetched && fetched.base === llm.baseUrl) list.push(...fetched.models);
    return [...new Set(list)];
  }, [preset, fetched, llm.baseUrl]);

  const pickPreset = (id: string) => {
    const next = applyLlmPreset(llm, id);
    const p = findLlmPreset(id);
    // Providers that block browser CORS need the relay.
    useSettingsStore.getState().update({ llm: { ...next, useProxy: p && !p.corsOk ? true : next.useProxy } });
    setFetched(null);
  };

  const fetchModels = async () => {
    setFetching(true);
    try {
      const models = await listModels(llm);
      setFetched({ base: llm.baseUrl, models });
      toast(models.length ? t('settings.llm.fetched', { n: models.length }) : t('settings.llm.fetchedNone'), {
        kind: models.length ? 'success' : 'warning',
      });
    } catch (err) {
      const msg = isLlmError(err) ? llmErrorText(t, err.code) : t('common.unknownError');
      toast(t('settings.llm.fetchFailed', { msg }), { kind: 'error' });
    } finally {
      setFetching(false);
    }
  };

  const isDemo = llm.protocol === 'demo';
  const needsKey = llmNeedsKey(llm);

  return (
    <div className="cfg-tab" data-testid="settings-llm">
      <FieldSection
        title={t('settings.llm.section')}
        icon="chip"
        aside={
          isDemo ? (
            <Chip tone="gold">{t('setup.dev.llmDemoChip')}</Chip>
          ) : issue ? (
            <Chip tone="danger" icon="warn">
              {t(`setup.dev.llmIssue.${issue}`)}
            </Chip>
          ) : (
            <Chip tone="mint" icon="check">
              {t('setup.dev.llmReady')}
            </Chip>
          )
        }
      >
        <FieldRow
          label={t('settings.llm.preset')}
          hint={t('settings.llm.presetHint')}
          below={
            (preset?.note || preset?.keyUrl) && !isDemo ? (
              <Hint kind="info" compact>
                {preset?.note?.[lang]}
                {preset?.note && preset?.keyUrl && ' '}
                {preset?.keyUrl && (
                  <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="cfg-link">
                    {t('settings.llm.getKey')} <Icon name="external" size={12} />
                  </a>
                )}
              </Hint>
            ) : undefined
          }
        >
          {(id) => (
            <Select
              ariaLabelledBy={id}
              value={preset?.id ?? llm.presetId}
              options={presetOptions}
              onChange={pickPreset}
              data-testid="llm-preset"
            />
          )}
        </FieldRow>
        {isDemo && (
          <div className="cfg-demo">
            <Icon name="sparkle" size={22} className="cfg-demo__icon" />
            <div>
              <div className="cfg-demo__title">{t('settings.llm.demoTitle')}</div>
              <div className="cfg-demo__body">{t('settings.llm.demoBody')}</div>
            </div>
          </div>
        )}
        {isDemo && <TestConnection llm={llm} />}
      </FieldSection>

      {!isDemo && (
        <>
          <FieldSection title={t('settings.llm.connection')} icon="globe">
            <FieldRow label={t('settings.llm.protocol')}>
              <Chip tone="lavender" className="cfg-protocol">
                {t(`settings.llm.protocol.${llm.protocol}`)}
              </Chip>
            </FieldRow>
            <FieldRow label={t('settings.llm.baseUrl')} hint={t('settings.llm.baseUrlHint')}>
              {(id) => (
                <TextField
                  aria-labelledby={id}
                  type="url"
                  mono
                  value={llm.baseUrl}
                  onChange={(baseUrl) => update({ baseUrl })}
                  placeholder={llm.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.example.com/v1'}
                  invalid={issue === 'missing_base_url' || issue === 'invalid_base_url'}
                  data-testid="llm-base"
                />
              )}
            </FieldRow>
            <FieldRow
              label={needsKey ? t('settings.llm.apiKey') : `${t('settings.llm.apiKey')}${t('settings.llm.apiKeyOptional')}`}
              hint={t('settings.llm.apiKeyHint')}
            >
              {(id) => (
                <TextField
                  aria-labelledby={id}
                  secret
                  mono
                  value={llm.apiKey}
                  onChange={(apiKey) => update({ apiKey })}
                  placeholder="sk-…"
                  invalid={issue === 'missing_key'}
                  data-testid="llm-key"
                />
              )}
            </FieldRow>
            <FieldRow label={t('settings.llm.model')} hint={t('settings.llm.modelHint')}>
              {(id) => (
                <div className="cfg-inline">
                  <TextField
                    aria-labelledby={id}
                    mono
                    value={llm.model}
                    onChange={(model) => update({ model })}
                    suggestions={suggestions}
                    placeholder={t('settings.llm.modelPlaceholder')}
                    invalid={issue === 'missing_model'}
                    data-testid="llm-model"
                  />
                  <Button
                    size="sm"
                    icon="refresh"
                    loading={fetching}
                    disabled={issue === 'missing_base_url' || issue === 'invalid_base_url' || issue === 'missing_key'}
                    onClick={() => void fetchModels()}
                    data-testid="llm-fetch-models"
                  >
                    {t('settings.llm.fetchModels')}
                  </Button>
                </div>
              )}
            </FieldRow>
            <ProxyToggle
              label={t('settings.llm.proxy')}
              value={llm.useProxy}
              onChange={(useProxy) => update({ useProxy })}
              corsOk={preset?.corsOk ?? false}
              testId="llm-proxy"
            />
          </FieldSection>

          <FieldSection title={t('settings.llm.advanced')} icon="sliders">
            <FieldRow label={t('settings.llm.jsonMode')} hint={t('settings.llm.jsonModeHint')}>
              {(id) => (
                <Toggle
                  ariaLabelledBy={id}
                  checked={llm.jsonMode}
                  onChange={(jsonMode) => update({ jsonMode })}
                  onText={t('common.on')}
                  offText={t('common.off')}
                />
              )}
            </FieldRow>
            {llm.protocol === 'anthropic' ? (
              <FieldRow label={t('settings.llm.effort')} hint={t('settings.llm.effortHint')}>
                {(id) => (
                  <Segmented<Effort>
                    ariaLabelledBy={id}
                    value={llm.effort}
                    onChange={(effort) => update({ effort })}
                    options={(['low', 'medium', 'high'] as const).map((e) => ({ value: e, label: t(`settings.llm.effort.${e}`) }))}
                  />
                )}
              </FieldRow>
            ) : (
              <TemperatureRow llm={llm} />
            )}
          </FieldSection>

          <TestConnection llm={llm} />
        </>
      )}
    </div>
  );
}
