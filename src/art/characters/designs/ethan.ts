/**
 * Ethan Gu — engineering director at DeepBlue Engine.
 * Short neat black hair with a blue sheen and slightly messy bangs, thin rectangular
 * glasses, sharp calm steel-blue eyes, charcoal suit with white shirt and dark tie.
 */
import { circlePath, polygon, roundRectPath, type Pt } from '../../lib/geom';
import type { CelLayer, CharacterDesign, ShadeShape } from '../model';
import { EARS_SHARP, FACE_SHARP, MALE_SKIN, NECK_SHARP, both, earDetail, fringe, highlightBand, noseSharp } from './shared';

const HAIR = {
  base: '#2b303e',
  shade: '#1d212c',
  deep: '#13161e',
  sheen: '#5a78a6',
  outline: '#0e1016',
};
const ACCENT = '#4a90d9';

// ── hair ──────────────────────────────────────────────────────────────
const CAP =
  'M 192 250 C 178 160 220 64 302 62 C 386 64 426 160 408 250 C 402 214 388 186 364 170 C 336 154 268 152 238 166 C 214 180 198 212 192 250 Z';
/** A couple of flicks that follow the head give the silhouette a slightly unruly edge. */
const TUFTS = ['M 298 72 C 310 58 328 52 344 56 C 332 60 322 66 316 76 Z'];

const FRINGE_EDGE: Pt[] = [
  [194, 236],
  [198, 258],
  [204, 216],
  [222, 210],
  [232, 186],
  [256, 206],
  [262, 186],
  [292, 220],
  [294, 192],
  [320, 210],
  [326, 190],
  [354, 212],
  [358, 192],
  [384, 214],
  [394, 202],
  [403, 258],
  [406, 236],
];
const FRINGE = fringe(FRINGE_EDGE, 'C 414 180 376 120 300 118 C 232 118 194 170 194 236', 0.5);

const notchWedges: ShadeShape[] = FRINGE_EDGE.filter((_, i) => i % 2 === 0 && i > 1 && i < FRINGE_EDGE.length - 2).map(([x, y]) => ({
  d: polygon([
    [x - 6, y + 28],
    [x - 10, y - 26],
    [x + 9, y + 28],
  ]),
  fill: HAIR.shade,
}));

const hairFront: CelLayer = {
  key: 'hairFront',
  shapes: [CAP, FRINGE, ...TUFTS],
  fill: HAIR.base,
  outline: HAIR.outline,
  shading: [
    { d: 'M 0 0 L 600 0 L 600 800 L 0 800 Z', fill: 'grad:hairShade' },
    ...notchWedges,
    { d: highlightBand({ cx: 300, cy: 262, rx: 104, ry: 158, from: 220, to: 320, width: 7, teeth: 6, toothLen: 10 }), fill: HAIR.sheen, opacity: 0.6 },
  ],
  lines: [
    { d: 'M 262 138 C 276 164 286 190 290 214', stroke: HAIR.deep, width: 1.6, opacity: 0.9 },
    { d: 'M 300 134 C 314 158 320 184 322 206', stroke: HAIR.deep, width: 1.6, opacity: 0.9 },
    { d: 'M 334 140 C 348 164 354 188 356 208', stroke: HAIR.deep, width: 1.6, opacity: 0.9 },
    { d: 'M 236 150 C 232 170 230 186 230 200', stroke: HAIR.deep, width: 1.4, opacity: 0.8 },
  ],
};

const hairBack: CelLayer = {
  key: 'hairBack',
  shapes: ['M 300 80 C 218 80 190 146 192 214 C 193 240 196 256 202 266 L 398 266 C 404 256 407 240 408 214 C 410 146 382 80 300 80 Z'],
  fill: HAIR.shade,
  outline: HAIR.outline,
};

// ── glasses ───────────────────────────────────────────────────────────
const FRAME = '#2e3647';
const [LENS_L, LENS_R] = both(roundRectPath(216, 234, 74, 48, 9));
const glassesLenses: CelLayer = {
  key: 'lenses',
  shapes: [LENS_L, LENS_R],
  fill: 'rgba(214, 232, 250, 0.16)',
  outline: FRAME,
  outlineWidth: 1.2,
  shading: [
    ...both('M 262 262 L 280 226 L 292 226 L 274 262 Z').map((d) => ({ d, fill: '#ffffff', opacity: 0.28 })),
    ...both('M 278 262 L 296 226 L 300 226 L 282 262 Z').map((d) => ({ d, fill: '#ffffff', opacity: 0.2 })),
  ],
  lines: [
    // heavier browline top bar
    ...both('M 222 235 C 240 233 270 233 286 235').map((d) => ({ d, stroke: FRAME, width: 3.4 })),
    { d: 'M 290 250 Q 300 243 310 250', stroke: FRAME, width: 2.6 },
    ...both('M 216 246 L 198 244').map((d) => ({ d, stroke: FRAME, width: 2.4 })),
  ],
};

// ── clothes ───────────────────────────────────────────────────────────
const SHIRT = { base: '#f6f8fc', shade: '#dfe5ee', line: '#97a3b6' };
const SUIT = { base: '#3a3f4b', shade: '#2d313b', light: '#464c5a', line: '#1d2027' };
const TIE = { base: '#26355a', shade: '#1c2846', line: '#121a2e' };

const shirt: CelLayer = {
  key: 'shirt',
  shapes: ['M 270 414 L 330 414 L 352 800 L 248 800 Z'],
  fill: SHIRT.base,
  outline: SHIRT.line,
  shading: [{ d: 'M 314 440 C 322 520 326 600 320 800 L 360 800 L 360 420 Z', fill: SHIRT.shade }],
};

