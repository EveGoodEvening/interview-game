/**
 * LRU cache of synthesized audio. Entries hold the (pending) Blob; an object URL is created on
 * first playback and revoked when the entry is evicted — or, if it is playing at that moment,
 * as soon as the last lease is released. Failed loads are not cached.
 */

export interface ObjectUrlApi {
  create(blob: Blob): string;
  revoke(url: string): void;
}

const browserUrls: ObjectUrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export interface BlobLease {
  readonly url: string;
  /** Call when playback is over. Idempotent. */
  release(): void;
}

interface Entry {
  readonly blob: Promise<Blob>;
  url: string | null;
  refs: number;
  evicted: boolean;
}

export class AudioBlobCache {
  readonly maxEntries: number;
  private readonly urls: ObjectUrlApi;
  private readonly entries = new Map<string, Entry>();

  constructor(maxEntries = 20, urls: ObjectUrlApi = browserUrls) {
    this.maxEntries = Math.max(1, maxEntries);
    this.urls = urls;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Start (or join) loading `key`, marking it most recently used. */
  load(key: string, fetcher: () => Promise<Blob>): Promise<Blob> {
    return this.ensure(key, fetcher).blob;
  }

  /** Load `key` and hold an object URL for it until the lease is released. */
  async acquire(key: string, fetcher: () => Promise<Blob>): Promise<BlobLease> {
    const entry = this.ensure(key, fetcher);
    const blob = await entry.blob;
    entry.url ??= this.urls.create(blob);
    entry.refs += 1;
    const url = entry.url;
    let released = false;
    return {
      url,
      release: () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        this.maybeRevoke(entry);
      },
    };
  }

  /** Drop everything (URLs in use are revoked when released). */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.evicted = true;
      this.maybeRevoke(entry);
    }
    this.entries.clear();
  }

  private ensure(key: string, fetcher: () => Promise<Blob>): Entry {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const blob = fetcher().catch((err: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw err;
    });
    // Mark as handled: a failed prefetch nobody awaits must not surface as an unhandled rejection.
    blob.catch(() => undefined);
    const entry: Entry = { blob, url: null, refs: 0, evicted: false };
    this.entries.set(key, entry);
    this.evictOverflow();
    return entry;
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (entry) {
        entry.evicted = true;
        this.maybeRevoke(entry);
      }
    }
  }

  private maybeRevoke(entry: Entry): void {
    if (!entry.evicted || entry.refs > 0 || entry.url === null) return;
    const url = entry.url;
    entry.url = null;
    try {
      this.urls.revoke(url);
    } catch {
      /* ignore */
    }
  }
}
