import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useSettingsStore } from '../store/settings';
import type { LlmSettings } from '../types';
import { DIMENSION_VALUES, EXPRESSION_VALUES, PlanSchema, ReportSchema, TURN_OUTPUT_KINDS, TurnSchema } from '../ai/schemas';
import { isOfficialAnthropic, REFUSAL_FALLBACK_BETA, supportsEffort, supportsRefusalFallback, withHistoryBreakpoint } from './anthropic';
import { createChatProvider } from './index';
import { ANTHROPIC_KEY, claudeError, claudeMessage, startMockLlmServer, type MockLlmServer } from './testing/mockLlmServer';
import { outputFormatFor, toStructuredOutputSchema } from './structuredOutput';
import { LlmError, type ChatRequest } from './types';

const Answer = z.object({ answer: z.string(), score: z.number().min(0).max(10) });
const FAST_RETRY = { 'retry-after-ms': '1' };

let server: MockLlmServer;

beforeAll(async () => {
  server = await startMockLlmServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  server.reset();
  useSettingsStore.setState({ proxyAvailable: null });
});
afterEach(() => vi.unstubAllGlobals());

function settings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    presetId: 'custom-anthropic',
    protocol: 'anthropic',
    baseUrl: server.anthropicBase,
    apiKey: ANTHROPIC_KEY,
    model: 'claude-opus-5',
    useProxy: false,
    jsonMode: true,
    effort: 'low',
    temperature: 0.7,
    ...overrides,
  };
}

/** Settings for the official endpoint, reached through the mock "relay" on the test server. */
function officialViaRelay(overrides: Partial<LlmSettings> = {}): LlmSettings {
  vi.stubGlobal('location', { origin: server.origin });
  useSettingsStore.setState({ proxyAvailable: true });
  return settings({ presetId: 'anthropic', baseUrl: 'https://api.anthropic.com', useProxy: true, ...overrides });
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: 'You are Ethan, a calm technical director.',
    messages: [
      { role: 'user', content: 'Hi, I am ready.' },
      { role: 'assistant', content: 'Great. Tell me about your last project.' },
      { role: 'user', content: 'I built a payments service handling 2k QPS.' },
    ],
    purpose: 'turn',
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err as LlmError;
  }
  throw new Error('expected the promise to reject');
}

