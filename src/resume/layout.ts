/**
 * Rebuild reading order from positioned PDF text fragments.
 *
 * PDF text is a bag of positioned strings. We:
 *  1. cluster fragments into lines by baseline (tolerance relative to font size), sort by x;
 *  2. join fragments with spaces decided from the horizontal gap (no spaces between CJK glyphs);
 *  3. detect two-column layouts (sidebar résumés) via a vertical whitespace gutter that is not a
 *     table (rows on both sides share baselines) — optionally below a full-width header — and read
 *     column by column;
 *  4. insert blank lines where the vertical gap is clearly larger than the normal line pitch.
 * Pure functions — no pdfjs dependency — so they are unit-tested with synthetic fragments.
 */

export interface LayoutItem {
  str: string;
  /** Left edge of the fragment. */
  x: number;
  /** Baseline, measured downwards (bigger = lower on the page). */
  y: number;
  /** Advance width along the baseline. */
  width: number;
  /** Font size (≈ glyph height). */
  size: number;
}

interface Box {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
  spaceBefore: boolean;
  spaceAfter: boolean;
}

interface Line {
  boxes: Box[];
  y: number;
  size: number;
}

/** A paragraph = consecutive lines; paragraphs are separated by a blank line in the output. */
type Block = string[];

const WORD_GAP_EM = 0.16;
const CJK_GAP_EM = 0.6;
const WIDE_GAP_EM = 2.2;
const MIN_COLUMN_LINES = 3;
const MAX_HEADER_LINES = 8;
const MAX_DEPTH = 4;
const MIN_COLUMN_DENSITY = 0.45;

const CJK_CHAR =
  /[\u2E80-\u2FDF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3190-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && CJK_CHAR.test(ch);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toBoxes(items: readonly LayoutItem[]): Box[] {
  const boxes: Box[] = [];
  for (const it of items) {
    if (!it.str || !/\S/.test(it.str)) continue;
    if (![it.x, it.y, it.width, it.size].every(Number.isFinite)) continue;
    const size = it.size > 0.5 ? it.size : 10;
    const width = Math.max(it.width, 0);
    boxes.push({
      text: it.str.trim().replace(/\s+/g, ' '),
      x0: it.x,
      x1: it.x + width,
      y: it.y,
      size,
      spaceBefore: /^\s/.test(it.str),
      spaceAfter: /\s$/.test(it.str),
    });
  }
  return boxes;
}

function sameLine(a: number, sizeA: number, b: number, sizeB: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.5 * Math.min(sizeA, sizeB));
}

function clusterLines(boxes: readonly Box[]): Line[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines: Line[] = [];
  for (const box of sorted) {
    const last = lines[lines.length - 1];
    if (last && sameLine(last.y, last.size, box.y, box.size)) {
      last.boxes.push(box);
      last.size = Math.max(last.size, box.size);
    } else {
      lines.push({ boxes: [box], y: box.y, size: box.size });
    }
  }
  for (const line of lines) line.boxes.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** Fake-bold PDFs draw the same string twice with a tiny offset. */
function isDuplicate(a: Box, b: Box): boolean {
  return a.text === b.text && Math.abs(a.x0 - b.x0) < 0.35 * Math.max(a.size, b.size) && Math.abs(a.y - b.y) < 0.35 * a.size;
}

function separator(a: Box, b: Box): string {
  const size = (a.size + b.size) / 2;
  const gap = b.x0 - a.x1;
  if (gap > WIDE_GAP_EM * size) return '  ';
  const cjkJoin = isCjk(a.text.at(-1)) && isCjk(b.text[0]);
  if (cjkJoin) return gap > CJK_GAP_EM * size ? ' ' : '';
  if (gap > WORD_GAP_EM * size) return ' ';
  return a.spaceAfter || b.spaceBefore ? ' ' : '';
}

function lineText(line: Line): string {
  let out = '';
  let prev: Box | null = null;
  for (const box of line.boxes) {
    if (prev && isDuplicate(prev, box)) continue;
    out += prev ? separator(prev, box) + box.text : box.text;
    prev = box;
  }
  return out;
}

function typicalPitch(lines: readonly Line[]): number {
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].y - lines[i - 1].y;
    if (d > 0 && d < 3 * Math.max(lines[i].size, lines[i - 1].size)) pitches.push(d);
  }
  const sizes = lines.map((l) => l.size);
  return pitches.length >= 2 ? median(pitches) : 1.25 * (median(sizes) || 10);
}

function isParagraphBreak(prev: Line, next: Line, pitch: number): boolean {
  const d = next.y - prev.y;
  return d > Math.max(pitch * 1.5, (prev.size + next.size) * 1.05);
}

/** Lines → paragraphs, splitting at clearly larger vertical gaps. */
function rowsToBlocks(lines: readonly Line[]): Block[] {
  if (lines.length === 0) return [];
  const pitch = typicalPitch(lines);
  const blocks: Block[] = [];
  let current: Block = [];
  lines.forEach((line, i) => {
    if (i > 0 && isParagraphBreak(lines[i - 1], line, pitch) && current.length) {
      blocks.push(current);
      current = [];
    }
    const text = lineText(line);
    if (text) current.push(text);
  });
  if (current.length) blocks.push(current);
  return blocks;
}

function charCount(boxes: readonly Box[]): number {
  return boxes.reduce((n, b) => n + b.text.length, 0);
}

interface ColumnSplit {
  header: Line[];
  left: Box[];
  right: Box[];
}

