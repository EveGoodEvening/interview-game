/**
 * Anthropic (Claude) chat provider on top of the official SDK in browser mode.
 *
 * - The SDK is loaded lazily (dynamic import) so the default offline demo never downloads it.
 * - Prompt caching: the system prompt is sent as one cached text block (`cache_control: ephemeral`) —
 *   the interviewer keeps it byte-identical across turns — and a second breakpoint sits on the last
 *   assistant message, so the growing interview history is read from the cache on the next turn (the
 *   latest user message carries the per-turn instructions and stays unmarked).
 * - JSON requests use structured outputs (`output_config.format`, a JSON Schema built from the zod
 *   schema by structuredOutput.ts: enums kept, `additionalProperties: false` everywhere, keywords the
 *   API rejects removed). The reply is validated here without throwing (`parsed` stays undefined on
 *   mismatch) so `stop_reason` is always inspected first and the caller's lenient normaliser still gets
 *   the raw text.
 * - Official endpoint + Claude Opus 5 / Fable models: server-side refusal fallbacks
 *   (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`) via the typed beta namespace.
 * - Third-party Anthropic-compatible endpoints that 400 on `output_config` are retried once without
 *   it, and the provider instance stops sending it.
 * - No temperature / thinking / budget_tokens are sent: Claude's defaults apply.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { effectiveUseProxy, type ResolvedLlmConfig } from './config';
import { createDeadline, DEFAULT_TIMEOUT_MS, type Deadline } from './deadline';
import { httpError, isModelNotFound, networkError, statusToCode, unknownError, type NetworkContext } from './errors';
import { PROXY_HEADERS, toProxyUrl } from './http';
import { assertChatRequest, clampMaxTokens, parseWithSchema, sanitizeMessages } from './output';
import { LlmError, type ChatMessage, type ChatProvider, type ChatRequest, type ChatResult, type LlmErrorCode } from './types';
import type { Effort } from '../types';

const LABEL = 'Anthropic API';
const OFFICIAL_HOST = 'api.anthropic.com';
export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const LIST_MODELS_TIMEOUT_MS = 30_000;

// ───────────────────────── SDK loading ─────────────────────────

interface Sdk {
  Anthropic: typeof Anthropic;
  outputFormatFor: typeof import('./structuredOutput').outputFormatFor;
}

let sdkPromise: Promise<Sdk> | undefined;

function loadSdk(): Promise<Sdk> {
  // The schema builder (and the zod it uses) is loaded with the SDK, so the Settings chunk doesn't carry it.
  sdkPromise ??= Promise.all([import('@anthropic-ai/sdk'), import('./structuredOutput')]).then(
    ([core, structured]) => ({ Anthropic: core.default, outputFormatFor: structured.outputFormatFor }),
    (err: unknown) => {
      sdkPromise = undefined; // allow a retry after e.g. a transient chunk-load failure
      throw new LlmError('network', 'Failed to load the Anthropic SDK', { cause: err });
    },
  );
  return sdkPromise;
}

// ───────────────────────── Capabilities ─────────────────────────

type RequestOptions = NonNullable<Parameters<Anthropic['messages']['create']>[1]>;
type JsonFormat = Anthropic.JSONOutputFormat;

type WireMessage = ChatMessage | { role: 'assistant'; content: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> };

/** Request body shared by `messages.create` and `beta.messages.create` (plain data, valid for both). */
interface WireParams {
  model: string;
  max_tokens: number;
  messages: WireMessage[];
  system?: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }>;
  output_config?: { effort?: Effort; format?: JsonFormat };
}

export function isOfficialAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host.toLowerCase() === OFFICIAL_HOST;
  } catch {
    return false;
  }
}

/** Claude Opus 5 (incl. 5.x) and Fable models run safety classifiers → opt into server-side fallbacks. */
export function supportsRefusalFallback(model: string): boolean {
  return /^claude-(opus-5|fable-)/i.test(model.trim());
}

/** `output_config.effort` is rejected by Haiku and pre-Opus-4.5 / Sonnet-4.5-era models. */
export function supportsEffort(model: string): boolean {
  const m = model.trim().toLowerCase();
  return !/haiku|claude-3|claude-(?:sonnet|opus)-4-(?:0|1|2025)|claude-sonnet-4-5|claude-(?:sonnet|opus)-4$/.test(m);
}

// ───────────────────────── Request / response ─────────────────────────

/** Optional request features, so a rejected feature can be dropped on retry. */
interface Plan {
  effort?: Effort;
  format?: JsonFormat;
  fallbacks: boolean;
}

/**
 * Messages with a cache breakpoint on the last assistant message (the one before the latest user turn).
 * Everything up to it is identical on the next turn — only the latest user message (per-turn
 * instructions, fuller answer) changes form — so the next request reads the history from the cache.
 * The latest user message itself is never marked: it would be written and never read.
 */
