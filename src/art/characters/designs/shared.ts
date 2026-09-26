/** Building blocks shared by the character designs. */
import { mirrorPath, n, p, type Pt } from '../../lib/geom';
import type { DetailLine, SkinPalette } from '../model';

/**
 * A fringe (bangs) edge: `edge` alternates notches and tips (any order, left→right).
 * Descending segments curve like a hair clump sweeping into its tip; ascending ones
 * rise steeply back to the next notch. `sweep` (−1…1) leans the tips sideways.
 * `close` continues the path from the last edge point back over the top (absolute commands).
 */
export function fringe(edge: readonly Pt[], close: string, sweep = 0): string {
  let d = `M ${p(edge[0])}`;
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1];
    const b = edge[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dy >= 0) {
      // into a tip: fall first, then glide into the point
      const c1: Pt = [a[0] + dx * (0.12 - sweep * 0.08), a[1] + dy * 0.62];
      const c2: Pt = [b[0] - dx * (0.4 + sweep * 0.1), b[1] - dy * 0.1];
      d += ` C ${p(c1)} ${p(c2)} ${p(b)}`;
    } else {
      // back up to a notch: short and steep
      const c1: Pt = [a[0] + dx * (0.2 + sweep * 0.1), a[1] + dy * 0.35];
      const c2: Pt = [b[0] - dx * 0.08, b[1] - dy * 0.35];
      d += ` C ${p(c1)} ${p(c2)} ${p(b)}`;
    }
  }
  return `${d} ${close} Z`;
}

/** Both a path and its mirror image around x = 300. */
export function both(d: string): [string, string] {
  return [d, mirrorPath(d)];
}

export const FEMALE_SKIN: SkinPalette = {
  base: '#fff0e6',
  shade: '#f6cfc1',
  line: '#cf9082',
  light: '#fffaf5',
  blush: '#ff8da4',
  blushLine: '#ee6d8b',
};

export const MALE_SKIN: SkinPalette = {
  base: '#fdebdf',
  shade: '#f0c6b4',
  line: '#c28573',
  light: '#fff7f0',
  blush: '#f39a9a',
  blushLine: '#d9707a',
};

/** Soft, slightly narrow-chinned face (female). */
export const FACE_SOFT =
  'M 204 196 C 203 250 213 292 237 322 C 257 347 281 360 300 361 C 319 360 343 347 363 322 C 387 292 397 250 396 196 C 396 128 352 98 300 98 C 248 98 204 128 204 196 Z';

/** Longer face with a firmer jaw (male). */
export const FACE_SHARP =
  'M 205 196 C 204 256 212 296 232 326 C 252 354 280 369 300 370 C 320 369 348 354 368 326 C 388 296 396 256 395 196 C 395 126 351 95 300 95 C 249 95 205 126 205 196 Z';

export const EARS_SOFT = both('M 208 234 C 193 224 182 238 186 257 C 189 274 197 288 213 292 Z');
export const EARS_SHARP = both('M 208 232 C 192 222 180 238 184 258 C 187 277 196 292 214 296 Z');

export function earDetail(skin: SkinPalette): DetailLine[] {
  return both('M 203 245 C 194 242 192 254 196 264 C 198 270 202 274 206 276').map((d) => ({
    d,
    stroke: skin.line,
    width: 1.5,
    opacity: 0.7,
  }));
}

export const NECK_SOFT = 'M 277 316 C 278 350 277 384 273 410 C 290 419 310 419 327 410 C 323 384 322 350 323 316 Z';
export const NECK_SHARP = 'M 269 318 C 270 354 269 388 264 414 C 286 425 314 425 336 414 C 331 388 330 354 331 318 Z';

/** Torso silhouette including the upper arms, down to the bottom edge. */
export const TORSO_SOFT =
  'M 273 404 C 238 418 186 424 156 436 C 128 448 112 472 108 508 L 94 800 L 506 800 L 492 508 C 488 472 472 448 444 436 C 414 424 362 418 327 404 Z';

export function noseSoft(skin: SkinPalette): DetailLine[] {
  return [{ d: 'M 303 292 Q 306 299 300 302', stroke: skin.line, width: 1.8, opacity: 0.75 }];
}

export function noseSharp(skin: SkinPalette): DetailLine[] {
  return [
    { d: 'M 304 282 Q 308 297 301 303', stroke: skin.line, width: 1.8, opacity: 0.75 },
    { d: 'M 296 304 L 300 305', stroke: skin.line, width: 1.4, opacity: 0.5 },
  ];
}

export interface HighlightBandOptions {
  cx: number;
  cy: number;
  /** Outer edge radii of the band (it follows the curve of the skull). */
  rx: number;
  ry: number;
  /** Arc span in degrees (0° = right, 270° = top). */
  from: number;
  to: number;
  /** Band thickness between teeth. */
  width: number;
  /** Number of teeth pointing down the hair flow (towards the centre). */
  teeth: number;
  toothLen: number;
}

/** Anime "angel ring" highlight: a thin arc band with soft teeth pointing down the hair. */
export function highlightBand(o: HighlightBandOptions): string {
  const steps = o.teeth * 2;
  const at = (deg: number, shrink: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [o.cx + Math.cos(a) * (o.rx - shrink), o.cy + Math.sin(a) * (o.ry - shrink)];
  };
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  const fine = steps * 4;
  for (let i = 0; i <= fine; i++) outer.push(at(o.from + ((o.to - o.from) * i) / fine, 0));
  for (let i = 0; i <= steps; i++) {
    const deg = o.from + ((o.to - o.from) * i) / steps;
    // taper the band towards both ends
    const taper = Math.sin((Math.PI * i) / steps);
    const tooth = i % 2 === 1 ? o.toothLen * taper : 0;
    inner.push(at(deg, (o.width + tooth) * (0.2 + 0.8 * taper)));
  }
  const pts = [...outer, ...inner.reverse()];
  return `M ${pts.map((pt) => `${n(pt[0])} ${n(pt[1])}`).join(' L ')} Z`;
}
