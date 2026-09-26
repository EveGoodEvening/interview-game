/**
 * Painted backgrounds (src/art/assets/backgrounds, see tools/art/README.md) with light CSS effects
 * on top. All of them fill their positioned parent (position:absolute; inset:0), ignore pointer
 * events and cover-fit any aspect ratio.
 */
import { memo, type ReactNode } from 'react';
import type { CharacterId, EndingId } from '../../types';
import { SakuraPetals } from '../effects/SakuraPetals';
import { backgroundUrl, type BackgroundName, type OfficeVariant } from '../lib/assets';
import { between, mulberry32 } from '../lib/random';
import './Backgrounds.css';

function Picture({ name, className }: { name: BackgroundName; className?: string }) {
  return (
    <img className={`bg-layer__img${className ? ` ${className}` : ''}`} src={backgroundUrl(name)} alt="" draggable={false} decoding="async" data-bg={name} />
  );
}

function BgFrame({ className, testId, children }: { className: string; testId: string; children: ReactNode }) {
  return (
    <div className={`bg-layer ${className}`} aria-hidden="true" data-testid={testId}>
      {children}
    </div>
  );
}

export interface OfficeBackgroundProps {
  /** Each company has its own meeting room. */
  characterId: CharacterId;
  /** Time of day (evening for the closing); switching crossfades between the two paintings. */
  variant?: OfficeVariant;
}

/** Interview room: window on the left, décor on the right, a calm wall behind the interviewer. */
export function OfficeBackground({ characterId, variant = 'day' }: OfficeBackgroundProps) {
  return (
    <BgFrame className={`bg-office bg-office--${variant}`} testId={`bg-office-${characterId}-${variant}`}>
      <Picture name={`office-${characterId}-day`} />
      <div className="bg-veil bg-veil--office-day" />
      <div className="bg-office__evening">
        <Picture name={`office-${characterId}-evening`} />
        <div className="bg-veil bg-veil--office-evening" />
      </div>
    </BgFrame>
  );
}

/** Title key art: sakura, sky and the office tower, drifting slowly. */
export function TitleBackground() {
  return (
    <BgFrame className="bg-title" testId="bg-title">
      <Picture name="title" className="bg-drift" />
    </BgFrame>
  );
}

/** Soft office lobby behind the menus. */
export function LobbyBackground() {
  return (
    <BgFrame className="bg-lobby" testId="bg-lobby">
      <Picture name="lobby" className="bg-drift bg-drift--slow" />
      <div className="bg-veil bg-veil--lobby" />
    </BgFrame>
  );
}

// ───────────────────────── Endings ─────────────────────────

export interface EndingBackgroundProps {
  ending: EndingId;
  /**
   * A static frame for thumbnails (Records, Gallery grid): no CSS animations (sparkles, rain and
   * glow hold their resting pose) and no falling-petal overlay.
   */
  still?: boolean;
}

interface Twinkle {
  left: number;
  top: number;
  size: number;
  delay: number;
}

/** Deterministic sparkle positions for the perfect ending (kept on the sunny left side). */
const TWINKLES: Twinkle[] = (() => {
  const r = mulberry32(4101);
  return Array.from({ length: 14 }, () => ({
    left: between(r, 3, 62),
    top: between(r, 4, 70),
    size: between(r, 10, 26),
    delay: -between(r, 0, 3),
  }));
})();

const Sparkles = memo(function Sparkles({ still }: { still: boolean }) {
  return (
    <div className="bg-sparkles">
      {TWINKLES.map((t, i) => (
        <svg
          key={i}
          className={still ? 'bg-sparkle' : 'bg-sparkle bg-twinkle'}
          viewBox="-10 -10 20 20"
          style={{ left: `${t.left}%`, top: `${t.top}%`, width: t.size, height: t.size, animationDelay: `${t.delay.toFixed(2)}s` }}
        >
          <path d="M 0 -10 Q 0 0 10 0 Q 0 0 0 10 Q 0 0 -10 0 Q 0 0 0 -10 Z" fill="#fffbe8" />
        </svg>
      ))}
    </div>
  );
});

/** Two layers of falling rain streaks (the tiles loop seamlessly); still: frozen streaks. */
function Rain({ still }: { still: boolean }) {
  const fall = still ? '' : ' bg-rain__fall';
  return (
    <div className="bg-rain">
      <div className={`bg-rain__sheet bg-rain__sheet--far${fall}`} />
      <div className={`bg-rain__sheet bg-rain__sheet--near${fall}`} />
    </div>
  );
}

const ENDING_PETALS: Record<EndingId, number> = { perfect: 8, offer: 16, pending: 0, rejected: 0 };

export function EndingBackground({ ending, still = false }: EndingBackgroundProps) {
  const petals = still ? 0 : ENDING_PETALS[ending];
  return (
    <BgFrame className={`bg-ending bg-ending--${ending}${still ? ' bg-still' : ''}`} testId={`bg-ending-${ending}`}>
      <Picture name={`ending-${ending}`} className={still ? undefined : 'bg-drift bg-drift--slow'} />
      {ending === 'perfect' && (
        <>
          <div className={still ? 'bg-glow bg-glow--still' : 'bg-glow'} />
          <Sparkles still={still} />
        </>
      )}
      {ending === 'rejected' && <Rain still={still} />}
      <div className={`bg-veil bg-veil--${ending}`} />
      {petals > 0 && <SakuraPetals count={petals} />}
    </BgFrame>
  );
}