export function withHistoryBreakpoint(messages: ChatMessage[]): WireMessage[] {
  const i = messages.length - 2;
  if (messages.length < 3 || messages[i].role !== 'assistant') return messages;
  const out: WireMessage[] = [...messages];
  out[i] = { role: 'assistant', content: [{ type: 'text', text: messages[i].content, cache_control: { type: 'ephemeral' } }] };
  return out;
}

function buildParams(cfg: ResolvedLlmConfig, req: ChatRequest, plan: Plan): WireParams {
  const params: WireParams = {
    model: cfg.model,
    max_tokens: clampMaxTokens(req.maxTokens),
    messages: withHistoryBreakpoint(sanitizeMessages(req.messages)),
  };
  // Empty text blocks are rejected by the API, so an empty system prompt is omitted.
  if (req.system.trim()) {
    params.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  }
  if (plan.effort || plan.format) {
    params.output_config = {
      ...(plan.effort ? { effort: plan.effort } : {}),
      ...(plan.format ? { format: plan.format } : {}),
    };
  }
  return params;
}

/** The parts of Message / BetaMessage we read (optional where Anthropic-compatible servers may omit them). */
interface ClaudeReply {
  content?: ReadonlyArray<{ type: string }> | null;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  model?: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null } | null;
}

function isTextBlock(block: { type: string }): block is { type: 'text'; text: string } {
  return block.type === 'text' && typeof (block as { text?: unknown }).text === 'string';
}

function toResult(reply: ClaudeReply, req: ChatRequest, model: string): ChatResult {
  if (reply.stop_reason === 'refusal') {
    const category = reply.stop_details?.category;
    throw new LlmError('refusal', `Claude declined to respond${category ? ` (category: ${category})` : ''}`, {
      detail: reply.stop_details?.explanation ?? undefined,
    });
  }
  if (reply.stop_reason === 'max_tokens' || reply.stop_reason === 'model_context_window_exceeded') {
    throw new LlmError('truncated', `The reply hit the token limit (stop_reason: ${reply.stop_reason}, max_tokens: ${clampMaxTokens(req.maxTokens)})`);
  }
  // Thinking / fallback marker blocks are skipped; only the visible answer is returned.
  const text = (reply.content ?? []).filter(isTextBlock).map((b) => b.text).join('').trim();
  if (!text) throw new LlmError('parse', 'Claude returned an empty reply', { detail: `stop_reason: ${reply.stop_reason ?? 'none'}` });
  const usage = reply.usage;
  return {
    text,
    parsed: req.jsonSchema ? parseWithSchema(text, req.jsonSchema) : undefined,
    model: reply.model || model,
    stopReason: reply.stop_reason ?? undefined,
    usage: usage
      ? {
          inputTokens: usage.input_tokens ?? undefined,
          outputTokens: usage.output_tokens ?? undefined,
          cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
        }
      : undefined,
  };
}

function createClient(sdk: Sdk, cfg: ResolvedLlmConfig, proxied: boolean): Anthropic {
  const defaultHeaders: Record<string, string | null> = proxied ? { ...PROXY_HEADERS } : {};
  // Keyless compatible servers: tell the SDK the missing x-api-key is intentional.
  if (!cfg.apiKey) defaultHeaders['x-api-key'] = null;
  return new sdk.Anthropic({
    apiKey: cfg.apiKey,
    authToken: null, // never pick up ambient credentials (env vars / profiles)
    baseURL: proxied ? toProxyUrl(cfg.baseUrl) : cfg.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders,
    maxRetries: 1,
    timeout: DEFAULT_TIMEOUT_MS,
  });
}

/** One SDK client per relay mode (the relay rule is re-evaluated per request: detection may finish late). */
function clientCache(cfg: ResolvedLlmConfig): (sdk: Sdk, proxied: boolean) => Anthropic {
  const clients = new Map<boolean, Anthropic>();
  return (sdk, proxied) => {
    let client = clients.get(proxied);
    if (!client) {
      client = createClient(sdk, cfg, proxied);
      clients.set(proxied, client);
    }
    return client;
  };
}

/** LlmErrorCode for an SDK status error, decided by its class. */
function classCode(A: typeof Anthropic, err: InstanceType<typeof Anthropic.APIError>, status: number): LlmErrorCode {
  if (err instanceof A.AuthenticationError || err instanceof A.PermissionDeniedError) return 'auth';
  if (err instanceof A.NotFoundError) return 'not_found';
  if (err instanceof A.RateLimitError) return 'rate_limit';
  if (err instanceof A.BadRequestError || err instanceof A.UnprocessableEntityError || err instanceof A.ConflictError) {
    return 'bad_request';
  }
  if (err instanceof A.InternalServerError) return 'server';
  return statusToCode(status); // other statuses the SDK has no class for (402, 408, 413…)
}

