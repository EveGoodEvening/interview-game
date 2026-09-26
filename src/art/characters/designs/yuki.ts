/**
 * Yuki Lin — HR manager at Stellar Tech.
 * Long wavy dark-brown hair with side-swept bangs, pink flower clip, gentle droopy
 * rose-brown eyes, cream cardigan over a white blouse with a small pink ribbon.
 */
import { circlePath, ellipsePath, polygon, type Pt } from '../../lib/geom';
import type { CharacterDesign, CelLayer, ShadeShape } from '../model';
import {
  EARS_SOFT,
  FACE_SOFT,
  FEMALE_SKIN,
  NECK_SOFT,
  TORSO_SOFT,
  both,
  earDetail,
  fringe,
  highlightBand,
  noseSoft,
} from './shared';

const HAIR = {
  base: '#5b3b30',
  shade: '#442b24',
  deep: '#321f1a',
  light: '#8a6352',
  outline: '#2a1915',
};
const ACCENT = '#f27ba5';

// ── hair ──────────────────────────────────────────────────────────────
const CAP =
  'M 186 262 C 176 170 224 84 300 80 C 382 82 428 164 414 262 C 404 220 388 190 360 172 C 330 156 268 156 240 170 C 214 184 196 216 186 262 Z';

const FRINGE_EDGE: Pt[] = [
  [196, 236],
  [206, 224],
  [214, 196],
  [230, 216],
  [242, 186],
  [256, 204],
  [262, 190],
  [296, 222],
  [298, 196],
  [318, 212],
  [322, 198],
  [350, 224],
  [352, 204],
  [378, 226],
  [382, 210],
  [400, 244],
  [410, 256],
];
const FRINGE = fringe(FRINGE_EDGE, 'C 420 190 380 128 300 124 C 240 124 196 170 196 236', 0.6);

/** Viewer's-left lock, brought forward over the shoulder in soft waves. */
const LOCK_L =
  'M 198 212 C 184 250 176 300 178 350 C 180 400 162 428 160 470 C 158 510 180 532 178 568 C 176 602 158 624 172 664 C 190 644 208 618 210 580 C 212 546 198 520 202 490 C 206 458 226 432 226 396 C 226 350 214 300 214 262 C 214 244 214 228 218 216 Z';
/** Viewer's-right lock: frames the cheek and tapers off at the jaw (the rest falls behind the shoulder). */
const LOCK_R =
  'M 402 212 C 418 250 426 296 422 332 C 419 354 418 368 414 384 C 405 368 398 348 395 326 C 391 300 388 270 386 244 C 385 232 384 226 382 220 Z';

const NOTCHES = FRINGE_EDGE.filter((_, i) => i % 2 === 0 && i > 0 && i < FRINGE_EDGE.length - 1);
const notchWedges: ShadeShape[] = NOTCHES.map(([x, y]) => ({
  d: polygon([
    [x - 7, y + 34],
    [x - 12, y - 30],
    [x + 11, y + 34],
  ]),
  fill: HAIR.shade,
}));

const HIGHLIGHT_BAND = highlightBand({ cx: 300, cy: 262, rx: 108, ry: 134, from: 212, to: 328, width: 9, teeth: 7, toothLen: 13 });

const hairFront: CelLayer = {
  key: 'hairFront',
  shapes: [CAP, FRINGE, LOCK_L, LOCK_R],
  fill: HAIR.base,
  outline: HAIR.outline,
  outlineWidth: 2.2,
  shading: [
    { d: 'M 0 0 L 600 0 L 600 800 L 0 800 Z', fill: 'grad:hairShade' },
    ...notchWedges,
    // inner edges of the locks sit in shadow next to the face
    { d: 'M 206 226 C 204 300 214 370 218 440 L 232 440 L 232 226 Z', fill: HAIR.shade },
    { d: 'M 395 226 C 397 300 392 350 396 400 L 368 400 L 368 226 Z', fill: HAIR.shade },
    // lower half of the forward lock turns away from the light
    { d: 'M 150 520 C 170 540 200 530 220 520 L 220 680 L 150 680 Z', fill: HAIR.shade, opacity: 0.6 },
    { d: HIGHLIGHT_BAND, fill: HAIR.light, opacity: 0.8 },
    { d: 'M 172 470 C 168 490 176 506 182 520 C 178 504 176 488 180 472 Z', fill: HAIR.light, opacity: 0.8 },
  ],
  lines: [
    { d: 'M 258 140 C 270 164 280 186 286 210', stroke: HAIR.deep, width: 1.6, opacity: 0.8 },
    { d: 'M 292 134 C 308 160 320 190 327 218', stroke: HAIR.deep, width: 1.6, opacity: 0.8 },
    { d: 'M 324 136 C 344 164 358 196 363 224', stroke: HAIR.deep, width: 1.6, opacity: 0.8 },
    { d: 'M 238 152 C 230 170 224 188 222 204', stroke: HAIR.deep, width: 1.4, opacity: 0.7 },
    { d: 'M 196 290 C 192 350 194 400 180 450 C 170 490 188 530 188 570', stroke: HAIR.deep, width: 1.5, opacity: 0.7 },
    { d: 'M 212 420 C 206 460 190 480 192 520 C 194 560 196 600 184 640', stroke: HAIR.deep, width: 1.4, opacity: 0.6 },
    { d: 'M 404 290 C 410 320 408 346 412 370', stroke: HAIR.deep, width: 1.5, opacity: 0.7 },
    { d: 'M 286 86 C 298 74 316 70 332 74', stroke: HAIR.outline, width: 1.6, opacity: 0.9 },
  ],
};

