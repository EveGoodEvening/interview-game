/** Internal result of a format-specific extractor, before normalisation / truncation. */
export interface RawExtraction {
  text: string;
  pageCount?: number;
  /** Warning strings in the `code:detail` format (see warnings.ts). */
  warnings: string[];
}
