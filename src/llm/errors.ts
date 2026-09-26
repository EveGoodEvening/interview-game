/**
 * Shared error helpers: HTTP status → LlmErrorCode, provider error-body parsing and
 * network-failure messages. Messages are English/technical; the UI localizes by `code`.
 */
import { LlmError, type LlmErrorCode } from './types';

/** Error `type` values emitted by our own relay (server/proxy.ts). */
const RELAY_UNREACHABLE = 'proxy_upstream_unreachable';
const RELAY_CONFIG_ERRORS = new Set(['proxy_forbidden', 'proxy_bad_target']);
/** Structured error codes/types some OpenAI-compatible providers use for moderation blocks. */
const MODERATION_ERROR_CODES = new Set([
  'content_filter',
  'content_policy_violation',
  'data_inspection_failed', // DashScope (Qwen)
  'sensitive_words_detected',
]);

const MAX_DETAIL_CHARS = 600;

export function isLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError;
}

export function statusToCode(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'server';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_DETAIL_CHARS ? `${t.slice(0, MAX_DETAIL_CHARS)}…` : t;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Best-effort human-readable message from a provider error body. Understands the shapes used by
 * OpenAI / Anthropic (`{error:{message}}`), FastAPI (`{detail}`), DashScope (`{code,message}`),
 * plain-string errors and non-JSON text bodies.
 */
export function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === 'string') {
    if (!body.trim()) return undefined;
    // An HTML error page (wrong base URL, gateway page…): its <title> is the useful part.
    if (/^\s*</.test(body)) {
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
      return title ? `HTML page: ${clip(title)}` : 'HTML page instead of an API response (check the base URL)';
    }
    return clip(body);
  }
  if (!isRecord(body)) return undefined;
  const { error } = body;
  if (typeof error === 'string' && error.trim()) return clip(error);
  if (isRecord(error)) {
    const inner = firstString(error.message, error.msg, error.detail);
    if (inner) return clip(inner);
    if (isRecord(error.error)) {
      const nested = firstString(error.error.message);
      if (nested) return clip(nested);
    }
  }
  const direct = firstString(body.message, body.msg, body.error_msg, body.errmsg, body.detail);
  if (direct) return clip(direct);
  if (Array.isArray(body.detail)) {
    const parts = body.detail.map((d) => (isRecord(d) ? firstString(d.msg, d.message) : undefined)).filter(Boolean);
    if (parts.length) return clip(parts.join('; '));
  }
  if (Array.isArray(body.errors) && isRecord(body.errors[0])) {
    const first = firstString(body.errors[0].message);
    if (first) return clip(first);
  }
  return undefined;
}

/** Machine-readable error type/code from a provider error body (e.g. `rate_limit_error`, `invalid_api_key`). */
export function extractErrorType(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { error } = body;
  if (isRecord(error)) return firstString(error.type, error.code);
  return firstString(body.type, body.code);
}

/** The request parameter an OpenAI-style 400 blames (`{error:{param:"temperature"}}`), if any. */
export function extractErrorParam(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { error } = body;
  return isRecord(error) ? firstString(error.param) : firstString(body.param);
}

/** Structured codes providers use for an unknown model id (OpenAI / DashScope, Zhipu 1211, SiliconFlow 20012). */
const MODEL_NOT_FOUND_CODES = new Set(['model_not_found', 'modelnotfound', 'model_not_exist', 'invalidmodel', '1211', '20012']);
/**
 * Unknown-model wording: OpenAI "The model `gpt-4.1-x` does not exist", DeepSeek "Model Not Exist", Kimi
 * "Not found the model x or Permission denied", Ollama `model "qwen2.5:7b" not found`, OpenRouter "x is not a
 * valid model ID", Anthropic "model: x" (404), Zhipu "模型不存在". Dots inside ids are allowed; a sentence end is not.
 */
