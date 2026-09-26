/**
 * Pure geometry for the expressive face parts (eyes, brows, mouths).
 * Everything is computed from the design + expression spec so each character
 * can have its own eye shape while sharing the construction.
 */
import { add, cubicAt, ellipsePath, lerp, mirrorPath, n, p, type Pt } from '../lib/geom';
import type { BrowSpec, EyeSpec } from './expressions';
import type { BrowDesign, EyeDesign, MouthFamily, MouthShapeId } from './model';

export type Side = 'L' | 'R';

export interface EyeGeometry {
  white: string;
  lash: string;
  spikes: string[];
  crease: string | null;
  lowerLash: string;
  shadowBand: string;
  iris: { cx: number; cy: number; rx: number; ry: number };
  pupil: { rx: number; ry: number };
  /** Blink: closed-lid line. */
  closed: string;
  /** Short outer wing drawn with the closed lid. */
  closedWing: string;
}

/** x for an "outward" offset: the left eye's outer corner is towards −x. */
function outX(d: EyeDesign, side: Side, lx: number): number {
  return side === 'L' ? d.cx - lx : 600 - d.cx + lx;
}

/** Quadratic through three points (control chosen so the curve passes through `mid`). */
function quadThrough(a: Pt, mid: Pt, b: Pt): string {
  const c: Pt = [2 * mid[0] - (a[0] + b[0]) / 2, 2 * mid[1] - (a[1] + b[1]) / 2];
  return `M ${p(a)} Q ${p(c)} ${p(b)}`;
}

