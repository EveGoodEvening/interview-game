import { memo } from 'react';
import { n } from '../../lib/geom';
import { ref } from '../../lib/svgId';
import { closedMouth, openMouth, type MouthShape } from '../faceGeometry';
import type { MouthDesign, MouthFamily, MouthShapeId } from '../model';

interface MouthProps {
  design: MouthDesign;
  closed: MouthShapeId;
  family: MouthFamily;
  /** Unique per instance + expression. */
  uid: string;
}

function Shape({ shape, design, clipId }: { shape: MouthShape; design: MouthDesign; clipId: string }) {
  if (shape.line) {
    return <path d={shape.line} fill="none" stroke={design.line} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />;
  }
  const d = shape.fill!;
  return (
    <>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={design.inner} />
      <g clipPath={ref(clipId)}>
        <ellipse cx={0} cy={shape.h * 0.95} rx={shape.w * 0.62} ry={Math.max(2.5, shape.h * 0.42)} fill={design.tongue} />
        {shape.teeth && <rect x={-shape.w} y={n(shape.top - 3)} width={shape.w * 2} height={4.6} fill={design.teeth} />}
      </g>
      <path d={d} fill="none" stroke={design.line} strokeWidth={1.8} strokeLinejoin="round" />
    </>
  );
}

/**
 * All four lip-sync shapes for one expression (level 0 = the expression's closed mouth).
 * Only one is visible at a time, selected by the `data-mouth` attribute on the sprite root,
 * which the lip-sync driver updates every animation frame without re-rendering React.
 */
export const Mouth = memo(function Mouth({ design, closed, family, uid }: MouthProps) {
  const shapes: MouthShape[] = [closedMouth(closed), openMouth(family, 1), openMouth(family, 2), openMouth(family, 3)];
  return (
    <g data-part="mouth" transform={`translate(${design.x} ${design.y}) scale(${design.scale})`}>
      {shapes.map((shape, level) => (
        <g key={level} className={`cs-mouth cs-m${level}`}>
          <Shape shape={shape} design={design} clipId={`${uid}-mouth${level}`} />
        </g>
      ))}
    </g>
  );
});
