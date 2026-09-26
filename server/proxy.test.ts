import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allowedHostsFromEnv, handleApiRequest, hostnameOf, isAllowedHost, isForwardedResponseHeader, type ApiRequestOptions } from './proxy.ts';

/** An "internal" upstream service plus a relay server, both on 127.0.0.1. */
let upstream: Server;
let upstreamPort: number;
let upstreamHeaders: Record<string, string> = {};
let upstreamBodies: number[] = [];
let relay: Server;
let relayPort: number;
let relayOptions: ApiRequestOptions = {};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let size = 0;
    req.on('data', (c: Buffer) => (size += c.length));
    req.on('end', () => {
      upstreamBodies.push(size);
      res.statusCode = 200;
      for (const [key, value] of Object.entries(upstreamHeaders)) res.setHeader(key, value);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ secret: 'INTERNAL-ONLY', path: req.url }));
    });
  });
  upstreamPort = await listen(upstream);
  relay = createServer((req, res) => {
    void handleApiRequest(req, res, relayOptions).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not an api route');
      }
    });
  });
  relayPort = await listen(relay);
});

afterAll(async () => {
  await Promise.all([new Promise((r) => upstream.close(r)), new Promise((r) => relay.close(r))]);
});

beforeEach(() => {
  upstreamHeaders = {};
  upstreamBodies = [];
  relayOptions = { allowedHosts: [] };
});

interface Sent {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Raw HTTP request to the relay (lets the test forge Host / Origin like a DNS-rebound page). */
function send(path: string, opts: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: relayPort, path, method: opts.method ?? 'GET', headers: { host: `127.0.0.1:${relayPort}`, ...opts.headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const target = () => `/api/proxy/http/127.0.0.1:${upstreamPort}/admin`;
const RELAY = { 'x-interview-proxy': '1' };

describe('relay Host allow-list (DNS rebinding guard)', () => {
  it('a rebound page (attacker Host + matching Origin) is refused before reaching the upstream', async () => {
    const res = await send(target(), { headers: { ...RELAY, host: `evil.example:${relayPort}`, origin: `http://evil.example:${relayPort}` } });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: { type: 'proxy_forbidden' } });
    expect(res.body).toContain('ALLOWED_HOSTS');
    expect(res.body).not.toContain('INTERNAL-ONLY');
    expect(upstreamBodies).toHaveLength(0);

    // Same-origin GET from a rebound page carries no Origin at all.
    expect((await send(target(), { headers: { ...RELAY, host: `evil.example:${relayPort}` } })).status).toBe(403);
  });

  it('loopback names and IP literals pass', async () => {
    for (const host of [`127.0.0.1:${relayPort}`, `localhost:${relayPort}`, `game.localhost:${relayPort}`, `[::1]:${relayPort}`, '192.168.1.5:8080']) {
      const res = await send(target(), { headers: { ...RELAY, host } });
      expect(res.status, host).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ secret: 'INTERNAL-ONLY', path: '/admin' });
    }
  });

  it('names listed in ALLOWED_HOSTS pass (a leading dot allows subdomains)', async () => {
    relayOptions = { allowedHosts: ['interview.lan', '.example.org'] };
    expect((await send(target(), { headers: { ...RELAY, host: `interview.lan:${relayPort}` } })).status).toBe(200);
    expect((await send(target(), { headers: { ...RELAY, host: 'example.org' } })).status).toBe(200);
    expect((await send(target(), { headers: { ...RELAY, host: 'game.example.org:4173' } })).status).toBe(200);
    expect((await send(target(), { headers: { ...RELAY, host: 'badexample.org' } })).status).toBe(403);
    expect((await send(target(), { headers: { ...RELAY, host: 'interview.lan.evil.example' } })).status).toBe(403);
  });

