import type { z } from 'zod';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  /** Output token cap. Default chosen by the provider (≈4096). */
  maxTokens?: number;
  /**
   * Ask for JSON matching this schema. The anthropic provider uses structured outputs
   * (a JSON Schema built by structuredOutput.ts) when settings.jsonMode is on; the openai provider uses
   * response_format json_object. Callers must still validate `text` themselves.
   */
  jsonSchema?: z.ZodType;
  /** Short label for logs / errors: 'plan' | 'turn' | 'report' | 'test'. */
  purpose?: string;
  signal?: AbortSignal;
  /** Request timeout in ms (default 120000). */
  timeoutMs?: number;
}

export interface ChatResult {
  /** Raw assistant text (JSON text when jsonSchema was given). */
  text: string;
  /** Already-parsed object when the provider validated structured output; otherwise undefined. */
  parsed?: unknown;
  model?: string;
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
}

export interface ChatProvider {
  readonly protocol: 'anthropic' | 'openai';
  chat(req: ChatRequest): Promise<ChatResult>;
}

export type LlmErrorCode =
  | 'config' // missing key / model / base URL
  | 'auth' // 401/403
  | 'not_found' // 404 model or endpoint
  | 'rate_limit' // 429
  | 'bad_request' // other 4xx
  | 'server' // 5xx
  | 'network' // fetch failed (DNS, offline, CORS in direct mode)
  | 'timeout'
  | 'aborted'
  | 'refusal' // model refused / safety stop
  | 'truncated' // hit max tokens
  | 'parse'; // response could not be parsed / validated

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  /** Provider's raw error message for the details view. */
  readonly detail?: string;
  constructor(code: LlmErrorCode, message: string, opts: { status?: number; detail?: string; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'LlmError';
    this.code = code;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}
