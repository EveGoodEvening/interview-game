/// <reference types="node" />
/**
 * Test-only local HTTP server that imitates the provider APIs the LLM transport talks to:
 *
 *   /openai/v1/chat/completions, /openai/v1/models           (OpenAI-compatible)
 *   /anthropic/v1/messages, /anthropic/v1/models             (Anthropic, third-party host)
 *   /api/proxy/https/api.anthropic.com/v1/...                (stands in for the relay → official API)
 *   /api/proxy/http/127.0.0.1:<port>/...                     (the real relay, server/proxy.ts)
 *
 * Every request is recorded. Tests can queue explicit replies per route; otherwise a realistic
 * default reply is produced (with API-key checks and provider-shaped error bodies).
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleApiRequest } from '../../../server/proxy.ts';

export const OPENAI_KEY = 'sk-test-openai';
export const ANTHROPIC_KEY = 'sk-ant-test';

export type Route = 'openai.chat' | 'openai.models' | 'anthropic.messages' | 'anthropic.models';

export interface RecordedRequest {
  route: Route;
  method: string;
  /** Path + query as received. */
  url: string;
  headers: IncomingHttpHeaders;
  /** Parsed JSON body (undefined for GET). */
  body: Record<string, unknown> | undefined;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** JSON-serialised unless it is a string. */
  body?: unknown;
  /** Wait before answering (the reply is dropped if the client disconnects first). */
  delayMs?: number;
}

export type ReplyFactory = Reply | ((req: RecordedRequest) => Reply);

export interface MockLlmServer {
  /** e.g. http://127.0.0.1:43123 */
  readonly origin: string;
  readonly openaiBase: string;
  readonly anthropicBase: string;
  readonly requests: RecordedRequest[];
  /** URLs that went through the real relay (/api/proxy/http/…) before reaching a mock route. */
  readonly relayed: string[];
  requestsFor(route: Route): RecordedRequest[];
  /** Queue one-shot replies for a route (consumed in order before the default handler). */
  enqueue(route: Route, ...replies: ReplyFactory[]): void;
  reset(): void;
  close(): Promise<void>;
}

// ───────────────────────── realistic bodies ─────────────────────────

export function openAiCompletion(content: string | null, extra: { finish?: string; model?: string; message?: Record<string, unknown> } = {}) {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: 1_790_000_000,
    model: extra.model ?? 'gpt-test',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null, ...extra.message },
        logprobs: null,
        finish_reason: extra.finish ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: 42,
      completion_tokens: 7,
      total_tokens: 49,
      prompt_tokens_details: { cached_tokens: 32, audio_tokens: 0 },
    },
    system_fingerprint: 'fp_test',
  };
}

export function openAiError(message: string, extra: { type?: string; param?: string | null; code?: string | null } = {}) {
  return { error: { message, type: extra.type ?? 'invalid_request_error', param: extra.param ?? null, code: extra.code ?? null } };
}

export function claudeMessage(
  text: string | null,
  extra: { stop?: string; model?: string; stopDetails?: Record<string, unknown> | null; content?: unknown[] } = {},
) {
  return {
    id: 'msg_01TestMessage',
    type: 'message',
    role: 'assistant',
    model: extra.model ?? 'claude-test',
    content: extra.content ?? (text === null ? [] : [{ type: 'text', text }]),
    stop_reason: extra.stop ?? 'end_turn',
    stop_sequence: null,
    stop_details: extra.stopDetails ?? null,
    usage: {
      input_tokens: 120,
      output_tokens: 9,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2048,
      service_tier: 'standard',
    },
  };
}

export function claudeError(type: string, message: string) {
  return { type: 'error', error: { type, message }, request_id: 'req_test_01' };
}

const OPENAI_MODELS = ['gpt-5-mini', 'gpt-4.1', 'gpt-5', 'gpt-4.1', 'o4-mini'];
const CLAUDE_MODEL_PAGES = [
  ['claude-opus-5', 'claude-sonnet-5'],
  ['claude-haiku-4-5', 'claude-fable-5-1'],
];

// ───────────────────────── default handlers ─────────────────────────

