import { useEffect, useState } from 'react';

/**
 * Animated number from 0 to `target` (ease-out cubic) once `start` is true.
 * `instant` (reduce motion) jumps straight to the target.
 */
export function useCountUp(target: number, { durationMs = 1200, start = true, instant = false } = {}): number {
  const [value, setValue] = useState(instant && start ? target : 0);

  useEffect(() => {
    if (!start) return;
    if (instant || durationMs <= 0) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, start, instant]);

  return value;
}
