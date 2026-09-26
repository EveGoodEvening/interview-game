import { useEffect, type RefObject } from 'react';

const CLOSE_MS = 120;

/**
 * Random blinking (every 2–6 s, sometimes a double blink). Toggles the
 * `data-blink` attribute on the sprite root; CSS then shows the expression's painted
 * closed-eyes patch (.cs-blink), so React never re-renders for a blink.
 */
export function useBlink(rootRef: RefObject<Element | null>, enabled: boolean): void {
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => el.setAttribute('data-blink', '');
    const open = () => el.removeAttribute('data-blink');

    const blink = (then: () => void) => {
      close();
      timer = setTimeout(() => {
        open();
        then();
      }, CLOSE_MS);
    };
    const schedule = () => {
      timer = setTimeout(
        () => {
          blink(() => {
            if (Math.random() < 0.18) timer = setTimeout(() => blink(schedule), 140);
            else schedule();
          });
        },
        2000 + Math.random() * 4000,
      );
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      open();
    };
  }, [rootRef, enabled]);
}