function header(req: RecordedRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function defaultOpenAiChat(req: RecordedRequest): Reply {
  const auth = header(req, 'authorization');
  if (auth !== undefined && auth !== `Bearer ${OPENAI_KEY}`) {
    return { status: 401, body: openAiError('Incorrect API key provided.', { code: 'invalid_api_key' }) };
  }
  if (req.body?.model === 'missing-model') {
    return {
      status: 404,
      body: openAiError('The model `missing-model` does not exist or you do not have access to it.', { code: 'model_not_found' }),
    };
  }
  const json = (req.body?.response_format as { type?: string } | undefined)?.type === 'json_object';
  return { body: openAiCompletion(json ? '{"answer":"hello","score":7}' : 'OK', { model: String(req.body?.model ?? 'gpt-test') }) };
}

function defaultOpenAiModels(req: RecordedRequest): Reply {
  const auth = header(req, 'authorization');
  if (auth !== undefined && auth !== `Bearer ${OPENAI_KEY}`) {
    return { status: 401, body: openAiError('Incorrect API key provided.', { code: 'invalid_api_key' }) };
  }
  return {
    body: { object: 'list', data: OPENAI_MODELS.map((id) => ({ id, object: 'model', created: 1_700_000_000, owned_by: 'openai' })) },
  };
}

function defaultClaudeMessages(req: RecordedRequest): Reply {
  if (header(req, 'x-api-key') !== ANTHROPIC_KEY) {
    return { status: 401, headers: { 'request-id': 'req_auth_01' }, body: claudeError('authentication_error', 'invalid x-api-key') };
  }
  if (!header(req, 'anthropic-version')) {
    return { status: 400, body: claudeError('invalid_request_error', 'anthropic-version header is required') };
  }
  if (req.body?.model === 'missing-model') {
    return { status: 404, body: claudeError('not_found_error', 'model: missing-model') };
  }
  const format = (req.body?.output_config as { format?: unknown } | undefined)?.format;
  return {
    headers: { 'request-id': 'req_ok_01' },
    body: claudeMessage(format ? '{"answer":"hello","score":7}' : 'OK', { model: String(req.body?.model ?? 'claude-test') }),
  };
}

function defaultClaudeModels(req: RecordedRequest): Reply {
  if (header(req, 'x-api-key') !== ANTHROPIC_KEY) {
    return { status: 401, body: claudeError('authentication_error', 'invalid x-api-key') };
  }
  const after = new URL(req.url, 'http://x').searchParams.get('after_id');
  const pageIndex = after ? CLAUDE_MODEL_PAGES.findIndex((p) => p[p.length - 1] === after) + 1 : 0;
  const page = CLAUDE_MODEL_PAGES[pageIndex] ?? [];
  return {
    body: {
      data: page.map((id) => ({ type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' })),
      has_more: pageIndex < CLAUDE_MODEL_PAGES.length - 1,
      first_id: page[0] ?? null,
      last_id: page[page.length - 1] ?? null,
    },
  };
}

const DEFAULTS: Record<Route, (req: RecordedRequest) => Reply> = {
  'openai.chat': defaultOpenAiChat,
  'openai.models': defaultOpenAiModels,
  'anthropic.messages': defaultClaudeMessages,
  'anthropic.models': defaultClaudeModels,
};

// ───────────────────────── server ─────────────────────────

function routeOf(method: string, path: string): Route | null {
  const p = path
    .replace(/^\/api\/proxy\/https\/api\.anthropic\.com/, '/anthropic')
    .replace(/^\/api\/proxy\/https?\/[^/]+/, '');
  if (method === 'POST' && p === '/openai/v1/chat/completions') return 'openai.chat';
  if (method === 'GET' && p === '/openai/v1/models') return 'openai.models';
  if (method === 'POST' && p === '/anthropic/v1/messages') return 'anthropic.messages';
  if (method === 'GET' && p === '/anthropic/v1/models') return 'anthropic.models';
  return null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, reply: Reply): void {
  if (res.destroyed) return;
  const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
  res.writeHead(reply.status ?? 200, {
    'content-type': typeof reply.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    ...reply.headers,
  });
  res.end(payload);
}

export async function startMockLlmServer(): Promise<MockLlmServer> {
  const requests: RecordedRequest[] = [];
  const relayed: string[] = [];
  const queues = new Map<Route, ReplyFactory[]>();

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const path = url.split('?')[0];
      // Requests addressed to the local upstream through the relay go through the real relay code.
      if (path.startsWith('/api/proxy/http/')) {
        relayed.push(url);
        await handleApiRequest(req, res);
        return;
      }
      const route = routeOf(req.method ?? 'GET', path);
      if (!route) {
        send(res, { status: 404, body: { error: { message: `No mock route for ${req.method} ${path}` } } });
        return;
      }
      const raw = await readBody(req);
      const record: RecordedRequest = {
        route,
        method: req.method ?? 'GET',
        url,
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
      };
      requests.push(record);
      const queued = queues.get(route)?.shift();
      const reply = queued === undefined ? DEFAULTS[route](record) : typeof queued === 'function' ? queued(record) : queued;
      if (reply.delayMs) {
        const timer = setTimeout(() => send(res, reply), reply.delayMs);
        res.on('close', () => clearTimeout(timer));
        return;
      }
      send(res, reply);
    })().catch((err: unknown) => {
      send(res, { status: 500, body: { error: { message: `mock server failure: ${String(err)}` } } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    openaiBase: `${origin}/openai/v1`,
    anthropicBase: `${origin}/anthropic`,
    requests,
    relayed,
    requestsFor: (route) => requests.filter((r) => r.route === route),
    enqueue(route, ...replies) {
      queues.set(route, [...(queues.get(route) ?? []), ...replies]);
    },
    reset() {
      requests.length = 0;
      relayed.length = 0;
      queues.clear();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
