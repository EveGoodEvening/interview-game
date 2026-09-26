import { memo, type CSSProperties } from 'react';
import { between, mulberry32 } from '../lib/random';
import './SakuraPetals.css';

export interface SakuraPetalsProps {
  /** Number of petals (default 24). */
  count?: number;
  /** Render nothing (the game's reduce-motion setting). */
  reduceMotion?: boolean;
  className?: string;
}

interface Petal {
  left: number;
  size: number;
  fall: number;
  delay: number;
  sway: number;
  swayDur: number;
  spin: number;
  flip: number;
  hue: number;
  opacity: number;
}

const COLORS = ['#ffd1e1', '#ffc0d6', '#ffb3cc', '#ffe3ec', '#ffcadb'];

/** Deterministic petal parameters (no Math.random in render). */
export function petalParams(count: number): Petal[] {
  return Array.from({ length: count }, (_, i) => {
    const r = mulberry32(i * 7919 + 17);
    const fall = between(r, 8, 15);
    return {
      left: between(r, -4, 100),
      size: between(r, 13, 24),
      fall,
      delay: -between(r, 0, fall),
      sway: between(r, 18, 60),
      swayDur: between(r, 2.6, 4.8),
      spin: between(r, 3, 7),
      flip: between(r, 1.6, 3.2),
      hue: Math.floor(r() * COLORS.length),
      opacity: between(r, 0.65, 0.95),
    };
  });
}

/** Falling petals overlay (pointer-events: none). Renders nothing when reduceMotion. */
export const SakuraPetals = memo(function SakuraPetals({ count = 24, reduceMotion = false, className }: SakuraPetalsProps) {
  if (reduceMotion || count <= 0) return null;
  const petals = petalParams(Math.min(count, 80));
  return (
    <div className={`sp-layer${className ? ` ${className}` : ''}`} aria-hidden="true">
      {petals.map((p, i) => (
        <div
          key={i}
          className="sp-fall"
          style={
            {
              left: `${p.left.toFixed(2)}%`,
              width: `${p.size.toFixed(1)}px`,
              animationDuration: `${p.fall.toFixed(2)}s`,
              animationDelay: `${p.delay.toFixed(2)}s`,
            } as CSSProperties
          }
        >
          <div
            className="sp-sway"
            style={{ '--sp-sway': `${p.sway.toFixed(1)}px`, animationDuration: `${p.swayDur.toFixed(2)}s` } as CSSProperties}
          >
            <div className="sp-spin" style={{ animationDuration: `${p.spin.toFixed(2)}s, ${p.flip.toFixed(2)}s` }}>
              <svg className="sp-petal" viewBox="0 0 20 24" style={{ opacity: p.opacity }}>
                <path d="M 10 23 C 2 18 0 10 3 4 C 5 1 8 1 10 4 C 12 1 15 1 17 4 C 20 10 18 18 10 23 Z" fill={COLORS[p.hue]} />
                <path d="M 10 21 C 7 16 7 10 10 6" fill="none" stroke="#ff9fc0" strokeWidth={1} opacity={0.6} />
              </svg>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});
