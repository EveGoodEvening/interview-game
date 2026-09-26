import { memo, useRef, type CSSProperties } from 'react';
import { CHARACTERS } from '../../characters';
import { useUiLang } from '../../i18n';
import type { CharacterId, Expression } from '../../types';
import { useSvgUid } from '../lib/svgId';
import { CharacterArt } from './CharacterArt';
import { DESIGNS } from './designs';
import { FACE_SPECS } from './expressions';
import { useBlink } from './hooks/useBlink';
import { useHop } from './hooks/useHop';
import { useMouthDriver } from './hooks/useMouthDriver';
import './CharacterSprite.css';

export interface CharacterSpriteProps {
  characterId: CharacterId;
  expression: Expression;
  /** Procedural mouth flapping while true (used when mouthLevelRef is absent or reads 0 for long). */
  speaking?: boolean;
  /** Real-time mouth openness 0–1, read every animation frame (e.g. from TTS amplitude). */
  mouthLevelRef?: { current: number };
  /** Rendered height (px or CSS length). Width follows the sprite's aspect ratio (≈ 3:4 upper body). */
  height?: number | string;
  /** Darken slightly (not the active speaker / background character). */
  dimmed?: boolean;
  className?: string;
}

const hopsOn = (e: Expression) => FACE_SPECS[e].hop;

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Upper-body standing sprite ("tachie") with blinking, expressions and lip-sync.
 * Memoised: blinking and lip-sync never re-render React, so a parent re-rendering
 * (e.g. a typewriter) costs nothing here as long as props are stable.
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
  const design = DESIGNS[characterId];
  const lang = useUiLang();
  const uid = useSvgUid('cs');
  const rootRef = useRef<SVGGElement>(null);
  const hopRef = useRef<SVGGElement>(null);
  useBlink(rootRef, FACE_SPECS[expression].eyes.mode === 'open');
  useMouthDriver(rootRef, speaking, mouthLevelRef);
  useHop(hopRef, expression, hopsOn);
  return (
    <svg
      className={cx('cs-sprite', dimmed && 'cs-sprite--dimmed', className)}
      viewBox="0 0 600 800"
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
      role="img"
      aria-label={CHARACTERS[characterId].name[lang]}
      data-character={characterId}
      data-expression={expression}
    >
      <g ref={hopRef}>
        <g ref={rootRef} className="cs-root">
          <CharacterArt design={design} expression={expression} uid={uid} breathing />
        </g>
      </g>
    </svg>
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
   * sparkle / sweat / surprise animations and no expression crossfade.
   */
  still?: boolean;
}

/** Head-and-shoulders crop for cards, name plates and the backlog. */
export const CharacterPortrait = memo(function CharacterPortrait({
  characterId,
  expression = 'smile',
  size = 96,
  className,
  shape = 'circle',
  silhouette = false,
  still = false,
}: CharacterPortraitProps) {
  const design = DESIGNS[characterId];
  const c = CHARACTERS[characterId];
  const lang = useUiLang();
  const uid = useSvgUid('cp');
  const rootRef = useRef<SVGGElement>(null);
  useBlink(rootRef, !still && !silhouette && size >= 40 && FACE_SPECS[expression].eyes.mode === 'open');
  const [x, y, s] = design.portraitCrop;
  const style = { width: size, height: size, '--cp-accent': c.themeColor } as CSSProperties;
  return (
    <div
      className={cx('cp-portrait', `cp-portrait--${shape}`, silhouette && 'cp-portrait--silhouette', still && 'cp-portrait--still', className)}
      style={style}
      data-character={characterId}
    >
      <svg viewBox={`${x} ${y} ${s} ${s}`} className="cp-portrait__art" role="img" aria-label={c.name[lang]}>
        <g ref={rootRef} className="cs-root">
          <CharacterArt design={design} expression={expression} uid={uid} breathing={false} still={still} />
        </g>
      </svg>
    </div>
  );
});
