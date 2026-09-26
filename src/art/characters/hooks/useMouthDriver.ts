import { useEffect, type RefObject } from 'react';

/** Mouth openness (0–1) → lip-sync level 0 (closed) … 3 (wide). */
export function mouthLevelFor(value: number): 0 | 1 | 2 | 3 {
  if (!(value > 0.08)) return 0;
  if (value < 0.28) return 1;
  if (value < 0.55) return 2;
  return 3;
}

/** Real amplitude must be silent this long before procedural flapping takes over. */
const SILENCE_BEFORE_PROCEDURAL_MS = 300;
/** Minimum time a mouth shape stays on screen (avoids flicker on noisy levels). */
const MIN_HOLD_MS = 55;

/**
 * Lip-sync driver. Reads `levelRef.current` every animation frame and writes the
 * chosen shape to the `data-mouth` attribute of the sprite root (CSS shows the
 * matching pre-rendered mouth), so the SVG is never re-rendered by React.
 * Falls back to procedural flapping while `speaking` and no real level arrives.
 */
export function useMouthDriver(
  rootRef: RefObject<Element | null>,
  speaking: boolean,
  levelRef: { current: number } | undefined,
): void {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let shown = -1;
    const show = (level: number) => {
      if (level === shown) return;
      shown = level;
      el.setAttribute('data-mouth', String(level));
    };
    if ((!speaking && !levelRef) || typeof requestAnimationFrame !== 'function') {
      show(0);
      return;
    }

    let raf = 0;
    let lastReal = -Infinity;
    let holdUntil = 0;
    let proc = 0;
    let procUntil = 0;
    let phraseEnd = 0;

    const nextProcedural = (now: number) => {
      if (now > phraseEnd) {
        // A short breath between phrases.
        phraseEnd = now + 1200 + Math.random() * 1600;
        proc = 0;
        procUntil = now + 180 + Math.random() * 160;
        return;
      }
      proc = proc > 0 ? (Math.random() < 0.6 ? 0 : 1) : [1, 2, 2, 3][Math.floor(Math.random() * 4)];
      procUntil = now + 70 + Math.random() * 90;
    };

    const tick = (now: number) => {
      const real = levelRef?.current ?? 0;
      let target: number;
      if (real > 0.04) {
        lastReal = now;
        target = mouthLevelFor(real);
      } else if (speaking && now - lastReal > SILENCE_BEFORE_PROCEDURAL_MS) {
        if (now >= procUntil) nextProcedural(now);
        target = proc;
      } else {
        target = 0;
      }
      if (target !== shown && now >= holdUntil) {
        show(target);
        holdUntil = now + MIN_HOLD_MS;
      }
      raf = requestAnimationFrame(tick);
    };
    phraseEnd = performance.now() + 1500 + Math.random() * 1500;
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      show(0);
    };
  }, [rootRef, speaking, levelRef]);
}
