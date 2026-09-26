import { memo } from 'react';
import { ref } from '../../lib/svgId';
import type { CharacterDesign } from '../model';

interface PartProps {
  design: CharacterDesign;
  uid: string;
}

/** Neck with the soft cel shadow cast by the chin. Drawn before the clothes. */
export const Neck = memo(function Neck({ design, uid }: PartProps) {
  const { skin } = design;
  const clip = `${uid}-neck`;
  return (
    <g data-part="neck">
      <clipPath id={clip}>
        <path d={design.neck} />
      </clipPath>
      <path d={design.neck} fill={skin.base} stroke={skin.line} strokeWidth={2.2} strokeLinejoin="round" />
      <g clipPath={ref(clip)}>
        <path d={design.face} fill={skin.shade} transform={`translate(0 ${design.chinShadowOffset})`} />
      </g>
    </g>
  );
});

/** Ears, face silhouette, hair shadow on the forehead, nose. */
export const Head = memo(function Head({ design, uid }: PartProps) {
  const { skin } = design;
  const faceClip = `${uid}-face`;
  const { dx, dy, shapes } = design.bangShadow;
  return (
    <g data-part="head">
      {design.ears.map((d, i) => (
        <path key={i} d={d} fill={skin.base} stroke={skin.line} strokeWidth={2} strokeLinejoin="round" />
      ))}
      <g fill="none" strokeLinecap="round">
        {design.earDetail.map((l, i) => (
          <path key={i} d={l.d} stroke={l.stroke} strokeWidth={l.width ?? 1.6} opacity={l.opacity} />
        ))}
      </g>
      <clipPath id={faceClip}>
        <path d={design.face} />
      </clipPath>
      <path d={design.face} fill={skin.base} stroke={skin.line} strokeWidth={2.2} strokeLinejoin="round" />
      <g clipPath={ref(faceClip)}>
        <g transform={`translate(${dx} ${dy})`} fill={skin.shade}>
          {shapes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {design.nose.map((l, i) => (
          <path key={i} d={l.d} stroke={l.stroke} strokeWidth={l.width ?? 1.6} opacity={l.opacity} />
        ))}
      </g>
    </g>
  );
});
