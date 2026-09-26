/**
 * PDF text extraction with pdf.js (lazy-loaded; this module is itself only imported on demand).
 *
 * We use the *legacy* pdf.js build: the modern build relies on very recent JS built-ins
 * (Map#getOrInsertComputed, Uint8Array#toHex, Math.sumPrecise…) that are missing in many browsers
 * still in use (older Chromium shells common in mainland China, Safari < 18) and in Node — the
 * legacy build polyfills them and is otherwise API-identical.
 */
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { DocumentInitParameters, TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { ResumeParseError } from './errors';
import { layoutPageText, joinPages, type LayoutItem } from './layout';
import { formatResumeWarning, RESUME_WARNING } from './warnings';
import type { RawExtraction } from './types';

export type PdfjsLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface PdfRuntime {
  lib: PdfjsLib;
  /** Extra getDocument() parameters (CMap loading etc.). */
  init?: Partial<DocumentInitParameters>;
}

/** Résumés are 1–3 pages; anything longer is read partially. */
export const MAX_PDF_PAGES = 20;
export const PDF_TIMEOUT_MS = 45_000;
/** Stop reading pages once we have this much text (the result is truncated later anyway). */
const TEXT_BUDGET = 60_000;

// Predefined Chinese CMaps, needed for PDFs whose CJK fonts are not embedded or have no
// ToUnicode table. Bundled lazily (one tiny chunk each) so it works offline.
const CMAP_LOADERS = import.meta.glob<string>(
  [
    '/node_modules/pdfjs-dist/cmaps/Uni{GB,CNS}-*.bcmap',
    '/node_modules/pdfjs-dist/cmaps/{GB,B5,ETen,ETHK,HK,CNS}*.bcmap',
    '/node_modules/pdfjs-dist/cmaps/Adobe-{GB1,CNS1}-*.bcmap',
  ],
  { query: '?url', import: 'default' },
);

/** Serves CMap requests from the bundled set; standard fonts / wasm are not needed for text. */
class BundledBinaryDataFactory {
  constructor(_options: unknown) {}

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind !== 'cMapUrl') throw new Error(`${kind} data is not bundled (${filename})`);
    const load = CMAP_LOADERS[`/node_modules/pdfjs-dist/cmaps/${filename}`];
    if (!load) throw new Error(`CMap not bundled: ${filename}`);
    const response = await fetch(await load());
    if (!response.ok) throw new Error(`CMap ${filename}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

let browserRuntime: Promise<PdfRuntime> | null = null;

function loadBrowserRuntime(): Promise<PdfRuntime> {
  browserRuntime ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (lib) => {
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return {
        lib,
        init: {
          BinaryDataFactory: BundledBinaryDataFactory,
          useWorkerFetch: false,
          cMapPacked: true,
          // Text extraction never needs system/standard font files.
          useSystemFonts: true,
          disableFontFace: true,
        },
      };
    },
    (error: unknown) => {
      browserRuntime = null; // allow a retry after a network hiccup
      throw error;
    },
  );
  return browserRuntime;
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return typeof (item as TextItem).str === 'string';
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: readonly number[], n: readonly number[]): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Map a pdf.js text item into top-down page coordinates (handles /Rotate via the viewport). */
export function toLayoutItem(item: TextItem, viewportTransform: readonly number[]): LayoutItem {
  const [a, b, c, d, e, f] = multiply(viewportTransform, item.transform as number[]);
  const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height;
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]) || 1;
  return { str: item.str, x: e, y: f, width: item.width * scale, size };
}

function mapPdfError(error: unknown): ResumeParseError {
  if (error instanceof ResumeParseError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PasswordException') {
    return new ResumeParseError('corrupt', 'The PDF is password-protected.', { reason: 'encrypted', cause: error });
  }
  if (/worker|dynamically imported module|Failed to fetch/i.test(message)) {
    return new ResumeParseError('corrupt', `PDF reader failed to load: ${message}`, { reason: 'engine', cause: error });
  }
  return new ResumeParseError('corrupt', `Invalid or damaged PDF: ${message}`, { cause: error });
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new ResumeParseError('corrupt', 'PDF parsing timed out.', { reason: 'timeout' }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Extract reading-ordered text from PDF bytes. `runtime` is injectable for tests (Node);
 * by default the browser build + bundled worker is loaded lazily.
 * Note: pdf.js takes ownership of (detaches) `bytes`.
 */
export async function extractPdfText(bytes: Uint8Array, runtime?: PdfRuntime): Promise<RawExtraction> {
  let rt: PdfRuntime;
  try {
    rt = runtime ?? (await loadBrowserRuntime());
  } catch (error) {
    throw new ResumeParseError('corrupt', 'PDF reader failed to load.', { reason: 'engine', cause: error });
  }

  const task = rt.lib.getDocument({
    data: bytes,
    stopAtErrors: false,
    verbosity: rt.lib.VerbosityLevel.ERRORS,
    ...rt.init,
  });

  const run = async (): Promise<RawExtraction> => {
    const doc = await task.promise;
    const total = doc.numPages;
    const limit = Math.min(total, MAX_PDF_PAGES);
    const pages: string[] = [];
    let emptyPages = 0;
    let failedPages = 0;
    let budget = TEXT_BUDGET;
    let read = 0;
    for (let n = 1; n <= limit && budget > 0; n++) {
      read = n;
      try {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.filter(isTextItem).map((item) => toLayoutItem(item, viewport.transform));
        const text = layoutPageText(items);
        page.cleanup();
        if (text.trim()) {
          pages.push(text);
          budget -= text.length;
        } else {
          emptyPages++;
        }
      } catch {
        failedPages++;
      }
    }

    if (failedPages === read) throw new ResumeParseError('corrupt', 'No page of the PDF could be read.');
    if (pages.length === 0) {
      throw new ResumeParseError('empty', 'The PDF contains no selectable text (scanned?).', { reason: 'no_text' });
    }
    const warnings: string[] = [];
    if (read < total) warnings.push(formatResumeWarning(RESUME_WARNING.pagesLimited, `${read}/${total}`));
    if (emptyPages > 0) warnings.push(formatResumeWarning(RESUME_WARNING.scannedPages, emptyPages));
    if (failedPages > 0) warnings.push(formatResumeWarning(RESUME_WARNING.pageErrors, failedPages));
    return { text: joinPages(pages), pageCount: total, warnings };
  };

  try {
    return await withTimeout(run(), PDF_TIMEOUT_MS, () => void task.destroy().catch(() => undefined));
  } catch (error) {
    throw mapPdfError(error);
  } finally {
    void task.destroy().catch(() => undefined);
  }
}
