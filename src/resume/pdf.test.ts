import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, MAX_PDF_PAGES, PDF_TIMEOUT_MS, toLayoutItem, type PdfjsLib, type PdfRuntime } from './pdf';
import { ResumeParseError } from './errors';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

// Node runs pdf.js with its in-process "fake worker"; point it at the legacy worker file.
pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url));
const cMapUrl = fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url));
const node: PdfRuntime = { lib: pdfjs, init: { cMapUrl, cMapPacked: true } };

describe('extractPdfText (real pdf.js)', () => {
  it('rebuilds lines, gaps and glued words across pages, without page numbers', async () => {
    const result = await extractPdfText(fixture('simple.pdf'), node);
    expect(result).toEqual({
      text: [
        'Jane Doe',
        'Software Engineer  jane@example.com',
        '',
        'EXPERIENCE',
        'Acme Corp  2019 - 2021',
        'Built a payments system',
        'Cut latency by 40%',
        '',
        'EDUCATION',
        'State University  2015 - 2019',
      ].join('\n'),
      pageCount: 2,
      warnings: [],
    });
  });

  it('decodes non-embedded Chinese fonts through the predefined CMaps', async () => {
    const result = await extractPdfText(fixture('cmap-zh.pdf'), node);
    expect(result.text).toBe('王小红\n前端开发工程师\n熟悉 React 与 TypeScript');
  });

  it('reads a Chromium-printed two-column Chinese résumé in reading order', async () => {
    const { text, pageCount } = await extractPdfText(fixture('two-column-zh.pdf'), node);
    const lines = text.split('\n').filter(Boolean);
    expect(pageCount).toBe(1);
    expect(lines[0]).toBe('林雨桐');
    expect(lines[1]).toContain('求职意向：Java 后端开发工程师');
    // Sidebar is read completely before the main column.
    expect(lines.indexOf('证书')).toBeLessThan(lines.indexOf('教育背景'));
    expect(lines.indexOf('Java / Spring Cloud')).toBeGreaterThan(lines.indexOf('专业技能'));
    expect(lines.indexOf('Java / Spring Cloud')).toBeLessThan(lines.indexOf('教育背景'));
    // Title/date rows stay together; CJK text has no stray spaces.
    expect(lines).toContain('星河云科技 · 后端开发工程师  2024.07 – 至今');
    expect(lines).toContain('负责订单状态机服务重构，状态不一致工单下降 90%。');
    expect(text).not.toMatch(/\b1 \/ 1\b/);
  });

  it('rejects damaged files as corrupt', async () => {
    const garbage = new TextEncoder().encode('%PDF-1.4\nthis is not really a pdf\n%%EOF');
    await expect(extractPdfText(garbage, node)).rejects.toMatchObject({ name: 'ResumeParseError', code: 'corrupt' });
  });
});

// ───────────── Fake pdf.js runtime for edge cases that are hard to build as fixtures ─────────────

interface FakePage {
  text?: string;
  fail?: boolean;
}

function fakeRuntime(pages: FakePage[] | Error | 'hang'): { runtime: PdfRuntime; destroyed: () => number; requested: () => number[] } {
  let destroyed = 0;
  const requested: number[] = [];
  const promise =
    pages === 'hang'
      ? new Promise<never>(() => undefined)
      : pages instanceof Error
        ? Promise.reject(pages)
        : Promise.resolve({
            numPages: pages.length,
            getPage: (n: number) => {
              requested.push(n);
              const page = pages[n - 1];
              if (page.fail) return Promise.reject(new Error('bad page'));
              return Promise.resolve({
                getViewport: () => ({ transform: [1, 0, 0, -1, 0, 800] }),
                getTextContent: () =>
                  Promise.resolve({
                    items: page.text ? [{ str: page.text, transform: [10, 0, 0, 10, 72, 700], width: 60, height: 10, dir: 'ltr', hasEOL: false }] : [],
                  }),
                cleanup: () => true,
              });
            },
          });
  promise.catch(() => undefined);
  const lib = {
    VerbosityLevel: { ERRORS: 0 },
    getDocument: () => ({
      promise,
      destroy: () => {
        destroyed++;
        return Promise.resolve();
      },
    }),
  } as unknown as PdfjsLib;
  return { runtime: { lib }, destroyed: () => destroyed, requested: () => requested };
}