  it('the health endpoint stays public (it reveals nothing)', async () => {
    const res = await send('/api/health', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, proxy: true });
  });

  it('the existing header / Origin checks still apply to allowed hosts', async () => {
    expect((await send(target())).status).toBe(403);
    expect((await send(target(), { headers: { ...RELAY, origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('host parsing helpers', () => {
    expect(hostnameOf('LocalHost:4173')).toBe('localhost');
    expect(hostnameOf('[::1]:4173')).toBe('::1');
    expect(hostnameOf('[::1]')).toBe('::1');
    expect(hostnameOf('example.com.')).toBe('example.com');
    expect(hostnameOf('[::1]x')).toBeNull();
    expect(hostnameOf('a:b:c')).toBeNull();
    expect(isAllowedHost(undefined, [])).toBe(false);
    expect(isAllowedHost('', [])).toBe(false);
    expect(isAllowedHost('127.0.0.1.nip.io:4173', [])).toBe(false);
    expect(isAllowedHost('localhost.evil.example', [])).toBe(false);
    expect(isAllowedHost('10.0.0.7:4173', [])).toBe(true);
    expect(allowedHostsFromEnv(' a.lan, .Example.org  b.lan. ')).toEqual(['a.lan', '.example.org', 'b.lan']);
    expect(allowedHostsFromEnv(undefined)).toEqual([]);
  });
});

describe('relay request body cap', () => {
  it('a body declared larger than the cap → 413 without contacting the upstream', async () => {
    relayOptions = { allowedHosts: [], maxBodyBytes: 1024 };
    const res = await send(target(), { method: 'POST', headers: { ...RELAY, 'content-type': 'application/octet-stream' }, body: Buffer.alloc(4096) });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ error: { type: 'proxy_body_too_large' } });
    expect(upstreamBodies).toHaveLength(0);
  });

  it('a chunked body that grows past the cap → 413', async () => {
    relayOptions = { allowedHosts: [], maxBodyBytes: 1024 };
    const res = await new Promise<Sent>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: relayPort,
          path: target(),
          method: 'POST',
          headers: { ...RELAY, host: `127.0.0.1:${relayPort}`, 'transfer-encoding': 'chunked' },
        },
        (r) => {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body }));
        },
      );
      req.on('error', reject);
      for (let i = 0; i < 4; i++) req.write(Buffer.alloc(512));
      req.end();
    });
    expect(res.status).toBe(413);
    expect(upstreamBodies).toHaveLength(0);
  });

  it('a body within the cap is forwarded', async () => {
    relayOptions = { allowedHosts: [], maxBodyBytes: 1024 };
    const res = await send(target(), { method: 'POST', headers: { ...RELAY, 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(res.status).toBe(200);
    expect(upstreamBodies).toEqual([7]);
  });
});

describe('relay response header allow-list', () => {
  it('drops Clear-Site-Data, Set-Cookie, WWW-Authenticate, CSP and friends; keeps what the clients read', async () => {
    upstreamHeaders = {
      'clear-site-data': '"storage"',
      'set-cookie': 'sid=1',
      'www-authenticate': 'Basic realm="x"',
      'content-security-policy': "default-src 'none'",
      'strict-transport-security': 'max-age=1',
      refresh: '0; url=https://evil.example',
      link: '<https://evil.example>; rel=preload',
      'service-worker-allowed': '/',
      'access-control-allow-origin': '*',
      'alt-svc': 'h3=":443"',
      'cache-control': 'no-store',
      'retry-after': '3',
      'retry-after-ms': '3000',
      'x-should-retry': 'true',
      'request-id': 'req_1',
      'x-request-id': 'xreq_1',
      'anthropic-ratelimit-requests-remaining': '9',
      'openai-processing-ms': '12',
      'x-ratelimit-remaining-tokens': '1000',
    };
    const res = await send(target(), { headers: RELAY });
    expect(res.status).toBe(200);
    for (const dropped of [
      'clear-site-data',
      'set-cookie',
      'www-authenticate',
      'content-security-policy',
      'strict-transport-security',
      'refresh',
      'link',
      'service-worker-allowed',
      'access-control-allow-origin',
      'alt-svc',
    ]) {
      expect(res.headers, dropped).not.toHaveProperty(dropped);
    }
    expect(res.headers).toMatchObject({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': '3',
      'retry-after-ms': '3000',
      'x-should-retry': 'true',
      'request-id': 'req_1',
      'x-request-id': 'xreq_1',
      'anthropic-ratelimit-requests-remaining': '9',
      'openai-processing-ms': '12',
      'x-ratelimit-remaining-tokens': '1000',
    });
  });

  it('isForwardedResponseHeader', () => {
    expect(isForwardedResponseHeader('Content-Type')).toBe(true);
    expect(isForwardedResponseHeader('Anthropic-Organization-Id')).toBe(true);
    expect(isForwardedResponseHeader('Clear-Site-Data')).toBe(false);
    expect(isForwardedResponseHeader('content-encoding')).toBe(false);
    expect(isForwardedResponseHeader('content-length')).toBe(false);
  });
});
