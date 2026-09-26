import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, resolveStaticPath } from './static.ts';

const ROOT = path.resolve('/srv/game');
const DIST = path.join(ROOT, 'dist');

describe('resolveStaticPath', () => {
  it('maps URL paths to files under dist (query / hash ignored, escapes decoded)', () => {
    expect(resolveStaticPath(DIST, '/')).toEqual({ ok: true, file: DIST });
    expect(resolveStaticPath(DIST, '/index.html')).toEqual({ ok: true, file: path.join(DIST, 'index.html') });
    expect(resolveStaticPath(DIST, '/assets/app-1.js?v=2#x')).toEqual({ ok: true, file: path.join(DIST, 'assets', 'app-1.js') });
    expect(resolveStaticPath(DIST, '/assets/%E9%9D%A2%E8%AF%95.svg')).toEqual({ ok: true, file: path.join(DIST, 'assets', '面试.svg') });
    // `..` that stays inside dist is fine.
    expect(resolveStaticPath(DIST, '/assets/../index.html')).toEqual({ ok: true, file: path.join(DIST, 'index.html') });
  });

  it('refuses siblings that merely share the "dist" prefix', () => {
    expect(resolveStaticPath(DIST, '/../dist.env.local')).toEqual({ ok: false, status: 403 });
    expect(resolveStaticPath(DIST, '/%2e%2e/dist.env.local')).toEqual({ ok: false, status: 403 });
    expect(resolveStaticPath(DIST, '/../dist-old/secret.txt')).toEqual({ ok: false, status: 403 });
    expect(resolveStaticPath(DIST, '/..%2fdist_old%2fsecret.txt')).toEqual({ ok: false, status: 403 });
  });

  it('refuses paths outside dist', () => {
    expect(resolveStaticPath(DIST, '/../package.json')).toEqual({ ok: false, status: 403 });
    expect(resolveStaticPath(DIST, '/%2e%2e/%2e%2e/etc/passwd')).toEqual({ ok: false, status: 403 });
    expect(resolveStaticPath(DIST, '/..')).toEqual({ ok: false, status: 403 });
  });

  it('malformed escapes and NUL bytes are a 400, not a crash', () => {
    expect(resolveStaticPath(DIST, '/%E0%A4%A')).toEqual({ ok: false, status: 400 });
    expect(resolveStaticPath(DIST, '/index.html%00.png')).toEqual({ ok: false, status: 400 });
  });
});

describe('isInside', () => {
  it('is segment-wise', () => {
    expect(isInside(DIST, DIST)).toBe(true);
    expect(isInside(DIST, path.join(DIST, 'a', 'b'))).toBe(true);
    expect(isInside(DIST, path.join(DIST, '..dotfile'))).toBe(true);
    expect(isInside(DIST, `${DIST}-old`)).toBe(false);
    expect(isInside(DIST, `${DIST}.env`)).toBe(false);
    expect(isInside(DIST, ROOT)).toBe(false);
  });
});
