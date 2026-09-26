/**
 * Validation / normalisation of LlmSettings before any request is made, plus the
 * project-wide "effective useProxy" rule (DESIGN.md §2).
 */
import { useSettingsStore } from '../store/settings';
import type { Effort, LlmSettings } from '../types';
import { findLlmPreset } from './presets';
import { LlmError } from './types';

/** Why an LlmSettings object can't be used for network calls (null = usable). */
export type LlmConfigIssue = 'demo' | 'missing_base_url' | 'invalid_base_url' | 'missing_key' | 'missing_model';

export interface ResolvedLlmConfig {
  protocol: 'anthropic' | 'openai';
  presetId: string;
  /** Normalised provider base URL (never the relay URL). */
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * The user's relay preference (settings.useProxy). Providers apply effectiveUseProxy() to it on
   * every request, so relay detection finishing after the provider was created is still honoured.
   */
  useProxy: boolean;
  jsonMode: boolean;
  effort: Effort;
  temperature: number;
}

/**
 * DESIGN.md §2: route through the local relay only when the user wants it and the relay
 * was not found missing at startup (null = not checked yet → assume present).
 * Speech clients should use this too.
 */
export function effectiveUseProxy(useProxy: boolean): boolean {
  return useProxy && useSettingsStore.getState().proxyAvailable !== false;
}

/**
 * Normalise a user-typed base URL: trim, drop trailing slashes, and strip endpoint paths people
 * commonly paste by mistake (`…/v1` for Anthropic — the SDK adds it; `…/chat/completions` for
 * OpenAI-compatible APIs).
 */
export function normalizeBaseUrl(protocol: 'anthropic' | 'openai', raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (protocol === 'anthropic') url = url.replace(/\/v1(?:\/messages)?$/i, '');
  else url = url.replace(/\/chat\/completions$/i, '');
  return url.replace(/\/+$/, '');
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== '';
  } catch {
    return false;
  }
}

/** Whether the provider behind these settings requires an API key. */
export function llmNeedsKey(llm: Pick<LlmSettings, 'presetId' | 'protocol'>): boolean {
  const preset = findLlmPreset(llm.presetId);
  if (preset && preset.protocol === llm.protocol) return preset.needsKey;
  return llm.protocol === 'anthropic';
}

/** First problem that prevents using `llm` for requests, or null. Useful for Setup/Settings warnings. */
export function getLlmConfigIssue(llm: LlmSettings, opts: { requireModel?: boolean } = {}): LlmConfigIssue | null {
  if (llm.protocol === 'demo') return 'demo';
  const raw = llm.baseUrl.trim();
  if (!raw) return 'missing_base_url';
  if (!isHttpUrl(normalizeBaseUrl(llm.protocol, raw))) return 'invalid_base_url';
  if (llmNeedsKey(llm) && !llm.apiKey.trim()) return 'missing_key';
  if ((opts.requireModel ?? true) && !llm.model.trim()) return 'missing_model';
  return null;
}

/** True when `llm` points at a real provider with all required fields filled in. */
export function isLlmConfigured(llm: LlmSettings): boolean {
  return getLlmConfigIssue(llm) === null;
}

const ISSUE_MESSAGES: Record<LlmConfigIssue, string> = {
  demo: 'The offline demo interviewer does not use an LLM provider',
  missing_base_url: 'Base URL is not set',
  invalid_base_url: 'Base URL must be an absolute http(s) URL',
  missing_key: 'API key is required for this provider',
  missing_model: 'Model is not set',
};

/** Validate + normalise settings. Throws LlmError('config') (detail = the LlmConfigIssue). */
export function resolveLlmConfig(llm: LlmSettings, opts: { requireModel?: boolean } = {}): ResolvedLlmConfig {
  const issue = getLlmConfigIssue(llm, opts);
  if (issue) throw new LlmError('config', ISSUE_MESSAGES[issue], { detail: issue });
  // getLlmConfigIssue returned null, so protocol is not 'demo'.
  const protocol = llm.protocol === 'anthropic' ? 'anthropic' : 'openai';
  return {
    protocol,
    presetId: llm.presetId,
    baseUrl: normalizeBaseUrl(protocol, llm.baseUrl),
    apiKey: llm.apiKey.trim(),
    model: llm.model.trim(),
    useProxy: llm.useProxy,
    jsonMode: llm.jsonMode,
    effort: llm.effort,
    temperature: llm.temperature,
  };
}