const MODEL_NOT_FOUND_RES: readonly RegExp[] = [
  /\bmodel\b(?:[^.。\n]|\.(?=\S)){0,80}?\b(?:does not exist|doesn't exist|not exists?|not found)\b/i,
  /\b(?:not found the model|no such model|unknown model|invalid model(?: name| id)?|model not found|is not a valid model(?: id)?)\b/i,
  /^model: \S+$/i,
  /模型[^。]{0,40}?不存在/,
];

function rawCode(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** True when an error body says the requested model id does not exist (a renamed / retired / mistyped model). */
export function isModelNotFound(body: unknown): boolean {
  if (isRecord(body)) {
    const codes = [body.code, isRecord(body.error) ? body.error.code : undefined].map(rawCode);
    if (codes.some((c) => c !== undefined && MODEL_NOT_FOUND_CODES.has(c))) return true;
  }
  const message = extractErrorMessage(body);
  return message !== undefined && MODEL_NOT_FOUND_RES.some((re) => re.test(message));
}

/** Error codes/types a body carries, used to recognise moderation blocks without matching message text. */
function errorCodes(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const out: unknown[] = [body.code, body.type];
  if (isRecord(body.error)) out.push(body.error.code, body.error.type);
  return out.filter((v): v is string => typeof v === 'string');
}

export interface HttpErrorContext {
  /** Short provider label for messages, e.g. "OpenAI-compatible API" or "Anthropic API". */
  label: string;
  /** Request id reported by the provider, when known. */
  requestId?: string | null;
  /** Code already determined by the caller (e.g. from an SDK error class); defaults to statusToCode(status). */
  code?: LlmErrorCode;
  cause?: unknown;
}

/** Map a non-2xx provider response (status + parsed body) to an LlmError. */
export function httpError(status: number, body: unknown, ctx: HttpErrorContext): LlmError {
  const providerMessage = extractErrorMessage(body);
  const type = extractErrorType(body);
  const withId = (text: string) => (ctx.requestId ? `${text} (request id: ${ctx.requestId})` : text);
  const opts = { status, detail: providerMessage ? withId(providerMessage) : undefined, cause: ctx.cause };
  const suffix = providerMessage ? `: ${providerMessage}` : '';

  // Our own relay's errors and moderation blocks are recognised by their structured type/code.
  if (type === RELAY_UNREACHABLE) return new LlmError('network', `The local relay could not reach the provider${suffix}`, opts);
  if (type && RELAY_CONFIG_ERRORS.has(type)) return new LlmError('config', `The local relay rejected the request${suffix}`, opts);
  if (status >= 400 && status < 500 && errorCodes(body).some((c) => MODERATION_ERROR_CODES.has(c))) {
    return new LlmError('refusal', `${ctx.label} blocked the request (content moderation)${suffix}`, opts);
  }
  // Providers report an unknown model id as 404, 400 or 422: all mean "pick another model" (Settings → Fetch models).
  if ((status === 400 || status === 404 || status === 422) && isModelNotFound(body)) {
    return new LlmError('not_found', `${ctx.label} error ${status}: the model was not found — choose one from "Fetch models" in Settings${suffix}`, opts);
  }
  const code = ctx.code ?? statusToCode(status);
  return new LlmError(code, `${ctx.label} error ${status}${type ? ` (${type})` : ''}${suffix}`, opts);
}

/** Where a request was sent, for network-failure messages. */
export interface NetworkContext {
  /** True when the browser called the provider directly (no local relay). */
  direct: boolean;
  /** The provider URL (not the relay URL). */
  url: string;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** fetch() rejected (DNS, offline, TLS, CORS…). */
export function networkError(cause: unknown, ctx: NetworkContext): LlmError {
  const reason = cause instanceof Error && cause.message ? ` (${cause.message})` : '';
  const message = ctx.direct
    ? `Could not reach ${originOf(ctx.url)}${reason}. The provider may not allow direct browser requests (CORS) — enable the local relay, or check the URL and your connection.`
    : `Could not reach ${originOf(ctx.url)} through the local relay${reason}. Make sure the game is served by \`npm run dev\` / \`npm start\` and that the URL is correct.`;
  return new LlmError('network', message, { cause, detail: cause instanceof Error ? cause.message : undefined });
}

/** Wrap anything thrown by a provider in an LlmError (fallback classification). */
export function unknownError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof TypeError) return new LlmError('network', `Network request failed: ${err.message}`, { cause: err });
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError('server', `Unexpected LLM client error: ${message}`, { cause: err, detail: message });
}
