/**
 * Loading code-split chunks so that a failed load can be retried without reloading the page.
 *
 * Browsers remember a failed module fetch for the life of the document (the module map keeps the
 * failure), so a second `import()` of the same URL rejects again without touching the network, and
 * `React.lazy` caches the rejection too. Vite's preload helper also never requests a chunk's CSS
 * again once it tried it. The cache below therefore:
 * - never hands out a failed load again once a retry is asked for (`load(id, { fresh: true })`);
 * - re-imports a module that failed under a fresh, cache-busting URL taken from the browser's error
 *   message (Chromium and Firefox name the module; Safari does not, so there only a reload helps);
 * - re-requests stylesheets that failed to load before such a retry (see {@link watchStylesheetErrors}).
 * A failed *dependency* chunk stays poisoned until the page reloads: when the module is reachable
 * again but still cannot be imported, the error is marked {@link isReloadRequired} so the error
 * panel asks for a reload instead of offering Retry forever.
 */

/** Messages browsers / Vite use when a chunk (or its CSS) could not be fetched. */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk .* failed|ChunkLoadError/i;

/** A chunk that failed to load; `reloadRequired` when only a page reload can load it now. */
export class ChunkLoadError extends Error {
  readonly reloadRequired: boolean;
  constructor(message: string, reloadRequired: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ChunkLoadError';
    this.reloadRequired = reloadRequired;
  }
}

/** Whether `error` means a code chunk failed to load (network / deploy), not a bug in the screen. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (typeof name === 'string' && name === 'ChunkLoadError') || (typeof message === 'string' && CHUNK_ERROR_RE.test(message));
}

/**
 * Whether the chunk is reachable again but this document can no longer import it (the browser keeps
 * a failed dependency for the page's lifetime) — only a reload helps.
 */
export function isReloadRequired(error: unknown): boolean {
  return error instanceof ChunkLoadError && error.reloadRequired;
}

const SCRIPT_PATH_RE = /\.(?:m?js|jsx|ts|tsx)$/i;

function currentOrigin(): string | null {
  try {
    return typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : null;
  } catch {
    return null;
  }
}

/**
 * The script URL named by a failed dynamic import (Chromium: "Failed to fetch dynamically imported
 * module: <url>", Firefox: "error loading dynamically imported module: <url>"). Only same-origin
 * script URLs are returned; anything else (Safari's message, CSS preload errors) gives null.
 */
export function failedModuleUrl(error: unknown, origin: string | null = currentOrigin()): string | null {
  if (!isChunkLoadError(error) || !origin) return null;
  const message = (error as { message: string }).message;
  const match = /(https?:\/\/[^\s'"]+)/.exec(message);
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(match[1].replace(/[.,;)]+$/, ''));
  } catch {
    return null;
  }
  if (url.origin !== origin || !SCRIPT_PATH_RE.test(url.pathname)) return null;
  return url.href;
}

const RETRY_PARAM = 'chunk-retry';

/** `url` with a unique query parameter, so the browser treats it as a new module and fetches it again. */
export function cacheBustedUrl(url: string, token: string | number): string {
  const u = new URL(url);
  u.searchParams.set(RETRY_PARAM, String(token));
  return u.href;
}

// ───────────── stylesheets ─────────────

/** Stylesheet <link>s whose load failed and that were not re-requested yet. */
const failedStylesheets = new Set<HTMLLinkElement>();
let watchingStylesheets = false;

function isStylesheetLink(node: unknown): node is HTMLLinkElement {
  return (
    typeof HTMLLinkElement !== 'undefined' &&
    node instanceof HTMLLinkElement &&
    node.rel.split(/\s+/).includes('stylesheet')
  );
}

/**
 * Start remembering stylesheets that fail to load (a chunk's CSS is added by Vite's preload helper,
 * which never asks for it again). Idempotent; a no-op outside the browser.
 */
export function watchStylesheetErrors(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): void {
  if (watchingStylesheets || !doc) return;
  watchingStylesheets = true;
  // `error` does not bubble, but it can be captured at the document.
  doc.addEventListener(
    'error',
    (e) => {
      if (isStylesheetLink(e.target)) failedStylesheets.add(e.target);
    },
    true,
  );
}

/** Whether a stylesheet failed to load since the last {@link retryFailedStylesheets}. */
export function hasFailedStylesheets(): boolean {
  return failedStylesheets.size > 0;
}

/**
 * Request every failed stylesheet again (a new <link> next to the old one, which is left in place).
 * Resolves once they all loaded — or after `timeoutMs`, so a hanging request never blocks a screen —
 * and rejects like Vite's preload helper when one fails again (it is then retried next time).
 */
