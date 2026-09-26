import './LevelMeter.css';

export interface LevelMeterProps {
  /** Input level 0–1. */
  level: number;
  bars?: number;
  active?: boolean;
  className?: string;
}

/** Number of lit bars for a level (with a gentle curve so quiet speech still shows). */
export function litBars(level: number, bars: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const curved = Math.sqrt(Math.min(1, level));
  return Math.min(bars, Math.max(1, Math.round(curved * bars)));
}

/** Segmented microphone level meter (green → gold → pink). */
export function LevelMeter({ level, bars = 18, active = true, className = '' }: LevelMeterProps) {
  const lit = active ? litBars(level, bars) : 0;
  return (
    <div
      className={`gg-meter${active ? '' : ' gg-meter--idle'} ${className}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: bars }, (_, i) => {
        const zone = i < bars * 0.6 ? 'low' : i < bars * 0.85 ? 'mid' : 'high';
        return <span key={i} className={`gg-meter__bar gg-meter__bar--${zone}${i < lit ? ' gg-meter__bar--on' : ''}`} />;
      })}
    </div>
  );
}
