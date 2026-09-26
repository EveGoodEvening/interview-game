import { describe, expect, it } from 'vitest';
import { extractErrorMessage, extractErrorParam, extractErrorType, httpError, isModelNotFound, networkError, statusToCode, unknownError } from './errors';
import { LlmError } from './types';

describe('statusToCode', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [408, 'timeout'],
    [429, 'rate_limit'],
    [400, 'bad_request'],
    [402, 'bad_request'],
    [413, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
    [529, 'server'],
  ] as const)('%i → %s', (status, code) => {
    expect(statusToCode(status)).toBe(code);
  });
});

describe('error body parsing', () => {
  it.each([
    [{ error: { message: 'Incorrect API key', type: 'invalid_request_error' } }, 'Incorrect API key'],
    [{ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key'],
    [{ error: 'model not found' }, 'model not found'],
    [{ code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: 'x' }, 'Invalid API-key provided.'],
    [{ detail: 'Not Found' }, 'Not Found'],
    [{ detail: [{ loc: ['body', 'model'], msg: 'field required' }] }, 'field required'],
    [{ errors: [{ message: 'bad' }] }, 'bad'],
    ['upstream connect error', 'upstream connect error'],
    ['<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>', 'HTML page: 502 Bad Gateway'],
    ['<!doctype html><div>app</div>', 'HTML page instead of an API response (check the base URL)'],
  ])('%j', (body, expected) => {
    expect(extractErrorMessage(body)).toBe(expected);
  });

  it('returns undefined for empty / unknown shapes and clips long text', () => {
    expect(extractErrorMessage(null)).toBeUndefined();
    expect(extractErrorMessage({})).toBeUndefined();
    expect(extractErrorMessage('   ')).toBeUndefined();
    expect(extractErrorMessage('x'.repeat(2000))?.length).toBeLessThan(700);
  });

  it('reads the machine-readable type and blamed param', () => {
    expect(extractErrorType({ error: { type: 'rate_limit_error', message: '' } })).toBe('rate_limit_error');
    expect(extractErrorType({ error: { code: 'invalid_api_key' } })).toBe('invalid_api_key');
    expect(extractErrorType({ code: 'Throttling' })).toBe('Throttling');
    expect(extractErrorParam({ error: { message: 'x', param: 'temperature' } })).toBe('temperature');
    expect(extractErrorParam({ error: { message: 'x', param: null } })).toBeUndefined();
  });
});

describe('httpError', () => {
  it('maps status, keeps status + provider detail with request id', () => {
    const err = httpError(401, { error: { message: 'Incorrect API key', type: 'invalid_request_error' } }, { label: 'X', requestId: 'req_1' });
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: 'auth', status: 401, detail: 'Incorrect API key (request id: req_1)' });
    expect(err.message).toBe('X error 401 (invalid_request_error): Incorrect API key');
  });

  it('honours a caller-provided code', () => {
    expect(httpError(418, {}, { label: 'X', code: 'server' }).code).toBe('server');
  });

  it('recognises relay errors and moderation blocks by type/code', () => {
    expect(httpError(502, { error: { type: 'proxy_upstream_unreachable', message: 'ENOTFOUND' } }, { label: 'X' }).code).toBe('network');
    expect(httpError(403, { error: { type: 'proxy_forbidden', message: 'no' } }, { label: 'X' }).code).toBe('config');
    expect(httpError(400, { code: 'data_inspection_failed', message: 'Input data may contain inappropriate content.' }, { label: 'X' }).code).toBe(
      'refusal',
    );
    expect(httpError(400, { error: { code: 'content_policy_violation', message: 'x' } }, { label: 'X' }).code).toBe('refusal');
  });
});

describe('unknown model ids', () => {
  it.each([
    [{ error: { message: 'The model `gpt-4.1-nano-x` does not exist or you do not have access to it.', code: 'model_not_found' } }],
    [{ error: { message: 'The model `gpt-4.1-nano-x` does not exist or you do not have access to it.' } }],
    [{ error: { message: 'Model Not Exist', type: 'invalid_request_error', param: null, code: 'invalid_request_error' } }], // DeepSeek
    [{ error: { message: 'Not found the model kimi-k2-turbo-preview or Permission denied', type: 'resource_not_found_error' } }], // Kimi
    [{ error: { message: 'model "qwen2.5:7b" not found, try pulling it first', type: 'api_error' } }], // Ollama
    [{ error: { code: '1211', message: '模型不存在，请检查模型代码。' } }], // Zhipu
    [{ code: 20012, message: 'Model does not exist. Please check it carefully.', data: null }], // SiliconFlow
    [{ error: { message: 'foo/bar is not a valid model ID', code: 400 } }], // OpenRouter
    [{ type: 'error', error: { type: 'not_found_error', message: 'model: claude-opus-9' } }], // Anthropic
  ])('%j', (body) => {
    expect(isModelNotFound(body)).toBe(true);
  });

  it('does not fire on other errors', () => {
    expect(isModelNotFound({ error: { message: "This model's maximum context length is 8192 tokens. Not found: none" } })).toBe(false);
    expect(isModelNotFound({ error: { message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]' } })).toBe(false);
    expect(isModelNotFound({ error: { message: 'invalid temperature: only 1 is allowed for this model' } })).toBe(false);
    expect(isModelNotFound('404 page not found')).toBe(false);
    expect(isModelNotFound(null)).toBe(false);
  });

  it('httpError maps a 400 / 404 / 422 unknown model to not_found with a "Fetch models" hint', () => {
    for (const status of [400, 404, 422]) {
      const err = httpError(status, { error: { message: 'Model Not Exist' } }, { label: 'X', code: 'bad_request' });
      expect(err).toMatchObject({ code: 'not_found', status, detail: 'Model Not Exist' });
      expect(err.message).toContain('Fetch models');
    }
    // A 400 that is not about the model keeps its code.
    expect(httpError(400, { error: { message: 'messages: roles must alternate' } }, { label: 'X' }).code).toBe('bad_request');
    // 401 / 403 stay auth even when the text mentions the model (e.g. no access).
    expect(httpError(403, { error: { message: 'The model `x` does not exist or you do not have access to it.' } }, { label: 'X' }).code).toBe('auth');
  });
});

describe('networkError / unknownError', () => {
  it('hints at CORS for direct calls and at the relay otherwise', () => {
    const direct = networkError(new TypeError('Failed to fetch'), { direct: true, url: 'https://api.x.com/v1/chat/completions' });
    expect(direct.code).toBe('network');
    expect(direct.message).toContain('https://api.x.com');
    expect(direct.message).toContain('CORS');
    const relayed = networkError(new TypeError('Failed to fetch'), { direct: false, url: 'https://api.x.com/v1' });
    expect(relayed.message).toContain('relay');
    expect(relayed.message).not.toContain('CORS');
  });

  it('wraps unknown errors', () => {
    const e = new LlmError('parse', 'x');
    expect(unknownError(e)).toBe(e);
    expect(unknownError(new TypeError('fetch failed')).code).toBe('network');
    expect(unknownError(new Error('boom'))).toMatchObject({ code: 'server', detail: 'boom' });
    expect(unknownError('weird').code).toBe('server');
  });
});
