/**
 * Data model for code-drawn characters.
 *
 * A character is assembled from reusable, generic parts (see ./parts) that are
 * parameterised by a per-character `CharacterDesign` (see ./designs). Every
 * coordinate lives in the sprite's 600×800 viewBox; the face is centred on x = 300.
 */
import type { CharacterId, Expression } from '../../types';

/**
 * A paint value: a colour (`#rrggbb`, `rgba(…)`) or a reference to a
 * per-instance gradient declared in `CharacterDesign.gradients`, written as `grad:<name>`.
 */
export type Paint = string;

/** A shading / highlight shape clipped to its parent layer. */
export interface ShadeShape {
  d: string;
  fill: Paint;
  opacity?: number;
  /** Offset (e.g. a lock of hair re-used as its own cast shadow). */
  dx?: number;
  dy?: number;
}

/** A detail line (strand, fold, seam). */
export interface DetailLine {
  d: string;
  stroke: Paint;
  /** Stroke width in viewBox units (default 1.6). */
  width?: number;
  opacity?: number;
}

/**
 * A cel-shaded piece (a clump of hair, a garment…). `shapes` are unioned: all
 * outlines are painted first, then all fills, so only the outer silhouette of
 * the union keeps an outline. `shading` is clipped to the union; `lines` are drawn on top.
 */
export interface CelLayer {
  /** Stable, unique (per character) key — also used in clip-path ids. */
  key: string;
  shapes: string[];
  fill: Paint;
  /** Outline colour: a darker shade of `fill`, never pure black. */
  outline: string;
  /** Visible outline width in viewBox units (default 2.2). */
  outlineWidth?: number;
  shading?: ShadeShape[];
  lines?: DetailLine[];
}

export interface LinearGradientDef {
  kind: 'linear';
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: readonly (readonly [offset: number, color: string, opacity?: number])[];
  /** 'userSpaceOnUse' (default) — coordinates are viewBox units. */
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
}

export interface RadialGradientDef {
  kind: 'radial';
  name: string;
  cx: number;
  cy: number;
  r: number;
  fx?: number;
  fy?: number;
  stops: readonly (readonly [offset: number, color: string, opacity?: number])[];
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
}

export type GradientDef = LinearGradientDef | RadialGradientDef;

export interface SkinPalette {
  base: string;
  /** Cel shadow (hair shadow on forehead, under the chin). */
  shade: string;
  /** Outline of face / ears / neck. */
  line: string;
  /** Soft highlight (nose tip, cheek). */
  light: string;
  /** Blush tint. */
  blush: string;
  /** Blush hatching lines. */
  blushLine: string;
}

export interface EyeDesign {
  /** Centre of the viewer's-left eye; the other eye is mirrored around x = 300. */
  cx: number;
  cy: number;
  /** Half width of the eye opening. */
  w: number;
  /** Height from centre to the top of the upper lid. */
  h: number;
  /** Height from centre to the bottom of the lower lid. */
  hLow: number;
  /** Outer corner vertical offset (positive = droopy/gentle, negative = sharp). */
  droop: number;
  /** Inner corner vertical offset. */
  innerY: number;
  /** Upper lash thickness at the middle of the lid. */
  lash: number;
  /** Outer-corner lash wing length (0 = none). */
  flick: number;
  /** Extra lash spikes at the outer corner (feminine). */
  spikes: boolean;
  irisRx: number;
  irisRy: number;
  /** Iris centre offset from eye centre (positive y = lower). */
  irisDy: number;
  pupilRx: number;
  pupilRy: number;
  colors: {
    lash: string;
    sclera: string;
    scleraShade: string;
    irisDeep: string;
    irisDark: string;
    iris: string;
    irisLight: string;
    /** Lower-lid line colour. */
    lowerLash: string;
  };
}

export interface BrowDesign {
  /** Horizontal centre of the viewer's-left brow (mirrored for the right). */
  cx: number;
  /** Baseline y of the brow. */
  y: number;
  /** Half length. */
  len: number;
  /** Thickness at the inner end. */
  thick: number;
  color: string;
}

export interface MouthDesign {
  x: number;
  y: number;
  /** Uniform scale of the shared mouth shapes (1 = female default). */
  scale: number;
  line: string;
  inner: string;
  tongue: string;
  teeth: string;
}

/** Closed-mouth shapes (lip-sync level 0). */
export type MouthShapeId = 'line' | 'smile' | 'grin' | 'bigSmile' | 'pursed' | 'firm' | 'o' | 'wavy' | 'smirk';
/** Open-mouth families used for lip-sync levels 1–3. */
export type MouthFamily = 'oval' | 'smile' | 'wide' | 'o' | 'wavy';

export interface CharacterDesign {
  id: CharacterId;
  skin: SkinPalette;
  /** Face silhouette (skin), drawn over the neck. */
  face: string;
  ears: readonly [string, string];
  earDetail: readonly DetailLine[];
  neck: string;
  /** Neck shadow cast by the head: the face path is offset by this and clipped to the neck. */
  chinShadowOffset: number;
  nose: readonly DetailLine[];
  /** Front-hair shapes offset by (dx, dy) and clipped to the face to cast the hair shadow. */
  bangShadow: { shapes: readonly string[]; dx: number; dy: number };
  eyes: EyeDesign;
  brows: BrowDesign;
  mouth: MouthDesign;
  /** Per-character tweaks of the expression table (e.g. a restrained smile). */
  mouthOverrides?: Partial<Record<Expression, { closed?: MouthShapeId; family?: MouthFamily }>>;
  /** Multiplier for blush opacity (reserved characters blush less). */
  blushScale: number;
  /** Anime hatching on the cheeks for happy / flustered expressions. */
  blushHatch: boolean;
  gradients: readonly GradientDef[];
  hairBack: readonly CelLayer[];
  /** Clothing behind the neck (e.g. a hood). */
  bodyBack?: readonly CelLayer[];
  /** Clothes etc., drawn after the neck. */
  body: readonly CelLayer[];
  /** Drawn after the face but before the front hair (e.g. glasses). */
  midAccessories: readonly CelLayer[];
  hairFront: readonly CelLayer[];
  /** Drawn on top of the front hair (hair clip, scrunchie). */
  topAccessories: readonly CelLayer[];
  /** Where sweat drops / sparkles sit for this hairstyle. */
  extrasAnchor: { sweat: readonly [number, number]; sparkles: readonly (readonly [number, number, number])[]; shock: readonly [number, number] };
  /** Portrait crop (head and shoulders) as a square viewBox: [x, y, size]. */
  portraitCrop: readonly [number, number, number];
}
