// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheBustedUrl,
  chunk,
  ChunkLoadError,
  createChunkCache,
  failedModuleUrl,
  hasFailedStylesheets,
  isChunkLoadError,
  isReloadRequired,
  retryFailedStylesheets,
  watchStylesheetErrors,
} from './chunkLoader';

const ORIGIN = 'http://127.0.0.1:4173';
const CHROME = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

describe('chunk load errors', () => {
  it('recognises Chromium, Firefox, Safari and Vite messages', () => {
    expect(isChunkLoadError(CHROME(`${ORIGIN}/assets/SetupScreen-abc.js`))).toBe(true);
    expect(isChunkLoadError(new TypeError(`error loading dynamically imported module: ${ORIGIN}/assets/a.js`))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error(`Unable to preload CSS for ${ORIGIN}/assets/a.css`))).toBe(true);
    expect(isChunkLoadError(new ChunkLoadError('x', true))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });

  it('extracts only same-origin script URLs', () => {
    expect(failedModuleUrl(CHROME(`${ORIGIN}/assets/SetupScreen-abc.js`), ORIGIN)).toBe(`${ORIGIN}/assets/SetupScreen-abc.js`);
    expect(failedModuleUrl(CHROME(`${ORIGIN}/src/screens/SetupScreen.tsx?t=1`), ORIGIN)).toBe(`${ORIGIN}/src/screens/SetupScreen.tsx?t=1`);
    expect(failedModuleUrl(CHROME('https://evil.example/assets/x.js'), ORIGIN)).toBeNull();
    expect(failedModuleUrl(new Error(`Unable to preload CSS for ${ORIGIN}/assets/a.css`), ORIGIN)).toBeNull();
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'), ORIGIN)).toBeNull();
    expect(failedModuleUrl(CHROME(`${ORIGIN}/assets/a.js`), null)).toBeNull();
  });

  it('adds a cache-busting parameter, keeping existing ones', () => {
    expect(cacheBustedUrl(`${ORIGIN}/assets/a.js`, 'x1')).toBe(`${ORIGIN}/assets/a.js?chunk-retry=x1`);
    expect(cacheBustedUrl(`${ORIGIN}/src/a.tsx?t=5`, 2)).toBe(`${ORIGIN}/src/a.tsx?t=5&chunk-retry=2`);
  });
});