const hairBack: CelLayer = {
  key: 'hairBack',
  shapes: [
    'M 300 104 C 214 104 166 150 164 230 C 162 290 156 330 162 370 C 168 410 150 440 156 480 L 440 480 C 452 460 470 452 472 430 C 474 400 452 384 450 350 C 448 316 440 280 438 230 C 436 150 386 104 300 104 Z',
  ],
  fill: HAIR.shade,
  outline: HAIR.outline,
  shading: [{ d: 'M 214 270 C 236 330 248 400 250 480 L 350 480 C 352 400 364 330 386 270 Z', fill: HAIR.deep }],
  lines: [
    { d: 'M 176 280 C 174 330 180 360 174 400', stroke: HAIR.deep, width: 1.4, opacity: 0.8 },
    { d: 'M 428 280 C 432 320 436 350 446 380 C 454 400 462 414 462 430', stroke: HAIR.deep, width: 1.4, opacity: 0.8 },
  ],
};

// ── clothes ───────────────────────────────────────────────────────────
const BLOUSE = { base: '#fdfcfb', shade: '#ebe6f2', line: '#c3b8cc' };
const KNIT = { base: '#f4e6cc', shade: '#e0caa4', line: '#b4956a' };

const CARDIGAN_L =
  'M 273 406 C 238 420 186 424 156 436 C 128 448 112 472 108 508 L 94 800 L 252 800 C 250 720 246 620 250 540 C 253 480 262 440 276 412 Z';

const blouse: CelLayer = {
  key: 'blouse',
  shapes: [TORSO_SOFT],
  fill: BLOUSE.base,
  outline: BLOUSE.line,
  shading: [
    { d: 'M 318 436 C 336 520 340 640 332 800 L 520 800 L 520 420 Z', fill: BLOUSE.shade },
    { d: 'M 244 432 C 270 474 330 474 356 432 L 356 486 C 330 504 270 504 244 486 Z', fill: BLOUSE.shade, opacity: 0.8 },
  ],
  lines: [
    { d: 'M 300 474 L 300 800', stroke: BLOUSE.line, width: 1.4, opacity: 0.8 },
    { d: 'M 280 560 Q 286 640 280 730', stroke: BLOUSE.line, width: 1.3, opacity: 0.45 },
  ],
};

const blouseButtons: CelLayer = {
  key: 'blouseButtons',
  shapes: [520, 596, 672, 748].map((y) => circlePath(300, y, 3.2)),
  fill: '#f3eff7',
  outline: BLOUSE.line,
  outlineWidth: 1.2,
};

const cardigan: CelLayer = {
  key: 'cardigan',
  shapes: both(CARDIGAN_L),
  fill: KNIT.base,
  outline: KNIT.line,
  shading: [
    // shadow side of the right arm (light comes from the upper left)
    { d: 'M 462 446 C 478 462 486 490 488 530 L 502 800 L 470 800 C 474 700 474 600 468 530 C 464 496 464 470 462 446 Z', fill: KNIT.shade },
    // under the collar / inside the front edges
    { d: 'M 330 414 C 350 424 360 446 360 480 C 356 520 350 560 350 600 L 340 600 L 340 414 Z', fill: KNIT.shade, opacity: 0.8 },
    { d: 'M 262 430 C 256 470 254 520 254 600 L 262 600 L 270 430 Z', fill: KNIT.shade, opacity: 0.8 },
    // the long locks cast soft shadows on the knit
    { d: LOCK_L, fill: KNIT.shade, dx: 7, dy: 8 },
    { d: LOCK_R, fill: KNIT.shade, dx: 7, dy: 8 },
  ],
  lines: [
    ...both('M 150 548 C 156 630 160 720 158 800').map((d) => ({ d, stroke: KNIT.line, width: 1.8, opacity: 0.9 })),
    ...both('M 240 800 C 238 720 235 620 239 540 C 242 478 251 440 265 414').map((d) => ({
      d,
      stroke: KNIT.line,
      width: 1.4,
      opacity: 0.7,
    })),
    ...both('M 128 690 Q 138 702 148 696').map((d) => ({ d, stroke: KNIT.line, width: 1.4, opacity: 0.6 })),
  ],
};

const cardiganButtons: CelLayer = {
  key: 'cardiganButtons',
  shapes: [
    [246, 560],
    [244, 650],
    [243, 740],
  ].map(([x, y]) => circlePath(x, y, 5.2)),
  fill: '#fbf5ea',
  outline: KNIT.line,
  outlineWidth: 1.5,
};

