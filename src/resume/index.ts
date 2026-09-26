/**
 * Resume parsing public API.
 * OWNER: resume+audio agent. Keep exported signatures stable.
 *
 * PDF (pdf.js) and DOCX (mammoth) readers are code-split and only loaded when such a file is
 * parsed. Warnings are machine-readable `code[:detail]` strings — show them with
 * `describeResumeWarning(w, lang)`; show errors with `describeResumeError(err, lang)`.
 */
import type { Lang } from '../types';
import { ResumeParseError } from './errors';
import { resolveKind } from './detect';
import { decodeTextBytes } from './text';
import { countContentChars, normalizeResumeText, truncateResumeText } from './normalize';
import { formatResumeWarning, RESUME_WARNING } from './warnings';
import type { RawExtraction } from './types';
import { SAMPLE_RESUMES as SAMPLES } from './samples';

export interface ParsedResume {
  text: string;
  fileName: string;
  kind: 'pdf' | 'docx' | 'text';
  pageCount?: number;
  /**
   * Warnings as `code` or `code:detail` strings (see `RESUME_WARNING`), e.g. "truncated:23456".
   * Render with `describeResumeWarning(warning, lang)`; unknown strings render verbatim.
   */
  warnings: string[];
}

export const ACCEPTED_RESUME_TYPES = '.pdf,.docx,.txt,.md,.markdown';
/** Hard cap on characters sent to the LLM. */
export const MAX_RESUME_CHARS = 20000;
/** Upload size limit. */
export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
/** Below this many non-whitespace characters we warn that the file is probably a scan. */
export const MIN_RESUME_CHARS = 80;

export { ResumeParseError, isResumeParseError } from './errors';
export type { ResumeErrorReason, ResumeParseErrorCode } from './errors';
export {
  RESUME_WARNING,
  describeResumeError,
  describeResumeWarning,
  formatResumeWarning,
  parseResumeWarning,
} from './warnings';
export type { ResumeWarningCode } from './warnings';
export { normalizeResumeText } from './normalize';

/**
 * Normalise, validate and cap résumé text from any source. Use it for pasted text too, so the
 * LLM always gets the same shape. Returns '' (no throw) for empty input.
 */
export function prepareResumeText(raw: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const normalized = normalizeResumeText(raw);
  const { text, truncated, originalLength } = truncateResumeText(normalized, MAX_RESUME_CHARS);
  if (truncated) warnings.push(formatResumeWarning(RESUME_WARNING.truncated, originalLength));
  const content = countContentChars(text);
  if (content > 0 && content < MIN_RESUME_CHARS) warnings.push(formatResumeWarning(RESUME_WARNING.littleText, content));
  return { text, warnings };
}

async function readBytes(file: File): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new ResumeParseError('corrupt', 'The file could not be read.', { reason: 'read_failed', cause: error });
  }
}

function extractText(bytes: Uint8Array): RawExtraction {
  const decoded = decodeTextBytes(bytes);
  const warnings: string[] = [];
  if (decoded.encoding !== 'utf-8') warnings.push(formatResumeWarning(RESUME_WARNING.encoding, decoded.encoding));
  if (decoded.replacementCount > 0) {
    warnings.push(formatResumeWarning(RESUME_WARNING.replacementChars, decoded.replacementCount));
  }
  return { text: decoded.text, warnings };
}

/** Extract plain text from a resume file (PDF / DOCX / TXT / MD). Rejects with ResumeParseError. */
export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const fileName = file.name || 'resume';
  if (file.size === 0) throw new ResumeParseError('empty', 'The file is empty.');
  if (file.size > MAX_RESUME_FILE_BYTES) {
    throw new ResumeParseError('too_large', `The file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB.`);
  }

  const bytes = await readBytes(file);
  const kind = resolveKind(fileName, file.type, bytes);

  let raw: RawExtraction;
  if (kind === 'pdf') {
    const { extractPdfText } = await import('./pdf');
    raw = await extractPdfText(bytes);
  } else if (kind === 'docx') {
    const { extractDocxText } = await import('./docx');
    raw = await extractDocxText(bytes);
  } else {
    raw = extractText(bytes);
  }

  const { text, warnings } = prepareResumeText(raw.text);
  if (!text) {
    throw new ResumeParseError('empty', 'No text found in the file.', kind === 'pdf' ? { reason: 'no_text' } : undefined);
  }
  return {
    text,
    fileName,
    kind,
    ...(raw.pageCount !== undefined ? { pageCount: raw.pageCount } : {}),
    warnings: [...raw.warnings, ...warnings],
  };
}

/** Built-in sample resumes so players can try the game instantly. */
export const SAMPLE_RESUMES: Record<Lang, { fileName: string; text: string }> = SAMPLES;
