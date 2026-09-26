/**
 * LLM transport public API.
 * OWNER: llm agent. Keep these exported signatures stable.
 *
 * Implementation lives in anthropic.ts (official SDK, loaded lazily), openai.ts (fetch),
 * config.ts (validation + effective relay rule), errors.ts and presets.ts.
 */
import type { LlmSettings } from '../types';
import { createAnthropicProvider, listAnthropicModels } from './anthropic';
import { resolveLlmConfig } from './config';
import { unknownError } from './errors';
import { createOpenAiProvider, listOpenAiModels } from './openai';
import type { ChatProvider, LlmErrorCode } from './types';
import { LlmError } from './types';

export * from './types';
export {
  LLM_PRESETS,
  TTS_PRESETS,
  STT_PRESETS,
  findLlmPreset,
  findTtsPreset,
  findSttPreset,
  applyLlmPreset,
  applyTtsPreset,
  applySttPreset,
  presetVoiceFor,
} from './presets';
export type { LlmPreset, SpeechApiPreset } from './presets';
export { apiUrl, detectProxy, joinUrl, proxyHeaders, toProxyUrl, PROXY_HEADERS } from './http';
export { effectiveUseProxy, getLlmConfigIssue, isLlmConfigured, llmNeedsKey, normalizeBaseUrl } from './config';
export type { LlmConfigIssue } from './config';
export { isLlmError } from './errors';
export { DEFAULT_TIMEOUT_MS } from './deadline';
export { getTemperatureRange } from './temperature';
export type { TemperatureRange } from './temperature';

/** Build a provider for the given settings. Throws LlmError('config') for protocol 'demo' or missing fields. */
export function createChatProvider(llm: LlmSettings): ChatProvider {
  const cfg = resolveLlmConfig(llm);
  return cfg.protocol === 'anthropic' ? createAnthropicProvider(cfg) : createOpenAiProvider(cfg);
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  /** Model reply or error message (already human readable). */
  message: string;
  code?: string;
  /** Model that answered (as reported by the provider), when the test succeeded. */
  model?: string;
  /** Provider's raw error text for a details view, when the test failed. */
  detail?: string;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const TEST_TIMEOUT_MS = 30_000;
const TEST_SYSTEM = 'You are a connectivity check. Reply with exactly the word OK and nothing else.';
/** Roomy enough for reasoning models that think before answering. */
const TEST_MAX_TOKENS = 256;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Send a tiny request ("reply OK") to verify key / model / endpoint. Never throws. */
export async function testLlmConnection(llm: LlmSettings, opts: LlmCallOptions = {}): Promise<ConnectionTestResult> {
  if (llm.protocol === 'demo') {
    return { ok: true, latencyMs: 0, message: 'Demo mode runs offline — no connection needed.' };
  }
  const started = now();
  const elapsed = () => Math.max(0, Math.round(now() - started));
  try {
    const provider = createChatProvider(llm);
    const res = await provider.chat({
      system: TEST_SYSTEM,
      messages: [{ role: 'user', content: 'Connection test: reply with exactly OK.' }],
      maxTokens: TEST_MAX_TOKENS,
      purpose: 'test',
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? TEST_TIMEOUT_MS,
    });
    const reply = res.text.replace(/\s+/g, ' ').trim();
    return { ok: true, latencyMs: elapsed(), message: reply.length > 120 ? `${reply.slice(0, 120)}…` : reply, model: res.model };
  } catch (e) {
    const err = e instanceof LlmError ? e : unknownError(e);
    // The endpoint, key and model all worked; the model just spent its budget thinking.
    if (err.code === 'truncated') {
      return { ok: true, latencyMs: elapsed(), message: 'Connected (the reply was cut off by the token limit).' };
    }
    const code: LlmErrorCode = err.code;
    return { ok: false, latencyMs: err.code === 'config' ? 0 : elapsed(), message: err.message, code, detail: err.detail };
  }
}

/**
 * Fetch available model ids (GET /models). Throws LlmError on failure.
 * anthropic: newest first (API order); openai-compatible: sorted alphabetically. The model field may be empty.
 */
export async function listModels(llm: LlmSettings, opts: LlmCallOptions = {}): Promise<string[]> {
  const cfg = resolveLlmConfig(llm, { requireModel: false });
  return cfg.protocol === 'anthropic' ? listAnthropicModels(cfg, opts) : listOpenAiModels(cfg, opts);
}
