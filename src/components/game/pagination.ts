/**
 * Splits interviewer speech into dialogue-box pages, visual-novel style.
 *
 * Rules:
 * - Sentences end at 。！？!?…；; (and '.' when followed by whitespace / CJK / end) or a newline.
 * - Consecutive sentences are merged into one page while they fit.
 * - A page holds at most `maxUnits` "units": a CJK / full-width character counts 1, anything else 0.5
 *   (so the default 70 ≈ 70 CJK characters or ≈ 140 Latin characters).
 * - Over-long sentences are split at clause punctuation first, then between words — never inside one.
 * - Pages are balanced (90 units → 45 + 45 rather than 70 + 20).
 *
 * Pure: no React, no DOM.
 */

export type PagePart = 'reaction' | 'question';

export interface DialoguePage {
  /** Position within the turn (0-based). */
  index: number;
  text: string;
  part: PagePart;
  /** True only for the last page of the question — the line the candidate has to answer. */
  isQuestion: boolean;
}

export interface PaginateOptions {
  /** Page capacity in units (CJK char = 1, other char = 0.5). Default {@link DEFAULT_PAGE_UNITS}. */
  maxUnits?: number;
}

export const DEFAULT_PAGE_UNITS = 70;

const TERMINALS = new Set(['。', '！', '？', '!', '?', '…', '；', ';', '.', '．', '‼', '⁉']);
const CLOSERS = new Set(['"', "'", '”', '’', '」', '』', '）', ')', '】', ']', '》', '〉', '〕']);
const CLAUSE_MARKS = new Set(['，', '、', '：', '—', '–', '﹐', ',', ':']);
/** ASCII clause marks only split when followed by whitespace ("1,000" and "10:30" stay whole). */
const ASCII_CLAUSE_MARKS = new Set([',', ':']);
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'inc', 'ltd', 'co', 'no', 'approx', 'dept', 'fig']);

/** True for CJK ideographs, kana, hangul, CJK punctuation and full-width forms. */
export function isWideChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Display width of a string in page units. */
export function textUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += isWideChar(ch) ? 1 : 0.5;
  return n;
}

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

/** Glue between two trimmed pieces: nothing around CJK text, a space between Latin words. */
function joiner(a: string, b: string): string {
  if (!a || !b) return '';
  const last = Array.from(a).pop() ?? '';
  const first = Array.from(b)[0] ?? '';
  return isWideChar(last) || isWideChar(first) ? '' : ' ';
}

function joinPieces(pieces: readonly string[]): string {
  let out = '';
  for (const p of pieces) out += joiner(out, p) + p;
  return out;
}

/** Whether a run of ASCII periods at `chars[runStart..runEnd)` really ends a sentence. */
function isPeriodBoundary(chars: string[], runStart: number, runEnd: number): boolean {
  const next = chars[runEnd];
  const nextOk = next === undefined || isSpace(next) || isWideChar(next);
  if (!nextOk) return false; // "3.5", "Node.js", "e.g.,"
  if (runEnd - runStart >= 2) return true; // "..." ellipsis
  // Look at the word before the period: initials ("U.S.") and abbreviations ("Dr.") don't end sentences.
  let j = runStart - 1;
  let word = '';
  while (j >= 0 && /[A-Za-z.]/.test(chars[j])) word = chars[j--] + word;
  const bare = word.replace(/\.+$/, '').toLowerCase();
  if (/^([a-z]\.)*[a-z]$/.test(bare)) return false; // initials: "A.", "U.S."
  return !ABBREVIATIONS.has(bare);
}

/** Split one paragraph (no newlines) into trimmed sentences. */
export function splitSentences(paragraph: string): string[] {
  const chars = Array.from(paragraph);
  const out: string[] = [];
  let buf = '';
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    buf += ch;
    i++;
    if (!TERMINALS.has(ch)) continue;
    const runStart = i - 1;
    let onlyAsciiPeriods = ch === '.';
    // Absorb a run of terminal marks ("?!", "……", "...") followed by closing quotes/brackets.
    while (i < chars.length && TERMINALS.has(chars[i])) {
      if (chars[i] !== '.') onlyAsciiPeriods = false;
      buf += chars[i++];
    }
    const runEnd = i;
    while (i < chars.length && CLOSERS.has(chars[i])) buf += chars[i++];
    if (onlyAsciiPeriods && !isPeriodBoundary(chars, runStart, runEnd)) continue;
    const s = buf.trim();
    if (s) out.push(s);
    buf = '';
  }
  const rest = buf.trim();
  if (rest) out.push(rest);
  return out;
}