describe('extractPdfText (edge cases)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps password-protected PDFs to reason "encrypted"', async () => {
    const error = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    const { runtime, destroyed } = fakeRuntime(error);
    await expect(extractPdfText(new Uint8Array([1]), runtime)).rejects.toMatchObject({ code: 'corrupt', reason: 'encrypted' });
    expect(destroyed()).toBeGreaterThan(0);
  });

  it('maps worker loading failures to reason "engine"', async () => {
    const { runtime } = fakeRuntime(new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module"'));
    await expect(extractPdfText(new Uint8Array([1]), runtime)).rejects.toMatchObject({ reason: 'engine' });
  });

  it('reads at most MAX_PDF_PAGES pages and says so', async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 5 }, (_, i) => ({ text: `Page text ${i + 1}` }));
    const { runtime, requested } = fakeRuntime(pages);
    const result = await extractPdfText(new Uint8Array([1]), runtime);
    expect(requested()).toHaveLength(MAX_PDF_PAGES);
    expect(result.pageCount).toBe(MAX_PDF_PAGES + 5);
    expect(result.warnings).toEqual([`pages_limited:${MAX_PDF_PAGES}/${MAX_PDF_PAGES + 5}`]);
  });

  it('warns about image-only and unreadable pages but keeps the rest', async () => {
    const { runtime } = fakeRuntime([{ text: 'Alex Chen' }, {}, { fail: true }, { text: 'Education' }]);
    const result = await extractPdfText(new Uint8Array([1]), runtime);
    expect(result.text).toBe('Alex Chen\n\nEducation');
    expect(result.warnings).toEqual(['scanned_pages:1', 'page_errors:1']);
  });

  it('reports scanned PDFs (no text at all) as empty / no_text', async () => {
    const { runtime } = fakeRuntime([{}, {}]);
    await expect(extractPdfText(new Uint8Array([1]), runtime)).rejects.toMatchObject({ code: 'empty', reason: 'no_text' });
  });

  it('reports a PDF whose pages all fail as corrupt', async () => {
    const { runtime } = fakeRuntime([{ fail: true }]);
    const error = await extractPdfText(new Uint8Array([1]), runtime).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResumeParseError);
    expect(error).toMatchObject({ code: 'corrupt' });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const { runtime, destroyed } = fakeRuntime('hang');
    const pending = extractPdfText(new Uint8Array([1]), runtime).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS + 10);
    expect(await pending).toMatchObject({ code: 'corrupt', reason: 'timeout' });
    expect(destroyed()).toBeGreaterThan(0);
  });
});

describe('toLayoutItem', () => {
  const base = { str: 'Hi', dir: 'ltr', width: 12, height: 10, hasEOL: false, fontName: 'f' };

  it('flips PDF y-up coordinates into top-down baselines', () => {
    const it1 = toLayoutItem({ ...base, transform: [10, 0, 0, 10, 72, 700] }, [1, 0, 0, -1, 0, 792]);
    expect(it1).toEqual({ str: 'Hi', x: 72, y: 92, width: 12, size: 10 });
  });

  it('applies viewport scale and page rotation', () => {
    const rotated = toLayoutItem({ ...base, transform: [10, 0, 0, 10, 100, 200] }, [0, 2, 2, 0, 0, 0]);
    expect(rotated.x).toBe(400);
    expect(rotated.y).toBe(200);
    expect(rotated.size).toBe(20);
    expect(rotated.width).toBe(24);
  });
});
