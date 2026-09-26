/**
 * Decide how to read an uploaded file from its name, MIME type and first bytes ("magic").
 * Magic bytes win over the extension, because players rename files and OSes guess MIME types badly.
 */
import { ResumeParseError, type ResumeErrorReason } from './errors';

export type ReadableKind = 'pdf' | 'docx' | 'text';

type Declared = { kind: ReadableKind } | { kind: 'unsupported'; reason: ResumeErrorReason } | { kind: 'unknown' };

type Sniffed = 'pdf' | 'zip' | 'ole' | 'rtf' | 'image' | 'utf16' | 'binary' | 'text';

const EXTENSION_KINDS: Readonly<Record<string, ReadableKind>> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  text: 'text',
  md: 'text',
  markdown: 'text',
  mdown: 'text',
  mkd: 'text',
};

const UNSUPPORTED_EXTENSIONS: Readonly<Record<string, ResumeErrorReason>> = {
  doc: 'legacy_doc',
  wps: 'legacy_doc',
  dot: 'legacy_doc',
  rtf: 'other_document',
  odt: 'other_document',
  pages: 'other_document',
  html: 'other_document',
  htm: 'other_document',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  tif: 'image',
  tiff: 'image',
  svg: 'image',
  xls: 'binary',
  xlsx: 'binary',
  csv: 'binary',
  ppt: 'binary',
  pptx: 'binary',
  key: 'binary',
  zip: 'binary',
  rar: 'binary',
  '7z': 'binary',
  exe: 'binary',
};

const MIME_KINDS: Readonly<Record<string, ReadableKind>> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
};

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function classifyDeclared(name: string, mime: string): Declared {
  const ext = fileExtension(name);
  if (ext in EXTENSION_KINDS) return { kind: EXTENSION_KINDS[ext] };
  if (ext in UNSUPPORTED_EXTENSIONS) return { kind: 'unsupported', reason: UNSUPPORTED_EXTENSIONS[ext] };
  const type = mime.toLowerCase().split(';')[0].trim();
  if (type in MIME_KINDS) return { kind: MIME_KINDS[type] };
  if (type === 'application/msword') return { kind: 'unsupported', reason: 'legacy_doc' };
  if (type.startsWith('image/')) return { kind: 'unsupported', reason: 'image' };
  return { kind: 'unknown' };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function asciiAt(bytes: Uint8Array, text: string, offset = 0): boolean {
  return startsWith(
    bytes,
    Array.from(text, (c) => c.charCodeAt(0)),
    offset,
  );
}

/** PDF allows junk before the header as long as `%PDF-` appears within the first 1024 bytes. */
function findPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && asciiAt(bytes, '%PDF-', i)) return true;
  }
  return false;
}

export function sniffBytes(bytes: Uint8Array): Sniffed {
  if (findPdfHeader(bytes)) return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (asciiAt(bytes, '{\\rtf')) return 'rtf';
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(bytes, [0xff, 0xd8, 0xff]) ||
    asciiAt(bytes, 'GIF8') ||
    (asciiAt(bytes, 'RIFF') && asciiAt(bytes, 'WEBP', 8))
  ) {
    return 'image';
  }
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return 'utf16';
  return looksBinary(bytes) ? 'binary' : 'text';
}

/** Heuristic: text files have (almost) no NUL / C0 control bytes. UTF-16 without BOM is handled in text.ts. */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  if (n === 0) return false;
  let nul = 0;
  let control = 0;
  let nulEven = 0;
  let nulOdd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) {
      nul++;
      if (i % 2 === 0) nulEven++;
      else nulOdd++;
    } else if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) {
      control++;
    }
  }
  // UTF-16 text (no BOM): NULs sit almost exclusively on one parity.
  if (nul > n * 0.2 && (nulEven < nul * 0.05 || nulOdd < nul * 0.05) && control < n * 0.02) return false;
  return nul > 0 || control > n * 0.05;
}

/**
 * Final decision. Throws {@link ResumeParseError} for formats we can't read.
 */
export function resolveKind(name: string, mime: string, bytes: Uint8Array): ReadableKind {
  const declared = classifyDeclared(name, mime);
  const sniffed = sniffBytes(bytes);
  const ext = fileExtension(name);
  const label = ext ? `.${ext}` : name || 'file';

  if (sniffed === 'pdf') return 'pdf';
  if (sniffed === 'ole') {
    throw new ResumeParseError('unsupported', `Legacy Word document (${label}) — please save it as .docx or PDF.`, {
      reason: 'legacy_doc',
    });
  }
  if (sniffed === 'rtf') {
    throw new ResumeParseError('unsupported', `RTF documents are not supported (${label}).`, { reason: 'other_document' });
  }
  if (sniffed === 'image') {
    throw new ResumeParseError('unsupported', `Images are not supported (${label}) — upload a PDF/DOCX or paste the text.`, {
      reason: 'image',
    });
  }

  if (declared.kind === 'unsupported') {
    throw new ResumeParseError('unsupported', `Unsupported file type: ${label}`, { reason: declared.reason });
  }

  if (declared.kind === 'pdf') {
    throw new ResumeParseError('corrupt', `${label} is not a valid PDF file.`, { reason: 'wrong_format' });
  }
  if (declared.kind === 'docx') {
    if (sniffed === 'zip') return 'docx';
    throw new ResumeParseError('corrupt', `${label} is not a valid .docx file.`, { reason: 'wrong_format' });
  }
  if (sniffed === 'zip') {
    if (declared.kind === 'unknown') return 'docx';
    throw new ResumeParseError('unsupported', `${label} looks like an archive, not a text file.`, { reason: 'binary' });
  }
  if (sniffed === 'binary') {
    throw new ResumeParseError('unsupported', `${label} does not look like a text document.`, { reason: 'binary' });
  }
  // declared text, or unknown extension whose bytes look like text (incl. UTF-16).
  return 'text';
}