describe('anthropic provider — requests', () => {
  it('sends a Messages API request with a cached system block and effort, returns text + usage', async () => {
    const provider = createChatProvider(settings());
    expect(provider.protocol).toBe('anthropic');
    const res = await provider.chat(request({ maxTokens: 2000 }));
    expect(res).toEqual({
      text: 'OK',
      parsed: undefined,
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 120, outputTokens: 9, cacheReadTokens: 2048 },
    });

    const [sent] = server.requestsFor('anthropic.messages');
    expect(sent.url).toBe('/anthropic/v1/messages');
    expect(sent.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    expect(sent.headers['anthropic-version']).toBeDefined();
    expect(sent.headers['anthropic-beta']).toBeUndefined();
    expect(sent.headers['x-interview-proxy']).toBeUndefined();
    expect(sent.body).toEqual({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: [{ type: 'text', text: 'You are Ethan, a calm technical director.', cache_control: { type: 'ephemeral' } }],
      // Second cache breakpoint on the last assistant message; the latest user message stays plain.
      messages: [
        { role: 'user', content: 'Hi, I am ready.' },
        { role: 'assistant', content: [{ type: 'text', text: 'Great. Tell me about your last project.', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: 'I built a payments service handling 2k QPS.' },
      ],
      output_config: { effort: 'low' },
    });
    // Claude's own sampling / thinking defaults apply.
    for (const key of ['temperature', 'thinking', 'top_p', 'fallbacks']) expect(sent.body).not.toHaveProperty(key);
  });

  it('JSON mode: structured output format from the zod schema, validated into `parsed`', async () => {
    const res = await createChatProvider(settings({ effort: 'medium' })).chat(request({ jsonSchema: Answer }));
    expect(res.text).toBe('{"answer":"hello","score":7}');
    expect(res.parsed).toEqual({ answer: 'hello', score: 7 });

    const config = server.requestsFor('anthropic.messages')[0].body!.output_config as {
      effort: string;
      format: { type: string; schema: { type: string; properties: Record<string, unknown>; required: string[] } };
    };
    expect(config.effort).toBe('medium');
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema.type).toBe('object');
    expect(Object.keys(config.format.schema.properties)).toEqual(['answer', 'score']);
    expect(config.format.schema.required).toEqual(['answer', 'score']);
  });

  it('JSON mode: the wire schema keeps enums and closes every object (no SDK description-only enums)', async () => {
    const provider = createChatProvider(settings());
    server.enqueue('anthropic.messages', { body: claudeMessage('{}') }, { body: claudeMessage('{}') }, { body: claudeMessage('{}') });
    await provider.chat(request({ jsonSchema: TurnSchema }));
    await provider.chat(request({ jsonSchema: ReportSchema }));
    await provider.chat(request({ jsonSchema: PlanSchema }));
    type Node = Record<string, unknown> & { properties: Record<string, Node>; items: Node };
    const [turn, report, plan] = server
      .requestsFor('anthropic.messages')
      .map((r) => (r.body!.output_config as { format: { type: string; schema: Node } }).format);
    expect(turn.type).toBe('json_schema');
    expect(turn.schema.properties.kind.enum).toEqual([...TURN_OUTPUT_KINDS]);
    expect(turn.schema.properties.expression.enum).toEqual([...EXPRESSION_VALUES]);
    expect(report.schema.properties.dimensions.items.properties.key.enum).toEqual([...DIMENSION_VALUES]);
    expect(plan.schema.properties.opening.properties.expression.enum).toEqual([...EXPRESSION_VALUES]);

    for (const { schema } of [turn, report, plan]) {
      const text = JSON.stringify(schema);
      expect(text).not.toContain('$schema');
      expect(text).not.toContain('$ref');
      expect(text).not.toContain('{enum:'); // the SDK helper's description-text fallback
      // Every object node is closed.
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.type === 'object') expect(n.additionalProperties).toBe(false);
        Object.values(n).forEach(walk);
      };
      walk(schema);
    }
  });

  it('jsonMode off → no format; `parsed` still filled when the text validates', async () => {
    server.enqueue('anthropic.messages', { body: claudeMessage('{"answer":"a","score":1}') });
    const res = await createChatProvider(settings({ jsonMode: false })).chat(request({ jsonSchema: Answer }));
    expect(res.parsed).toEqual({ answer: 'a', score: 1 });
    expect(server.requestsFor('anthropic.messages')[0].body!.output_config).toEqual({ effort: 'low' });
  });

  it('a schema with no JSON Schema form falls back to prompt-only JSON', async () => {
    const Weird = z.object({ at: z.date() });
    await createChatProvider(settings()).chat(request({ jsonSchema: Weird }));
    expect(server.requestsFor('anthropic.messages')[0].body!.output_config).toEqual({ effort: 'low' });
  });

  it('does not send effort to models that reject it (Haiku)', async () => {
    await createChatProvider(settings({ model: 'claude-haiku-4-5' })).chat(request());
    await createChatProvider(settings({ model: 'claude-haiku-4-5' })).chat(request({ jsonSchema: Answer }));
    const [plain, json] = server.requestsFor('anthropic.messages');
    expect(plain.body).not.toHaveProperty('output_config');
    expect(json.body!.output_config).toEqual({ format: expect.objectContaining({ type: 'json_schema' }) });
  });

  it('omits an empty system prompt, keeps empty turns valid, and strips a pasted /v1', async () => {
    await createChatProvider(settings({ baseUrl: `${server.anthropicBase}/v1/` })).chat(
      request({ system: '', messages: [{ role: 'user', content: '  ' }] }),
    );
    const [sent] = server.requestsFor('anthropic.messages');
    expect(sent.url).toBe('/anthropic/v1/messages');
    expect(sent.body).not.toHaveProperty('system');
    expect(sent.body!.messages).toEqual([{ role: 'user', content: '…' }]);
  });

  it('tolerates minimal replies from compatible servers (no usage / model)', async () => {
    server.enqueue('anthropic.messages', { body: { type: 'message', role: 'assistant', content: [{ type: 'text', text: '好的' }], stop_reason: 'end_turn' } });
    const res = await createChatProvider(settings({ model: 'deepseek-chat' })).chat(request());
    expect(res).toEqual({ text: '好的', parsed: undefined, model: 'deepseek-chat', stopReason: 'end_turn', usage: undefined });
  });

  it('skips thinking / fallback marker blocks in the reply', async () => {
    server.enqueue('anthropic.messages', {
      body: claudeMessage(null, {
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'there' },
        ],
      }),
    });
    expect((await createChatProvider(settings()).chat(request())).text).toBe('Hello there');
  });
});

