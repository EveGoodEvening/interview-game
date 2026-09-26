import { useEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/**
 * A tiny hop (Web Animations API on the given element) whenever `trigger`
 * changes to a value for which `shouldHop` is true. Never on mount; skipped under reduced motion.
 */
export function useHop<T>(targetRef: RefObject<Element | null>, trigger: T, shouldHop: (value: T) => boolean): void {
  const previous = useRef(trigger);
  useEffect(() => {
    if (Object.is(previous.current, trigger)) return;
    previous.current = trigger;
    const el = targetRef.current;
    if (!el || !shouldHop(trigger) || typeof el.animate !== 'function' || prefersReducedMotion(el)) return;
    // No cleanup: the hop is short and must not be cut off by unrelated re-renders.
    // Percentages of the element's own height, so the hop scales with the sprite (1.75 % ≈ 11 px at 620 px).
    el.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(-1.75%)', offset: 0.35 },
        { transform: 'translateY(0)', offset: 0.7 },
        { transform: 'translateY(-0.375%)', offset: 0.85 },
        { transform: 'translateY(0)' },
      ],
      { duration: 380, easing: 'ease-out' },
    );
  }, [targetRef, trigger, shouldHop]);
}
