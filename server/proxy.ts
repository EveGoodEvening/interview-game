/**
 * Local API relay used by both the Vite dev server and the production server.
 *
 * Browsers cannot call many LLM / speech providers directly because of CORS.
 * The front end therefore rewrites `https://api.example.com/v1/chat/completions`
 * into `/api/proxy/https/api.example.com/v1/chat/completions` and this handler
 * forwards the request (method, body, auth headers) and streams the response back.
 *
 * Routes:
 *   GET  /api/health                      -> {"ok":true,"proxy":true}
 *   ANY  /api/proxy/{http|https}/{host[:port]}/{path...}?{query}
 *
 * Safety:
 * - The `Host` header must name this machine: `localhost` / `*.localhost`, an IP literal, or a
 *   name listed in the `ALLOWED_HOSTS` env var (comma-separated; `.example.com` also allows its
 *   subdomains). This blocks DNS rebinding, where an attacker's page on `evil.example:4173` is
 *   re-pointed at 127.0.0.1 and would otherwise count as "same origin" below.
 * - Requests must carry `x-interview-proxy: 1` (forces a CORS preflight for cross-site pages,
 *   which this relay never approves) and a same-origin `Origin` header when present.
 * - Only http/https upstreams are allowed; request bodies are capped (413 above the limit).
 * - Only an allow-list of upstream response headers reaches the page (content type, caching,
 *   retry hints, request ids, rate-limit info): nothing like `Clear-Site-Data`, `Set-Cookie`,
 *   CSP or `WWW-Authenticate` can act on the game's origin.
 * The API key travels with each request from the browser; nothing is stored server-side.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export const PROXY_PREFIX = '/api/proxy/';
export const PROXY_HEADER = 'x-interview-proxy';

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'origin',
  'referer',
  'cookie',
  'content-length',
  'accept-encoding',
  PROXY_HEADER,
]);

/**
 * Upstream response headers passed to the page; everything else is dropped. The LLM / speech
 * clients read content-type, retry-after(-ms), x-should-retry and request ids; the prefixes carry
 * provider rate-limit / org info. (content-length / content-encoding stay out: fetch() has
 * already decoded the body, so they would no longer match what is streamed.)
 */
const FORWARD_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-disposition',
  'cache-control',
  'date',
  'retry-after',
  'retry-after-ms',
  'x-should-retry',
  'request-id',
  'x-request-id',
]);
const FORWARD_RESPONSE_PREFIXES = ['anthropic-', 'openai-', 'x-ratelimit-'];

export function isForwardedResponseHeader(name: string): boolean {
  const key = name.toLowerCase();
  return FORWARD_RESPONSE_HEADERS.has(key) || FORWARD_RESPONSE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Largest request body the relay buffers (STT uploads: providers cap audio at ~25 MB + multipart overhead). */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface ApiRequestOptions {
  /** Extra allowed Host names; defaults to the `ALLOWED_HOSTS` env var. */
  allowedHosts?: readonly string[];
  /** Request body cap in bytes; defaults to MAX_BODY_BYTES. */
  maxBodyBytes?: number;
}

/** `ALLOWED_HOSTS` env var → list of host names (comma / whitespace separated, lower-cased). */
export function allowedHostsFromEnv(value: string | undefined = process.env.ALLOWED_HOSTS): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

/** The host name of a `Host` header value (`[::1]:4173` → `::1`, `Example.com.:80` → `example.com`). */
export function hostnameOf(hostHeader: string): string | null {
  const host = hostHeader.trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return null;
    const rest = host.slice(end + 1);
    if (rest !== '' && !/^:\d*$/.test(rest)) return null;
    return host.slice(1, end);
  }
  const match = /^([^:]+)(?::\d*)?$/.exec(host);
  return match ? match[1].replace(/\.$/, '') : null;
}

