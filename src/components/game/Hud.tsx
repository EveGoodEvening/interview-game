import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '../../i18n';
import type { ProgressInfo } from '../../store/selectors';
import { formatClock, progressLabel } from './labels';
import './Hud.css';

export interface ProgressChipProps {
  progress: ProgressInfo;
  accent: string;
}

/** Top-left chapter/progress chip: "Q2/5 · 追问 · topic" with one pip per main question. */
export function ProgressChip({ progress, accent }: ProgressChipProps) {
  const t = useT();
  const label = progressLabel(progress, t);
  const total = Math.max(0, progress.mainTotal);
  const done = progress.phase === 'questioning' ? Math.max(0, progress.mainIndex - 1) : ['reverse', 'closing', 'evaluating', 'finished'].includes(progress.phase) ? total : 0;
  const current = progress.phase === 'questioning' ? progress.mainIndex - 1 : -1;
  return (
    <div className="hud-progress" style={{ '--hud-accent': accent } as CSSProperties} data-testid="hud-progress">
      <div className="hud-progress__row">
        <span className="hud-progress__main">{label.main}</span>
        {label.badge && <span className="hud-progress__badge">{label.badge}</span>}
        {label.topic && (
          <span className="hud-progress__topic" title={label.topic}>
            {label.topic}
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="hud-progress__pips" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < done ? 'is-done' : i === current ? 'is-current' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface AffinityFloat {
  key: number;
  delta: number;
}

export interface AffinityMeterProps {
  value: number;
  floats: readonly AffinityFloat[];
}

function affinityTier(v: number): 'low' | 'mid' | 'high' {
  return v < 30 ? 'low' : v >= 70 ? 'high' : 'mid';
}

/** Top-right heart meter. Floats "♥ +4" / "♥ −3" for each affinity event. */
export function AffinityMeter({ value, floats }: AffinityMeterProps) {
  const t = useT();
  const v = Math.round(Math.min(100, Math.max(0, value)));
  const lastKey = floats.length ? floats[floats.length - 1].key : 0;
  return (
    <div className={`hud-aff hud-aff--${affinityTier(v)}`} data-testid="hud-affinity" aria-label={t('interview.hud.affinityAria', { n: v })}>
      <svg key={lastKey} className={`hud-aff__heart${lastKey ? ' is-beat' : ''}`} viewBox="0 0 32 30" aria-hidden="true">
        <defs>
          <linearGradient id="hud-heart-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffb3d1" />
            <stop offset="1" stopColor="#e2558f" />
          </linearGradient>
        </defs>
        <path
          d="M16 28.5 C 6 21, 1.5 15.5, 1.5 9.6 C 1.5 5, 5 1.5, 9.2 1.5 C 12.1 1.5, 14.5 3.1, 16 5.6 C 17.5 3.1, 19.9 1.5, 22.8 1.5 C 27 1.5, 30.5 5, 30.5 9.6 C 30.5 15.5, 26 21, 16 28.5 Z"
          fill="url(#hud-heart-grad)"
          stroke="#fff"
          strokeWidth="2"
        />
        <ellipse cx="9.5" cy="8" rx="3.2" ry="2.2" fill="#fff" opacity="0.65" transform="rotate(-30 9.5 8)" />
      </svg>
      <div className="hud-aff__col">
        <div className="hud-aff__label">
          <span>{t('interview.hud.affinity')}</span>
          <b>{v}</b>
        </div>
        <div className="hud-aff__bar">
          <div className="hud-aff__fill" style={{ width: `${v}%` }} />
          <div className="hud-aff__ticks" />
        </div>
      </div>
      {floats.map((f) => (
        <span key={f.key} className={`hud-aff__float ${f.delta >= 0 ? 'is-up' : 'is-down'}`}>
          ♥ {f.delta >= 0 ? `+${f.delta}` : `−${Math.abs(f.delta)}`}
        </span>
      ))}
    </div>
  );
}

export interface AnswerTimerProps {
  /** Countdown start (ms epoch, already shifted by paused time); null = not started yet (the question is still being voiced). */
  startedAt: number | null;
  /** Paused since (ms epoch): the display freezes. */
  pausedAt?: number | null;
  /** 0 = unlimited (shows elapsed time). */
  limitSec: number;
}

/**
 * Answer clock: countdown with a time limit (red in the last 10 s), elapsed time otherwise.
 * Shows the full limit until the clock starts and freezes while the game is paused.
 */
export function AnswerTimer({ startedAt, pausedAt = null, limitSec }: AnswerTimerProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const running = startedAt !== null && pausedAt === null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const elapsed = startedAt === null ? 0 : Math.max(0, ((pausedAt ?? now) - startedAt) / 1000);
  const limited = limitSec > 0;
  const remaining = limited ? Math.max(0, limitSec - elapsed) : 0;
  const warn = limited && remaining <= 10;
  const ratio = limited ? remaining / limitSec : 1;
  const state = startedAt === null ? 'waiting' : pausedAt !== null ? 'paused' : 'running';
  return (
    <div
      className={`hud-timer${limited ? '' : ' hud-timer--free'}${warn ? ' hud-timer--warn' : ''} hud-timer--${state}`}
      data-testid="hud-timer"
      data-state={state}
      role="timer"
    >
      <svg viewBox="0 0 36 36" className="hud-timer__ring" aria-hidden="true">
        <circle cx="18" cy="18" r="15" className="hud-timer__track" />
        <circle cx="18" cy="18" r="15" className="hud-timer__arc" style={{ strokeDashoffset: `${(1 - ratio) * 94.25}` }} />
        <path d="M18 10 V18 L23 21" className="hud-timer__hand" />
      </svg>
      <div className="hud-timer__col">
        <span className="hud-timer__label">{limited ? t('interview.hud.timeLeft') : t('interview.hud.elapsed')}</span>
        <b className="hud-timer__value">{formatClock(limited ? Math.ceil(remaining) : elapsed)}</b>
      </div>
    </div>
  );
}
