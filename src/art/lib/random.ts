/**
 * Deterministic pseudo-random numbers. Art must render identically on every
 * render (no Math.random in render paths), so decorative variation is derived
 * from a seed (usually an index).
 */

/** mulberry32 — tiny, fast, good enough for decoration. Returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max) from a generator. */
export function between(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

/** Pick one element of a non-empty array. */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
}
