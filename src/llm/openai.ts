/**
 * OpenAI-compatible chat provider (OpenAI, DeepSeek, Qwen, Kimi, GLM, SiliconFlow, OpenRouter,
 * Ollama, custom servers) over plain fetch: POST {base}/chat/completions, GET {base}/models.
 *
 * Compatibility strategy: send the richest request the endpoint is likely to accept, and when it
 * answers 400/422 adapt once per culprit (using the structured `error.param` when present, else the
 * error text) — e.g. drop `response_format`, switch `max_tokens` ↔ `max_completion_tokens`, lower the
 * output budget to the limit the error names, drop `temperature`. What worked is remembered for the
 * lifetime of the provider instance. Temperatures are clamped to the provider's range first
 * (temperature.ts), and models with a fixed temperature never get one.
 */
import { effectiveUseProxy, type ResolvedLlmConfig } from './config';
import { createDeadline, DEFAULT_TIMEOUT_MS, sleep, type Deadline } from './deadline';
import { extractErrorMessage, extractErrorParam, httpError, isModelNotFound, networkError, unknownError, type NetworkContext } from './errors';
import { apiUrl, joinUrl, proxyHeaders } from './http';
import { assertChatRequest, clampMaxTokens, parseWithSchema, sanitizeMessages, stripReasoning } from './output';
import { clampTemperature, isOpenAiReasoningModel, openAiTemperatureRange, type TemperatureRange } from './temperature';
import { LlmError, type ChatProvider, type ChatRequest, type ChatResult } from './types';
import type { Effort } from '../types';

export { isOpenAiReasoningModel } from './temperature';

const LABEL = 'OpenAI-compatible API';
/** Appended to the system prompt for JSON requests; some providers require the word "JSON" for json_object mode. */
export const OPENAI_JSON_HINT = 'Respond with a single valid JSON object only (no markdown, no code fences, no extra text).';
const MAX_ADAPTATIONS = 3;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 8000;
const LIST_MODELS_TIMEOUT_MS = 30_000;

interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Request body for POST /chat/completions (only the fields we send). */
export interface OpenAiChatBody {
  model: string;
  messages: WireMessage[];
  stream: false;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  reasoning_effort?: Effort;
  response_format?: { type: 'json_object' };
}

/** What this endpoint accepts, learned from 400 responses. */
interface Compat {
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** Largest output budget the endpoint accepts (known model cap, or the limit a 400 named). */
  maxTokens?: number;
  responseFormat: boolean;
  temperature: boolean;
  reasoningEffort: boolean;
}

/**
 * Documented output caps below the interviewer's budgets, keyed by bare model id (vendor prefix
 * stripped). Anything else is learned from the endpoint's 400 ("valid range of max_tokens is [1, 8192]").
 */
const KNOWN_OUTPUT_CAPS: ReadonlyArray<readonly [RegExp, number]> = [
  // DeepSeek's legacy V3 names (retired on api.deepseek.com 2026-07-24, still served by some hosts): 8K output.
  [/^deepseek-(?:chat|reasoner)$/, 8192],
  // Zhipu GLM-4-Long: 4K output (docs.bigmodel.cn model overview).
  [/^glm-4-long$/, 4096],
];

export function knownOutputCap(model: string): number | undefined {
  const m = model.trim().toLowerCase();
  const bare = m.slice(m.lastIndexOf('/') + 1);
  return KNOWN_OUTPUT_CAPS.find(([re]) => re.test(bare))?.[1];
}

