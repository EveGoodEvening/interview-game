import { memo } from 'react';
import { ref } from '../../lib/svgId';
import type { EyeSpec } from '../expressions';
import { eyeArc, eyeGeometry, type Side } from '../faceGeometry';
import type { EyeDesign } from '../model';

interface EyesProps {
  design: EyeDesign;
  spec: EyeSpec;
  /** Unique per instance + expression (clip-path ids). */
  uid: string;
  /** Instance uid for shared gradients. */
  baseUid: string;
}

function OpenEye({ design, spec, uid, baseUid, side }: EyesProps & { side: Side }) {
  const g = eyeGeometry(design, side, spec);
  const c = design.colors;
  const clip = `${uid}-eye${side}`;
  const { iris, pupil } = g;
  return (
    <>
      <g className="cs-eye-open">
        <clipPath id={clip}>
          <path d={g.white} />
        </clipPath>
        <path d={g.white} fill={ref(`${baseUid}-sclera`)} />
        <g clipPath={ref(clip)}>
          <ellipse cx={iris.cx} cy={iris.cy} rx={iris.rx} ry={iris.ry} fill={ref(`${baseUid}-iris`)} stroke={c.irisDeep} strokeWidth={1.6} />
          <ellipse cx={iris.cx} cy={iris.cy + iris.ry * 0.08} rx={iris.rx * 0.72} ry={iris.ry * 0.74} fill="none" stroke={c.irisDark} strokeWidth={1.2} opacity={0.55} />
          <ellipse cx={iris.cx} cy={iris.cy + iris.ry * 0.02} rx={pupil.rx} ry={pupil.ry} fill={c.irisDeep} />
          <ellipse cx={iris.cx} cy={iris.cy + iris.ry * 0.5} rx={iris.rx * 0.58} ry={iris.ry * 0.26} fill={c.irisLight} opacity={0.7} />
          <path d={g.shadowBand} fill={c.irisDeep} opacity={0.26} />
          <ellipse
            cx={iris.cx - iris.rx * 0.36}
            cy={iris.cy - iris.ry * 0.34}
            rx={iris.rx * 0.34}
            ry={iris.ry * 0.27}
            fill="#ffffff"
            transform={`rotate(-20 ${iris.cx - iris.rx * 0.36} ${iris.cy - iris.ry * 0.34})`}
          />
          <circle cx={iris.cx + iris.rx * 0.42} cy={iris.cy + iris.ry * 0.3} r={iris.rx * 0.15} fill="#ffffff" opacity={0.9} />
        </g>
        <path d={g.lowerLash} fill="none" stroke={c.lowerLash} strokeWidth={1.5} strokeLinecap="round" opacity={0.85} />
        <path d={g.lash} fill={c.lash} stroke={c.lash} strokeWidth={0.8} strokeLinejoin="round" />
        {g.spikes.map((d, i) => (
          <path key={i} d={d} fill={c.lash} />
        ))}
        {g.crease && <path d={g.crease} fill="none" stroke={c.lash} strokeWidth={1.3} strokeLinecap="round" opacity={0.45} />}
      </g>
      <g className="cs-eye-closed" fill="none" stroke={c.lash} strokeLinecap="round">
        <path d={g.closed} strokeWidth={design.lash * 0.85} />
        <path d={g.closedWing} strokeWidth={design.lash * 0.6} />
      </g>
    </>
  );
}

function ArcEye({ design, side }: { design: EyeDesign; side: Side }) {
  const { arc, wing } = eyeArc(design, side);
  const c = design.colors;
  return (
    <g fill="none" stroke={c.lash} strokeLinecap="round" strokeLinejoin="round">
      <path d={arc} strokeWidth={design.lash * 0.95} />
      <path d={wing} strokeWidth={design.lash * 0.6} />
    </g>
  );
}

/** Both eyes for one expression. Blink is handled by CSS on `data-blink` (see CharacterSprite.css). */
export const Eyes = memo(function Eyes(props: EyesProps) {
  if (props.spec.mode === 'arc') {
    return (
      <g data-part="eyes">
        <ArcEye design={props.design} side="L" />
        <ArcEye design={props.design} side="R" />
      </g>
    );
  }
  return (
    <g data-part="eyes">
      <OpenEye {...props} side="L" />
      <OpenEye {...props} side="R" />
    </g>
  );
});
