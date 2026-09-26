import { useEffect, useState } from 'react';

/**
 * Keeps the previous value around for `ms` after a change so both can be
 * rendered and crossfaded. Returns the current value and the outgoing one (or null).
 * With `enabled` false changes snap: `previous` is always null and no timer is started
 * (switching it off mid-fade drops the outgoing value at once).
 */
export function useCrossfade<T>(value: T, ms: number, enabled = true): { current: T; previous: T | null } {
  const [state, setState] = useState<{ current: T; previous: T | null }>({ current: value, previous: null });
  const changed = state.current !== value;
  if (changed || (!enabled && state.previous !== null)) {
    // Adjusting state during render is the React-sanctioned way to derive from a changed prop.
    setState({ current: value, previous: enabled && changed ? state.current : null });
  }
  const { previous } = state;
  useEffect(() => {
    if (previous === null) return;
    const t = setTimeout(() => setState((s) => ({ current: s.current, previous: null })), ms);
    return () => clearTimeout(t);
  }, [previous, ms]);
  return state;
}