describe('createChunkCache', () => {
  /** A module whose bundler import fails like a browser that cached the failed fetch. */
  function flakyChunk(opts: { failBundler: number; failUrl?: number }) {
    const url = `${location.origin}/assets/RecordsScreen-abc.js`;
    let bundlerCalls = 0;
    let urlCalls = 0;
    const urls: string[] = [];
    const bundler = vi.fn(async () => {
      bundlerCalls += 1;
      if (bundlerCalls <= opts.failBundler) throw CHROME(url);
      return { RecordsScreen: 'records' };
    });
    const byUrl = vi.fn(async (u: string) => {
      urlCalls += 1;
      urls.push(u);
      if (urlCalls <= (opts.failUrl ?? 0)) throw CHROME(u);
      return { RecordsScreen: 'records (retried)' };
    });
    return { spec: chunk(bundler, (m: { RecordsScreen: string }) => m.RecordsScreen, byUrl), bundler, byUrl, urls };
  }

  it('re-imports a failed module under a fresh URL instead of reusing the cached failure', async () => {
    // The bundler import keeps failing (the browser's module map remembers the failed fetch).
    const { spec, byUrl, urls } = flakyChunk({ failBundler: Infinity, failUrl: 1 });
    const reachable = vi.fn(async () => false);
    const cache = createChunkCache({ records: spec }, { now: () => 1000, reachable, repairStyles: () => null });

    // Background prefetch on a bad network: both the import and the retry fail.
    const first = cache.load('records');
    await expect(first).rejects.toThrow(/Failed to fetch/);
    await expect(first).rejects.toSatisfy((e) => isChunkLoadError(e) && !isReloadRequired(e));
    expect(cache.failed('records')).toBe(true);
    // A plain load (e.g. the screen rendering right after that failed transition) shows the same error.
    await expect(cache.load('records')).rejects.toThrow(/Failed to fetch/);
    expect(byUrl).toHaveBeenCalledTimes(1);

    // The next visit (network back) starts over and succeeds through a cache-busted URL.
    await expect(cache.load('records', { fresh: true })).resolves.toBe('records (retried)');
    expect(urls[1]).toMatch(/RecordsScreen-abc\.js\?chunk-retry=/);
    expect(urls[1]).not.toBe(urls[0]);
    expect(cache.get('records')).toBe('records (retried)');
    expect(cache.failed('records')).toBe(false);
    // Loaded values are reused.
    await expect(cache.load('records', { fresh: true })).resolves.toBe('records (retried)');
    expect(byUrl).toHaveBeenCalledTimes(2);
  });

  it('marks a chunk that downloads fine but still cannot be imported as needing a reload', async () => {
    // e.g. a dependency chunk failed during a prefetch: the browser keeps that failure for the page.
    const { spec } = flakyChunk({ failBundler: Infinity, failUrl: Infinity });
    const reachable = vi.fn(async () => true);
    const cache = createChunkCache({ records: spec }, { reachable, repairStyles: () => null });
    const error = await cache.load('records').catch((e: unknown) => e);
    expect(isReloadRequired(error)).toBe(true);
    expect(isChunkLoadError(error)).toBe(true);
    expect((error as Error).message).toMatch(/RecordsScreen-abc\.js$/);
    expect(reachable).toHaveBeenCalledWith(`${location.origin}/assets/RecordsScreen-abc.js`);
  });

  it('shares one attempt between concurrent loads and keeps the original error when no URL is known', async () => {
    const safari = new TypeError('Importing a module script failed.');
    let calls = 0;
    const cache = createChunkCache(
      {
        x: chunk(
          async () => {
            calls += 1;
            if (calls === 1) throw safari;
            return { X: 1 };
          },
          (m: { X: number }) => m.X,
        ),
      },
      { repairStyles: () => null },
    );
    const [a, b] = [cache.load('x'), cache.load('x')];
    await expect(a).rejects.toBe(safari);
    await expect(b).rejects.toBe(safari);
    expect(calls).toBe(1);
    await expect(cache.load('x', { fresh: true })).resolves.toBe(1);
    expect(calls).toBe(2);
  });

  it('does not retry errors that are not chunk-load failures', async () => {
    const byUrl = vi.fn(async () => ({ X: 2 }));
    const bug = new Error('boom');
    const cache = createChunkCache({
      x: chunk(
        async (): Promise<{ X: number }> => {
          throw bug;
        },
        (m) => m.X,
        byUrl,
      ),
    });
    await expect(cache.load('x')).rejects.toBe(bug);
    expect(byUrl).not.toHaveBeenCalled();
  });

  it('re-requests failed stylesheets before a fresh load, even for a screen whose code already loaded', async () => {
    const order: string[] = [];
    let repairs = 0;
    const repairStyles = () => {
      repairs += 1;
      order.push('repair');
      return Promise.resolve();
    };
    const cache = createChunkCache(
      {
        x: chunk(
          async () => {
            order.push('import');
            return { X: 1 };
          },
          (m: { X: number }) => m.X,
        ),
      },
      { repairStyles },
    );
    await expect(cache.load('x')).resolves.toBe(1);
    expect(repairs).toBe(0); // background loads never touch the DOM
    await expect(cache.load('x', { fresh: true })).resolves.toBe(1);
    expect(order).toEqual(['import', 'repair']);
  });
});

describe('failed stylesheets', () => {
  afterEach(() => {
    document.head.replaceChildren();
  });

  function brokenLink(href: string): HTMLLinkElement {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    return link;
  }

  it('remembers stylesheets that failed and requests them again once', async () => {
    watchStylesheetErrors();
    const old = brokenLink(`${location.origin}/assets/SetupScreen-x.css`);
    expect(hasFailedStylesheets()).toBe(true);

    const repaired = retryFailedStylesheets();
    expect(hasFailedStylesheets()).toBe(false);
    const links = document.head.querySelectorAll('link[rel="stylesheet"]');
    expect(links).toHaveLength(2);
    const fresh = links[1] as HTMLLinkElement;
    expect(fresh).not.toBe(old);
    expect(fresh.href).toBe(old.href);
    fresh.dispatchEvent(new Event('load'));
    await expect(repaired).resolves.toBeUndefined();
    // Nothing left to repair.
    await expect(retryFailedStylesheets()).resolves.toBeUndefined();
    expect(document.head.querySelectorAll('link')).toHaveLength(2);
  });

  it('fails like the preload helper when the stylesheet fails again, and retries it next time', async () => {
    watchStylesheetErrors();
    brokenLink(`${location.origin}/assets/Records-x.css`);
    const repaired = retryFailedStylesheets();
    const fresh = document.head.querySelectorAll('link')[1] as HTMLLinkElement;
    fresh.dispatchEvent(new Event('error'));
    await expect(repaired).rejects.toSatisfy((e) => isChunkLoadError(e) && /Unable to preload CSS/.test((e as Error).message));
    expect(hasFailedStylesheets()).toBe(true);
  });

  it('never waits forever for a stylesheet', async () => {
    vi.useFakeTimers();
    try {
      watchStylesheetErrors();
      brokenLink(`${location.origin}/assets/Gallery-x.css`);
      const repaired = retryFailedStylesheets(500);
      vi.advanceTimersByTime(500);
      await expect(repaired).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
