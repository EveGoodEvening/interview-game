/**
 * Error type for résumé parsing. Re-exported from `./index`.
 */

export type ResumeParseErrorCode = 'unsupported' | 'empty' | 'too_large' | 'corrupt';

/**
 * Optional refinement of a {@link ResumeParseError} code, so the UI can show a more helpful hint
 * (see `describeResumeError`).
 */
export type ResumeErrorReason =
  /** Legacy binary Word (.doc / .wps) — ask the player to re-save as .docx or PDF. */
  | 'legacy_doc'
  /** An image (photo / screenshot of a résumé). */
  | 'image'
  /** Some other binary format (spreadsheet, archive, executable…). */
  | 'binary'
  /** Rich Text Format, OpenDocument, Pages… — known document formats we don't read. */
  | 'other_document'
  /** The extension promised one format but the bytes are something else. */
  | 'wrong_format'
  /** Password-protected PDF. */
  | 'encrypted'
  /** A PDF without any selectable text (scanned / exported as images). */
  | 'no_text'
  /** Parsing took too long and was aborted. */
  | 'timeout'
  /** The PDF/DOCX reader itself failed to load (e.g. offline and the chunk is not cached). */
  | 'engine'
  /** The browser could not read the file from disk. */
  | 'read_failed';

export class ResumeParseError extends Error {
  readonly code: ResumeParseErrorCode;
  /** Finer-grained cause for UI hints; undefined when the code says it all. */
  readonly reason?: ResumeErrorReason;

  constructor(code: ResumeParseErrorCode, message: string, options?: { reason?: ResumeErrorReason; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ResumeParseError';
    this.code = code;
    if (options?.reason) this.reason = options.reason;
  }
}

export function isResumeParseError(value: unknown): value is ResumeParseError {
  return value instanceof ResumeParseError;
}
