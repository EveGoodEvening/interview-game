/**
 * Reusable scenery for the 1280×720 backgrounds: frame, skylines, clouds,
 * sakura branches, sparkles and bokeh. All variation is seeded (deterministic).
 */
import { memo, type ReactNode } from 'react';
import { n } from '../lib/geom';
import { between, mulberry32, pick } from '../lib/random';
import { useSvgUid } from '../lib/svgId';

export const BG_W = 1280;
export const BG_H = 720;

/** Absolute, non-interactive SVG layer that covers its positioned parent (cover-fit). */
export function BgFrame({
  className,
  children,
  overlay,
  testId,
}: {
  className?: string;
  children: (uid: string) => ReactNode;
  /** HTML drawn above the SVG (e.g. petals). */
  overlay?: ReactNode;
  testId?: string;
}) {
  const uid = useSvgUid('bg');
  return (
    <div className={`bg-layer${className ? ` ${className}` : ''}`} aria-hidden="true" data-testid={testId}>
      <svg className="bg-layer__svg" viewBox={`0 0 ${BG_W} ${BG_H}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        {children(uid)}
      </svg>
      {overlay}
    </div>
  );
}

// ───────────────────────── Skyline ─────────────────────────

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Small rooftop block / antenna. */
  cap: { x: number; w: number; h: number } | null;
}

export interface SkylineOptions {
  seed: number;
  x0: number;
  x1: number;
  baseY: number;
  minH: number;
  maxH: number;
  minW?: number;
  maxW?: number;
}

export function makeBuildings(o: SkylineOptions): Building[] {
  const rand = mulberry32(o.seed);
  const out: Building[] = [];
  let x = o.x0;
  while (x < o.x1) {
    const w = Math.round(between(rand, o.minW ?? 36, o.maxW ?? 90));
    const h = Math.round(between(rand, o.minH, o.maxH));
    const capRoll = rand();
    const cap = capRoll < 0.3 ? { x: x + w * between(rand, 0.2, 0.5), w: w * between(rand, 0.2, 0.35), h: between(rand, 8, 22) } : null;
    out.push({ x, y: o.baseY - h, w, h, cap });
    x += w + Math.round(between(rand, -6, 4));
  }
  return out;
}

function buildingsPath(list: Building[], baseY: number): string {
  return list
    .map((b) => {
      const body = `M ${n(b.x)} ${n(baseY)} L ${n(b.x)} ${n(b.y)} L ${n(b.x + b.w)} ${n(b.y)} L ${n(b.x + b.w)} ${n(baseY)} Z`;
      const cap = b.cap
        ? ` M ${n(b.cap.x)} ${n(b.y)} L ${n(b.cap.x)} ${n(b.y - b.cap.h)} L ${n(b.cap.x + b.cap.w)} ${n(b.y - b.cap.h)} L ${n(b.cap.x + b.cap.w)} ${n(b.y)} Z`
        : '';
      return body + cap;
    })
    .join(' ');
}

export interface SkylineProps extends SkylineOptions {
  fill: string;
  opacity?: number;
  /** Lit windows. */
  windows?: { color: string; chance: number; opacity?: number };
}

export const Skyline = memo(function Skyline({ fill, opacity, windows, ...o }: SkylineProps) {
  const list = makeBuildings(o);
  let rects: ReactNode[] = [];
  if (windows) {
    const rand = mulberry32(o.seed * 31 + 7);
    rects = list.flatMap((b, bi) => {
      const cells: ReactNode[] = [];
      for (let y = b.y + 8; y < o.baseY - 8; y += 12) {
        for (let x = b.x + 6; x < b.x + b.w - 8; x += 11) {
          if (rand() < windows.chance) cells.push(<rect key={`${bi}-${x}-${y}`} x={n(x)} y={n(y)} width={5} height={6} />);
        }
      }
      return cells;
    });
  }
  return (
    <g opacity={opacity}>
      <path d={buildingsPath(list, o.baseY)} fill={fill} />
      {windows && (
        <g fill={windows.color} opacity={windows.opacity ?? 0.9}>
          {rects}
        </g>
      )}
    </g>
  );
});

// ───────────────────────── Clouds ─────────────────────────

/** A soft cumulus: overlapping circles with a flat-ish bottom. */
export function Cloud({ x, y, s = 1, fill = '#ffffff', opacity = 0.9 }: { x: number; y: number; s?: number; fill?: string; opacity?: number }) {
  const puffs: [number, number, number][] = [
    [-60, 6, 30],
    [-26, -12, 40],
    [18, -24, 48],
    [58, -4, 36],
    [88, 10, 24],
  ];
  return (
    <g opacity={opacity} fill={fill} transform={`translate(${n(x)} ${n(y)}) scale(${s})`}>
      {puffs.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
      <rect x={-88} y={6} width={200} height={28} rx={14} />
    </g>
  );
}

// ───────────────────────── Sakura ─────────────────────────

function flowerPetals(cx: number, cy: number, r: number, rot: number): string {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = ((rot + i * 72) * Math.PI) / 180;
    const px = cx + Math.cos(a) * r * 0.62;
    const py = cy + Math.sin(a) * r * 0.62;
    const pr = r * 0.48;
    d += `M ${n(px - pr)} ${n(py)} a ${n(pr)} ${n(pr)} 0 1 0 ${n(pr * 2)} 0 a ${n(pr)} ${n(pr)} 0 1 0 ${n(-pr * 2)} 0 Z `;
  }
  return d;
}

export interface BranchProps {
  seed: number;
  /** Branch spine as a path (drawn as a tapered stroke). */
  spine: string;
  /** Twigs (thinner strokes). */
  twigs?: string[];
  /** Points where blossom clusters sit: [x, y, radius]. */
  clusters: [number, number, number][];
  bark?: string;
  className?: string;
}

/** A cherry-blossom branch: bark strokes + fluffy blossom masses + a few crisp flowers. */
export const SakuraBranch = memo(function SakuraBranch({ seed, spine, twigs = [], clusters, bark = '#8a5a64', className }: BranchProps) {
  const rand = mulberry32(seed);
  const masses: ReactNode[] = [];
  const flowers: ReactNode[] = [];
  const tones = ['#ffd3e4', '#ffc1d8', '#ffb0cd', '#ffe4ee'];
  clusters.forEach(([cx, cy, r], ci) => {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * r * 0.7;
      masses.push(
        <circle key={`${ci}-m${i}`} cx={n(cx + Math.cos(a) * d)} cy={n(cy + Math.sin(a) * d)} r={n(r * between(rand, 0.35, 0.6))} fill={pick(rand, tones)} />,
      );
    }
    const count = Math.max(3, Math.round(r / 7));
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * r * 0.85;
      const fx = cx + Math.cos(a) * d;
      const fy = cy + Math.sin(a) * d;
      const fr = between(rand, 6, 10);
      flowers.push(
        <g key={`${ci}-f${i}`}>
          <path d={flowerPetals(fx, fy, fr, rand() * 72)} fill={rand() < 0.5 ? '#fff0f6' : '#ffd9e8'} stroke="#f39cbf" strokeWidth={0.8} />
          <circle cx={n(fx)} cy={n(fy)} r={n(fr * 0.18)} fill="#f07aa6" />
        </g>,
      );
    }
  });
  return (
    <g className={className}>
      <path d={spine} fill="none" stroke={bark} strokeWidth={14} strokeLinecap="round" />
      <path d={spine} fill="none" stroke="#a9737d" strokeWidth={5} strokeLinecap="round" opacity={0.6} transform="translate(-2 -3)" />
      {twigs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={bark} strokeWidth={5} strokeLinecap="round" />
      ))}
      <g opacity={0.95}>{masses}</g>
      {flowers}
    </g>
  );
});

// ───────────────────────── Sparkles & bokeh ─────────────────────────

export function sparklePath(x: number, y: number, s: number): string {
  const k = s * 0.16;
  return `M ${n(x)} ${n(y - s)} Q ${n(x + k)} ${n(y - k)} ${n(x + s)} ${n(y)} Q ${n(x + k)} ${n(y + k)} ${n(x)} ${n(y + s)} Q ${n(x - k)} ${n(y + k)} ${n(x - s)} ${n(y)} Q ${n(x - k)} ${n(y - k)} ${n(x)} ${n(y - s)} Z`;
}

export interface Dot {
  x: number;
  y: number;
  r: number;
  delay: number;
  dur: number;
}

/** Deterministic scatter of points inside a rectangle. */
export function scatter(seed: number, count: number, x0: number, y0: number, x1: number, y1: number, rMin: number, rMax: number): Dot[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: between(rand, x0, x1),
    y: between(rand, y0, y1),
    r: between(rand, rMin, rMax),
    delay: -between(rand, 0, 6),
    dur: between(rand, 2.4, 5.5),
  }));
}

/** Soft round lights (radial gradient discs). */
export function Bokeh({ uid, dots, colors, className }: { uid: string; dots: Dot[]; colors: string[]; className?: string }) {
  return (
    <g className={className}>
      <defs>
        {colors.map((c, i) => (
          <radialGradient key={i} id={`${uid}-bokeh${i}`}>
            <stop offset="0" stopColor={c} stopOpacity="0.55" />
            <stop offset="0.7" stopColor={c} stopOpacity="0.25" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {dots.map((d, i) => (
        <circle
          key={i}
          className="bg-float"
          style={{ animationDelay: `${n(d.delay)}s`, animationDuration: `${n(d.dur * 3)}s` }}
          cx={n(d.x)}
          cy={n(d.y)}
          r={n(d.r)}
          fill={`url(#${uid}-bokeh${i % colors.length})`}
        />
      ))}
    </g>
  );
}