const tie: CelLayer = {
  key: 'tie',
  shapes: ['M 289 438 L 311 438 L 306 458 L 294 458 Z', 'M 294 456 L 306 456 L 317 610 L 300 636 L 283 610 Z'],
  fill: TIE.base,
  outline: TIE.line,
  outlineWidth: 1.8,
  shading: [
    { d: 'M 300 440 L 320 440 L 320 640 L 300 640 Z', fill: TIE.shade },
    ...[480, 520, 560, 600].map((y) => ({ d: polygon([[280, y + 14], [320, y - 12], [320, y - 6], [280, y + 20]]), fill: ACCENT, opacity: 0.55 })),
  ],
};

const collar: CelLayer = {
  key: 'collar',
  shapes: both('M 268 404 C 276 420 288 432 296 446 L 278 466 C 268 448 260 428 258 410 Z'),
  fill: '#fbfcfe',
  outline: SHIRT.line,
  shading: both('M 262 418 C 266 436 272 450 280 462 L 286 454 C 276 444 270 432 266 418 Z').map((d) => ({ d, fill: SHIRT.shade })),
};

const JACKET_L =
  'M 266 408 C 226 422 166 426 132 440 C 104 452 92 478 88 518 L 74 800 L 300 800 L 300 692 C 290 650 274 580 264 520 C 258 480 256 440 266 408 Z';

const jacket: CelLayer = {
  key: 'jacket',
  shapes: both(JACKET_L),
  fill: SUIT.base,
  outline: SUIT.line,
  shading: [
    { d: 'M 478 450 C 496 468 508 500 510 540 L 526 800 L 488 800 C 494 700 494 600 488 540 C 484 506 482 476 478 450 Z', fill: SUIT.shade },
    { d: 'M 318 600 C 340 640 356 700 360 800 L 300 800 L 300 600 Z', fill: SUIT.shade, opacity: 0.8 },
  ],
  lines: [
    ...both('M 138 560 C 144 640 148 720 146 800').map((d) => ({ d, stroke: SUIT.line, width: 1.8, opacity: 0.9 })),
    { d: 'M 300 692 L 303 800', stroke: SUIT.line, width: 2 },
    { d: 'M 370 566 L 424 560', stroke: SUIT.line, width: 2 },
  ],
};

const LAPEL_L =
  'M 266 410 C 256 440 258 480 264 520 C 274 580 290 650 300 692 L 290 668 C 268 612 244 556 230 506 L 248 488 L 234 478 C 240 450 250 426 266 410 Z';

const lapels: CelLayer = {
  key: 'lapels',
  shapes: both(LAPEL_L),
  fill: SUIT.light,
  outline: SUIT.line,
  outlineWidth: 1.8,
  shading: both('M 250 500 C 262 560 280 630 296 686 L 300 686 C 290 640 274 580 262 520 C 258 500 256 480 256 470 Z').map((d) => ({
    d,
    fill: SUIT.shade,
  })),
};

const button: CelLayer = {
  key: 'button',
  shapes: [circlePath(300, 704, 6)],
  fill: '#23262e',
  outline: '#121419',
  outlineWidth: 1.2,
};

const pocketSquare: CelLayer = {
  key: 'pocketSquare',
  shapes: ['M 378 563 C 380 554 383 548 387 543 C 390 549 392 553 394 556 C 397 550 401 545 405 541 C 408 548 410 555 411 560 Z'],
  fill: ACCENT,
  outline: '#2c6aa8',
  outlineWidth: 1.4,
};

export const ETHAN: CharacterDesign = {
  id: 'ethan',
  skin: MALE_SKIN,
  face: FACE_SHARP,
  ears: EARS_SHARP,
  earDetail: earDetail(MALE_SKIN),
  neck: NECK_SHARP,
  chinShadowOffset: 18,
  nose: noseSharp(MALE_SKIN),
  bangShadow: { shapes: [CAP, FRINGE], dx: 3, dy: 8 },
  eyes: {
    cx: 254,
    cy: 258,
    w: 28,
    h: 19,
    hLow: 17,
    droop: -3,
    innerY: 4,
    lash: 4.2,
    flick: 2,
    spikes: false,
    irisRx: 15.5,
    irisRy: 18,
    irisDy: 2,
    pupilRx: 6.5,
    pupilRy: 8.5,
    colors: {
      lash: '#1b1f2a',
      sclera: '#ffffff',
      scleraShade: '#dde3ee',
      irisDeep: '#1c2839',
      irisDark: '#33506f',
      iris: '#5b80a8',
      irisLight: '#aecbe6',
      lowerLash: '#4d5767',
    },
  },
  brows: { cx: 252, y: 219, len: 25, thick: 6.2, color: '#191c25' },
  mouth: { x: 300, y: 337, scale: 1.05, line: '#a45e58', inner: '#7a3038', tongue: '#d77a82', teeth: '#ffffff' },
  mouthOverrides: { smile: { closed: 'smirk' }, happy: { closed: 'grin' } },
  blushScale: 0.35,
  blushHatch: false,
  gradients: [
    {
      kind: 'linear',
      name: 'hairShade',
      x1: 0,
      y1: 120,
      x2: 0,
      y2: 280,
      stops: [
        [0, HAIR.deep, 0],
        [1, HAIR.deep, 0.35],
      ],
    },
  ],
  hairBack: [hairBack],
  body: [shirt, tie, collar, jacket, lapels, button, pocketSquare],
  midAccessories: [glassesLenses],
  hairFront: [hairFront],
  topAccessories: [],
  extrasAnchor: {
    sweat: [418, 224],
    sparkles: [
      [176, 140, 11],
      [430, 110, 8],
      [446, 188, 6],
    ],
    shock: [420, 92],
  },
  portraitCrop: [112, 66, 376],
};
