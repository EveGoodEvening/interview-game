/** True when the user (OS setting) or the game settings ask for reduced motion. */
export function prefersReducedMotion(el?: Element | null): boolean {
  if (el?.closest('.reduce-motion')) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
