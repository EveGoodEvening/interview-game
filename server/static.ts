/**
 * Path resolution for the production static server (server/index.ts), kept separate so it can be
 * unit-tested without starting a server.
 */
import path from 'node:path';

export type StaticTarget = { ok: true; file: string } | { ok: false; status: 400 | 403 };

/** True when `file` is `root` itself or lies inside it (segment-wise, so `/app/dist-old` is not inside `/app/dist`). */
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Map a request URL path (`/assets/x.js?v=1`) to a file under `root`.
 * 400 for a malformed percent-escape or a NUL byte; 403 for anything that escapes `root`
 * (`/../x`, `/%2e%2e/x`, and siblings sharing the prefix, like `/../dist-old/x`).
 */
export function resolveStaticPath(root: string, urlPath: string): StaticTarget {
  let clean: string;
  try {
    clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  } catch {
    return { ok: false, status: 400 };
  }
  if (clean.includes('\0')) return { ok: false, status: 400 };
  const base = path.resolve(root);
  const file = path.resolve(base, `.${clean.startsWith('/') ? '' : '/'}${clean}`);
  return isInside(base, file) ? { ok: true, file } : { ok: false, status: 403 };
}
