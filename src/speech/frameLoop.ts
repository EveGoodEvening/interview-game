import { nowMs } from './env';

export type FrameTick = (dtMs: number, nowMs: number) => void;

/**
 * Run `tick` once per animation frame (requestAnimationFrame, or a ~60 Hz timer where rAF is
 * unavailable). Returns a stop function. `dtMs` is clamped so a throttled background tab does
 * not produce huge jumps.
 */
export function startFrameLoop(tick: FrameTick): () => void {
  const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null;
  const caf = typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : null;
  let stopped = false;
  let last = nowMs();
  let rafId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const step = (): void => {
    if (stopped) return;
    const t = nowMs();
    const dt = Math.min(100, Math.max(0, t - last));
    last = t;
    tick(dt, t);
    schedule();
  };

  function schedule(): void {
    if (stopped) return;
    if (raf) rafId = raf(step);
    else timerId = setTimeout(step, 16);
  }

  schedule();
  return () => {
    stopped = true;
    if (rafId !== null && caf) caf(rafId);
    if (timerId !== null) clearTimeout(timerId);
    rafId = null;
    timerId = null;
  };
}
