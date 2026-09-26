/**
 * Post-processing shared by both providers.
 */
import type { z } from 'zod';
import { LlmError, type ChatMessage, type ChatRequest } from './types';

export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Some OpenAI-compatible reasoning models (Qwen3 / DeepSeek-R1 via Ollama, some relays) inline
 * their chain of thought as a leading `<think>…</think>` block in `content`. Drop it so callers
 * only see the answer.
 */
export function stripReasoning(text: string): string {
  return text.replace(/^\s*<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/i, '');
}

function unfence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
  return m ? m[1] : text;
}

/**
 * Strictly parse `text` as JSON and validate it with `schema`. Returns the parsed value, or
 * undefined when the text isn't valid JSON / doesn't match (callers then fall back to their own
 * lenient normalisation of `text`). Never throws.
 */
export function parseWithSchema(text: string, schema: z.ZodType): unknown {
  let json: unknown;
  try {
    json = JSON.parse(unfence(text).trim());
  } catch {
    return undefined;
  }
  try {
    const result = schema.safeParse(json);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Providers reject empty text turns (Anthropic: "text content blocks must be non-empty").
 * Keep the turn (so roles still alternate) with a neutral placeholder.
 */
export function sanitizeMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.content.trim() ? { role: m.role, content: m.content } : { role: m.role, content: '…' }));
}

/** Reject requests no provider can serve before spending a network round trip on them. */
export function assertChatRequest(req: ChatRequest): void {
  if (req.messages.length === 0) throw new LlmError('bad_request', 'A chat request needs at least one message');
  if (req.messages[0].role !== 'user') throw new LlmError('bad_request', 'The first chat message must come from the user');
}

export function clampMaxTokens(maxTokens: number | undefined): number {
  if (maxTokens === undefined || !Number.isFinite(maxTokens)) return DEFAULT_MAX_TOKENS;
  return Math.max(1, Math.round(maxTokens));
}
