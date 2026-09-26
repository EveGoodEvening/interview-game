import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { CHARACTERS } from '../../characters';
import { useUiLang } from '../../i18n';
import type { CharacterId, Expression } from '../../types';
import { preloadSprite, spriteSheet } from '../lib/assets';
import { EXPRESSION_MOTION } from './expressions';
import { useBlink } from './hooks/useBlink';
import { useHop } from './hooks/useHop';
import { useMouthDriver } from './hooks/useMouthDriver';
import { SpriteLayers, canBlink } from './SpriteLayers';
import './CharacterSprite.css';

export interface CharacterSpriteProps {
  characterId: CharacterId;
  expression: Expression;
  /** Procedural mouth flapping while true (used when mouthLevelRef is absent or reads 0 for long). */
  speaking?: boolean;
  /** Real-time mouth openness 0–1, read every animation frame (e.g. from TTS amplitude). */
  mouthLevelRef?: { current: number };
  /**
   * Rendered height (px or CSS length). The layout box is always 3:4 (height × 0.75) and centred on
   * the face; a character whose canvas is wider (broad shoulders) overflows it equally on both sides.
   */
  height?: number | string;
  /** Darken slightly (not the active speaker / background character). */
  dimmed?: boolean;
  className?: string;
}

const hopsOn = (e: Expression) => EXPRESSION_MOTION[e].hop;

/** Width / height of the box a sprite takes in layout, whatever its canvas. */
export const LAYOUT_ASPECT = 3 / 4;

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Upper-body standing sprite ("tachie") with blinking, expressions and lip-sync.
 * Memoised: blinking and lip-sync only toggle attributes on the root (CSS shows the matching
 * layer), so they never re-render React.
 */
export const CharacterSprite = memo(function CharacterSprite({
  characterId,
  expression,
  speaking = false,
  mouthLevelRef,
  height = 640,
  dimmed = false,
  className,
}: CharacterSpriteProps) {
  const lang = useUiLang();
  const [cw, ch] = spriteSheet(characterId).canvas;
  const rootRef = useRef<HTMLDivElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  useBlink(rootRef, canBlink(characterId, expression));
  useMouthDriver(rootRef, speaking, mouthLevelRef);
  useHop(hopRef, expression, hopsOn);
  useEffect(() => preloadSprite(characterId), [characterId]);
  const h = typeof height === 'number' ? `${height}px` : height;
  // Negative side margins bring a wider canvas back to a 3:4 layout box, so screens can place every
  // character the same way (the face is centred in every canvas).
  const overflow = (cw / ch - LAYOUT_ASPECT) / 2;
  const style: CSSProperties = {
    height: h,
    aspectRatio: `${cw} / ${ch}`,
    ...(overflow > 0 ? { marginInline: `calc(${h} * ${(-overflow).toFixed(5)})` } : null),
  };
  return (
    <div
      className={cx('cs-sprite', dimmed && 'cs-sprite--dimmed', className)}
      style={style}
      role="img"
      aria-label={CHARACTERS[characterId].name[lang]}
      data-character={characterId}
      data-expression={expression}
    >
      <div ref={hopRef} className="cs-hop">
        <div ref={rootRef} className="cs-root cs-breathe">
          <SpriteLayers id={characterId} expression={expression} />
        </div>
      </div>
    </div>
  );
});

export interface CharacterPortraitProps {
  characterId: CharacterId;
  expression?: Expression;
  /** Square size in px. */
  size?: number;
  className?: string;
  /** Frame shape (default circle). */
  shape?: 'circle' | 'rounded';
  /** Flat silhouette (e.g. locked gallery entries). */
  silhouette?: boolean;
  /**
   * Static frame for thumbnails (Records, Gallery grid): no blink timer, no looping
   * symbol animations and no expression crossfade.
   */
  still?: boolean;
}

/** Head-and-shoulders crop of the same sprite, for cards, name plates and the backlog. */
export const CharacterPortrait = memo(function CharacterPortrait({
  characterId,
  expression = 'smile',
  size = 96,
  className,
  shape = 'circle',
  silhouette = false,
  still = false,
}: CharacterPortraitProps) {
  const c = CHARACTERS[characterId];
  const lang = useUiLang();
  const sheet = spriteSheet(characterId);
  const rootRef = useRef<HTMLDivElement>(null);
  useBlink(rootRef, !still && !silhouette && size >= 40 && canBlink(characterId, expression));
  const [px, py, edge] = sheet.portrait;
  const [cw, ch] = sheet.canvas;
  // The whole canvas, scaled so the crop square fills the frame (top/left % of a square = of its edge).
  const stage: CSSProperties = {
    width: `${(cw / edge) * 100}%`,
    height: `${(ch / edge) * 100}%`,
    left: `${(-px / edge) * 100}%`,
    top: `${(-py / edge) * 100}%`,
  };
  const style = { width: size, height: size, '--cp-accent': c.themeColor } as CSSProperties;
  return (
    <div
      className={cx('cp-portrait', `cp-portrait--${shape}`, silhouette && 'cp-portrait--silhouette', still && 'cp-portrait--still', className)}
      style={style}
      data-character={characterId}
    >
      <div className="cp-portrait__art" role="img" aria-label={c.name[lang]}>
        <div ref={rootRef} className="cs-root cp-portrait__stage" style={stage}>
          <SpriteLayers id={characterId} expression={expression} still={still} />
        </div>
      </div>
    </div>
  );
});
