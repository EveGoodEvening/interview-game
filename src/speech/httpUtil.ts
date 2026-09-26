/** Small fetch helpers shared by the API TTS and STT clients. */

export class HttpTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/**
 * fetch + read the body under one timeout. `outer` aborts the request too (the caller's cancel);
 * a timeout rejects with HttpTimeoutError, an outer abort with the original AbortError.
 */
export async function requestWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onOuterAbort = (): void => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return await read(res);
  } catch (err) {
    if (timedOut) throw new HttpTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Best-effort human readable error from an error response body (JSON `error.message`, `message`, or text). */
export async function readErrorMessage(res: Response): Promise<string> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    return res.statusText || 'request failed';
  }
  const fromJson = extractJsonMessage(body);
  const text = (fromJson ?? body).replace(/\s+/g, ' ').trim();
  return (text || res.statusText || 'request failed').slice(0, 300);
}

function extractJsonMessage(body: string): string | null {
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    const err = obj.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === 'string') return msg;
    }
    for (const key of ['message', 'detail', 'msg']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
    return null;
  } catch {
    return null;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function bearer(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}
