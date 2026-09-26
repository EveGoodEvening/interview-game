import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LlmSettings } from '../types';
import { resolveLlmConfig } from './config';
import { createChatProvider } from './index';
import { buildOpenAiBody, extractModelIds, isOpenAiReasoningModel, knownOutputCap, OPENAI_JSON_HINT, parseOutputTokenLimit } from './openai';
import { openAiCompletion, openAiError, OPENAI_KEY, startMockLlmServer, type MockLlmServer } from './testing/mockLlmServer';
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
beforeEach(() => server.reset());

function settings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    presetId: 'custom-openai',
    protocol: 'openai',
    baseUrl: server.openaiBase,
    apiKey: OPENAI_KEY,
    model: 'gpt-test',
    useProxy: false,
    jsonMode: true,
    effort: 'low',
    temperature: 0.7,
    ...overrides,
  };
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: 'You are Yuki, an HR interviewer.',
    messages: [{ role: 'user', content: '你好，我是小林。' }],
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

describe('openai provider — happy path', () => {
  it('sends a chat/completions request and returns text, model and usage', async () => {
    const provider = createChatProvider(settings());
    expect(provider.protocol).toBe('openai');
    const res = await provider.chat(request());

    expect(res).toEqual({
      text: 'OK',
      parsed: undefined,
      model: 'gpt-test',
      stopReason: 'stop',
      usage: { inputTokens: 42, outputTokens: 7, cacheReadTokens: 32 },
    });
    const [sent] = server.requestsFor('openai.chat');
    expect(sent.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(sent.headers['content-type']).toBe('application/json');
    expect(sent.headers['x-interview-proxy']).toBeUndefined();
    expect(sent.body).toEqual({
      model: 'gpt-test',
      stream: false,
      max_tokens: 4096,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You are Yuki, an HR interviewer.' },
        { role: 'user', content: '你好，我是小林。' },
      ],
    });
  });

  it('JSON mode: response_format + JSON hint, and validates into `parsed`', async () => {
    const res = await createChatProvider(settings()).chat(request({ jsonSchema: Answer, maxTokens: 900 }));
    expect(res.text).toBe('{"answer":"hello","score":7}');
    expect(res.parsed).toEqual({ answer: 'hello', score: 7 });
    const body = server.requestsFor('openai.chat')[0].body!;
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(900);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0].content).toBe(`You are Yuki, an HR interviewer.\n\n${OPENAI_JSON_HINT}`);
    expect(messages[0].content).toMatch(/JSON/);
  });

  it('jsonMode off: no response_format, still hints and parses', async () => {
    server.enqueue('openai.chat', { body: openAiCompletion('```json\n{"answer":"x","score":3}\n```') });
    const res = await createChatProvider(settings({ jsonMode: false })).chat(request({ jsonSchema: Answer }));
    expect(res.parsed).toEqual({ answer: 'x', score: 3 });
    const body = server.requestsFor('openai.chat')[0].body!;
    expect(body.response_format).toBeUndefined();
    expect((body.messages as { content: string }[])[0].content).toContain(OPENAI_JSON_HINT);
  });

  it('leaves `parsed` undefined when the JSON does not match the schema', async () => {
    server.enqueue('openai.chat', { body: openAiCompletion('{"answer":"x","score":42}') });
    const res = await createChatProvider(settings()).chat(request({ jsonSchema: Answer }));
    expect(res.text).toBe('{"answer":"x","score":42}');
    expect(res.parsed).toBeUndefined();
  });

  it('omits Authorization for keyless servers (Ollama)', async () => {
    await createChatProvider(settings({ presetId: 'ollama', apiKey: '' })).chat(request());
    expect(server.requestsFor('openai.chat')[0].headers.authorization).toBeUndefined();
  });

  it('keeps empty turns valid and omits an empty system prompt', async () => {
    await createChatProvider(settings()).chat(request({ system: '  ', messages: [{ role: 'user', content: '' }] }));
    expect(server.requestsFor('openai.chat')[0].body!.messages).toEqual([{ role: 'user', content: '…' }]);
  });

  it('accepts a pasted full endpoint URL', async () => {
    await createChatProvider(settings({ baseUrl: `${server.openaiBase}/chat/completions/` })).chat(request());
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
  });
});

