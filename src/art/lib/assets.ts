/**
 * The painted art (AI-generated with the Codex CLI's image tool, packed by tools/art/build.py):
 * WebP files under src/art/assets plus the generated ART_MANIFEST describing how sprite layers fit.
 *
 * A sprite is one base picture (neutral face) with layers on top, all in canvas pixels:
 *   face-<expr>        the face for an expression — every expression's face layer shares one rect/mask
 *   mouth-<expr>-<k>   talking frames 1 (lips parted) … 3 (open), over that expression's face
 *   blink-<expr>       eyes closed, over that expression's face (absent where the eyes are closed anyway)
 */
import { ART_MANIFEST } from '../assets/manifest';
import type { CharacterId, EndingId, Expression } from '../../types';

/** x, y, width, height in canvas pixels. */
export type Rect = readonly [number, number, number, number];

export interface ExpressionFrames {
  mouth: readonly [Rect, Rect, Rect];
  blink?: Rect;
}

export interface SpriteSheet {
  /** Canvas size of base.webp: 1280 px high, at least 960 wide (wider where the shoulders need it). */
  canvas: readonly [number, number];
  /** Square head-and-shoulders crop for portraits: x, y, edge. */
  portrait: readonly [number, number, number];
  /** Where the head is, for manga symbols around it. */
  head: Rect;
  /** The shared rect of every face-<expr> layer. */
  face: Rect;
  frames: Record<Expression, ExpressionFrames>;
}

export interface ArtManifest {
  characters: Record<CharacterId, SpriteSheet>;
}

export type OfficeVariant = 'day' | 'evening';
export type BackgroundName = `office-${CharacterId}-${OfficeVariant}` | 'title' | 'lobby' | `ending-${EndingId}`;

// no-inline: tiny patches would otherwise be base64-inlined into the entry chunk
const FILES = import.meta.glob<string>('../assets/**/*.webp', { eager: true, query: '?no-inline', import: 'default' });

function fileUrl(path: string): string {
  const url = FILES[`../assets/${path}.webp`];
  if (!url) throw new Error(`missing art asset: ${path}.webp`);
  return url;
}

export function spriteSheet(id: CharacterId): SpriteSheet {
  return ART_MANIFEST.characters[id];
}

export type SpriteLayerName = 'base' | `face-${Expression}` | `mouth-${Expression}-${1 | 2 | 3}` | `blink-${Expression}`;

export function spriteUrl(id: CharacterId, layer: SpriteLayerName): string {
  return fileUrl(`characters/${id}/${layer}`);
}

export function backgroundUrl(name: BackgroundName): string {
  return fileUrl(`backgrounds/${name}`);
}

/** CSS box of a canvas rect, as percentages of the canvas. */
export function rectStyle(rect: Rect, canvas: readonly [number, number]): { left: string; top: string; width: string; height: string } {
  const [x, y, w, h] = rect;
  const [cw, ch] = canvas;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(4)}%`;
  return { left: pct(x, cw), top: pct(y, ch), width: pct(w, cw), height: pct(h, ch) };
}

/** Every layer of a character (for warming the image cache before the first expression change). */
export function spriteUrls(id: CharacterId): string[] {
  const sheet = spriteSheet(id);
  const urls = [spriteUrl(id, 'base')];
  for (const expr of Object.keys(sheet.frames) as Expression[]) {
    urls.push(spriteUrl(id, `face-${expr}`));
    for (const k of [1, 2, 3] as const) urls.push(spriteUrl(id, `mouth-${expr}-${k}`));
    if (sheet.frames[expr].blink) urls.push(spriteUrl(id, `blink-${expr}`));
  }
  return urls;
}

const warmed = new Set<string>();
/** Keep references so the browser does not drop the decoded images. */
const keep: HTMLImageElement[] = [];

/**
 * Load (once per session, when the browser is idle) every layer of a character, so expression
 * changes never flash. The layers on screen load first, with the page.
 */
export function preloadSprite(id: CharacterId): void {
  if (warmed.has(id) || typeof Image !== 'function') return;
  warmed.add(id);
  const load = () => {
    for (const url of spriteUrls(id)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      keep.push(img);
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(load, { timeout: 2000 });
  else setTimeout(load, 300);
}
