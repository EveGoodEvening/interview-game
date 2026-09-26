/**
 * Sampling-temperature rules per provider / model.
 *
 * - Claude (anthropic protocol): no temperature is sent (current models reject sampling parameters).
 * - OpenAI reasoning models (o-series, GPT-5 family) and Kimi K2.5+ / K3 run at a fixed temperature and
 *   reject any explicit value, so none is sent.
 * - Kimi (Moonshot) and Zhipu GLM accept [0, 1]; DashScope (Qwen) accepts [0, 2) → 1.9 at the slider's 0.1 step;
 *   everything else the OpenAI range [0, 2].
 *
 * `getTemperatureRange` feeds the Settings slider (null = hide/disable it); the openai provider clamps
 * to the same range before sending, so an out-of-range stored value never reaches the API.
 */
import type { LlmSettings } from '../types';

export interface TemperatureRange {
  min: number;
  max: number;
}

const OPENAI_RANGE: TemperatureRange = { min: 0, max: 2 };
const UNIT_RANGE: TemperatureRange = { min: 0, max: 1 };
/** DashScope documents [0, 2): 2.0 itself is rejected. */
const DASHSCOPE_RANGE: TemperatureRange = { min: 0, max: 1.9 };
const DEFAULT_TEMPERATURE = 0.8;

function hostnameOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function onHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** The model id without an aggregator's vendor prefix (`openai/gpt-5` → `gpt-5`, `moonshotai/kimi-k3` → `kimi-k3`). */
function bareModel(model: string): string {
  const m = model.trim().toLowerCase();
  const slash = m.lastIndexOf('/');
  return slash >= 0 ? m.slice(slash + 1) : m;
}

/** OpenAI reasoning models (o-series, GPT-5 family) reject custom temperatures. */
export function isOpenAiReasoningModel(model: string): boolean {
  const bare = model.trim().toLowerCase().replace(/^openai\//, '');
  return /^(o\d|gpt-5)/.test(bare);
}

/**
 * Kimi K2.5 and later (kimi-k2.6, kimi-k2.7-code…, kimi-k3) fix the temperature and answer any explicit
 * value with a 400 ("invalid temperature: only 1 is allowed for this model").
 */
export function isFixedTemperatureKimi(model: string): boolean {
  return /^kimi-k(?:[3-9]|2\.[5-9])/.test(bareModel(model));
}

/** Temperature range for an OpenAI-compatible endpoint + model, or null when none may be sent. */
export function openAiTemperatureRange(baseUrl: string, model: string): TemperatureRange | null {
  if (isOpenAiReasoningModel(model) || isFixedTemperatureKimi(model)) return null;
  const host = hostnameOf(baseUrl);
  if (onHost(host, 'moonshot.cn') || onHost(host, 'moonshot.ai')) return UNIT_RANGE;
  if (onHost(host, 'bigmodel.cn') || onHost(host, 'z.ai')) return UNIT_RANGE;
  if (onHost(host, 'aliyuncs.com') && host.startsWith('dashscope')) return DASHSCOPE_RANGE;
  return OPENAI_RANGE;
}

/**
 * Temperature range the provider/model accepts, or null when the provider/model uses a fixed
 * temperature (or no temperature is sent at all) and the UI should hide/disable the slider.
 */
export function getTemperatureRange(llm: Pick<LlmSettings, 'protocol' | 'baseUrl' | 'model'>): TemperatureRange | null {
  if (llm.protocol !== 'openai') return null;
  return openAiTemperatureRange(llm.baseUrl, llm.model);
}

/** Clamp `t` into `range` (non-finite → the settings default, clamped too). */
export function clampTemperature(t: number, range: TemperatureRange = OPENAI_RANGE): number {
  const value = Number.isFinite(t) ? t : DEFAULT_TEMPERATURE;
  return Math.min(range.max, Math.max(range.min, value));
}
