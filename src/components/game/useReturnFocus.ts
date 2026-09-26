import { useEffect, useState } from 'react';

/**
 * Remember what had the keyboard focus when an overlay (pause menu, backlog) opened and give it
 * back when the overlay closes — e.g. the answer box the player was typing in, so the next
 * keystrokes land there instead of triggering the scene hotkeys (L = backlog, A = auto…).
 *
 * The element is read during the first render, before the overlay's own `autoFocus` moves the
 * focus. Nothing is restored when that element is gone (Config / Save & quit unmount the scene).
 */
export function useReturnFocus(): void {
  const [previous] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const el = document.activeElement;
    return el instanceof HTMLElement && el !== document.body ? el : null;
  });
  useEffect(
    () => () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    },
    [previous],
  );
}