/** Twinkling four-point stars. */
export function Sparkles({ dots, fill = '#fffbe6', stroke = '#ffd36b' }: { dots: Dot[]; fill?: string; stroke?: string }) {
  return (
    <g>
      {dots.map((d, i) => (
        <path
          key={i}
          className="bg-twinkle"
          style={{ animationDelay: `${n(d.delay)}s`, animationDuration: `${n(d.dur)}s` }}
          d={sparklePath(d.x, d.y, d.r)}
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/** Linear vertical gradient helper. */
export function VGradient({ id, stops }: { id: string; stops: [number, string, number?][] }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      {stops.map(([o, c, a], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />
      ))}
    </linearGradient>
  );
}

/** Edge vignette to keep attention in the centre. */
export function Vignette({ uid, color = '#2a1d40', strength = 0.18 }: { uid: string; color?: string; strength?: number }) {
  return (
    <>
      <defs>
        <radialGradient id={`${uid}-vig`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor={color} stopOpacity="0" />
          <stop offset="1" stopColor={color} stopOpacity={strength} />
        </radialGradient>
      </defs>
      <rect width={BG_W} height={BG_H} fill={`url(#${uid}-vig)`} />
    </>
  );
}

// ───────────────────────── Props ─────────────────────────

/** Potted plant (origin at the pot's rim centre). */
export function Plant({ x, y, s = 1, pot = '#f3e6da', potLine = '#d4bfae', leaf = '#8fcf9b', leafDark = '#6bb07c' }: { x: number; y: number; s?: number; pot?: string; potLine?: string; leaf?: string; leafDark?: string }) {
  const leaves: [number, number, number][] = [
    [-48, -150, -40],
    [-10, -190, -8],
    [34, -160, 30],
    [-70, -96, -62],
    [62, -104, 58],
    [8, -126, 6],
    [-30, -120, -24],
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {leaves.map(([lx, ly, rot], i) => (
        <g key={i} transform={`rotate(${rot})`}>
          <path d={`M 0 -20 C ${n(lx * 0.2 - 22)} ${n(ly * 0.5)} ${n(lx * 0.1 - 18)} ${n(ly)} 0 ${n(ly - 10)} C ${n(lx * 0.1 + 18)} ${n(ly)} ${n(lx * 0.2 + 22)} ${n(ly * 0.5)} 0 -20 Z`} fill={i % 2 ? leaf : leafDark} />
          <path d={`M 0 -20 L 0 ${n(ly - 4)}`} stroke={leafDark} strokeWidth={2} opacity={0.6} />
        </g>
      ))}
      <path d="M -46 -24 L 46 -24 L 36 60 C 20 68 -20 68 -36 60 Z" fill={pot} stroke={potLine} strokeWidth={2} />
      <rect x={-50} y={-30} width={100} height={12} rx={4} fill={pot} stroke={potLine} strokeWidth={2} />
    </g>
  );
}
