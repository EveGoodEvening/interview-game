/**
 * Text clean-up shared by every résumé source (PDF, DOCX, TXT/MD and pasted text).
 * Goals: stable, readable plain text for the preview textarea and compact input for the LLM,
 * without destroying Chinese punctuation (so no blanket NFKC).
 */

/** Symbol-font bullets that PDF/Word exports map into the Private Use Area. */
const PUA_BULLETS = /[\uF0B7\uF0A7\uF076\uF06C\uF06E\uF0D8\uF0FC\uF0A8\uF09F\uF0E8\uF075\uF0AE]/g;
/** Remaining Private Use Area glyphs are icon-font pictograms (phone, mail…) that carry no text. */
const PUA = /[\uE000-\uF8FF]/g;
/** Characters that only make sense after compatibility normalisation: Kangxi radicals and CJK
 * compatibility ideographs (PDF text extraction often yields "⽤" U+2F64 instead of "用"), Latin ligatures. */
const COMPAT = /[\u2F00-\u2FDF\uF900-\uFAFF\uFB00-\uFB06]/g;
/** Full-width letters, digits and number/e-mail symbols (＃＄％＆＋－．／＝＠＿) fold to ASCII;
 * Chinese punctuation (，：；（）！？ …) is kept. */
const FULLWIDTH_ALNUM = /[\uFF03-\uFF06\uFF0B\uFF0D-\uFF19\uFF1D\uFF20-\uFF3A\uFF3F\uFF41-\uFF5A]/g;
/** Zero-width & invisible formatting characters. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
/** C0/C1 control characters except \n and \t. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Horizontal spaces of every width. */
const HSPACE = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** A leading bullet glyph (any common style), or an ASCII list marker followed by whitespace. */
const BULLET = /^(?:[•●○◦▪▫■□◆◇◈❖►▸▹▶▷➢➣➤➔→✓✔☐☑⁃‣∙・·★☆]\s*|[-*+–—](?:\s+|$))/;

/** Unify line endings and characters, drop invisible junk. Keeps line structure. */
export function cleanCharacters(input: string): string {
  return input
    .replace(/\r\n?|\u2028|\u2029|\u0085|\f|\v/g, '\n')
    .normalize('NFC')
    .replace(COMPAT, (c) => c.normalize('NFKC'))
    .replace(FULLWIDTH_ALNUM, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(PUA_BULLETS, '•')
    .replace(PUA, '')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(HSPACE, ' ');
}

function normalizeLine(line: string): string {
  const trimmedEnd = line.replace(/ +$/, '');
  if (!trimmedEnd.trim()) return '';
  const indentMatch = /^ */.exec(trimmedEnd);
  const indent = Math.min(indentMatch ? indentMatch[0].length : 0, 4);
  let body = trimmedEnd.trimStart().replace(/ {2,}/g, '  ');
  const bullet = BULLET.exec(body);
  if (bullet) {
    const rest = body.slice(bullet[0].length);
    body = rest ? `- ${rest}` : '-';
  }
  return ' '.repeat(indent) + body;
}

/**
 * Normalise résumé text:
 * - CRLF/CR → LF, NFC, Kangxi radicals & ligatures folded, full-width letters/digits → ASCII;
 * - invisible/control/private-use characters removed; tabs & exotic spaces → spaces;
 * - trailing spaces trimmed, runs of spaces collapsed (max 2 inside a line, indent ≤ 4);
 * - every bullet style ("•", "●", "▪", "➢", "·", "*", "–" …) unified to "- ";
 * - at most one blank line between blocks; leading/trailing blank lines removed.
 */
export function normalizeResumeText(input: string): string {
  const lines = cleanCharacters(input).split('\n').map(normalizeLine);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Cap the text at `max` characters, preferring to cut at a line break in the last 10 %
 * so the LLM never sees half a sentence.
 */
export function truncateResumeText(text: string, max: number): TruncateResult {
  const originalLength = text.length;
  if (originalLength <= max) return { text, truncated: false, originalLength };
  let cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf('\n');
  if (lastBreak >= max * 0.9) cut = cut.slice(0, lastBreak);
  // Do not leave a dangling high surrogate.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut.replace(/\s+$/, ''), truncated: true, originalLength };
}

/** Characters that carry content (ignores whitespace). */
export function countContentChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}
