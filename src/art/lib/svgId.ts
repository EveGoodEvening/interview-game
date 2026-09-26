import { useId } from 'react';

/**
 * A per-instance prefix for SVG element ids (gradients, clip paths).
 * Several sprites / portraits / backgrounds can be mounted at once, so every
 * `id` / `url(#…)` must be unique per component instance. React's useId()
 * output contains characters (`:`, `«`, `»`) that are awkward inside
 * `url(#…)` references, so they are stripped.
 */
export function useSvgUid(prefix: string): string {
  const raw = useId();
  return `${prefix}${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** `url(#id)` helper. */
export function ref(id: string): string {
  return `url(#${id})`;
}
