/**
 * The painted sprite of one character, shared by CharacterSprite and CharacterPortrait:
 * base → face layer of the expression → talking mouths / blink (shown by CSS from the root's
 * data-mouth / data-blink attributes; the blink comes last, so it closes the eyes over any mouth)
 * → manga symbol. Fills its parent, which has the canvas's aspect ratio.
 */
import { memo } from 'react';
import type { CharacterId, Expression } from '../../types';
import { rectStyle, spriteSheet, spriteUrl, type SpriteSheet } from '../lib/assets';
import { EXPRESSION_MOTION } from './expressions';
import { useCrossfade } from './hooks/useCrossfade';

/** Must match the cs-face-in animation duration in CharacterSprite.css. */
export const EXPRESSION_FADE_MS = 170;

/** True when the expression has open eyes that can blink. */
export function canBlink(id: CharacterId, expression: Expression): boolean {
  return spriteSheet(id).frames[expression].blink !== undefined;
}

function Layer({ src, className, style }: { src: string; className: string; style?: ReturnType<typeof rectStyle> }) {
  return <img className={`cs-layer ${className}`} src={src} style={style} alt="" draggable={false} decoding="async" />;
}

/** One expression: its face, three talking mouths and the blink frame. */
const Face = memo(function Face({ id, sheet, expression }: { id: CharacterId; sheet: SpriteSheet; expression: Expression }) {
  const frames = sheet.frames[expression];
  const { canvas } = sheet;
  return (
    <>
      <Layer src={spriteUrl(id, `face-${expression}`)} className="cs-face" style={rectStyle(sheet.face, canvas)} />
      {frames.mouth.map((rect, i) => (
        <Layer key={i} src={spriteUrl(id, `mouth-${expression}-${(i + 1) as 1 | 2 | 3}`)} className={`cs-mouth cs-m${i + 1}`} style={rectStyle(rect, canvas)} />
      ))}
      {frames.blink && <Layer src={spriteUrl(id, `blink-${expression}`)} className="cs-blink" style={rectStyle(frames.blink, canvas)} />}
    </>
  );
});

/** 4-point star centred on (x, y). */
function star(x: number, y: number, r: number): string {
  const f = (v: number) => v.toFixed(1);
  return `M ${f(x)} ${f(y - r)} Q ${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y + r)} Q ${f(x)} ${f(y)} ${f(x - r)} ${f(y)} Q ${f(x)} ${f(y)} ${f(x)} ${f(y - r)} Z`;
}

/** Sparkles (happy) or surprise lines (surprised) beside the head, in canvas coordinates. Still: drawn, not animated. */
const MangaSymbol = memo(function MangaSymbol({ sheet, kind, still }: { sheet: SpriteSheet; kind: 'sparkle' | 'shock'; still: boolean }) {
  const anim = (cls: string) => (still ? undefined : cls);
  const [cw, ch] = sheet.canvas;
  const [hx, hy, hw, hh] = sheet.head;
  return (
    <svg className="cs-symbols" viewBox={`0 0 ${cw} ${ch}`} aria-hidden="true" focusable="false" data-part="symbols">
      {kind === 'sparkle' ? (
        <g fill="#fff8d6" stroke="#ffc861" strokeWidth={hw * 0.012} strokeLinejoin="round">
          <path className={anim('cs-sparkle')} d={star(hx + hw * 1.0, hy + hh * 0.2, hw * 0.075)} />
          <path className={anim('cs-sparkle cs-sparkle--late')} d={star(hx + hw * 0.9, hy + hh * 0.02, hw * 0.045)} />
          <path className={anim('cs-sparkle cs-sparkle--later')} d={star(hx + hw * 0.02, hy + hh * 0.1, hw * 0.055)} />
        </g>
      ) : (
        <g className={anim('cs-shock')} stroke="#43365a" strokeWidth={hw * 0.022} strokeLinecap="round" fill="none">
          {[-58, -30, -2].map((deg) => {
            const a = (deg * Math.PI) / 180;
            const ox = hx + hw * 0.93;
            const oy = hy + hh * 0.12;
            const r0 = hw * 0.07;
            const r1 = hw * 0.17;
            return (
              <line
                key={deg}
                x1={(ox + Math.cos(a) * r0).toFixed(1)}
                y1={(oy + Math.sin(a) * r0).toFixed(1)}
                x2={(ox + Math.cos(a) * r1).toFixed(1)}
                y2={(oy + Math.sin(a) * r1).toFixed(1)}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
});

export interface SpriteLayersProps {
  id: CharacterId;
  expression: Expression;
  /** Static frame: expression changes snap (no crossfade). */
  still?: boolean;
}

export function SpriteLayers({ id, expression, still = false }: SpriteLayersProps) {
  const sheet = spriteSheet(id);
  const { current, previous } = useCrossfade(expression, EXPRESSION_FADE_MS, !still);
  // The outgoing face stays underneath; the new one fades in over it (both share one mask).
  const faces: { expr: Expression; cls: string }[] = previous
    ? [
        { expr: previous, cls: 'cs-expr cs-face-out' },
        { expr: current, cls: 'cs-expr cs-face-in' },
      ]
    : [{ expr: current, cls: 'cs-expr' }];
  const symbol = EXPRESSION_MOTION[current].symbol;
  return (
    <>
      <Layer src={spriteUrl(id, 'base')} className="cs-base" />
      {faces.map(({ expr, cls }) => (
        <div key={expr} className={cls} data-expression={expr}>
          <Face id={id} sheet={sheet} expression={expr} />
        </div>
      ))}
      {symbol && <MangaSymbol key={`${current}-${symbol}`} sheet={sheet} kind={symbol} still={still} />}
    </>
  );
}