/** A non-2xx response kept raw so the request can adapt before it becomes an LlmError. */
class HttpFailure extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId: string | null;
  constructor(status: number, body: unknown, headers: Headers) {
    super(`HTTP ${status}`);
    this.name = 'HttpFailure';
    this.status = status;
    this.body = body;
    this.requestId = headers.get('x-request-id') ?? headers.get('request-id');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function initialCompat(cfg: ResolvedLlmConfig): Compat {
  const official = hostOf(cfg.baseUrl) === 'api.openai.com';
  const reasoning = isOpenAiReasoningModel(cfg.model);
  return {
    // api.openai.com deprecated max_tokens (reasoning models reject it); compatible servers mostly only know max_tokens.
    tokenParam: official ? 'max_completion_tokens' : 'max_tokens',
    maxTokens: knownOutputCap(cfg.model),
    responseFormat: true,
    // Fixed-temperature models (OpenAI reasoning models, Kimi K2.5+/K3) reject any explicit value.
    temperature: openAiTemperatureRange(cfg.baseUrl, cfg.model) !== null,
    // Map the effort setting onto OpenAI's reasoning effort: keeps GPT-5 / o-series turns snappy.
    reasoningEffort: official && reasoning,
  };
}

export function buildOpenAiBody(cfg: ResolvedLlmConfig, req: ChatRequest, compat: Compat = initialCompat(cfg)): OpenAiChatBody {
  const wantsJson = req.jsonSchema !== undefined;
  const system = wantsJson ? [req.system.trim(), OPENAI_JSON_HINT].filter(Boolean).join('\n\n') : req.system;
  const messages: WireMessage[] = [];
  if (system.trim()) messages.push({ role: 'system', content: system });
  messages.push(...sanitizeMessages(req.messages));

  const body: OpenAiChatBody = { model: cfg.model, messages, stream: false };
  body[compat.tokenParam] = Math.min(clampMaxTokens(req.maxTokens), compat.maxTokens ?? Number.POSITIVE_INFINITY);
  const range: TemperatureRange | null = compat.temperature ? openAiTemperatureRange(cfg.baseUrl, cfg.model) : null;
  if (range) body.temperature = clampTemperature(cfg.temperature, range);
  if (compat.reasoningEffort) body.reasoning_effort = cfg.effort;
  if (wantsJson && cfg.jsonMode && compat.responseFormat) body.response_format = { type: 'json_object' };
  return body;
}

const TOKEN_PARAM_RE = /max_(?:completion_)?tokens|max[ _-]?output[ _-]?tokens/i;
/**
 * The upper bound a "max_tokens too large" error names: DeepSeek "the valid range of max_tokens is
 * [1, 8192]", OpenAI "supports at most 16384 completion tokens", Anthropic-style "20000 > 8192, which is
 * the maximum allowed", "must be less than or equal to 8192", "<= 8192", "between 1 and 8192".
 */
const TOKEN_LIMIT_RES: readonly RegExp[] = [
  /\[\s*\d+\s*,\s*(\d+)\s*[\])]/,
  /\bat most\s*`?(\d+)/i,
  /(\d+)`?,?\s*which is the maximum/i,
  /less than or equal to\s*`?(\d+)/i,
  /(?:<=|≤)\s*`?(\d+)/,
  /\bbetween\s+\d+\s+and\s+`?(\d+)/i,
  /\bmaximum(?: value| allowed)?(?: is| of)?:?\s*`?(\d+)/i,
  /\b(?:must not|cannot|can't) exceed\s*`?(\d+)/i,
];

/** Output-token limit named by a 400 about max_tokens, when it is below what was sent. */
export function parseOutputTokenLimit(message: string, sent: number): number | undefined {
  if (!TOKEN_PARAM_RE.test(message)) return undefined;
  // vLLM: "… maximum context length is 8192 tokens and your request has 1000 input tokens (8000 > 8192 - 1000)".
  const room = /\b(\d+)\s*>\s*(\d+)\s*-\s*(\d+)\b/.exec(message);
  if (room) {
    const limit = Number(room[2]) - Number(room[3]);
    if (Number.isInteger(limit) && limit >= 1 && limit < sent) return limit;
  }
  for (const re of TOKEN_LIMIT_RES) {
    const limit = Number(re.exec(message)?.[1]);
    if (Number.isInteger(limit) && limit >= 1 && limit < sent) return limit;
  }
  return undefined;
}

/** Compat to retry with after a 400/422, or null when nothing we control could fix it. */
function adapt(failure: HttpFailure, body: OpenAiChatBody, compat: Compat): Compat | null {
  if (failure.status !== 400 && failure.status !== 422) return null;
  // A wrong model id: nothing in the request shape can fix it (and dropping JSON mode would hide it).
  if (isModelNotFound(failure.body)) return null;
  const param = extractErrorParam(failure.body);
  const message = extractErrorMessage(failure.body) ?? '';
  const sentTokens = body.max_tokens ?? body.max_completion_tokens;
  // "max_tokens is too large" — retry within the limit the endpoint names (and keep it for later calls).
  if (sentTokens !== undefined && (param === undefined || param === 'max_tokens' || param === 'max_completion_tokens')) {
    const limit = parseOutputTokenLimit(message, sentTokens);
    if (limit !== undefined) return { ...compat, maxTokens: limit };
  }
  switch (param) {
    case 'max_tokens':
      return body.max_tokens !== undefined ? { ...compat, tokenParam: 'max_completion_tokens' } : null;
    case 'max_completion_tokens':
      return body.max_completion_tokens !== undefined ? { ...compat, tokenParam: 'max_tokens' } : null;
    case 'temperature':
      return body.temperature !== undefined ? { ...compat, temperature: false } : null;
    case 'reasoning_effort':
      return body.reasoning_effort !== undefined ? { ...compat, reasoningEffort: false } : null;
    case undefined:
      // No param named, but the text blames one (Kimi: "invalid temperature: only 1 is allowed for this model").
      if (/temperature/i.test(message)) return body.temperature !== undefined ? { ...compat, temperature: false } : null;
      if (/reasoning[_ ]effort/i.test(message)) return body.reasoning_effort !== undefined ? { ...compat, reasoningEffort: false } : null;
      // A token-budget complaint without a usable limit: dropping JSON mode would not help.
      if (TOKEN_PARAM_RE.test(message)) return null;
      // No culprit named: drop the optional feature compatible servers most often reject.
      if (body.response_format) return { ...compat, responseFormat: false };
      if (body.reasoning_effort !== undefined) return { ...compat, reasoningEffort: false };
      return null;
    case 'response_format':
      return body.response_format ? { ...compat, responseFormat: false } : null;
    default:
      return null;
  }
}

function retryDelayMs(headers: Headers): number {
  const ms = Number(headers.get('retry-after-ms'));
  if (headers.has('retry-after-ms') && Number.isFinite(ms)) return Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS);
  const after = headers.get('retry-after');
  if (after) {
    const seconds = Number(after);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
    if (Number.isFinite(delay)) return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function shouldRetry(res: Response): boolean {
  const hint = res.headers.get('x-should-retry');
  if (hint === 'false') return false;
  if (hint === 'true') return true;
  return RETRYABLE_STATUS.has(res.status);
}

/** Where a request goes right now; the relay rule is re-evaluated per request (detection may finish late). */
interface Target {
  url: string;
  proxied: boolean;
  net: NetworkContext;
}

function targetFor(cfg: ResolvedLlmConfig, path: string): Target {
  const proxied = effectiveUseProxy(cfg.useProxy);
  return { url: apiUrl(cfg.baseUrl, path, proxied), proxied, net: { direct: !proxied, url: joinUrl(cfg.baseUrl, path) } };
}

function headersFor(cfg: ResolvedLlmConfig, target: Target, withBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...proxyHeaders(target.proxied) };
  if (withBody) headers['Content-Type'] = 'application/json';
  // Keyless local servers (Ollama, LM Studio…) get no Authorization header at all.
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  return headers;
}

async function readPayload(res: Response, deadline: Deadline): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (deadline.signal.aborted) throw deadline.abortError(err);
    throw new LlmError('network', 'Connection dropped while reading the response', { cause: err });
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * One HTTP exchange with a single automatic retry for 408/409/429/5xx (honouring retry-after /
 * x-should-retry). Returns the parsed JSON of a 2xx response; throws HttpFailure otherwise.
 */
async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  init: { headers: Record<string, string>; body?: string },
  deadline: Deadline,
  net: NetworkContext,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers: init.headers, body: init.body, signal: deadline.signal });
    } catch (err) {
      if (deadline.signal.aborted) throw deadline.abortError(err);
      throw networkError(err, net);
    }
    const payload = await readPayload(res, deadline);
    if (res.ok) {
      if (payload !== null && typeof payload !== 'object') {
        const type = res.headers.get('content-type') ?? 'unknown content type';
        throw new LlmError('parse', `Expected JSON from ${net.url} but got ${type} — check the base URL`, {
          status: res.status,
          detail: String(payload).slice(0, 300),
        });
      }
      return payload;
    }
    if (attempt === 0 && shouldRetry(res)) {
      await sleep(retryDelayMs(res.headers), deadline);
      continue;
    }
    throw new HttpFailure(res.status, payload, res.headers);
  }
}

