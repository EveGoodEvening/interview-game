/**
 * URL helpers shared by the LLM, TTS and STT clients.
 * With `useProxy`, `https://host/v1/x` becomes `/api/proxy/https/host/v1/x`
 * (served by server/proxy.ts) and requests must carry PROXY_HEADERS.
 */

export const PROXY_HEADERS: Readonly<Record<string, string>> = { 'x-interview-proxy': '1' };

/** Join a base URL and a path without doubling slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!path) return base;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/** Rewrite an absolute http(s) URL to go through the local relay. Non-http(s) URLs are returned unchanged. */
export function toProxyUrl(absoluteUrl: string, origin: string = globalThis.location?.origin ?? ''): string {
  const m = /^(https?):\/\/(.+)$/i.exec(absoluteUrl.trim());
  if (!m) return absoluteUrl;
  return `${origin}/api/proxy/${m[1].toLowerCase()}/${m[2]}`;
}

/** Final request URL for `baseUrl + path`, optionally proxied. */
export function apiUrl(baseUrl: string, path: string, useProxy: boolean): string {
  const url = joinUrl(baseUrl, path);
  return useProxy ? toProxyUrl(url) : url;
}

/** Headers to add to every request (the relay rejects requests without them). */
export function proxyHeaders(useProxy: boolean): Record<string, string> {
  return useProxy ? { ...PROXY_HEADERS } : {};
}

/** GET /api/health — true when the local relay is running (dev server or `npm start`). */
export async function detectProxy(timeoutMs = 2500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { proxy?: boolean } | null;
    return body?.proxy === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