/** Map anything the SDK throws to an LlmError, using the SDK's error classes (never message text). */
function toLlmError(sdk: Sdk | undefined, err: unknown, deadline: Deadline, net: NetworkContext): LlmError {
  if (err instanceof LlmError) return err;
  if (deadline.signal.aborted) return deadline.abortError(err);
  if (!sdk) return unknownError(err);
  const A = sdk.Anthropic;
  // Order matters: the timeout / abort classes extend APIConnectionError / APIError.
  if (err instanceof A.APIUserAbortError) return deadline.abortError(err);
  if (err instanceof A.APIConnectionTimeoutError) {
    return new LlmError('timeout', `Request timed out after ${deadline.timeoutMs} ms`, { cause: err });
  }
  if (err instanceof A.APIConnectionError) return networkError(err.cause instanceof Error ? err.cause : err, net);
  if (err instanceof A.APIError) {
    if (err.status === undefined) return networkError(err, net);
    return httpError(err.status, err.error, { label: LABEL, requestId: err.requestID, code: classCode(A, err, err.status), cause: err });
  }
  if (err instanceof A.AnthropicError) {
    return new LlmError('bad_request', `Anthropic SDK error: ${err.message}`, { cause: err, detail: err.message });
  }
  return unknownError(err);
}

// ───────────────────────── Provider ─────────────────────────

/**
 * The plan to retry with after a 400/422, or null when there is nothing optional left to drop.
 * - Official API: the schema (or the fallbacks beta) was most likely rejected → keep effort only.
 * - Third-party endpoint: it probably doesn't know output_config at all → drop it entirely.
 */
function reducePlan(plan: Plan, official: boolean): Plan | null {
  const reduced: Plan = official ? { effort: plan.effort, fallbacks: false } : { fallbacks: false };
  const changed = plan.format !== undefined || plan.fallbacks || plan.effort !== reduced.effort;
  return changed ? reduced : null;
}

export function createAnthropicProvider(cfg: ResolvedLlmConfig): ChatProvider {
  const official = isOfficialAnthropic(cfg.baseUrl);
  const effort = supportsEffort(cfg.model) ? cfg.effort : undefined;
  const clientFor = clientCache(cfg);
  /** What this endpoint accepts, learned from 400 responses. */
  let outputConfigSupported = true;
  let fallbacksSupported = official && supportsRefusalFallback(cfg.model);

  const send = async (client: Anthropic, req: ChatRequest, plan: Plan, deadline: Deadline): Promise<ChatResult> => {
    const params = buildParams(cfg, req, plan);
    const options: RequestOptions = { signal: deadline.signal, timeout: deadline.timeoutMs };
    if (plan.fallbacks) {
      const reply = await client.beta.messages.create({ ...params, betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' }, options);
      return toResult(reply, req, cfg.model);
    }
    return toResult(await client.messages.create(params, options), req, cfg.model);
  };

  return {
    protocol: 'anthropic',
    async chat(req: ChatRequest): Promise<ChatResult> {
      assertChatRequest(req);
      const deadline = createDeadline(req.signal, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const proxied = effectiveUseProxy(cfg.useProxy);
      let sdk: Sdk | undefined;
      try {
        sdk = await loadSdk();
        if (deadline.signal.aborted) throw deadline.abortError();
        const client = clientFor(sdk, proxied);
        const format = cfg.jsonMode && req.jsonSchema && outputConfigSupported ? sdk.outputFormatFor(req.jsonSchema) : null;
        const plan: Plan = {
          effort: outputConfigSupported ? effort : undefined,
          format: format ?? undefined,
          fallbacks: fallbacksSupported,
        };
        try {
          return await send(client, req, plan, deadline);
        } catch (err) {
          const A = sdk.Anthropic;
          const reduced = reducePlan(plan, official);
          const rejected = err instanceof A.BadRequestError || err instanceof A.UnprocessableEntityError;
          // An unknown model id is not about optional features: report it instead of retrying without them.
          if (!rejected || !reduced || deadline.signal.aborted || isModelNotFound(err.error)) throw err;
          const result = await send(client, req, reduced, deadline);
          // Remember only unambiguous culprits; a rejected schema is specific to this request.
          if (!official) outputConfigSupported = false;
          else if (plan.fallbacks && !plan.format) fallbacksSupported = false;
          return result;
        }
      } catch (err) {
        throw toLlmError(sdk, err, deadline, { direct: !proxied, url: cfg.baseUrl });
      } finally {
        deadline.dispose();
      }
    },
  };
}

export async function listAnthropicModels(cfg: ResolvedLlmConfig, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string[]> {
  const deadline = createDeadline(opts.signal, opts.timeoutMs ?? LIST_MODELS_TIMEOUT_MS);
  const proxied = effectiveUseProxy(cfg.useProxy);
  let sdk: Sdk | undefined;
  try {
    sdk = await loadSdk();
    const client = createClient(sdk, cfg, proxied);
    const ids: string[] = [];
    // Auto-paginates; the API lists newest models first, which is the most useful order for a picker.
    for await (const model of client.models.list({ limit: 100 }, { signal: deadline.signal, timeout: deadline.timeoutMs })) {
      if (!ids.includes(model.id)) ids.push(model.id);
    }
    return ids;
  } catch (err) {
    throw toLlmError(sdk, err, deadline, { direct: !proxied, url: cfg.baseUrl });
  } finally {
    deadline.dispose();
  }
}