const collar: CelLayer = {
  key: 'collar',
  shapes: both('M 300 434 C 292 428 281 418 275 406 C 262 412 250 424 246 438 C 256 456 286 454 300 442 Z'),
  fill: '#ffffff',
  outline: BLOUSE.line,
  shading: [{ d: 'M 246 446 C 270 458 290 454 300 444 L 356 444 L 356 470 L 246 470 Z', fill: BLOUSE.shade }],
};

const ribbon: CelLayer = {
  key: 'ribbon',
  shapes: [
    ...both('M 299 442 C 290 429 272 427 270 438 C 268 450 286 454 299 445 Z'),
    'M 297 445 C 294 458 290 468 284 478 L 292 476 L 295 483 C 299 471 301 457 301 446 Z',
    'M 303 445 C 306 457 310 466 316 474 L 308 473 L 305 480 C 301 469 299 457 299 446 Z',
    ellipsePath(300, 443, 5.5, 6),
  ],
  fill: ACCENT,
  outline: '#c24d79',
  outlineWidth: 1.6,
  shading: [
    ...both('M 290 440 C 284 436 278 436 277 440 C 280 444 286 445 292 444 Z').map((d) => ({ d, fill: '#d85c8c' })),
  ],
};

// ── flower clip ───────────────────────────────────────────────────────
const FLOWER: Pt = [384, 158];
const petals = [-90, -18, 54, 126, 198].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return circlePath(FLOWER[0] + Math.cos(a) * 10, FLOWER[1] + Math.sin(a) * 10, 8.6);
});

const leaf: CelLayer = {
  key: 'leaf',
  shapes: ['M 378 166 C 366 165 357 171 354 180 C 365 183 374 178 380 170 Z'],
  fill: '#a5d8ae',
  outline: '#5f9c70',
  outlineWidth: 1.4,
};

const flower: CelLayer = {
  key: 'flower',
  shapes: petals,
  fill: '#f9b4d0',
  outline: '#d05888',
  outlineWidth: 1.6,
  shading: [
    { d: circlePath(FLOWER[0] + 3, FLOWER[1] + 4, 12), fill: ACCENT, opacity: 0.55 },
    { d: circlePath(FLOWER[0] - 6, FLOWER[1] - 8, 5), fill: '#ffe1ee', opacity: 0.9 },
  ],
};

const flowerCenter: CelLayer = {
  key: 'flowerCenter',
  shapes: [circlePath(FLOWER[0], FLOWER[1], 4.6)],
  fill: '#ffe08a',
  outline: '#d49a3a',
  outlineWidth: 1.3,
};

export const YUKI: CharacterDesign = {
  id: 'yuki',
  skin: FEMALE_SKIN,
  face: FACE_SOFT,
  ears: EARS_SOFT,
  earDetail: earDetail(FEMALE_SKIN),
  neck: NECK_SOFT,
  chinShadowOffset: 16,
  nose: noseSoft(FEMALE_SKIN),
  bangShadow: { shapes: [CAP, FRINGE], dx: 3, dy: 9 },
  eyes: {
    cx: 252,
    cy: 252,
    w: 29,
    h: 25,
    hLow: 23,
    droop: 5,
    innerY: 5,
    lash: 4.6,
    flick: 7,
    spikes: true,
    irisRx: 19,
    irisRy: 23.5,
    irisDy: 3,
    pupilRx: 8.5,
    pupilRy: 11,
    colors: {
      lash: '#3a2123',
      sclera: '#ffffff',
      scleraShade: '#e7def0',
      irisDeep: '#3d1d25',
      irisDark: '#6f3342',
      iris: '#a9566b',
      irisLight: '#eaa6b6',
      lowerLash: '#7c4a4f',
    },
  },
  brows: { cx: 250, y: 206, len: 22, thick: 5.4, color: '#2f1b17' },
  mouth: { x: 300, y: 327, scale: 1, line: '#b8606a', inner: '#8c3046', tongue: '#e7818f', teeth: '#ffffff' },
  blushScale: 1,
  blushHatch: true,
  gradients: [
    {
      kind: 'linear',
      name: 'hairShade',
      x1: 0,
      y1: 130,
      x2: 0,
      y2: 640,
      stops: [
        [0, HAIR.deep, 0],
        [0.3, HAIR.deep, 0.06],
        [1, HAIR.deep, 0.45],
      ],
    },
  ],
  hairBack: [hairBack],
  body: [blouse, blouseButtons, cardigan, cardiganButtons, collar, ribbon],
  midAccessories: [],
  hairFront: [hairFront],
  topAccessories: [leaf, flower, flowerCenter],
  extrasAnchor: {
    sweat: [416, 214],
    sparkles: [
      [168, 146, 13],
      [432, 118, 9],
      [448, 196, 7],
    ],
    shock: [418, 96],
  },
  portraitCrop: [115, 70, 370],
};