function toLlmError(err: unknown, deadline: Deadline): LlmError {
  if (err instanceof HttpFailure) return httpError(err.status, err.body, { label: LABEL, requestId: err.requestId });
  if (err instanceof LlmError) return err;
  if (deadline.signal.aborted) return deadline.abortError(err);
  return unknownError(err);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `message.content` may be a string, null, or (some servers) an array of `{type:'text', text}` parts. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' && (part.type === undefined || part.type === 'text') ? part.text : ''))
      .join('');
  }
  return '';
}

/**
 * Convert a /chat/completions JSON body into a ChatResult (or the matching LlmError).
 * `sentMaxTokens` is the output budget actually sent (may be below req.maxTokens after a cap).
 */
export function parseCompletion(json: unknown, req: ChatRequest, fallbackModel: string, sentMaxTokens?: number): ChatResult {
  if (!isRecord(json)) throw new LlmError('parse', 'Unexpected response from the provider (not a JSON object)');
  const choice = Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : undefined;
  if (!choice) {
    if (json.error !== undefined) {
      // Some gateways (e.g. OpenRouter) report upstream failures as HTTP 200 + {error}.
      const code = isRecord(json.error) ? num(json.error.code) : undefined;
      const status = code !== undefined && code >= 400 && code < 600 ? code : 502;
      throw httpError(status, json, { label: LABEL });
    }
    throw new LlmError('parse', 'The provider response contains no choices', { detail: JSON.stringify(json).slice(0, 300) });
  }

  const message = isRecord(choice.message) ? choice.message : {};
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new LlmError('refusal', 'The model refused to answer', { detail: message.refusal.trim() });
  }
  if (finish === 'content_filter' || finish === 'sensitive') {
    throw new LlmError('refusal', `The provider's content filter stopped the reply (finish_reason: ${finish})`);
  }
  if (finish === 'length') {
    throw new LlmError('truncated', `The reply hit the output token limit (max ${sentMaxTokens ?? clampMaxTokens(req.maxTokens)} tokens)`);
  }
  // Reasoning models (deepseek-reasoner, GLM, Qwen3…) put the answer in `content` and their thinking in
  // `reasoning_content`, which is deliberately ignored.
  const text = stripReasoning(contentText(message.content)).trim();
  if (!text) throw new LlmError('parse', 'The model returned an empty reply', { detail: finish ? `finish_reason: ${finish}` : undefined });

  const usage = isRecord(json.usage) ? json.usage : undefined;
  const details = usage && isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
  return {
    text,
    parsed: req.jsonSchema ? parseWithSchema(text, req.jsonSchema) : undefined,
    model: typeof json.model === 'string' && json.model ? json.model : fallbackModel,
    stopReason: finish,
    usage: usage
      ? {
          inputTokens: num(usage.prompt_tokens),
          outputTokens: num(usage.completion_tokens),
          // OpenAI: prompt_tokens_details.cached_tokens; DeepSeek: prompt_cache_hit_tokens.
          cacheReadTokens: num(details?.cached_tokens) ?? num(usage.prompt_cache_hit_tokens),
        }
      : undefined,
  };
}

