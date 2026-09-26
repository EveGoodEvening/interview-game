/**
 * DOCX text extraction with mammoth (browser bundle, lazy-loaded).
 *
 * We convert to HTML and flatten that ourselves instead of using `extractRawText`, because the raw
 * extractor drops soft line breaks (Shift+Enter — "Company<br>2021–2023" would become
 * "Company2021–2023"), list bullets and table-row structure, all of which résumés use heavily.
 */
import type { Mammoth } from 'mammoth/mammoth.browser.js';
import { ResumeParseError } from './errors';
import type { RawExtraction } from './types';

export type MammothLoader = () => Promise<Mammoth>;

const loadMammoth: MammothLoader = async () => {
  const mod: { default?: Mammoth } & Partial<Mammoth> = await import('mammoth/mammoth.browser.js');
  const lib = mod.default ?? (mod as Mammoth);
  if (typeof lib.convertToHtml !== 'function') throw new Error('mammoth failed to load');
  return lib;
};

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'blockquote', 'pre']);
const HEADING = /^h[1-6]$/;

/**
 * Flatten mammoth's (simple, well-formed) HTML into plain text:
 * paragraphs/headings → lines, empty paragraphs → blank lines, `<br>` → newline,
 * list items → "- " / "1. " with indentation per nesting level, table cells → "  "-separated row.
 */
export function docxHtmlToText(html: string): string {
  let out = '';
  const lists: { ordered: boolean; counter: number }[] = [];
  let cellDepth = 0;
  let cellIndex = 0;
  let cellParagraphs = 0;

  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };

  const tokens = html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)/g);
  for (const [, closing, rawTag, text] of tokens) {
    if (text !== undefined) {
      out += decodeEntities(text).replace(/\s*\n\s*/g, ' ');
      continue;
    }
    const tag = rawTag.toLowerCase();
    const isParagraph = tag === 'p' || HEADING.test(tag);
    if (!closing) {
      if (tag === 'br') {
        out += '\n';
      } else if (tag === 'ul' || tag === 'ol') {
        newline();
        lists.push({ ordered: tag === 'ol', counter: 0 });
      } else if (tag === 'li') {
        newline();
        const list = lists[lists.length - 1];
        if (list) list.counter++;
        out += '  '.repeat(Math.max(lists.length - 1, 0)) + (list?.ordered ? `${list.counter}. ` : '- ');
      } else if (tag === 'tr') {
        newline();
        cellIndex = 0;
      } else if (tag === 'td' || tag === 'th') {
        if (cellIndex++ > 0 && !out.endsWith('\n')) out += '  ';
        cellDepth++;
        cellParagraphs = 0;
      } else if (isParagraph && cellDepth > 0) {
        // Several paragraphs inside one table cell: keep them on separate lines.
        if (cellParagraphs++ > 0) newline();
      } else if (HEADING.test(tag)) {
        newline();
        if (out && !out.endsWith('\n\n')) out += '\n';
      } else if (BLOCK_TAGS.has(tag)) {
        newline();
      }
    } else if (tag === 'td' || tag === 'th') {
      cellDepth = Math.max(cellDepth - 1, 0);
    } else if (isParagraph) {
      // Outside tables every paragraph ends its line; an empty one therefore leaves a blank line.
      if (cellDepth === 0) out += '\n';
    } else if (tag === 'ul' || tag === 'ol') {
      lists.pop();
      newline();
    } else if (tag === 'li' || tag === 'tr' || tag === 'table') {
      newline();
    }
  }
  return out;
}

/** Extract text from DOCX bytes. `loader` is injectable for tests. */
export async function extractDocxText(bytes: Uint8Array, loader: MammothLoader = loadMammoth): Promise<RawExtraction> {
  let mammoth: Mammoth;
  try {
    mammoth = await loader();
  } catch (error) {
    throw new ResumeParseError('corrupt', 'DOCX reader failed to load.', { reason: 'engine', cause: error });
  }
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        ignoreEmptyParagraphs: false,
        externalFileAccess: false,
        // Skip image payloads entirely (profile photos would otherwise be base64-encoded).
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      },
    );
    return { text: docxHtmlToText(result.value), warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ResumeParseError('corrupt', `Invalid or damaged DOCX: ${message}`, { cause: error });
  }
}
