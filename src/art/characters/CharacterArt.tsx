/**
 * Layer assembly shared by CharacterSprite and CharacterPortrait:
 * hair back → neck + clothes → head → face parts → accessories → front hair → brows / symbols.
 */
import { memo } from 'react';
import type { Expression } from '../../types';
import { FACE_SPECS, type FaceSpec } from './expressions';
import type { CharacterDesign } from './model';
import { Brows } from './parts/Brows';
import { CelLayers, GradientDefs } from './parts/CelLayer';
import { Blush, Symbols } from './parts/Extras';
import { Eyes } from './parts/Eyes';
import { Head, Neck } from './parts/Head';
import { Mouth } from './parts/Mouth';
import { useCrossfade } from './hooks/useCrossfade';

/** Must match the cs-face-in / cs-face-out animation duration in CharacterSprite.css. */
const EXPRESSION_FADE_MS = 170;

/** Resolve the expression table entry with the character's own tweaks. */
export function faceSpecFor(design: CharacterDesign, expression: Expression): FaceSpec {
  const base = FACE_SPECS[expression];
  const override = design.mouthOverrides?.[expression];
  if (!override) return base;
  return { ...base, mouth: { closed: override.closed ?? base.mouth.closed, family: override.family ?? base.mouth.family } };
}

/** Eye / blush gradients derived from the design palette, plus the design's own gradients. */
const FaceDefs = memo(function FaceDefs({ design, uid }: { design: CharacterDesign; uid: string }) {
  const c = design.eyes.colors;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-sclera`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.scleraShade} />
          <stop offset="0.45" stopColor={c.sclera} />
        </linearGradient>
        <linearGradient id={`${uid}-iris`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.irisDark} />
          <stop offset="0.5" stopColor={c.iris} />
          <stop offset="1" stopColor={c.irisLight} />
        </linearGradient>
        <radialGradient id={`${uid}-blush`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={design.skin.blush} stopOpacity="0.85" />
          <stop offset="0.55" stopColor={design.skin.blush} stopOpacity="0.45" />
          <stop offset="1" stopColor={design.skin.blush} stopOpacity="0" />
        </radialGradient>
        {/* the front hair over the forehead: where the brows turn it see-through */}
        <clipPath id={`${uid}-bangs`}>
          {design.bangShadow.shapes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      </defs>
      <GradientDefs gradients={design.gradients} uid={uid} />
    </>
  );
});

interface FaceLayerProps {
  design: CharacterDesign;
  expression: Expression;
  uid: string;
  still?: boolean;
}

/** Blush, eyes and the four lip-sync mouths for one expression (under the front hair). */
const LowerFace = memo(function LowerFace({ design, expression, uid }: FaceLayerProps) {
  const spec = faceSpecFor(design, expression);
  const exprUid = `${uid}-${expression}`;
  return (
    <>
      <Blush design={design} spec={spec} baseUid={uid} />
      <Eyes design={design.eyes} spec={spec.eyes} uid={exprUid} baseUid={uid} />
      <Mouth design={design.mouth} closed={spec.mouth.closed} family={spec.mouth.family} uid={exprUid} />
    </>
  );
});

/** Brows and manga symbols for one expression (above the front hair). */
const UpperFace = memo(function UpperFace({ design, expression, uid, still }: FaceLayerProps) {
  const spec = faceSpecFor(design, expression);
  return (
    <>
      <Brows design={design.brows} specs={spec.brows} baseUid={uid} seeThrough={design.skin.shade} />
      <Symbols design={design} spec={spec} still={still} />
    </>
  );
});

export interface CharacterArtProps {
  design: CharacterDesign;
  expression: Expression;
  uid: string;
  /** Idle breathing bob (CSS animation). */
  breathing: boolean;
  /** Static frame: expression changes snap (no crossfade) and the manga symbols do not animate. */
  still?: boolean;
}

export function CharacterArt({ design, expression, uid, breathing, still = false }: CharacterArtProps) {
  const { current, previous } = useCrossfade(expression, EXPRESSION_FADE_MS, !still);
  const faces: { expr: Expression; cls: string | undefined }[] = previous
    ? [
        { expr: previous, cls: 'cs-face-out' },
        { expr: current, cls: 'cs-face-in' },
      ]
    : [{ expr: current, cls: undefined }];
  const headCls = breathing ? 'cs-bob-head' : undefined;
  return (
    <>
      <FaceDefs design={design} uid={uid} />
      <g className={headCls}>
        <CelLayers layers={design.hairBack} uid={uid} />
      </g>
      <g className={breathing ? 'cs-bob-body' : undefined}>
        {design.bodyBack && <CelLayers layers={design.bodyBack} uid={uid} />}
        <Neck design={design} uid={uid} />
        <CelLayers layers={design.body} uid={uid} />
      </g>
      <g className={headCls}>
        <Head design={design} uid={uid} />
        {faces.map(({ expr, cls }) => (
          <g key={expr} className={cls}>
            <LowerFace design={design} expression={expr} uid={uid} />
          </g>
        ))}
        <CelLayers layers={design.midAccessories} uid={uid} />
        <CelLayers layers={design.hairFront} uid={uid} />
        <CelLayers layers={design.topAccessories} uid={uid} />
        {faces.map(({ expr, cls }) => (
          <g key={expr} className={cls}>
            <UpperFace design={design} expression={expr} uid={uid} still={still} />
          </g>
        ))}
      </g>
    </>
  );
}
