/**
 * Haru Xia — founder & CEO of Clearsky Labs.
 * Short orange-auburn bob with a small side ponytail and an ahoge, bright amber eyes,
 * energetic grin, mustard hoodie under a navy blazer, orange lanyard badge.
 */
import { circlePath, polygon, roundRectPath, type Pt } from '../../lib/geom';
import type { CelLayer, CharacterDesign, ShadeShape } from '../model';
import { EARS_SOFT, FACE_SOFT, FEMALE_SKIN, NECK_SOFT, TORSO_SOFT, both, earDetail, fringe, highlightBand, noseSoft } from './shared';

const HAIR = {
  base: '#e27a3f',
  shade: '#c65d2d',
  deep: '#a04523',
  light: '#ffb983',
  outline: '#8e3a1b',
};
const ACCENT = '#ff9f43';

// ── hair ──────────────────────────────────────────────────────────────
const CAP =
  'M 184 256 C 172 164 220 78 300 76 C 380 78 428 164 416 256 C 406 216 390 188 362 172 C 332 156 268 156 238 172 C 212 186 194 218 184 256 Z';

const AHOGE = 'M 294 84 C 286 60 296 38 322 30 C 338 26 350 34 346 44 C 338 38 326 38 318 44 C 306 54 302 68 306 84 Z';

const FRINGE_EDGE: Pt[] = [
  [194, 234],
  [208, 222],
  [220, 194],
  [240, 220],
  [250, 198],
  [264, 212],
  [276, 188],
  [300, 224],
  [310, 196],
  [326, 212],
  [340, 190],
  [362, 220],
  [374, 198],
  [392, 222],
  [406, 234],
];
const FRINGE = fringe(FRINGE_EDGE, 'C 418 180 380 120 300 118 C 220 118 182 180 194 234', 0.15);

/** Bob side locks curling in at the jaw. */
const [SIDE_L, SIDE_R] = both(
  'M 198 212 C 180 258 176 306 184 344 C 188 360 200 366 214 358 C 206 342 206 322 210 302 C 214 280 214 250 218 226 Z',
);

const notchWedges: ShadeShape[] = FRINGE_EDGE.filter((_, i) => i % 2 === 0 && i > 0 && i < FRINGE_EDGE.length - 1).map(([x, y]) => ({
  d: polygon([
    [x - 7, y + 30],
    [x, y - 26],
    [x + 7, y + 30],
  ]),
  fill: HAIR.shade,
}));

const hairFront: CelLayer = {
  key: 'hairFront',
  shapes: [CAP, FRINGE, SIDE_L, SIDE_R, AHOGE],
  fill: HAIR.base,
  outline: HAIR.outline,
  shading: [
    { d: 'M 0 0 L 600 0 L 600 800 L 0 800 Z', fill: 'grad:hairShade' },
    ...notchWedges,
    { d: 'M 204 230 C 200 280 204 330 214 360 L 226 360 L 226 230 Z', fill: HAIR.shade },
    { d: 'M 396 230 C 400 280 396 330 386 360 L 374 360 L 374 230 Z', fill: HAIR.shade },
    { d: highlightBand({ cx: 300, cy: 264, rx: 110, ry: 146, from: 212, to: 328, width: 9, teeth: 7, toothLen: 12 }), fill: HAIR.light, opacity: 0.9 },
    { d: 'M 300 40 C 312 34 326 32 336 36 C 324 38 314 44 306 54 Z', fill: HAIR.light, opacity: 0.9 },
  ],
  lines: [
    { d: 'M 256 142 C 248 166 242 188 240 210', stroke: HAIR.deep, width: 1.5, opacity: 0.7 },
    { d: 'M 290 136 C 294 162 298 190 299 216', stroke: HAIR.deep, width: 1.5, opacity: 0.6 },
    { d: 'M 340 142 C 350 166 358 190 361 212', stroke: HAIR.deep, width: 1.5, opacity: 0.7 },
    { d: 'M 192 280 C 190 310 194 330 200 346', stroke: HAIR.deep, width: 1.4, opacity: 0.7 },
    { d: 'M 408 280 C 410 310 406 330 400 346', stroke: HAIR.deep, width: 1.4, opacity: 0.7 },
  ],
};

const PONYTAIL = 'M 414 158 C 448 146 480 166 486 204 C 492 240 474 266 486 300 C 464 292 448 270 446 242 C 444 216 434 198 414 194 Z';