export function createOpenAiProvider(cfg: ResolvedLlmConfig): ChatProvider {
  let compat = initialCompat(cfg);

  return {
    protocol: 'openai',
    async chat(req: ChatRequest): Promise<ChatResult> {
      assertChatRequest(req);
      const deadline = createDeadline(req.signal, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const target = targetFor(cfg, 'chat/completions');
      try {
        let attemptCompat = compat;
        for (let adaptations = 0; ; adaptations++) {
          const body = buildOpenAiBody(cfg, req, attemptCompat);
          let json: unknown;
          try {
            const init = { headers: headersFor(cfg, target, true), body: JSON.stringify(body) };
            json = await requestJson('POST', target.url, init, deadline, target.net);
          } catch (err) {
            const next =
              err instanceof HttpFailure && adaptations < MAX_ADAPTATIONS && !deadline.signal.aborted
                ? adapt(err, body, attemptCompat)
                : null;
            if (!next) throw err;
            attemptCompat = next;
            continue;
          }
          compat = attemptCompat; // the endpoint accepted this request shape — keep using it
          return parseCompletion(json, req, cfg.model, body.max_tokens ?? body.max_completion_tokens);
        }
      } catch (err) {
        throw toLlmError(err, deadline);
      } finally {
        deadline.dispose();
      }
    },
  };
}

/** Pull model ids out of a /models response (OpenAI `{data:[{id}]}`, Ollama `{models:[{name}]}`, bare arrays). */
export function extractModelIds(json: unknown): string[] {
  const list: unknown[] = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.data)
      ? json.data
      : isRecord(json) && Array.isArray(json.models)
        ? json.models
        : [];
  const ids = list
    .map((item) => (typeof item === 'string' ? item : isRecord(item) ? (item.id ?? item.name ?? item.model) : undefined))
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    .map((id) => id.trim());
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function listOpenAiModels(cfg: ResolvedLlmConfig, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string[]> {
  const deadline = createDeadline(opts.signal, opts.timeoutMs ?? LIST_MODELS_TIMEOUT_MS);
  const target = targetFor(cfg, 'models');
  try {
    const json = await requestJson('GET', target.url, { headers: headersFor(cfg, target, false) }, deadline, target.net);
    return extractModelIds(json);
  } catch (err) {
    throw toLlmError(err, deadline);
  } finally {
    deadline.dispose();
  }
}
