/** Small geometry helpers for building SVG paths in code. */

export type Pt = readonly [number, number];

/** Format a number for path data (1 decimal, no trailing zeros). */
export function n(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

/** "x y" for a point. */
export function p(pt: Pt): string {
  return `${n(pt[0])} ${n(pt[1])}`;
}

export function add(a: Pt, dx: number, dy: number): Pt {
  return [a[0] + dx, a[1] + dy];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Point on a cubic Bézier at parameter t. */
export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/**
 * Mirror every x coordinate of an absolute-command SVG path around x = cx.
 * Supports M/L/C/Q/S/T/Z (absolute only) — which is all the character data uses.
 */
export function mirrorPath(d: string, cx = 300): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let isX = true;
  for (const tok of tokens) {
    if (/^[a-z]$/i.test(tok)) {
      if (!'MLCQSTZ'.includes(tok)) throw new Error(`mirrorPath: command "${tok}" is not supported`);
      out.push(tok);
      isX = true;
      continue;
    }
    const v = Number(tok);
    out.push(n(isX ? 2 * cx - v : v));
    isX = !isX;
  }
  return out.join(' ');
}

/** Circle as an absolute cubic path (so it can be mirrored / unioned like other shapes). */
export function circlePath(cx: number, cy: number, r: number): string {
  return ellipsePath(cx, cy, r, r);
}

/** Axis-aligned ellipse as an absolute cubic path. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5523;
  return (
    `M ${n(cx - rx)} ${n(cy)} C ${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} ` +
    `C ${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)} ` +
    `C ${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} ` +
    `C ${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)} Z`
  );
}

/** Closed polygon through the given points. */
export function polygon(points: readonly Pt[]): string {
  return `M ${points.map(p).join(' L ')} Z`;
}

/** Rounded rectangle as an absolute path (cubic corners, mirror-friendly). */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const k = r * 0.4477; // 1 - 0.5523
  return (
    `M ${n(x + r)} ${n(y)} L ${n(x + w - r)} ${n(y)} C ${n(x + w - k)} ${n(y)} ${n(x + w)} ${n(y + k)} ${n(x + w)} ${n(y + r)} ` +
    `L ${n(x + w)} ${n(y + h - r)} C ${n(x + w)} ${n(y + h - k)} ${n(x + w - k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} ` +
    `L ${n(x + r)} ${n(y + h)} C ${n(x + k)} ${n(y + h)} ${n(x)} ${n(y + h - k)} ${n(x)} ${n(y + h - r)} ` +
    `L ${n(x)} ${n(y + r)} C ${n(x)} ${n(y + k)} ${n(x + k)} ${n(y)} ${n(x + r)} ${n(y)} Z`
  );
}
