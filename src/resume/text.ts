/**
 * Decoding of plain-text résumés (TXT / Markdown).
 * UTF-8 first (BOM stripped); UTF-16 by BOM or NUL-byte pattern; GB18030 (superset of GBK/GB2312,
 * what Chinese Windows Notepad used for years) when UTF-8 yields many replacement characters.
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  /** U+FFFD characters left in the result (undecodable bytes). */
  replacementCount: number;
}

const REPLACEMENT = /\uFFFD/g;

function countReplacements(text: string): number {
  return text.match(REPLACEMENT)?.length ?? 0;
}

function decode(bytes: Uint8Array, encoding: TextEncodingName): string | null {
  try {
    // ignoreBOM: false (default) strips a matching BOM.
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return null; // label unsupported by this runtime
  }
}

function detectUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }
  // No BOM: ASCII-heavy UTF-16 has NUL on every other byte.
  const n = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (n < 4) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenNul++;
    if (bytes[i + 1] === 0) oddNul++;
  }
  const pairs = n / 2;
  if (oddNul > pairs * 0.3 && evenNul < pairs * 0.02) return 'utf-16le';
  if (evenNul > pairs * 0.3 && oddNul < pairs * 0.02) return 'utf-16be';
  return null;
}

/** Many replacement chars → the file is probably not UTF-8. */
function isSuspicious(replacements: number, length: number): boolean {
  return replacements >= 8 || (replacements > 0 && replacements / Math.max(length, 1) > 0.01);
}

export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  const utf16 = detectUtf16(bytes);
  if (utf16) {
    const text = decode(bytes, utf16);
    if (text !== null) return { text, encoding: utf16, replacementCount: countReplacements(text) };
  }

  const utf8 = decode(bytes, 'utf-8') ?? '';
  const utf8Bad = countReplacements(utf8);
  if (!isSuspicious(utf8Bad, utf8.length)) {
    return { text: utf8, encoding: 'utf-8', replacementCount: utf8Bad };
  }

  const gb = decode(bytes, 'gb18030');
  if (gb !== null) {
    const gbBad = countReplacements(gb);
    // GB18030 decodes almost any byte soup, so only switch when it is clearly better.
    if (gbBad * 4 < utf8Bad) return { text: gb, encoding: 'gb18030', replacementCount: gbBad };
  }
  return { text: utf8, encoding: 'utf-8', replacementCount: utf8Bad };
}
