import { useEffect, useState } from 'react';
import { useCountUp } from './useCountUp';

export interface ScoreRingProps {
  /** 0–100 */
  score: number;
  label: string;
  accent: string;
  size?: number;
  reduceMotion?: boolean;
}

const R = 52;
const C = 2 * Math.PI * R;

/** Circular score gauge with a counting number in the middle. */
export function ScoreRing({ score, label, accent, size = 168, reduceMotion = false }: ScoreRingProps) {
  const target = Math.max(0, Math.min(100, Math.round(score)));
  const [drawn, setDrawn] = useState(reduceMotion);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = useCountUp(target, { durationMs: 1100, instant: reduceMotion });
  const offset = drawn ? C * (1 - target / 100) : C;
  return (
    <div className="rpt-ring" style={{ width: size, height: size }} role="img" aria-label={`${label} ${target}/100`}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <circle cx="60" cy="60" r={R} className="rpt-ring__track" />
        <circle
          cx="60"
          cy="60"
          r={R}
          className="rpt-ring__arc"
          stroke={accent}
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="rpt-ring__center">
        <b className="rpt-ring__value">{shown}</b>
        <span className="rpt-ring__label">{label}</span>
      </div>
    </div>
  );
}