/** Share of the shorter column's lines whose baseline coincides with a line in the other column. */
function alignmentRatio(left: readonly Line[], right: readonly Line[]): number {
  const [few, many] = left.length <= right.length ? [left, right] : [right, left];
  let aligned = 0;
  for (const line of few) {
    const tol = Math.max(0.75, 0.15 * line.size);
    if (many.some((other) => Math.abs(other.y - line.y) <= tol)) aligned++;
  }
  return few.length ? aligned / few.length : 1;
}

/** Lines per line-pitch over the column's vertical extent: ~1 for running text, low for sparse cells. */
function density(lines: readonly Line[]): number {
  if (lines.length < 2) return 0;
  const extent = lines[lines.length - 1].y - lines[0].y;
  return lines.length / (extent / typicalPitch(lines) + 1);
}

function findGutter(boxes: readonly Box[]): { left: Box[]; right: Box[] } | null {
  if (boxes.length < MIN_COLUMN_LINES * 2) return null;
  const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
  const medianSize = median(boxes.map((b) => b.size)) || 10;
  const minGutter = Math.max(8, 1.2 * medianSize);
  const gaps: { start: number; end: number }[] = [];
  let reach = sorted[0].x1;
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.x0 - reach >= minGutter) gaps.push({ start: reach, end: b.x0 });
    reach = Math.max(reach, b.x1);
  }
  gaps.sort((a, b) => b.end - b.start - (a.end - a.start));
  const total = charCount(boxes);
  for (const gap of gaps) {
    const left = boxes.filter((b) => b.x1 <= gap.start + 0.01);
    const right = boxes.filter((b) => b.x0 >= gap.end - 0.01);
    if (charCount(left) < total * 0.08 || charCount(right) < total * 0.08) continue;
    const leftLines = clusterLines(left);
    const rightLines = clusterLines(right);
    if (leftLines.length < MIN_COLUMN_LINES || rightLines.length < MIN_COLUMN_LINES) continue;
    // Rows that share baselines on both sides are a table / "title … date" layout, not columns;
    // so is a sparse side (a date or location every few lines).
    if (alignmentRatio(leftLines, rightLines) >= 0.7) continue;
    if (density(leftLines) < MIN_COLUMN_DENSITY || density(rightLines) < MIN_COLUMN_DENSITY) continue;
    return { left, right };
  }
  return null;
}

function findColumns(lines: readonly Line[]): ColumnSplit | null {
  const maxHeader = Math.min(MAX_HEADER_LINES, lines.length - MIN_COLUMN_LINES * 2);
  for (let k = 0; k <= maxHeader; k++) {
    const body = lines.slice(k).flatMap((l) => l.boxes);
    const split = findGutter(body);
    if (split) return { header: lines.slice(0, k), ...split };
  }
  return null;
}

/** Split at gaps that are much larger than the line pitch (section breaks). */
function splitBands(lines: readonly Line[]): Line[][] {
  const pitch = typicalPitch(lines);
  const bands: Line[][] = [];
  let current: Line[] = [];
  lines.forEach((line, i) => {
    if (i > 0 && line.y - lines[i - 1].y > pitch * 2.2 && current.length) {
      bands.push(current);
      current = [];
    }
    current.push(line);
  });
  if (current.length) bands.push(current);
  return bands;
}

function layoutRegion(lines: Line[], depth: number): Block[] {
  if (depth < MAX_DEPTH && lines.length >= MIN_COLUMN_LINES * 2) {
    const split = findColumns(lines);
    if (split) {
      return [
        ...rowsToBlocks(split.header),
        ...layoutRegion(clusterLines(split.left), depth + 1),
        ...layoutRegion(clusterLines(split.right), depth + 1),
      ];
    }
    const bands = splitBands(lines);
    if (bands.length > 1 && bands.some((b) => b.length >= MIN_COLUMN_LINES * 2)) {
      return bands.flatMap((band) => layoutRegion(band, depth + 1));
    }
  }
  return rowsToBlocks(lines);
}

/** Text of one page: lines joined by "\n", paragraphs by a blank line. */
export function layoutPageText(items: readonly LayoutItem[]): string {
  const boxes = toBoxes(items);
  if (boxes.length === 0) return '';
  // Page numbers in the header/footer would otherwise disturb column detection.
  const lines = clusterLines(boxes);
  while (lines.length > 1 && isPageNumberLine(lineText(lines[lines.length - 1]))) lines.pop();
  while (lines.length > 1 && isPageNumberLine(lineText(lines[0]))) lines.shift();
  return layoutRegion(lines, 0)
    .map((block) => block.join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

const PAGE_NUMBER_LINE = [
  /^\s*(?:page|p\.?)?\s*[-–—]?\s*\d{1,3}\s*[-–—]?\s*$/i,
  /^\s*(?:page\s*)?\d{1,3}\s*(?:\/|of)\s*\d{1,3}\s*$/i,
  /^\s*第\s*\d{1,3}\s*页(?:\s*[,，/]?\s*共\s*\d{1,3}\s*页)?\s*$/,
  /^\s*共\s*\d{1,3}\s*页\s*[,，]?\s*第\s*\d{1,3}\s*页\s*$/,
];

export function isPageNumberLine(line: string): boolean {
  return PAGE_NUMBER_LINE.some((re) => re.test(line));
}

/** Join page texts, dropping page-number headers/footers ("1/2", "Page 3", "第 1 页 共 2 页"). */
export function joinPages(pages: readonly string[]): string {
  const cleaned = pages.map((page) => {
    const lines = page.split('\n');
    while (lines.length && (!lines[0].trim() || isPageNumberLine(lines[0]))) lines.shift();
    while (lines.length && (!lines[lines.length - 1].trim() || isPageNumberLine(lines[lines.length - 1]))) lines.pop();
    return lines.join('\n');
  });
  return cleaned.filter((p) => p.trim()).join('\n\n');
}
