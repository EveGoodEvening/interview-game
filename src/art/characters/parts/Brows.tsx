import { memo } from 'react';
import { ref } from '../../lib/svgId';
import type { BrowSpec } from '../expressions';
import { browPath } from '../faceGeometry';
import type { BrowDesign } from '../model';

/**
 * See-through bangs (透け前髪): where a brow crosses the front hair, the hair right around it
 * turns translucent and the shadowed forehead underneath shows through. Each entry is
 * [reach beyond the brow edge, opacity]; the bands are stroked along the brow outline, widest
 * and faintest first, so they stack into a soft falloff that follows the brow's shape
 * (≈0.37 at the brow edge, gone 4 units out) instead of a blurry blob or a hard outline ring.
 */
export const SEE_THROUGH_BANDS: readonly (readonly [spread: number, opacity: number])[] = [
  [4, 0.07],
  [3, 0.09],
  [2, 0.12],
  [1, 0.16],
];

interface BrowsProps {
  design: BrowDesign;
  specs: readonly [BrowSpec, BrowSpec];
  /** Instance uid (shared defs: the front-hair clip `${baseUid}-bangs`). */
  baseUid: string;
  /** Colour of the skin seen through the bangs (the forehead's shadow tone under the fringe). */
  seeThrough: string;
}

/**
 * Eyebrows drawn above the front hair, anime style. Where a brow crosses the bangs the hair
 * turns see-through in a tight, feathered, brow-shaped window (clipped to the hair shapes, so
 * nothing is added over bare skin); the brow itself stays crisp and fully opaque, so
 * expressions read even on dark hair.
 */
export const Brows = memo(function Brows({ design, specs, baseUid, seeThrough }: BrowsProps) {
  const paths = [browPath(design, 'L', specs[0]), browPath(design, 'R', specs[1])];
  return (
    <g data-part="brows">
      <g data-part="brows-see-through" clipPath={ref(`${baseUid}-bangs`)} fill="none" stroke={seeThrough} strokeLinejoin="round">
        {SEE_THROUGH_BANDS.map(([spread, opacity]) =>
          paths.map((d, i) => <path key={`${spread}-${i}`} d={d} strokeWidth={spread * 2} strokeOpacity={opacity} />),
        )}
      </g>
      <g fill={design.color}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </g>
  );
});