/** Split at clause punctuation (，、：— and ", " / ": "), keeping the mark with the left clause. */
function splitClauses(sentence: string): string[] {
  const chars = Array.from(sentence);
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    buf += ch;
    if (!CLAUSE_MARKS.has(ch)) continue;
    if (ASCII_CLAUSE_MARKS.has(ch) && !(i + 1 >= chars.length || isSpace(chars[i + 1]))) continue;
    const s = buf.trim();
    if (s) out.push(s);
    buf = '';
  }
  const rest = buf.trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Word-safe atoms: a Latin word/number (with its inner punctuation such as "Node.js", "don't",
 * "C++", "50%") plus trailing spaces, or a single other character. Joining atoms with '' restores the text.
 */
const ATOM_RE = /[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’._\-+#/@%&]*\s*|\s+|[\s\S]/gu;

function splitAtoms(text: string): string[] {
  return text.match(ATOM_RE) ?? [];
}

/** Greedy packing of pieces into chunks of at most `limit` units (a single oversize piece stays alone). */
function packGreedy(pieces: readonly string[], limit: number, join: (parts: readonly string[]) => string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const piece of pieces) {
    if (current.length === 0) {
      current = [piece];
      continue;
    }
    const candidate = join([...current, piece]);
    if (textUnits(candidate) <= limit) current.push(piece);
    else {
      chunks.push(join(current).trim());
      current = [piece];
    }
  }
  if (current.length) chunks.push(join(current).trim());
  return chunks.filter(Boolean);
}

/** Pack into the fewest chunks that fit `max`, with chunk sizes as even as possible. */
function packBalanced(pieces: readonly string[], max: number, join: (parts: readonly string[]) => string): string[] {
  if (pieces.length === 0) return [];
  const total = textUnits(join(pieces));
  if (total <= max) return [join(pieces).trim()];
  const fewest = packGreedy(pieces, max, join).length;
  for (let limit = Math.ceil(total / fewest); limit < max; limit += 1) {
    const chunks = packGreedy(pieces, limit, join);
    if (chunks.length <= fewest) return chunks;
  }
  return packGreedy(pieces, max, join);
}

const joinAtoms = (parts: readonly string[]): string => parts.join('');

/** Break one sentence that is longer than a page into page-sized pieces. */
function splitLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  for (const clause of splitClauses(sentence)) {
    if (textUnits(clause) <= max) pieces.push(clause);
    else pieces.push(...packBalanced(splitAtoms(clause), max, joinAtoms));
  }
  return packBalanced(pieces, max, joinPieces);
}

/** Paginate a block of speech into page texts. Empty / whitespace-only input → []. */
export function paginate(text: string, options: PaginateOptions = {}): string[] {
  const max = Math.max(4, options.maxUnits ?? DEFAULT_PAGE_UNITS);
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[ \t\u00a0\u3000]+/g, ' ');
  const pages: string[] = [];
  // Newlines are hard page boundaries.
  for (const paragraph of normalized.split(/\n+/)) {
    const sentences: string[] = [];
    for (const s of splitSentences(paragraph.trim())) {
      if (textUnits(s) <= max) sentences.push(s);
      else sentences.push(...splitLongSentence(s, max));
    }
    pages.push(...packBalanced(sentences, max, joinPieces));
  }
  return pages.filter(Boolean);
}

/**
 * Pages for one interviewer turn: the reaction first, then the question.
 * The question's last page is flagged `isQuestion`.
 */
export function paginateTurn(turn: { reaction: string; question: string }, options: PaginateOptions = {}): DialoguePage[] {
  const pages: DialoguePage[] = [];
  for (const text of paginate(turn.reaction, options)) {
    pages.push({ index: pages.length, text, part: 'reaction', isQuestion: false });
  }
  const questionPages = paginate(turn.question, options);
  questionPages.forEach((text, i) => {
    pages.push({ index: pages.length, text, part: 'question', isQuestion: i === questionPages.length - 1 });
  });
  return pages;
}

/** Re-join page texts the way they were split (no space around CJK, a space between Latin words). */
export function joinPages(texts: readonly string[]): string {
  return joinPieces(texts.map((s) => s.trim()).filter(Boolean));
}