describe('openai provider — reasoning models', () => {
  it('drops inline <think> blocks and ignores reasoning_content', async () => {
    server.enqueue('openai.chat', {
      body: openAiCompletion('<think>\nThe user wants {json}…\n</think>\n\n{"answer":"hi","score":5}', {
        message: { reasoning_content: 'long chain of thought' },
      }),
    });
    const res = await createChatProvider(settings()).chat(request({ jsonSchema: Answer }));
    expect(res.text).toBe('{"answer":"hi","score":5}');
    expect(res.parsed).toEqual({ answer: 'hi', score: 5 });
  });

  it('joins array content parts', async () => {
    server.enqueue('openai.chat', {
      body: openAiCompletion(null, { message: { content: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }] } }),
    });
    expect((await createChatProvider(settings()).chat(request())).text).toBe('Hello');
  });

  it('shapes requests for OpenAI reasoning models on api.openai.com', () => {
    const cfg = resolveLlmConfig(settings({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', effort: 'medium' }));
    const body = buildOpenAiBody(cfg, request({ maxTokens: 500 }));
    expect(body).toMatchObject({ max_completion_tokens: 500, reasoning_effort: 'medium' });
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(isOpenAiReasoningModel('openai/o4-mini')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-4.1-mini')).toBe(false);
    expect(isOpenAiReasoningModel('deepseek-reasoner')).toBe(false);
  });
});

describe('openai provider — compatibility fallbacks', () => {
  it('retries without response_format when the provider rejects it, and remembers', async () => {
    server.enqueue('openai.chat', {
      status: 400,
      body: openAiError("Invalid parameter: 'response_format' of type 'json_object' is not supported with this model.", {
        param: 'response_format',
      }),
    });
    const provider = createChatProvider(settings());
    const first = await provider.chat(request({ jsonSchema: Answer }));
    expect(first.text).toBe('OK');
    const [rejected, retried] = server.requestsFor('openai.chat');
    expect(rejected.body!.response_format).toEqual({ type: 'json_object' });
    expect(retried.body!.response_format).toBeUndefined();

    server.reset();
    await provider.chat(request({ jsonSchema: Answer }));
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
    expect(server.requestsFor('openai.chat')[0].body!.response_format).toBeUndefined();
  });

  it('drops response_format when a 400 names no parameter', async () => {
    server.enqueue('openai.chat', { status: 400, body: { error: { message: 'json mode unsupported' } } });
    await createChatProvider(settings()).chat(request({ jsonSchema: Answer }));
    expect(server.requestsFor('openai.chat').map((r) => r.body!.response_format)).toEqual([{ type: 'json_object' }, undefined]);
  });

  it('switches max_tokens → max_completion_tokens and drops temperature when blamed', async () => {
    server.enqueue(
      'openai.chat',
      {
        status: 400,
        body: openAiError("Unsupported parameter: 'max_tokens' is not supported with this model.", {
          param: 'max_tokens',
          code: 'unsupported_parameter',
        }),
      },
      {
        status: 400,
        body: openAiError("Unsupported value: 'temperature' does not support 0.7.", { param: 'temperature', code: 'unsupported_value' }),
      },
    );
    await createChatProvider(settings()).chat(request({ maxTokens: 300 }));
    const bodies = server.requestsFor('openai.chat').map((r) => r.body!);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toMatchObject({ max_completion_tokens: 300 });
    expect(bodies[2].max_tokens).toBeUndefined();
    expect(bodies[2].temperature).toBeUndefined();
  });

  it('does not retry a 400 it cannot fix', async () => {
    server.enqueue('openai.chat', {
      status: 400,
      body: openAiError("This model's maximum context length is 8192 tokens.", { param: 'messages', code: 'context_length_exceeded' }),
    });
    const err = await failure(createChatProvider(settings()).chat(request({ jsonSchema: Answer })));
    expect(err).toMatchObject({ code: 'bad_request', status: 400 });
    expect(err.detail).toContain('maximum context length');
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
  });
});

describe('openai provider — output token caps', () => {
  const DEEPSEEK_RANGE_400 = openAiError('Invalid max_tokens value, the valid range of max_tokens is [1, 8192]', { code: 'invalid_request_error' });

  it('a paramless "max_tokens out of range" 400 is retried within the named limit, JSON mode kept, and remembered', async () => {
    server.enqueue('openai.chat', { status: 400, body: DEEPSEEK_RANGE_400 });
    const provider = createChatProvider(settings());
    await provider.chat(request({ jsonSchema: Answer, maxTokens: 12000 }));
    await provider.chat(request({ jsonSchema: Answer, maxTokens: 12000 }));
    await provider.chat(request({ jsonSchema: Answer, maxTokens: 2000 }));
    const bodies = server.requestsFor('openai.chat').map((r) => r.body!);
    expect(bodies.map((b) => b.max_tokens)).toEqual([12000, 8192, 8192, 2000]);
    expect(bodies.map((b) => b.response_format)).toEqual(Array(4).fill({ type: 'json_object' }));
  });

  it('a truncated reply reports the budget that was actually sent', async () => {
    server.enqueue('openai.chat', { status: 400, body: DEEPSEEK_RANGE_400 }, { body: openAiCompletion('{"answer":"cut', { finish: 'length' }) });
    const err = await failure(createChatProvider(settings()).chat(request({ jsonSchema: Answer, maxTokens: 12000 })));
    expect(err.code).toBe('truncated');
    expect(err.message).toContain('8192');
  });

  it('a token-budget complaint with no usable limit is not "fixed" by dropping JSON mode', async () => {
    server.enqueue('openai.chat', { status: 400, body: openAiError('max_tokens is too large for this model') });
    const err = await failure(createChatProvider(settings()).chat(request({ jsonSchema: Answer, maxTokens: 12000 })));
    expect(err.code).toBe('bad_request');
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
  });

  it('known model caps are applied up front (legacy DeepSeek V3 names, GLM-4-Long)', () => {
    expect(knownOutputCap('deepseek-chat')).toBe(8192);
    expect(knownOutputCap('deepseek/deepseek-reasoner')).toBe(8192);
    expect(knownOutputCap('GLM-4-Long')).toBe(4096);
    expect(knownOutputCap('deepseek-flash')).toBeUndefined();
    expect(knownOutputCap('gpt-5-mini')).toBeUndefined();
    const cfg = resolveLlmConfig(settings({ model: 'deepseek-chat' }));
    expect(buildOpenAiBody(cfg, request({ maxTokens: 12000 })).max_tokens).toBe(8192);
    expect(buildOpenAiBody(cfg, request({ maxTokens: 3000 })).max_tokens).toBe(3000);
  });

  it.each([
    ['Invalid max_tokens value, the valid range of max_tokens is [1, 8192]', 12000, 8192],
    ['max_tokens is too large: 20000. This model supports at most 16384 completion tokens, whereas you provided 20000.', 20000, 16384],
    ['max_tokens: 20000 > 8192, which is the maximum allowed number of output tokens for glm', 20000, 8192],
    ['max_tokens must be less than or equal to `4096`', 6000, 4096],
    ['Range of max_tokens should be [1, 4096]', 6000, 4096],
    ["'max_tokens' or 'max_completion_tokens' is too large: 8000. This model's maximum context length is 8192 tokens and your request has 1000 input tokens (8000 > 8192 - 1000).", 8000, 7192],
  ])('parseOutputTokenLimit(%j)', (message, sent, limit) => {
    expect(parseOutputTokenLimit(message, sent)).toBe(limit);
  });

  it('parseOutputTokenLimit ignores limits that would not shrink the budget and unrelated messages', () => {
    expect(parseOutputTokenLimit('the valid range of max_tokens is [1, 8192]', 8192)).toBeUndefined();
    expect(parseOutputTokenLimit('temperature must be in [0, 1]', 12000)).toBeUndefined();
  });
});

describe('openai provider — temperature', () => {
  it('clamps to the provider range before sending (Kimi / GLM 0–1, DashScope below 2)', () => {
    const body = (baseUrl: string, model: string, temperature: number) =>
      buildOpenAiBody(resolveLlmConfig(settings({ baseUrl, model, temperature })), request()).temperature;
    expect(body('https://open.bigmodel.cn/api/paas/v4', 'glm-4.5-air', 1.2)).toBe(1);
    expect(body('https://api.z.ai/api/paas/v4', 'glm-4.6', 1.6)).toBe(1);
    expect(body('https://api.moonshot.cn/v1', 'moonshot-v1-8k', 1.5)).toBe(1);
    expect(body('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus', 2)).toBe(1.9);
    expect(body('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen-plus', 1.95)).toBe(1.9);
    expect(body('https://api.deepseek.com/v1', 'deepseek-flash', 1.5)).toBe(1.5);
    expect(body('https://api.deepseek.com/v1', 'deepseek-flash', 5)).toBe(2);
    expect(body('https://api.deepseek.com/v1', 'deepseek-flash', Number.NaN)).toBe(0.8);
  });

  it('fixed-temperature models get no temperature at all (current Kimi models, OpenAI reasoning models)', () => {
    for (const model of ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code', 'moonshotai/Kimi-K2.6']) {
      expect(buildOpenAiBody(resolveLlmConfig(settings({ baseUrl: 'https://api.moonshot.cn/v1', model })), request()).temperature, model).toBeUndefined();
    }
    expect(buildOpenAiBody(resolveLlmConfig(settings({ model: 'gpt-5-mini' })), request()).temperature).toBeUndefined();
  });

  it('a paramless 400 blaming the temperature drops the temperature (not JSON mode) and remembers', async () => {
    server.enqueue('openai.chat', { status: 400, body: openAiError('invalid temperature: only 1 is allowed for this model') });
    const provider = createChatProvider(settings({ temperature: 0.8 }));
    await provider.chat(request({ jsonSchema: Answer }));
    await provider.chat(request({ jsonSchema: Answer }));
    const bodies = server.requestsFor('openai.chat').map((r) => r.body!);
    expect(bodies.map((b) => b.temperature)).toEqual([0.8, undefined, undefined]);
    expect(bodies.map((b) => b.response_format)).toEqual(Array(3).fill({ type: 'json_object' }));
  });
});

describe('openai provider — unknown model', () => {
  it('a 400 "model does not exist" is reported as not_found with the Fetch models hint, without a JSON-mode retry', async () => {
    server.enqueue('openai.chat', { status: 400, body: openAiError('Model Not Exist', { code: 'invalid_request_error' }) });
    const err = await failure(createChatProvider(settings({ model: 'deepseek-chat' })).chat(request({ jsonSchema: Answer })));
    expect(err).toMatchObject({ code: 'not_found', status: 400, detail: 'Model Not Exist' });
    expect(err.message).toContain('Fetch models');
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
  });

  it('a 404 with code model_not_found gets the same hint', async () => {
    server.enqueue('openai.chat', {
      status: 404,
      body: openAiError('The model `gpt-4.1-x` does not exist or you do not have access to it.', { code: 'model_not_found' }),
    });
    const err = await failure(createChatProvider(settings()).chat(request()));
    expect(err).toMatchObject({ code: 'not_found', status: 404 });
    expect(err.message).toContain('Fetch models');
  });
});

describe('openai provider — errors', () => {
  it('401 → auth with the provider message as detail', async () => {
    const err = await failure(createChatProvider(settings({ apiKey: 'sk-wrong' })).chat(request()));
    expect(err).toMatchObject({ code: 'auth', status: 401, detail: 'Incorrect API key provided.' });
    expect(err.message).toContain('401');
  });

  it('403 → auth', async () => {
    server.enqueue('openai.chat', { status: 403, body: openAiError('Country, region, or territory not supported', { code: 'unsupported_country_region_territory' }) });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('auth');
  });

  it('404 → not_found', async () => {
    const err = await failure(createChatProvider(settings({ model: 'missing-model' })).chat(request()));
    expect(err).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('429 → rate_limit after one retry', async () => {
    const limited = { status: 429, headers: FAST_RETRY, body: openAiError('Rate limit reached for requests', { type: 'requests', code: 'rate_limit_exceeded' }) };
    server.enqueue('openai.chat', limited, limited);
    const err = await failure(createChatProvider(settings()).chat(request()));
    expect(err).toMatchObject({ code: 'rate_limit', status: 429 });
    expect(server.requestsFor('openai.chat')).toHaveLength(2);
  });

  it('500 → server after one retry; a transient 503 recovers', async () => {
    const boom = { status: 500, headers: FAST_RETRY, body: openAiError('The server had an error while processing your request.', { type: 'server_error' }) };
    server.enqueue('openai.chat', boom, boom);
    expect(await failure(createChatProvider(settings()).chat(request()))).toMatchObject({ code: 'server', status: 500 });
    expect(server.requestsFor('openai.chat')).toHaveLength(2);

    server.reset();
    server.enqueue('openai.chat', { status: 503, headers: FAST_RETRY, body: 'upstream overloaded' });
    expect((await createChatProvider(settings()).chat(request())).text).toBe('OK');
  });

  it('honours x-should-retry: false', async () => {
    server.enqueue('openai.chat', { status: 500, headers: { 'x-should-retry': 'false' }, body: openAiError('nope', { type: 'server_error' }) });
    await failure(createChatProvider(settings()).chat(request()));
    expect(server.requestsFor('openai.chat')).toHaveLength(1);
  });

  it('HTTP 200 carrying an error object (gateway style)', async () => {
    server.enqueue('openai.chat', { body: { error: { code: 429, message: 'Provider returned error: rate limited upstream' } } });
    const err = await failure(createChatProvider(settings()).chat(request()));
    expect(err).toMatchObject({ code: 'rate_limit', detail: 'Provider returned error: rate limited upstream' });
  });

  it('moderation blocks → refusal', async () => {
    server.enqueue('openai.chat', { status: 400, body: { code: 'data_inspection_failed', message: 'Input data may contain inappropriate content.', request_id: 'r1' } });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('refusal');
  });

  it('finish_reason length → truncated; content_filter / refusal → refusal', async () => {
    server.enqueue('openai.chat', { body: openAiCompletion('{"answer":"cut', { finish: 'length' }) });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('truncated');

    server.enqueue('openai.chat', { body: openAiCompletion('', { finish: 'content_filter' }) });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('refusal');

    server.enqueue('openai.chat', { body: openAiCompletion(null, { message: { refusal: "I'm sorry, I can't help with that." } }) });
    const refusal = await failure(createChatProvider(settings()).chat(request()));
    expect(refusal).toMatchObject({ code: 'refusal', detail: "I'm sorry, I can't help with that." });
  });

  it('empty reply → parse', async () => {
    server.enqueue('openai.chat', { body: openAiCompletion('   ') });
    expect((await failure(createChatProvider(settings()).chat(request()))).code).toBe('parse');
  });

  it('rejects an empty message list without a request', async () => {
    expect((await failure(createChatProvider(settings()).chat(request({ messages: [] })))).code).toBe('bad_request');
    expect(server.requests).toHaveLength(0);
  });

  it('a non-JSON 200 (wrong base URL) → parse with a hint', async () => {
    server.enqueue('openai.chat', { body: '<!doctype html><title>Welcome</title>' });
    const err = await failure(createChatProvider(settings()).chat(request()));
    expect(err.code).toBe('parse');
    expect(err.message).toContain('base URL');
  });

  it('unreachable host → network with a CORS / relay hint', async () => {
    const err = await failure(createChatProvider(settings({ baseUrl: 'http://127.0.0.1:1/v1' })).chat(request()));
    expect(err.code).toBe('network');
    expect(err.message).toContain('http://127.0.0.1:1');
    expect(err.message).toContain('relay');
  });
});

describe('openai provider — abort & timeout', () => {
  it('caller abort → aborted', async () => {
    server.enqueue('openai.chat', { delayMs: 3000, body: openAiCompletion('late') });
    const ctrl = new AbortController();
    const pending = createChatProvider(settings()).chat(request({ signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 50);
    expect((await failure(pending)).code).toBe('aborted');
  });

  it('an already-aborted signal fails fast without a retry', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const started = Date.now();
    expect((await failure(createChatProvider(settings()).chat(request({ signal: ctrl.signal })))).code).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('timeoutMs → timeout', async () => {
    server.enqueue('openai.chat', { delayMs: 3000, body: openAiCompletion('late') });
    const started = Date.now();
    const err = await failure(createChatProvider(settings()).chat(request({ timeoutMs: 150 })));
    expect(err.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('the timeout also bounds retry back-off', async () => {
    server.enqueue('openai.chat', { status: 429, headers: { 'retry-after': '5' }, body: openAiError('slow down') });
    const err = await failure(createChatProvider(settings()).chat(request({ timeoutMs: 200 })));
    expect(err.code).toBe('timeout');
  });
});

describe('extractModelIds', () => {
  it('handles OpenAI, Ollama and bare-array shapes, sorted and de-duplicated', () => {
    expect(extractModelIds({ object: 'list', data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
    expect(extractModelIds({ models: [{ name: 'qwen2.5:7b' }, { model: 'llama3.1:8b' }] })).toEqual(['llama3.1:8b', 'qwen2.5:7b']);
    expect(extractModelIds(['x', { id: 'y' }, 3, null])).toEqual(['x', 'y']);
    expect(extractModelIds({ nothing: true })).toEqual([]);
  });
});