const hairBack: CelLayer = {
  key: 'hairBack',
  shapes: [
    'M 300 88 C 210 88 174 152 174 234 C 174 292 178 332 188 358 C 196 374 214 374 226 360 C 256 344 344 344 374 360 C 386 374 404 374 412 358 C 422 332 426 292 426 234 C 426 152 390 88 300 88 Z',
    PONYTAIL,
  ],
  fill: HAIR.shade,
  outline: HAIR.outline,
  shading: [
    { d: 'M 452 200 C 462 230 466 260 480 294 L 500 300 L 500 180 Z', fill: HAIR.deep, opacity: 0.6 },
    { d: 'M 430 168 C 452 162 470 172 476 192 C 462 180 446 176 430 180 Z', fill: HAIR.light, opacity: 0.7 },
  ],
  lines: [{ d: 'M 440 180 C 462 196 464 230 466 256', stroke: HAIR.deep, width: 1.4, opacity: 0.8 }],
};

// ── clothes ───────────────────────────────────────────────────────────
const HOODIE = { base: '#ebb43f', shade: '#cf9429', line: '#a8741b' };
const BLAZER = { base: '#2d3b60', shade: '#222d4a', light: '#36466f', line: '#18203a' };

const hood: CelLayer = {
  key: 'hood',
  shapes: ['M 220 448 C 212 414 244 390 300 388 C 356 390 388 414 380 448 C 354 458 326 460 300 460 C 274 460 246 458 220 448 Z'],
  fill: HOODIE.shade,
  outline: HOODIE.line,
};

const hoodie: CelLayer = {
  key: 'hoodie',
  shapes: [TORSO_SOFT],
  fill: HOODIE.base,
  outline: HOODIE.line,
  shading: [
    { d: 'M 326 456 C 338 540 342 640 336 800 L 520 800 L 520 440 Z', fill: HOODIE.shade },
    { d: 'M 250 450 C 270 476 330 476 350 450 C 344 480 324 494 300 494 C 276 494 256 480 250 450 Z', fill: HOODIE.shade, opacity: 0.6 },
  ],
  lines: [{ d: 'M 244 760 C 270 752 330 752 356 760', stroke: HOODIE.line, width: 1.8 }],
};

const hoodRim: CelLayer = {
  key: 'hoodRim',
  shapes: ['M 262 404 C 270 430 288 440 300 440 C 312 440 330 430 338 404 C 346 414 348 426 342 438 C 332 454 314 460 300 460 C 286 460 268 454 258 438 C 252 426 254 414 262 404 Z'],
  fill: HOODIE.base,
  outline: HOODIE.line,
  shading: [{ d: 'M 300 452 C 318 452 334 444 342 432 L 350 440 L 350 470 L 300 470 Z', fill: HOODIE.shade }],
};

const cords: CelLayer = {
  key: 'cords',
  shapes: [
    'M 281 450 C 279 484 277 514 279 548 L 285 548 C 283 514 285 484 287 450 Z',
    'M 313 450 C 315 480 319 510 317 540 L 323 540 C 325 510 321 480 319 450 Z',
    roundRectPath(276, 546, 12, 16, 3),
    roundRectPath(314, 538, 12, 16, 3),
  ],
  fill: '#fff4dc',
  outline: '#c9a765',
  outlineWidth: 1.4,
};

const BLAZER_L =
  'M 272 408 C 238 420 186 424 156 436 C 128 448 112 472 108 508 L 94 800 L 236 800 C 238 720 240 640 244 580 C 248 520 254 466 264 428 Z';

const blazer: CelLayer = {
  key: 'blazer',
  shapes: both(BLAZER_L),
  fill: BLAZER.base,
  outline: BLAZER.line,
  shading: [
    { d: 'M 462 446 C 478 462 486 490 488 530 L 502 800 L 470 800 C 474 700 474 600 468 530 C 464 496 464 470 462 446 Z', fill: BLAZER.shade },
    { d: 'M 372 520 C 366 600 364 700 364 800 L 386 800 C 386 700 384 600 372 520 Z', fill: BLAZER.shade, opacity: 0.8 },
  ],
  lines: [
    ...both('M 150 548 C 156 630 160 720 158 800').map((d) => ({ d, stroke: BLAZER.line, width: 1.8, opacity: 0.9 })),
    ...both('M 128 690 Q 138 700 150 696').map((d) => ({ d, stroke: BLAZER.line, width: 1.4, opacity: 0.6 })),
  ],
};

const LAPEL_L = 'M 270 410 C 262 450 254 500 248 550 C 246 570 244 590 244 606 L 232 566 C 222 536 214 506 210 482 L 228 470 L 216 458 C 228 436 248 418 270 410 Z';

const lapels: CelLayer = {
  key: 'lapels',
  shapes: both(LAPEL_L),
  fill: BLAZER.light,
  outline: BLAZER.line,
  outlineWidth: 1.8,
};