describe('anthropic provider — prompt caching', () => {
  it('marks only the system block and the last assistant message; the latest user turn stays uncached', async () => {
    const messages = [
      { role: 'user' as const, content: 'Intro' },
      { role: 'assistant' as const, content: 'Q1' },
      { role: 'user' as const, content: 'A1' },
      { role: 'assistant' as const, content: 'Q2' },
      { role: 'user' as const, content: 'A2 (full, with per-turn instructions)' },
    ];
    await createChatProvider(settings()).chat(request({ messages }));
    const body = server.requestsFor('anthropic.messages')[0].body!;
    expect(body.messages).toEqual([
      { role: 'user', content: 'Intro' },
      { role: 'assistant', content: 'Q1' },
      { role: 'user', content: 'A1' },
      { role: 'assistant', content: [{ type: 'text', text: 'Q2', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'A2 (full, with per-turn instructions)' },
    ]);
    const breakpoints = JSON.stringify(body).match(/cache_control/g) ?? [];
    expect(breakpoints).toHaveLength(2); // of the 4 allowed
  });

  it('the breakpoint moves forward with the history (the previous one stays a byte-identical prefix)', () => {
    const turn1 = withHistoryBreakpoint([
      { role: 'user', content: 'Intro' },
      { role: 'assistant', content: 'Q1' },
      { role: 'user', content: 'A1' },
    ]);
    const turn2 = withHistoryBreakpoint([
      { role: 'user', content: 'Intro' },
      { role: 'assistant', content: 'Q1' },
      { role: 'user', content: 'A1' },
      { role: 'assistant', content: 'Q2' },
      { role: 'user', content: 'A2' },
    ]);
    expect(turn1[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Q1', cache_control: { type: 'ephemeral' } }] });
    expect(turn2[1]).toEqual({ role: 'assistant', content: 'Q1' });
    expect(turn2[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Q2', cache_control: { type: 'ephemeral' } }] });
  });

  it('no message breakpoint for a single message or when the second-to-last turn is not the assistant', () => {
    const single = [{ role: 'user' as const, content: 'Plan this interview' }];
    expect(withHistoryBreakpoint(single)).toEqual(single);
    const odd = [
      { role: 'user' as const, content: 'a' },
      { role: 'user' as const, content: 'b' },
      { role: 'user' as const, content: 'c' },
    ];
    expect(withHistoryBreakpoint(odd)).toEqual(odd);
  });
});

describe('anthropic structured-output schema', () => {
  it('builds the wire format with z.toJSONSchema: enums kept, constraints stripped, objects closed', () => {
    const format = outputFormatFor(Answer);
    expect(format).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' }, score: { type: 'number' } },
        required: ['answer', 'score'],
        additionalProperties: false,
      },
    });
    // Cached per schema.
    expect(outputFormatFor(Answer)).toBe(format);
    expect(outputFormatFor(z.object({ at: z.date() }))).toBeNull();
  });

  it('toStructuredOutputSchema walks nested nodes', () => {
    const schema = toStructuredOutputSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        list: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 9 } } } },
        one: { type: 'array', minItems: 1, items: { type: 'string', minLength: 2, pattern: '^a', format: 'email' } },
        loose: { type: 'object', additionalProperties: {} },
        pick: { oneOf: [{ type: 'object', properties: { k: { const: 'a' } } }, { type: 'string', format: 'color' }] },
      },
    });
    expect(schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        list: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' } } } },
        one: { type: 'array', minItems: 1, items: { type: 'string', format: 'email' } },
        loose: { type: 'object', additionalProperties: false },
        pick: { anyOf: [{ type: 'object', additionalProperties: false, properties: { k: { const: 'a' } } }, { type: 'string' }] },
      },
    });
  });
});

