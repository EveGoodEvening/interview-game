/**
 * Text preparation for TTS: strip things that should not be read aloud and split long text
 * into sentence-aligned chunks. Chrome's speechSynthesis silently stops long utterances
 * (~15 s for network voices), so each chunk is kept short.
 *
 * Length is measured as a *weight*: CJK / full-width characters count 2 (they take roughly
 * twice as long to speak as a Latin letter), everything else 1. The default budget of 180
 * therefore means ≤ 180 Latin chars or ≈ 90 Chinese chars per chunk.
 */

export const DEFAULT_CHUNK_WEIGHT = 180;

/** CJK ideographs, kana, hangul, CJK punctuation and full-width forms. */
const WIDE_CHAR = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{3FFFF}]/u;
/** Sentence terminators (Chinese + Latin) — always a boundary. `.` is handled separately. */
const HARD_END = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '｡']);
/** Closing quotes / brackets that stay attached to the sentence they close. */
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', ']', '}', '〉', '》', '"', "'"]);
/** Clause punctuation used to break a sentence that is still too long. */
const SOFT_BREAK = new Set(['，', '、', ',', '：', ':', '—', '–']);

export function isWideChar(ch: string): boolean {
  return WIDE_CHAR.test(ch);
}

export function textWeight(text: string): number {
  let w = 0;
  for (const ch of text) w += isWideChar(ch) ? 2 : 1;
  return w;
}

/**
 * Remove what a voice would read literally or stumble over: emoji / pictographs, markdown
 * emphasis, code ticks and heading marks. Line breaks are kept (they are sentence boundaries).
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0E|\uFE0F|\u200D|\u20E3/gu, '')
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1')
    .replace(/\*{1,3}|`+|~~/g, '')
    .replace(/[ \t\f\v\u00A0\u3000]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

function isBoundaryAfterDot(next: string | undefined): boolean {
  return next === undefined || /\s/.test(next) || CLOSERS.has(next);
}

/** Split into sentences, keeping terminators and closing quotes attached. */
export function splitSentences(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let buf = '';
  const flush = (): void => {
    const s = buf.replace(/\s+/g, ' ').trim();
    if (s) out.push(s);
    buf = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      flush();
      continue;
    }
    buf += ch;
    const boundary = HARD_END.has(ch) || (ch === '.' && isBoundaryAfterDot(chars[i + 1]));
    if (!boundary) continue;
    // Absorb runs like "？！", "……", '."' and closing brackets.
    while (i + 1 < chars.length) {
      const next = chars[i + 1];
      if (HARD_END.has(next) || next === '.' || CLOSERS.has(next)) {
        buf += next;
        i++;
      } else break;
    }
    flush();
  }
  flush();
  return out;
}

function lastChar(s: string): string {
  const arr = Array.from(s);
  return arr[arr.length - 1] ?? '';
}

/** Join two pieces: no space between CJK text, a single space otherwise. */
function joinPieces(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const tight = isWideChar(lastChar(a)) && isWideChar(Array.from(b)[0] ?? '');
  return tight ? a + b : `${a} ${b}`;
}

/** Greedily merge consecutive pieces while they fit in `maxWeight`. */
function pack(pieces: readonly string[], maxWeight: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    if (!cur) {
      cur = piece;
      continue;
    }
    const joined = joinPieces(cur, piece);
    if (textWeight(joined) <= maxWeight) cur = joined;
    else {
      chunks.push(cur);
      cur = piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Split after any of `breaks`, keeping the break character on the left piece. */
function splitAfter(text: string, breaks: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (breaks.has(ch)) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Last resort: cut every `maxWeight` (never inside a surrogate pair). */
function hardSplit(text: string, maxWeight: number): string[] {
  const out: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of text) {
    const cw = isWideChar(ch) ? 2 : 1;
    if (cur && w + cw > maxWeight) {
      out.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur) out.push(cur);
  return out;
}

function splitByWords(text: string, maxWeight: number): string[] {
  if (!/\s/.test(text)) return hardSplit(text, maxWeight);
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (textWeight(w) > maxWeight ? hardSplit(w, maxWeight) : [w]));
  return pack(words, maxWeight);
}

function splitLongSentence(sentence: string, maxWeight: number): string[] {
  return pack(splitAfter(sentence, SOFT_BREAK), maxWeight).flatMap((piece) =>
    textWeight(piece) <= maxWeight ? [piece] : splitByWords(piece, maxWeight),
  );
}

/**
 * Split `text` into speakable chunks of at most `maxWeight` (see module doc), preferring
 * sentence boundaries (。！？；.!?; and line breaks), then clause punctuation (，、,:), then
 * spaces, and finally hard cuts for long runs without any punctuation.
 */
export function splitIntoChunks(text: string, maxWeight: number = DEFAULT_CHUNK_WEIGHT): string[] {
  const budget = Math.max(8, Math.floor(maxWeight));
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  const pieces = splitSentences(clean).flatMap((s) => (textWeight(s) > budget ? splitLongSentence(s, budget) : [s]));
  return pack(pieces, budget);
}