const lanyard: CelLayer = {
  key: 'lanyard',
  shapes: [
    'M 276 418 C 280 480 288 540 296 586 L 303 586 C 296 540 288 480 283 418 Z',
    'M 324 418 C 320 480 312 540 304 586 L 297 586 C 304 540 312 480 317 418 Z',
  ],
  fill: ACCENT,
  outline: '#c36a1c',
  outlineWidth: 1.4,
};

const BADGE = roundRectPath(270, 594, 60, 80, 7);
const badge: CelLayer = {
  key: 'badge',
  shapes: [BADGE, roundRectPath(293, 580, 14, 18, 3)],
  fill: '#ffffff',
  outline: '#a9b1c2',
  outlineWidth: 1.6,
  shading: [
    { d: 'M 260 590 L 340 590 L 340 614 L 260 614 Z', fill: ACCENT },
    { d: circlePath(300, 603, 5), fill: '#fff4d6' },
    { d: roundRectPath(278, 622, 18, 20, 2), fill: '#ffd9b3' },
    { d: 'M 302 624 L 322 624 L 322 628 L 302 628 Z', fill: '#c9cfdb' },
    { d: 'M 302 633 L 318 633 L 318 637 L 302 637 Z', fill: '#c9cfdb' },
    { d: 'M 278 650 L 322 650 L 322 654 L 278 654 Z', fill: '#c9cfdb' },
    { d: 'M 278 659 L 310 659 L 310 663 L 278 663 Z', fill: '#c9cfdb' },
    { d: 'M 318 594 L 340 594 L 340 680 L 318 680 Z', fill: '#e8ecf3', opacity: 0.6 },
  ],
};

// ── scrunchie on the side ponytail ─────────────────────────────────────
const SCRUNCHIE_C: Pt = [420, 176];
const scrunchie: CelLayer = {
  key: 'scrunchie',
  shapes: [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return circlePath(SCRUNCHIE_C[0] + Math.cos(a) * 7, SCRUNCHIE_C[1] + Math.sin(a) * 10, 6);
  }),
  fill: '#7cc8f4',
  outline: '#3a86bd',
  outlineWidth: 1.5,
  shading: [
    { d: circlePath(SCRUNCHIE_C[0] + 4, SCRUNCHIE_C[1] + 5, 10), fill: '#56aee3', opacity: 0.8 },
    { d: circlePath(SCRUNCHIE_C[0] - 4, SCRUNCHIE_C[1] - 7, 4), fill: '#e2f4ff' },
  ],
};

export const HARU: CharacterDesign = {
  id: 'haru',
  skin: FEMALE_SKIN,
  face: FACE_SOFT,
  ears: EARS_SOFT,
  earDetail: earDetail(FEMALE_SKIN),
  neck: NECK_SOFT,
  chinShadowOffset: 16,
  nose: noseSoft(FEMALE_SKIN),
  bangShadow: { shapes: [CAP, FRINGE], dx: 2, dy: 9 },
  eyes: {
    cx: 252,
    cy: 254,
    w: 29,
    h: 27,
    hLow: 24,
    droop: 0,
    innerY: 4,
    lash: 4.4,
    flick: 5,
    spikes: true,
    irisRx: 20,
    irisRy: 24.5,
    irisDy: 2,
    pupilRx: 8,
    pupilRy: 10.5,
    colors: {
      lash: '#4a2313',
      sclera: '#ffffff',
      scleraShade: '#f1e2dc',
      irisDeep: '#5a2a08',
      irisDark: '#a65a12',
      iris: '#e59c2c',
      irisLight: '#ffdb8c',
      lowerLash: '#8a5030',
    },
  },
  brows: { cx: 250, y: 207, len: 21, thick: 5.2, color: '#7a3217' },
  mouth: { x: 300, y: 327, scale: 1, line: '#bb5c60', inner: '#8c3046', tongue: '#e7818f', teeth: '#ffffff' },
  mouthOverrides: { neutral: { closed: 'smile', family: 'smile' }, smile: { closed: 'grin' } },
  blushScale: 0.95,
  blushHatch: true,
  gradients: [
    {
      kind: 'linear',
      name: 'hairShade',
      x1: 0,
      y1: 140,
      x2: 0,
      y2: 370,
      stops: [
        [0, HAIR.deep, 0],
        [1, HAIR.deep, 0.4],
      ],
    },
  ],
  hairBack: [hairBack],
  bodyBack: [hood],
  body: [hoodie, hoodRim, cords, blazer, lapels, lanyard, badge],
  midAccessories: [],
  hairFront: [hairFront],
  topAccessories: [scrunchie],
  extrasAnchor: {
    sweat: [414, 214],
    sparkles: [
      [164, 150, 13],
      [240, 52, 8],
      [160, 232, 7],
    ],
    shock: [372, 76],
  },
  portraitCrop: [106, 28, 388],
};
