import { memo } from 'react';
import { n } from '../../lib/geom';
import { ref } from '../../lib/svgId';
import type { FaceSpec } from '../expressions';
import type { CharacterDesign } from '../model';

/** Cheek blush + optional hatching. Sits under the eyes. */
export const Blush = memo(function Blush({ design, spec, baseUid }: { design: CharacterDesign; spec: FaceSpec; baseUid: string }) {
  const { eyes, skin } = design;
  const y = eyes.cy + eyes.hLow + 13;
  const xs = [eyes.cx - 6, 600 - eyes.cx + 6];
  const opacity = Math.min(1, spec.blush * design.blushScale);
  const hatch = spec.hatch && design.blushHatch;
  return (
    <g data-part="blush">
      {xs.map((x) => (
        <ellipse key={x} cx={x} cy={y} rx={25} ry={10} fill={ref(`${baseUid}-blush`)} opacity={opacity} />
      ))}
      {hatch && (
        <g stroke={skin.blushLine} strokeWidth={1.5} strokeLinecap="round" opacity={0.75}>
          {xs.flatMap((x) =>
            [-8, 0, 8].map((dx) => <path key={`${x}${dx}`} d={`M ${n(x + dx + 3)} ${n(y - 5)} L ${n(x + dx - 2)} ${n(y + 4)}`} />),
          )}
        </g>
      )}
    </g>
  );
});

function sparklePath(x: number, y: number, s: number): string {
  return `M ${n(x)} ${n(y - s)} Q ${n(x + s * 0.18)} ${n(y - s * 0.18)} ${n(x + s)} ${n(y)} Q ${n(x + s * 0.18)} ${n(y + s * 0.18)} ${n(x)} ${n(y + s)} Q ${n(x - s * 0.18)} ${n(y + s * 0.18)} ${n(x - s)} ${n(y)} Q ${n(x - s * 0.18)} ${n(y - s * 0.18)} ${n(x)} ${n(y - s)} Z`;
}

/**
 * Floating manga symbols: sweat drop, sparkles, surprise lines. Drawn above the hair.
 * `still`: the same symbols in their resting pose, without the looping / pop-in animation classes.
 */
export const Symbols = memo(function Symbols({ design, spec, still = false }: { design: CharacterDesign; spec: FaceSpec; still?: boolean }) {
  const { sweat, sparkles, shock } = design.extrasAnchor;
  const [sx, sy] = sweat;
  return (
    <g data-part="symbols">
      {spec.sweat && (
        <g className={still ? undefined : 'cs-sweat'}>
          <path
            d={`M ${sx} ${sy - 16} C ${sx + 8} ${sy - 4} ${sx + 10} ${sy + 4} ${sx} ${sy + 9} C ${sx - 10} ${sy + 4} ${sx - 8} ${sy - 4} ${sx} ${sy - 16} Z`}
            fill="#d4f0ff"
            stroke="#6fb1e0"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <ellipse cx={sx - 3} cy={sy + 1} rx={2} ry={3.5} fill="#ffffff" />
        </g>
      )}
      {spec.sparkle &&
        sparkles.map(([x, y, s], i) => (
          <path
            key={i}
            className={still ? undefined : 'cs-sparkle'}
            style={still ? undefined : { animationDelay: `${i * 0.35}s` }}
            d={sparklePath(x, y, s)}
            fill="#fff7c2"
            stroke="#ffc857"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        ))}
      {spec.shock && (
        <g stroke="#5a4a70" strokeWidth={3} strokeLinecap="round" className={still ? undefined : 'cs-shock'}>
          <path d={`M ${shock[0]} ${shock[1]} L ${shock[0] + 10} ${shock[1] - 16}`} />
          <path d={`M ${shock[0] + 14} ${shock[1] + 8} L ${shock[0] + 30} ${shock[1] - 2}`} />
          <path d={`M ${shock[0] + 18} ${shock[1] + 22} L ${shock[0] + 36} ${shock[1] + 20}`} />
        </g>
      )}
    </g>
  );
});
