import { useState } from 'react';

export interface RadarAxis {
  key: string;
  label: string;
  /** 0–100 */
  value: number;
  /** Tooltip detail. */
  detail?: string;
}

export interface RadarChartProps {
  axes: readonly RadarAxis[];
  accent: string;
  title: string;
  width?: number;
  height?: number;
}

const RINGS = [25, 50, 75, 100];

/**
 * Single-series radar: recessive grid, one accent hue (fill + 2px stroke), ringed markers,
 * hover tooltip per vertex. Labels use ink colours, never the series colour.
 */
export function RadarChart({ axes, accent, title, width = 380, height = 320 }: RadarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = width / 2;
  const cy = height / 2 + 6;
  const radius = Math.min(width, height) / 2 - 58;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, v: number): [number, number] => {
    const r = (radius * Math.max(0, Math.min(100, v))) / 100;
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  };
  const poly = (v: (i: number) => number) =>
    axes
      .map((_, i) => point(i, v(i)))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');

  if (n < 3) return null;
  const hovered = hover !== null ? axes[hover] : null;
  const [hx, hy] = hover !== null ? point(hover, axes[hover].value) : [0, 0];

  return (
    <figure className="rpt-radar" style={{ width, height }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={title}>
        <title>{title}</title>
        {RINGS.map((ring) => (
          <polygon key={ring} points={poly(() => ring)} className={`rpt-radar__grid${ring === 100 ? ' is-outer' : ''}`} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = point(i, 100);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="rpt-radar__axis" />;
        })}
        <g className="rpt-radar__data" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <polygon points={poly((i) => axes[i].value)} fill={accent} fillOpacity={0.2} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
          {axes.map((a, i) => {
            const [x, y] = point(i, a.value);
            return <circle key={a.key} cx={x} cy={y} r={hover === i ? 6 : 4.5} fill={accent} stroke="#fff" strokeWidth={2} />;
          })}
        </g>
        {axes.map((a, i) => {
          const [x, y] = point(i, 100);
          const cos = Math.cos(angle(i));
          const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
          const lx = x + cos * 14;
          const ly = y + Math.sin(angle(i)) * 16 + (Math.sin(angle(i)) < -0.5 ? -8 : 4);
          return (
            <text key={a.key} x={lx} y={ly} textAnchor={anchor} className="rpt-radar__label">
              <tspan x={lx} className="rpt-radar__label-name">
                {a.label}
              </tspan>
              <tspan x={lx} dy="16" className="rpt-radar__label-value">
                {a.value}
              </tspan>
            </text>
          );
        })}
        {/* generous invisible hit targets */}
        {axes.map((a, i) => {
          const [x, y] = point(i, a.value);
          return (
            <circle
              key={`hit-${a.key}`}
              cx={x}
              cy={y}
              r={16}
              className="rpt-radar__hit"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              <title>{`${a.label} ${a.value}`}</title>
            </circle>
          );
        })}
      </svg>
      {hovered && (
        <figcaption className="rpt-radar__tip" style={{ left: hx, top: hy }}>
          <b>
            {hovered.label} · {hovered.value}
          </b>
          {hovered.detail && <span>{hovered.detail}</span>}
        </figcaption>
      )}
    </figure>
  );
}
