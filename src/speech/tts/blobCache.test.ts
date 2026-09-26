import { describe, expect, it, vi } from 'vitest';
import { AudioBlobCache, type ObjectUrlApi } from './blobCache';

function fakeUrls(): ObjectUrlApi & { created: string[]; revoked: string[] } {
  let n = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    create: () => {
      const url = `blob:${++n}`;
      created.push(url);
      return url;
    },
    revoke: (url) => revoked.push(url),
  };
}

const blob = (s: string): Blob => new Blob([s], { type: 'audio/mpeg' });

describe('AudioBlobCache', () => {
  it('dedupes concurrent loads and reuses the object URL', async () => {
    const urls = fakeUrls();
    const cache = new AudioBlobCache(3, urls);
    const fetcher = vi.fn(async () => blob('a'));
    const p1 = cache.load('a', fetcher);
    const lease = await cache.acquire('a', fetcher);
    await p1;
    const lease2 = await cache.acquire('a', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(lease.url).toBe(lease2.url);
    expect(urls.created).toHaveLength(1);
  });

  it('evicts the least recently used entry and revokes its URL', async () => {
    const urls = fakeUrls();
    const cache = new AudioBlobCache(2, urls);
    const a = await cache.acquire('a', async () => blob('a'));
    a.release();
    const b = await cache.acquire('b', async () => blob('b'));
    b.release();
    // touch "a" so "b" becomes the oldest
    await cache.load('a', async () => blob('a2'));
    await cache.load('c', async () => blob('c'));
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(urls.revoked).toEqual([b.url]);
  });

  it('defers revocation of an evicted entry until its lease is released', async () => {
    const urls = fakeUrls();
    const cache = new AudioBlobCache(1, urls);
    const playing = await cache.acquire('a', async () => blob('a'));
    await cache.load('b', async () => blob('b'));
    expect(cache.has('a')).toBe(false);
    expect(urls.revoked).toEqual([]);
    playing.release();
    playing.release(); // idempotent
    expect(urls.revoked).toEqual([playing.url]);
  });

  it('does not cache failures', async () => {
    const cache = new AudioBlobCache(2, fakeUrls());
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.load('x', failing)).rejects.toThrow('boom');
    expect(cache.has('x')).toBe(false);
    const ok = vi.fn(async () => blob('x'));
    await expect(cache.acquire('x', ok)).resolves.toMatchObject({ url: expect.any(String) });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('clear() revokes idle URLs', async () => {
    const urls = fakeUrls();
    const cache = new AudioBlobCache(5, urls);
    const lease = await cache.acquire('a', async () => blob('a'));
    lease.release();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(urls.revoked).toEqual([lease.url]);
  });
});