/**
 * True when the `Host` header names this machine (loopback name or IP literal) or an explicitly
 * allowed name — the DNS-rebinding guard (mirrors Vite's `server.allowedHosts`).
 */
export function isAllowedHost(hostHeader: string | undefined, allowed: readonly string[] = allowedHostsFromEnv()): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (isIP(hostname) !== 0) return true;
  return allowed.some((entry) => {
    const name = entry.toLowerCase();
    // Vite-style: a leading dot allows the domain itself and every subdomain.
    if (name.startsWith('.')) return hostname === name.slice(1) || hostname.endsWith(name);
    return hostname === name;
  });
}

/** Parse `/api/proxy/https/host:port/rest?x=1` into an absolute upstream URL. */
export function parseProxyTarget(url: string): URL | null {
  if (!url.startsWith(PROXY_PREFIX)) return null;
  const rest = url.slice(PROXY_PREFIX.length);
  const match = /^(https?)\/([^/?#]+)(.*)$/.exec(rest);
  if (!match) return null;
  const [, scheme, host, tail] = match;
  try {
    const target = new URL(`${scheme}://${host}${tail.startsWith('/') || tail.startsWith('?') || tail === '' ? tail : `/${tail}`}`);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    return target;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {}

/** Buffer the request body, rejecting with BodyTooLarge as soon as it (or its declared length) passes `limit`. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    req.on('data', (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        chunks.length = 0;
        finish(() => reject(new BodyTooLarge()));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
    req.on('error', (err) => finish(() => reject(err)));
  });
}

function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Handle `/api/*` requests. Resolves `true` when the request was handled,
 * `false` when the caller should continue with its own routing.
 */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, opts: ApiRequestOptions = {}): Promise<boolean> {
  const url = req.url ?? '/';
  if (url === '/api/health' || url.startsWith('/api/health?')) {
    sendJson(res, 200, { ok: true, proxy: true });
    return true;
  }
  if (!url.startsWith(PROXY_PREFIX)) return false;

  // Checked before the same-origin test: under DNS rebinding the attacker controls Host and Origin alike.
  if (!isAllowedHost(req.headers.host, opts.allowedHosts ?? allowedHostsFromEnv())) {
    sendJson(res, 403, {
      error: {
        type: 'proxy_forbidden',
        message: `Host "${req.headers.host ?? ''}" is not allowed to use the relay; add it to the ALLOWED_HOSTS environment variable.`,
      },
    });
    return true;
  }
  if (req.headers[PROXY_HEADER] !== '1' || !isSameOrigin(req)) {
    sendJson(res, 403, { error: { type: 'proxy_forbidden', message: 'Proxy requests must come from the game page.' } });
    return true;
  }
  const target = parseProxyTarget(url);
  if (!target) {
    sendJson(res, 400, { error: { type: 'proxy_bad_target', message: 'Invalid proxy target URL.' } });
    return true;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const limit = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await readBody(req, limit);
    } catch (err) {
      if (!(err instanceof BodyTooLarge)) throw err;
      // Close the connection after answering and discard whatever the client is still uploading.
      res.setHeader('connection', 'close');
      sendJson(res, 413, {
        error: { type: 'proxy_body_too_large', message: `Request body exceeds the relay limit of ${Math.round(limit / (1024 * 1024))} MB.` },
      });
      req.resume();
      return true;
    }
  }
  const controller = new AbortController();
  // Abort upstream when the browser goes away (e.g. user cancels a request).
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    if (controller.signal.aborted) return true;
    const message = err instanceof Error ? `${err.message}${err.cause instanceof Error ? `: ${err.cause.message}` : ''}` : String(err);
    sendJson(res, 502, { error: { type: 'proxy_upstream_unreachable', message: `Cannot reach ${target.origin} — ${message}` } });
    return true;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (isForwardedResponseHeader(key)) res.setHeader(key, value);
  });
  if (!upstream.body) {
    res.end();
    return true;
  }
  const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
