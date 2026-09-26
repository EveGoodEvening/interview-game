/**
 * Small deterministic PRNG utilities for the demo interviewer.
 */

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Pick, avoiding items for which `used` returns true when possible. */
  pickFresh<T>(items: readonly T[], used: (item: T) => boolean): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * Math.max(1, n)),
    chance: (p) => next() < p,
    pick: (items) => items[rng.int(items.length)],
    pickFresh: (items, used) => {
      const fresh = items.filter((i) => !used(i));
      return rng.pick(fresh.length > 0 ? fresh : items);
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/** A fresh random seed (varies between sessions). */
export function randomSeed(): number {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0xffffffff);
}

/** Replace `{key}` placeholders. Unknown keys are left empty. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (vars[k] !== undefined ? String(vars[k]) : ''));
}
