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
    el.animate(
      [
        { transform: 'translateY(0px)' },
        { transform: 'translateY(-14px)', offset: 0.35 },
        { transform: 'translateY(0px)', offset: 0.7 },
        { transform: 'translateY(-3px)', offset: 0.85 },
        { transform: 'translateY(0px)' },
      ],
      { duration: 380, easing: 'ease-out' },
    );
  }, [targetRef, trigger, shouldHop]);
}
