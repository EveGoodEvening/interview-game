import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../store/settings';
import type { LlmSettings } from '../types';
import {
  createChatProvider,
  effectiveUseProxy,
  getLlmConfigIssue,
  isLlmConfigured,
  listModels,
  LlmError,
  normalizeBaseUrl,
  testLlmConnection,
} from './index';
import { ANTHROPIC_KEY, claudeMessage, OPENAI_KEY, openAiCompletion, startMockLlmServer, type MockLlmServer } from './testing/mockLlmServer';

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

function openai(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    presetId: 'custom-openai',
    protocol: 'openai',
    baseUrl: server.openaiBase,
    apiKey: OPENAI_KEY,
    model: 'gpt-test',
    useProxy: false,
    jsonMode: true,
    effort: 'low',
    temperature: 0.8,
    ...overrides,
  };
}

function anthropic(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return openai({ presetId: 'custom-anthropic', protocol: 'anthropic', baseUrl: server.anthropicBase, apiKey: ANTHROPIC_KEY, model: 'claude-opus-5', ...overrides });
}

function configError(fn: () => unknown): LlmError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('config');
    return err as LlmError;
  }
  throw new Error('expected a config error');
}

describe('createChatProvider — configuration', () => {
  it('rejects the demo protocol and incomplete settings with LlmError("config")', () => {
    expect(configError(() => createChatProvider(openai({ presetId: 'demo', protocol: 'demo' }))).detail).toBe('demo');
    expect(configError(() => createChatProvider(openai({ baseUrl: '  ' }))).detail).toBe('missing_base_url');
    expect(configError(() => createChatProvider(openai({ baseUrl: 'api.openai.com/v1' }))).detail).toBe('invalid_base_url');
    expect(configError(() => createChatProvider(openai({ baseUrl: 'ftp://x.com' }))).detail).toBe('invalid_base_url');
    expect(configError(() => createChatProvider(openai({ presetId: 'deepseek', apiKey: '' }))).detail).toBe('missing_key');
    expect(configError(() => createChatProvider(anthropic({ apiKey: ' ' }))).detail).toBe('missing_key');
    expect(configError(() => createChatProvider(openai({ model: '' }))).detail).toBe('missing_model');
  });

  it('accepts keyless OpenAI-compatible servers', () => {
    expect(createChatProvider(openai({ presetId: 'ollama', apiKey: '' })).protocol).toBe('openai');
    expect(createChatProvider(openai({ presetId: 'custom-openai', apiKey: '' })).protocol).toBe('openai');
    expect(createChatProvider(anthropic()).protocol).toBe('anthropic');
  });

  it('exposes the config checks for the UI', () => {
    expect(getLlmConfigIssue(openai())).toBeNull();
    expect(getLlmConfigIssue(openai({ model: '' }), { requireModel: false })).toBeNull();
    expect(isLlmConfigured(openai())).toBe(true);
    expect(isLlmConfigured(openai({ protocol: 'demo' }))).toBe(false);
  });

  it('normalises pasted base URLs per protocol', () => {
    expect(normalizeBaseUrl('anthropic', 'https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com');
    expect(normalizeBaseUrl('anthropic', 'https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com');
    expect(normalizeBaseUrl('anthropic', 'https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic');
    expect(normalizeBaseUrl('openai', ' https://api.x.com/v1/chat/completions ')).toBe('https://api.x.com/v1');
    expect(normalizeBaseUrl('openai', 'https://api.x.com/v1//')).toBe('https://api.x.com/v1');
  });
});

describe('effectiveUseProxy', () => {
  it('follows settings.useProxy && proxyAvailable !== false', () => {
    useSettingsStore.setState({ proxyAvailable: null });
    expect(effectiveUseProxy(true)).toBe(true);
    useSettingsStore.setState({ proxyAvailable: true });
    expect(effectiveUseProxy(true)).toBe(true);
    expect(effectiveUseProxy(false)).toBe(false);
    useSettingsStore.setState({ proxyAvailable: false });
    expect(effectiveUseProxy(true)).toBe(false);
  });
});

describe('testLlmConnection', () => {
  it('demo needs no connection', async () => {
    await expect(testLlmConnection(openai({ protocol: 'demo' }))).resolves.toMatchObject({ ok: true, latencyMs: 0 });
  });

  it.each([
    ['openai', openai],
    ['anthropic', anthropic],
  ] as const)('%s: reports the reply, model and latency', async (_name, make) => {
    const res = await testLlmConnection(make());
    expect(res.ok).toBe(true);
    expect(res.message).toBe('OK');
    expect(res.model).toBeTruthy();
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    const sent = server.requests[0];
    expect(JSON.stringify(sent.body)).toContain('OK');
    expect(sent.body!.max_tokens).toBe(256);
  });

  it('never throws: auth, config and network failures become results', async () => {
    const auth = await testLlmConnection(anthropic({ apiKey: 'sk-ant-wrong' }));
    expect(auth).toMatchObject({ ok: false, code: 'auth' });
    expect(auth.message).toContain('401');
    expect(auth.detail).toContain('invalid x-api-key');

    await expect(testLlmConnection(openai({ model: '' }))).resolves.toMatchObject({ ok: false, code: 'config', latencyMs: 0 });

    const net = await testLlmConnection(openai({ baseUrl: 'http://127.0.0.1:1/v1' }));
    expect(net).toMatchObject({ ok: false, code: 'network' });
  });

  it('a reasoning model that runs out of tokens still counts as connected', async () => {
    server.enqueue('openai.chat', { body: openAiCompletion('', { finish: 'length' }) });
    await expect(testLlmConnection(openai())).resolves.toMatchObject({ ok: true });
  });

  it('honours its timeout', async () => {
    server.enqueue('anthropic.messages', { delayMs: 3000, body: claudeMessage('late') });
    await expect(testLlmConnection(anthropic(), { timeoutMs: 100 })).resolves.toMatchObject({ ok: false, code: 'timeout' });
  });
});

describe('listModels', () => {
  it('openai: GET /models, sorted and de-duplicated; the model field may be empty', async () => {
    await expect(listModels(openai({ model: '' }))).resolves.toEqual(['gpt-4.1', 'gpt-5', 'gpt-5-mini', 'o4-mini']);
    const [sent] = server.requestsFor('openai.models');
    expect(sent.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('anthropic: auto-paginates /v1/models, newest first', async () => {
    await expect(listModels(anthropic({ model: '' }))).resolves.toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1']);
    expect(server.requestsFor('anthropic.models')).toHaveLength(2);
  });

  it('throws LlmError on failure', async () => {
    await expect(listModels(openai({ apiKey: 'sk-wrong' }))).rejects.toMatchObject({ code: 'auth' });
    await expect(listModels(anthropic({ apiKey: 'sk-ant-wrong' }))).rejects.toMatchObject({ code: 'auth' });
    await expect(listModels(openai({ protocol: 'demo' }))).rejects.toMatchObject({ code: 'config' });
  });
});

describe('through the real local relay (server/proxy.ts)', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { origin: server.origin });
    useSettingsStore.setState({ proxyAvailable: true });
  });

  it('openai: the relay forwards method, body and auth, and strips its own header', async () => {
    const res = await createChatProvider(openai({ useProxy: true })).chat({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.text).toBe('OK');
    const [upstream] = server.requestsFor('openai.chat');
    expect(upstream.url).toBe('/openai/v1/chat/completions');
    expect(upstream.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(upstream.headers['x-interview-proxy']).toBeUndefined();
    await expect(listModels(openai({ useProxy: true }))).resolves.toContain('gpt-5-mini');
    expect(server.relayed.map((u) => u.replace(/127\.0\.0\.1:\d+/, 'HOST'))).toEqual([
      '/api/proxy/http/HOST/openai/v1/chat/completions',
      '/api/proxy/http/HOST/openai/v1/models',
    ]);
  });

  it('anthropic: SDK requests work through the relay, errors keep their class', async () => {
    const res = await createChatProvider(anthropic({ useProxy: true })).chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('OK');
    expect(server.requestsFor('anthropic.messages')[0].headers['x-api-key']).toBe(ANTHROPIC_KEY);
    await expect(
      createChatProvider(anthropic({ useProxy: true, apiKey: 'bad' })).chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'auth', status: 401 });
  });

  it('relay cannot reach the upstream → network', async () => {
    const res = await testLlmConnection(openai({ useProxy: true, baseUrl: 'http://127.0.0.1:1/v1' }));
    expect(res).toMatchObject({ ok: false, code: 'network' });
    expect(res.message).toContain('relay');
  });
});
