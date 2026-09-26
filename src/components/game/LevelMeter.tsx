import { useEffect, useRef } from 'react';

export interface LevelMeterProps {
  /** Live level 0–1, read every animation frame. */
  levelRef: { readonly current: number };
  active: boolean;
  bars?: number;
  className?: string;
  /** Also mirrored to this element as the CSS variable --lvl (e.g. the mic button's pulsing ring). */
  mirrorRef?: { readonly current: HTMLElement | null };
}

/**
 * Scrolling microphone waveform. Updates the DOM directly from requestAnimationFrame
 * (no React re-render at 60 fps).
 */
export function LevelMeter({ levelRef, active, bars = 36, className = '', mirrorRef }: LevelMeterProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.children) as HTMLElement[];
    const history = new Array<number>(nodes.length).fill(0);
    if (!active) {
      nodes.forEach((n) => (n.style.transform = 'scaleY(0.08)'));
      mirrorRef?.current?.style.setProperty('--lvl', '0');
      return;
    }
    let raf = 0;
    let frame = 0;
    let smooth = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const lvl = Math.min(1, Math.max(0, levelRef.current || 0));
      smooth = smooth * 0.6 + lvl * 0.4;
      mirrorRef?.current?.style.setProperty('--lvl', smooth.toFixed(3));
      if (++frame % 3 !== 0) return; // scroll at ~20 Hz
      history.shift();
      history.push(smooth);
      for (let i = 0; i < nodes.length; i++) {
        const v = history[i];
        nodes[i].style.transform = `scaleY(${(0.08 + Math.min(1, v * 1.6) * 0.92).toFixed(3)})`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef, mirrorRef]);

  return (
    <div className={`lvl-meter ${className}`} ref={rootRef} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