export function eyeGeometry(d: EyeDesign, side: Side, s: EyeSpec): EyeGeometry {
  const X = (lx: number) => outX(d, side, lx);
  const dirOut = side === 'L' ? -1 : 1;

  const O: Pt = [X(d.w), d.cy + d.droop + s.droopAdd];
  const I: Pt = [X(-d.w * 0.92), d.cy + d.innerY];
  const topY = d.cy - d.h * s.open;
  const T: Pt = [X(d.w * 0.12), topY];
  const botY = d.cy + d.hLow - s.lowerLift;
  const B: Pt = [X(-d.w * 0.05), botY];

  // Upper lid: O → T → I
  const c1: Pt = [X(d.w * 0.98), O[1] - (O[1] - topY) * 0.72];
  const c2: Pt = [X(d.w * 0.6), topY];
  const c3: Pt = [X(-d.w * 0.42), topY - s.innerRaise];
  const c4: Pt = [X(-d.w * 0.88), I[1] - (I[1] - topY) * 0.6 - s.innerRaise];
  // Lower lid: I → B → O
  const c5: Pt = [X(-d.w * 0.94), I[1] + (botY - I[1]) * 0.6];
  const c6: Pt = [X(-d.w * 0.5), botY];
  const c7: Pt = [X(d.w * 0.45), botY];
  const c8: Pt = [X(d.w * 1.0), O[1] + (botY - O[1]) * 0.45];

  const upper = `M ${p(O)} C ${p(c1)} ${p(c2)} ${p(T)} C ${p(c3)} ${p(c4)} ${p(I)}`;
  const white = `${upper} C ${p(c5)} ${p(c6)} ${p(B)} C ${p(c7)} ${p(c8)} ${p(O)} Z`;

  // Upper lash: thick at the outer corner, tapering towards the inner corner.
  const tOut = d.lash * 1.3;
  const tMid = d.lash;
  const tIn = d.lash * 0.35;
  const up = (pt: Pt, t: number): Pt => add(pt, 0, -t);
  const O2: Pt = [X(d.w + 1.5), O[1] - tOut];
  const k1 = up(c1, lerp(tOut, tMid, 0.33));
  const k2 = up(c2, lerp(tOut, tMid, 0.66));
  const T2 = up(T, tMid);
  const k3 = up(c3, lerp(tMid, tIn, 0.33));
  const k4 = up(c4, lerp(tMid, tIn, 0.66));
  const I2 = up(I, tIn);
  const F: Pt = [X(d.w + d.flick), O[1] + d.flick * 0.4];
  const lash = `${upper} L ${p(I2)} C ${p(k4)} ${p(k3)} ${p(T2)} C ${p(k2)} ${p(k1)} ${p(O2)} L ${p(F)} Z`;

  const spikes: string[] = [];
  if (d.spikes) {
    for (const [t, len] of [
      [0.1, 6],
      [0.28, 4.5],
    ] as const) {
      const a = cubicAt(O2, k1, k2, T2, Math.max(0, t - 0.06));
      const b = cubicAt(O2, k1, k2, T2, t + 0.06);
      const m = cubicAt(O2, k1, k2, T2, t);
      const tip: Pt = [m[0] + dirOut * len * 0.7, m[1] - len];
      spikes.push(`M ${p(a)} L ${p(tip)} L ${p(b)} Z`);
    }
  }

  const crease =
    s.open >= 0.85
      ? quadThrough(
          add(cubicAt(O2, k1, k2, T2, 0.45), 0, -4.5),
          add(T2, 0, -7),
          add(cubicAt(T2, k3, k4, I2, 0.55), 0, -4),
        )
      : null;

  const lowerLash = quadThrough(cubicAt(B, c7, c8, O, 0.3), cubicAt(B, c7, c8, O, 0.62), cubicAt(B, c7, c8, O, 0.9));

  const band = 8.5;
  const shadowBand =
    `${upper} L ${p(add(I, 0, band * 0.7))} C ${p(add(c4, 0, band))} ${p(add(c3, 0, band))} ${p(add(T, 0, band))} ` +
    `C ${p(add(c2, 0, band))} ${p(add(c1, 0, band))} ${p(add(O, 0, band * 0.6))} Z`;

  const iris = {
    cx: X(-d.w * 0.02) + s.lookX,
    cy: d.cy + d.irisDy + s.lookY,
    rx: d.irisRx * s.irisScale,
    ry: d.irisRy * s.irisScale,
  };
  const pupil = { rx: d.pupilRx * s.irisScale * s.pupilScale, ry: d.pupilRy * s.irisScale * s.pupilScale };

  const closedMid: Pt = [X(d.w * 0.05), (O[1] + I[1]) / 2 + d.hLow * 0.42];
  const closed = quadThrough(O, closedMid, I);
  const closedWing = `M ${p(O)} L ${p(F)}`;

  return { white, lash, spikes, crease, lowerLash, shadowBand, iris, pupil, closed, closedWing };
}

/** Closed happy eye "^". */
export function eyeArc(d: EyeDesign, side: Side): { arc: string; wing: string } {
  const X = (lx: number) => outX(d, side, lx);
  const a: Pt = [X(d.w * 0.95), d.cy + 6];
  const b: Pt = [X(-d.w * 0.88), d.cy + 6];
  const mid: Pt = [X(d.w * 0.05), d.cy - d.h * 0.5];
  const wing: Pt = [X(d.w + d.flick * 0.8), d.cy + 9];
  return { arc: quadThrough(a, mid, b), wing: `M ${p(a)} L ${p(wing)}` };
}

/** Tapered brow shape (thick inner end). */
export function browPath(d: BrowDesign, side: Side, s: BrowSpec): string {
  const Po: Pt = [d.cx - d.len, d.y - s.outer];
  const Pi: Pt = [d.cx + d.len, d.y - s.inner];
  const mid: Pt = [d.cx - d.len * 0.1, (Po[1] + Pi[1]) / 2 - s.arch];
  const t = d.thick;
  const path =
    `M ${p(Po)} Q ${p(add(mid, 0, -t * 0.55))} ${p(add(Pi, 0, -t * 0.5))} ` +
    `Q ${n(Pi[0] + t * 0.45)} ${n(Pi[1])} ${p(add(Pi, 0, t * 0.5))} ` +
    `Q ${p(add(mid, 0, t * 0.45))} ${p(Po)} Z`;
  return side === 'L' ? path : mirrorPath(path);
}

