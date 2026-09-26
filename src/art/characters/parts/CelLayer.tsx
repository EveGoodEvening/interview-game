import { memo } from 'react';
import { ref } from '../../lib/svgId';
import type { CelLayer as CelLayerData, GradientDef, Paint } from '../model';

/** Resolve `grad:<name>` paints to this instance's gradient url. */
export function paint(value: Paint, uid: string): string {
  return value.startsWith('grad:') ? ref(`${uid}-g-${value.slice(5)}`) : value;
}

interface CelLayerProps {
  layer: CelLayerData;
  uid: string;
}

/**
 * Cel-shaded piece: union outline (all strokes first, then all fills), shading
 * clipped to the union, then detail lines.
 */
export const CelLayer = memo(function CelLayer({ layer, uid }: CelLayerProps) {
  const clipId = `${uid}-c-${layer.key}`;
  const hasShading = (layer.shading?.length ?? 0) > 0;
  const outline = layer.outlineWidth ?? 2.2;
  return (
    <g data-part={layer.key}>
      {hasShading && (
        <clipPath id={clipId}>
          {layer.shapes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      )}
      {outline > 0 && (
        <g fill="none" stroke={layer.outline} strokeWidth={outline * 2} strokeLinejoin="round" strokeLinecap="round">
          {layer.shapes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
      <g fill={paint(layer.fill, uid)}>
        {layer.shapes.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {hasShading && (
        <g clipPath={ref(clipId)}>
          {layer.shading!.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill={paint(s.fill, uid)}
              opacity={s.opacity}
              transform={s.dx || s.dy ? `translate(${s.dx ?? 0} ${s.dy ?? 0})` : undefined}
            />
          ))}
        </g>
      )}
      {layer.lines && (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {layer.lines.map((l, i) => (
            <path key={i} d={l.d} stroke={paint(l.stroke, uid)} strokeWidth={l.width ?? 1.6} opacity={l.opacity} />
          ))}
        </g>
      )}
    </g>
  );
});

/** Several layers in order. */
export const CelLayers = memo(function CelLayers({ layers, uid }: { layers: readonly CelLayerData[]; uid: string }) {
  return (
    <>
      {layers.map((layer) => (
        <CelLayer key={layer.key} layer={layer} uid={uid} />
      ))}
    </>
  );
});

/** Gradient definitions for one instance. */
export const GradientDefs = memo(function GradientDefs({ gradients, uid }: { gradients: readonly GradientDef[]; uid: string }) {
  return (
    <defs>
      {gradients.map((g) => {
        const id = `${uid}-g-${g.name}`;
        const units = g.units ?? 'userSpaceOnUse';
        const stops = g.stops.map(([offset, color, opacity], i) => (
          <stop key={i} offset={offset} stopColor={color} stopOpacity={opacity ?? 1} />
        ));
        return g.kind === 'linear' ? (
          <linearGradient key={id} id={id} gradientUnits={units} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {stops}
          </linearGradient>
        ) : (
          <radialGradient key={id} id={id} gradientUnits={units} cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>
            {stops}
          </radialGradient>
        );
      })}
    </defs>
  );
});