describe('anthropic provider — official endpoint', () => {
  it('Opus 5 opts into server-side refusal fallbacks (beta) and goes through the relay', async () => {
    server.enqueue('anthropic.messages', {
      body: claudeMessage(null, {
        model: 'claude-opus-4-8',
        content: [
          { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal', category: 'cyber' } },
          { type: 'text', text: 'Rescued answer' },
        ],
      }),
    });
    const res = await createChatProvider(officialViaRelay()).chat(request({ jsonSchema: Answer }));
    expect(res).toMatchObject({ text: 'Rescued answer', model: 'claude-opus-4-8' });

    const [sent] = server.requestsFor('anthropic.messages');
    expect(sent.url).toBe('/api/proxy/https/api.anthropic.com/v1/messages?beta=true');
    expect(sent.headers['x-interview-proxy']).toBe('1');
    expect(String(sent.headers['anthropic-beta'])).toContain(REFUSAL_FALLBACK_BETA);
    expect(sent.body).toMatchObject({
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
    });
    expect(sent.body).not.toHaveProperty('betas');
  });

  it('other official models use the stable endpoint without fallbacks', async () => {
    await createChatProvider(officialViaRelay({ model: 'claude-sonnet-5' })).chat(request());
    const [sent] = server.requestsFor('anthropic.messages');
    expect(sent.url).toBe('/api/proxy/https/api.anthropic.com/v1/messages');
    expect(sent.headers['anthropic-beta']).toBeUndefined();
    expect(sent.body).not.toHaveProperty('fallbacks');
  });

  it('a rejected schema is retried without the format but keeps effort, and is not remembered', async () => {
    server.enqueue('anthropic.messages', {
      status: 400,
      body: claudeError('invalid_request_error', 'output_config.format.schema: Schema is too complex for compilation.'),
    });
    const provider = createChatProvider(officialViaRelay({ model: 'claude-sonnet-5' }));
    await provider.chat(request({ jsonSchema: Answer }));
    await provider.chat(request({ jsonSchema: Answer }));
    const configs = server.requestsFor('anthropic.messages').map((r) => r.body!.output_config as Record<string, unknown>);
    expect(configs).toHaveLength(3);
    expect(configs[0]).toHaveProperty('format');
    expect(configs[1]).toEqual({ effort: 'low' });
    expect(configs[2]).toHaveProperty('format');
  });

  it('if the fallbacks opt-in itself is rejected, retries without it and stops sending it', async () => {
    server.enqueue('anthropic.messages', { status: 400, body: claudeError('invalid_request_error', 'fallbacks: not available for this organization') });
    const provider = createChatProvider(officialViaRelay());
    await provider.chat(request());
    await provider.chat(request());
    const sent = server.requestsFor('anthropic.messages');
    expect(sent.map((r) => r.body!.fallbacks)).toEqual(['default', undefined, undefined]);
    expect(sent.map((r) => r.url.endsWith('?beta=true'))).toEqual([true, false, false]);
    expect(sent.map((r) => r.body!.output_config)).toEqual([{ effort: 'low' }, { effort: 'low' }, { effort: 'low' }]);
  });

  it('goes direct when the relay was found missing — even for a provider created before detection finished', async () => {
    vi.stubGlobal('location', { origin: server.origin });
    useSettingsStore.setState({ proxyAvailable: null });
    const provider = createChatProvider(settings({ useProxy: true }));
    await provider.chat(request());
    useSettingsStore.setState({ proxyAvailable: false });
    await provider.chat(request());
    expect(server.requestsFor('anthropic.messages')).toHaveLength(2);
    // Only the first request went through the (real) relay.
    expect(server.relayed).toEqual([expect.stringMatching(/^\/api\/proxy\/http\/127\.0\.0\.1:\d+\/anthropic\/v1\/messages$/)]);
  });

  it('capability helpers', () => {
    expect(isOfficialAnthropic('https://api.anthropic.com')).toBe(true);
    expect(isOfficialAnthropic('https://api.anthropic.com.evil.test')).toBe(false);
    expect(isOfficialAnthropic('https://api.deepseek.com/anthropic')).toBe(false);
    expect(supportsRefusalFallback('claude-opus-5')).toBe(true);
    expect(supportsRefusalFallback('claude-opus-5-5')).toBe(true);
    expect(supportsRefusalFallback('claude-fable-5-1')).toBe(true);
    expect(supportsRefusalFallback('claude-sonnet-5')).toBe(false);
    expect(supportsRefusalFallback('claude-opus-4-8')).toBe(false);
    expect(supportsEffort('claude-opus-5')).toBe(true);
    expect(supportsEffort('claude-sonnet-5')).toBe(true);
    expect(supportsEffort('claude-opus-4-5')).toBe(true);
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
    expect(supportsEffort('claude-sonnet-4-5')).toBe(false);
    expect(supportsEffort('claude-3-7-sonnet-latest')).toBe(false);
  });
});

describe('anthropic provider — third-party output_config fallback', () => {
  it('retries once without output_config on a 400 and stops sending it', async () => {
    server.enqueue('anthropic.messages', { status: 400, body: claudeError('invalid_request_error', 'output_config: Extra inputs are not permitted') });
    const provider = createChatProvider(settings());
    const res = await provider.chat(request({ jsonSchema: Answer }));
    expect(res.text).toBe('OK');
    const [rejected, retried] = server.requestsFor('anthropic.messages');
    expect(rejected.body).toHaveProperty('output_config');
    expect(retried.body).not.toHaveProperty('output_config');
    expect(retried.body).toHaveProperty('system');

    server.reset();
    await provider.chat(request({ jsonSchema: Answer }));
    expect(server.requestsFor('anthropic.messages')).toHaveLength(1);
    expect(server.requestsFor('anthropic.messages')[0].body).not.toHaveProperty('output_config');
  });

  it('an unknown model id is reported (with the Fetch models hint), not retried without output_config', async () => {
    server.enqueue('anthropic.messages', { status: 400, body: claudeError('invalid_request_error', 'Model Not Exist') });
    const provider = createChatProvider(settings({ model: 'deepseek-chat' }));
    const err = await failure(provider.chat(request({ jsonSchema: Answer })));
    expect(err).toMatchObject({ code: 'not_found', status: 400, detail: 'Model Not Exist' });
    expect(err.message).toContain('Fetch models');
    expect(server.requestsFor('anthropic.messages')).toHaveLength(1);
    // output_config is still considered supported.
    await provider.chat(request({ jsonSchema: Answer }));
    expect(server.requestsFor('anthropic.messages')[1].body).toHaveProperty('output_config');
  });

  it('a 400 that persists without output_config is reported as bad_request', async () => {
    const bad = { status: 400, body: claudeError('invalid_request_error', 'messages: roles must alternate') };
    server.enqueue('anthropic.messages', bad, bad);
    const provider = createChatProvider(settings());
    const err = await failure(provider.chat(request()));
    expect(err).toMatchObject({ code: 'bad_request', status: 400, detail: 'messages: roles must alternate' });
    expect(server.requestsFor('anthropic.messages')).toHaveLength(2);
  });
});

describe('anthropic provider — stop reasons', () => {
  it('refusal → LlmError("refusal") with the explanation', async () => {
    server.enqueue('anthropic.messages', {
      body: claudeMessage(null, {
        stop: 'refusal',
        stopDetails: { type: 'refusal', category: 'cyber', explanation: 'This request was declined by a safety classifier.' },
      }),
    });
    const err = await failure(createChatProvider(settings()).chat(request()));
    expect(err).toMatchObject({ code: 'refusal', detail: 'This request was declined by a safety classifier.' });
    expect(err.message).toContain('cyber');
  });

  it('max_tokens → truncated (even with partial text)', async () => {
    server.enqueue('anthropic.messages', { body: claudeMessage('{"answer":"cut', { stop: 'max_tokens' }) });
    const err = await failure(createChatProvider(settings()).chat(request({ jsonSchema: Answer, maxTokens: 50 })));
    expect(err.code).toBe('truncated');
    expect(err.message).toContain('50');
  });

  it('empty reply → parse', async () => {
    server.enqueue('anthropic.messages', { body: claudeMessage(null) });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('parse');
  });

  it('rejects unusable message lists without a request', async () => {
    const provider = createChatProvider(settings());
    expect((await failure(provider.chat(request({ messages: [] })))).code).toBe('bad_request');
    expect((await failure(provider.chat(request({ messages: [{ role: 'assistant', content: 'Hi' }] })))).code).toBe('bad_request');
    expect(server.requests).toHaveLength(0);
  });
});

describe('anthropic provider — errors (SDK error classes)', () => {
  it('401 → auth with request id in detail', async () => {
    const err = await failure(createChatProvider(settings({ apiKey: 'sk-ant-wrong' })).chat(request()));
    expect(err).toMatchObject({ code: 'auth', status: 401 });
    expect(err.detail).toBe('invalid x-api-key (request id: req_auth_01)');
    expect(server.requestsFor('anthropic.messages')).toHaveLength(1); // not retried
  });

  it('403 → auth', async () => {
    server.enqueue('anthropic.messages', { status: 403, body: claudeError('permission_error', 'Your API key does not have permission to use the specified resource.') });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('auth');
  });

  it('404 → not_found', async () => {
    const err = await failure(createChatProvider(settings({ model: 'missing-model' })).chat(request()));
    expect(err).toMatchObject({ code: 'not_found', status: 404, detail: 'model: missing-model' });
  });

  it('429 → rate_limit after the SDK retry', async () => {
    const limited = { status: 429, headers: FAST_RETRY, body: claudeError('rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit') };
    server.enqueue('anthropic.messages', limited, limited);
    expect(await failure(createChatProvider(settings()).chat(request()))).toMatchObject({ code: 'rate_limit', status: 429 });
    expect(server.requestsFor('anthropic.messages')).toHaveLength(2);
  });

  it('500 / 529 → server', async () => {
    const boom = { status: 500, headers: FAST_RETRY, body: claudeError('api_error', 'Internal server error') };
    server.enqueue('anthropic.messages', boom, boom);
    expect(await failure(createChatProvider(settings()).chat(request()))).toMatchObject({ code: 'server', status: 500 });

    const overloaded = { status: 529, headers: FAST_RETRY, body: claudeError('overloaded_error', 'Overloaded') };
    server.enqueue('anthropic.messages', overloaded, overloaded);
    expect(await failure(createChatProvider(settings()).chat(request()))).toMatchObject({ code: 'server', status: 529 });
  });

  it('a transient 500 recovers through the SDK retry', async () => {
    server.enqueue('anthropic.messages', { status: 500, headers: FAST_RETRY, body: claudeError('api_error', 'Internal server error') });
    expect((await createChatProvider(settings()).chat(request())).text).toBe('OK');
  });

  it('unreachable host → network', async () => {
    const err = await failure(createChatProvider(settings({ baseUrl: 'http://127.0.0.1:1' })).chat(request()));
    expect(err.code).toBe('network');
    expect(err.message).toContain('CORS');
  });
});

describe('anthropic provider — abort & timeout', () => {
  it('caller abort → aborted', async () => {
    server.enqueue('anthropic.messages', { delayMs: 3000, body: claudeMessage('late') });
    const ctrl = new AbortController();
    const pending = createChatProvider(settings()).chat(request({ signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 50);
    expect((await failure(pending)).code).toBe('aborted');
  });

  it('pre-aborted signal → aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect((await failure(createChatProvider(settings()).chat(request({ signal: ctrl.signal })))).code).toBe('aborted');
  });

  it('timeoutMs → timeout (no SDK retry past the deadline)', async () => {
    server.enqueue('anthropic.messages', { delayMs: 3000, body: claudeMessage('late') }, { delayMs: 3000, body: claudeMessage('late') });
    const started = Date.now();
    const err = await failure(createChatProvider(settings()).chat(request({ timeoutMs: 200 })));
    expect(err.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