export function retryFailedStylesheets(timeoutMs = 10_000): Promise<void> {
  const links = [...failedStylesheets];
  failedStylesheets.clear();
  if (links.length === 0) return Promise.resolve();
  const loads = links.map(
    (old) =>
      new Promise<void>((resolve, reject) => {
        if (!old.isConnected || !old.href) {
          resolve();
          return;
        }
        const link = old.ownerDocument.createElement('link');
        link.rel = 'stylesheet';
        if (old.crossOrigin !== null) link.crossOrigin = old.crossOrigin;
        if (old.media) link.media = old.media;
        const timer = setTimeout(resolve, timeoutMs);
        link.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        });
        link.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new ChunkLoadError(`Unable to preload CSS for ${old.href}`, false));
        });
        link.href = old.href;
        old.after(link);
      }),
  );
  return Promise.all(loads).then(() => undefined);
}

// ───────────── chunks ─────────────

/** One lazily loaded value (e.g. a screen component) and how to fetch it again from another URL. */
export interface Chunk<T> {
  /** Load through the bundler's own dynamic import (preloads the chunk's CSS / dependencies). */
  load: () => Promise<T>;
  /** Load the same module from `url` (used for the cache-busted retry). */
  loadUrl: (url: string) => Promise<T>;
}

const importUrl = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

/** Describe a chunk: `load` is the bundler-visible `import()`, `pick` takes the export out of the module. */
export function chunk<M, T>(load: () => Promise<M>, pick: (mod: M) => T, loadModule: (url: string) => Promise<unknown> = importUrl): Chunk<T> {
  return {
    load: () => load().then(pick),
    loadUrl: (url) => loadModule(url).then((mod) => pick(mod as M)),
  };
}

/** Whether `url` can be downloaded right now (the network is back). */
async function isReachable(url: string): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(8000) : undefined;
    const res = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ChunkCacheOptions {
  now?: () => number;
  /** Re-request stylesheets that failed (default: {@link retryFailedStylesheets} when any did). */
  repairStyles?: () => Promise<void> | null;
  /** Whether a module URL downloads fine now (default: a no-store fetch). */
  reachable?: (url: string) => Promise<boolean>;
}

export interface ChunkCache<K extends string, T> {
  /**
   * The value for `id`, loading it on first use. Concurrent and later calls share one attempt, even a
   * failed one, so a render right after a failed transition shows that error instead of fetching
   * again; pass `fresh` (a new navigation, the error panel's Retry) to start over after a failure
   * and to re-request stylesheets that failed meanwhile.
   */
  load: (id: K, opts?: { fresh?: boolean }) => Promise<T>;
  /** The value for `id` if it has loaded. */
  get: (id: K) => T | undefined;
  /** Whether the last attempt for `id` failed. */
  failed: (id: K) => boolean;
}

const defaultRepair = (): Promise<void> | null => (hasFailedStylesheets() ? retryFailedStylesheets() : null);

export function createChunkCache<K extends string, T>(chunks: Readonly<Record<K, Chunk<T>>>, options: ChunkCacheOptions = {}): ChunkCache<K, T> {
  const now = options.now ?? Date.now;
  const repairStyles = options.repairStyles ?? defaultRepair;
  const reachable = options.reachable ?? isReachable;
  const attempts = new Map<K, Promise<T>>();
  const loaded = new Map<K, T>();
  const failures = new Set<K>();
  let retries = 0;

  const attempt = (id: K): Promise<T> => {
    const spec = chunks[id];
    return spec.load().catch(async (error: unknown) => {
      const url = failedModuleUrl(error);
      if (!url) throw error;
      // The browser keeps the failed fetch for this URL, so ask for the same file under a new one.
      retries += 1;
      try {
        return await spec.loadUrl(cacheBustedUrl(url, `${now().toString(36)}${retries}`));
      } catch (retryError) {
        // Downloadable but still not importable: a dependency failed earlier and stays failed.
        const stuck = isChunkLoadError(retryError) && (await reachable(url));
        throw new ChunkLoadError((error as Error).message, stuck, error);
      }
    });
  };

  return {
    load: (id, opts) => {
      const repair = opts?.fresh ? repairStyles() : null;
      const done = loaded.get(id);
      if (done !== undefined) return repair ? repair.then(() => done, () => done) : Promise.resolve(done);
      if (opts?.fresh && failures.has(id)) {
        attempts.delete(id);
        failures.delete(id);
      }
      let p = attempts.get(id);
      if (!p) {
        p = repair ? repair.then(() => attempt(id)) : attempt(id);
        attempts.set(id, p);
        p.then(
          (value) => {
            loaded.set(id, value);
          },
          () => {
            failures.add(id);
          },
        );
      } else if (repair) {
        const current = p;
        p = repair.then(
          () => current,
          () => current,
        );
      }
      return p;
    },
    get: (id) => loaded.get(id),
    failed: (id) => failures.has(id),
  };
}