// ───────────────────────── Mouths ─────────────────────────

export interface MouthShape {
  /** Filled opening (null for line mouths). */
  fill: string | null;
  /** Stroke-only line mouth (null for filled ones). */
  line: string | null;
  /** Local height of the opening (for tongue / teeth placement). */
  w: number;
  h: number;
  top: number;
  teeth: boolean;
}

const line = (d: string): MouthShape => ({ fill: null, line: d, w: 0, h: 0, top: 0, teeth: false });

/** Closed (level 0) mouth shapes in local coordinates around (0, 0). */
export function closedMouth(id: MouthShapeId): MouthShape {
  switch (id) {
    case 'line':
      return line('M -8 0 Q 0 2.2 8 0');
    case 'smile':
      return line('M -12 -3 Q 0 8 12 -3');
    case 'smirk':
      return line('M -10 1 Q 2 4.5 10 -3.5');
    case 'pursed':
      return line('M -3 1 Q 3 -1.8 9 1.6');
    case 'firm':
      return line('M -10 0.8 Q 0 -0.8 10 0.8');
    case 'wavy':
      return line('M -11 1.5 Q -5.5 -3 0 0.5 Q 5.5 4 11 -0.5');
    case 'grin':
      return { fill: 'M -13 -2.5 Q 0 1.5 13 -2.5 Q 11 10 0 11 Q -11 10 -13 -2.5 Z', line: null, w: 13, h: 11, top: -2.5, teeth: true };
    case 'bigSmile':
      return { fill: 'M -17 -4 Q 0 0.5 17 -4 Q 15 15 0 17 Q -15 15 -17 -4 Z', line: null, w: 17, h: 17, top: -4, teeth: true };
    case 'o':
      return { fill: ellipsePath(0, 2, 5.5, 7), line: null, w: 5.5, h: 9, top: -5, teeth: false };
  }
}

/** Open mouth for lip-sync level 1–3. */
export function openMouth(family: MouthFamily, level: 1 | 2 | 3): MouthShape {
  const i = level - 1;
  switch (family) {
    case 'oval': {
      const w = [6.5, 8.5, 9.5][i];
      const h = [4.5, 7.5, 10.5][i];
      return {
        fill: `M ${-w} 0 Q 0 ${n(-h * 0.3)} ${w} 0 Q ${n(w * 0.85)} ${h} 0 ${h} Q ${n(-w * 0.85)} ${h} ${-w} 0 Z`,
        line: null,
        w,
        h,
        top: -h * 0.15,
        teeth: false,
      };
    }
    case 'smile':
    case 'wide': {
      const big = family === 'wide';
      const w = (big ? [14, 16, 17] : [10.5, 12.5, 14])[i];
      const h = (big ? [9, 13, 17] : [6, 10, 13.5])[i];
      return {
        fill: `M ${-w} -2.5 Q 0 1 ${w} -2.5 Q ${n(w * 0.85)} ${h} 0 ${h} Q ${n(-w * 0.85)} ${h} ${-w} -2.5 Z`,
        line: null,
        w,
        h,
        top: -1.5,
        teeth: level >= 2,
      };
    }
    case 'o': {
      const rx = [4.8, 6, 7.2][i];
      const ry = [5.5, 8, 10][i];
      return { fill: ellipsePath(0, ry * 0.35, rx, ry), line: null, w: rx, h: ry * 1.35, top: -ry * 0.65, teeth: false };
    }
    case 'wavy': {
      const w = [7.5, 9, 10.5][i];
      const h = [4.5, 6.5, 9][i];
      return {
        fill: `M ${-w} 1.5 Q 0 -2 ${w} -0.5 Q ${n(w * 0.75)} ${h} 0 ${h} Q ${n(-w * 0.8)} ${h} ${-w} 1.5 Z`,
        line: null,
        w,
        h,
        top: -1,
        teeth: false,
      };
    }
  }
}
