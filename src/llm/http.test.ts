import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, detectProxy, joinUrl, PROXY_HEADERS, proxyHeaders, toProxyUrl } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('joinUrl', () => {
  it('joins without doubling or dropping slashes', () => {
    expect(joinUrl('https://api.x.com/v1', 'chat/completions')).toBe('https://api.x.com/v1/chat/completions');
    expect(joinUrl('https://api.x.com/v1/', '/chat/completions')).toBe('https://api.x.com/v1/chat/completions');
    expect(joinUrl('  https://api.x.com/v1///  ', 'models')).toBe('https://api.x.com/v1/models');
    expect(joinUrl('https://api.x.com/v1', '')).toBe('https://api.x.com/v1');
  });
});

describe('toProxyUrl', () => {
  it('rewrites http(s) URLs onto the relay, keeping host, port, path and query', () => {
    expect(toProxyUrl('https://api.openai.com/v1/chat/completions', 'http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173/api/proxy/https/api.openai.com/v1/chat/completions',
    );
    expect(toProxyUrl('http://localhost:11434/v1/models?x=1', 'http://h')).toBe('http://h/api/proxy/http/localhost:11434/v1/models?x=1');
    expect(toProxyUrl('HTTPS://API.X.COM/v1', 'http://h')).toBe('http://h/api/proxy/https/API.X.COM/v1');
  });

  it('leaves non-http URLs alone', () => {
    expect(toProxyUrl('blob:abc', 'http://h')).toBe('blob:abc');
    expect(toProxyUrl('/relative/path', 'http://h')).toBe('/relative/path');
    expect(toProxyUrl('ftp://x.com/a', 'http://h')).toBe('ftp://x.com/a');
  });

  it('defaults to the page origin', () => {
    vi.stubGlobal('location', { origin: 'https://game.example' });
    expect(toProxyUrl('https://api.x.com/v1')).toBe('https://game.example/api/proxy/https/api.x.com/v1');
  });

  it('produces a same-origin relative URL when there is no page origin (node)', () => {
    vi.stubGlobal('location', undefined);
    expect(toProxyUrl('https://api.x.com/v1')).toBe('/api/proxy/https/api.x.com/v1');
  });
});

describe('apiUrl / proxyHeaders', () => {
  it('only rewrites when proxying', () => {
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173' });
    expect(apiUrl('https://api.x.com/v1/', 'models', false)).toBe('https://api.x.com/v1/models');
    expect(apiUrl('https://api.x.com/v1/', 'models', true)).toBe('http://127.0.0.1:5173/api/proxy/https/api.x.com/v1/models');
  });

  it('adds the relay header only when proxying, as a fresh copy', () => {
    expect(proxyHeaders(false)).toEqual({});
    const h = proxyHeaders(true);
    expect(h).toEqual({ 'x-interview-proxy': '1' });
    h.extra = 'x';
    expect(PROXY_HEADERS).toEqual({ 'x-interview-proxy': '1' });
  });
});

describe('detectProxy', () => {
  it('is true only for {proxy:true}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, proxy: true }), { status: 200 })));
    await expect(detectProxy()).resolves.toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(detectProxy()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(detectProxy()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(detectProxy()).resolves.toBe(false);
  });

  it('is false when the request fails or hangs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(detectProxy()).resolves.toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    await expect(detectProxy(20)).resolves.toBe(false);
  });
});
