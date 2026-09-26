/**
 * Expression table: which brows / eyes / mouth / extras each expression uses.
 * Parts read these specs; per-character tweaks live in CharacterDesign.mouthOverrides.
 */
import type { Expression } from '../../types';
import type { MouthFamily, MouthShapeId } from './model';

export interface EyeSpec {
  /** 'open' = normal eye; 'arc' = closed happy ^ ^ eyes. */
  mode: 'open' | 'arc';
  /** Upper-lid opening multiplier (1 = design default). */
  open: number;
  /** How far the lower lid is pushed up (smiling squint), viewBox units. */
  lowerLift: number;
  /** Gaze offset of the irises. */
  lookX: number;
  lookY: number;
  irisScale: number;
  pupilScale: number;
  /** Extra droop of the outer corners (worried). */
  droopAdd: number;
  /** Raise of the inner half of the upper lid (worried). */
  innerRaise: number;
}

/** One brow: vertical offsets of the outer / inner ends and the arch height (positive = up). */
export interface BrowSpec {
  outer: number;
  inner: number;
  arch: number;
}

export interface FaceSpec {
  eyes: EyeSpec;
  /** [viewer's left, viewer's right] */
  brows: readonly [BrowSpec, BrowSpec];
  mouth: { closed: MouthShapeId; family: MouthFamily };
  blush: number;
  hatch: boolean;
  sweat: boolean;
  sparkle: boolean;
  shock: boolean;
  /** Small hop when switching to this expression. */
  hop: boolean;
}

const OPEN: EyeSpec = {
  mode: 'open',
  open: 1,
  lowerLift: 0,
  lookX: 0,
  lookY: 0,
  irisScale: 1,
  pupilScale: 1,
  droopAdd: 0,
  innerRaise: 0,
};

const brow = (outer: number, inner: number, arch: number): BrowSpec => ({ outer, inner, arch });
const pair = (b: BrowSpec): readonly [BrowSpec, BrowSpec] => [b, b];

export const FACE_SPECS: Record<Expression, FaceSpec> = {
  neutral: {
    eyes: OPEN,
    brows: pair(brow(0, 0, 4)),
    mouth: { closed: 'line', family: 'oval' },
    blush: 0.45,
    hatch: false,
    sweat: false,
    sparkle: false,
    shock: false,
    hop: false,
  },
  smile: {
    eyes: { ...OPEN, open: 0.96, lowerLift: 5 },
    brows: pair(brow(1, 2, 5)),
    mouth: { closed: 'smile', family: 'smile' },
    blush: 0.62,
    hatch: false,
    sweat: false,
    sparkle: false,
    shock: false,
    hop: false,
  },
  happy: {
    eyes: { ...OPEN, mode: 'arc' },
    brows: pair(brow(3, 5, 7)),
    mouth: { closed: 'bigSmile', family: 'wide' },
    blush: 0.85,
    hatch: true,
    sweat: false,
    sparkle: true,
    shock: false,
    hop: true,
  },
  thinking: {
    eyes: { ...OPEN, open: 0.9, lookX: 6, lookY: -6 },
    brows: [brow(-1, -3, 3), brow(4, 6, 6)],
    mouth: { closed: 'pursed', family: 'oval' },
    blush: 0.35,
    hatch: false,
    sweat: false,
    sparkle: false,
    shock: false,
    hop: false,
  },
  serious: {
    eyes: { ...OPEN, open: 0.78, lowerLift: 2, lookY: 1, irisScale: 0.97 },
    brows: pair(brow(1, -5, 1)),
    mouth: { closed: 'firm', family: 'oval' },
    blush: 0.2,
    hatch: false,
    sweat: false,
    sparkle: false,
    shock: false,
    hop: false,
  },
  surprised: {
    eyes: { ...OPEN, open: 1.12, irisScale: 0.84, pupilScale: 0.7 },
    brows: pair(brow(8, 9, 8)),
    mouth: { closed: 'o', family: 'o' },
    blush: 0.55,
    hatch: false,
    sweat: false,
    sparkle: false,
    shock: true,
    hop: true,
  },
  troubled: {
    eyes: { ...OPEN, open: 0.92, lookX: -2, lookY: 3, droopAdd: 3, innerRaise: 4 },
    brows: pair(brow(-2, 7, 1)),
    mouth: { closed: 'wavy', family: 'wavy' },
    blush: 0.6,
    hatch: true,
    sweat: true,
    sparkle: false,
    shock: false,
    hop: false,
  },
};
