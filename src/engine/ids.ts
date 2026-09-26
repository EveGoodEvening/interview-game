/**
 * Collision-resistant ids for sessions, transcript entries and records.
 * Uses crypto.randomUUID when available (browsers, Node ≥ 19) with a Math.random fallback.
 */

let counter = 0;

function randomPart(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14).padEnd(12, '0');
}

/** `${prefix}_${time36}${counter36}_${random}` — sortable by creation time within one tab. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_679_616; // 36^4
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}_${randomPart()}`;
}
