import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCEPTED_RESUME_TYPES,
  MAX_RESUME_CHARS,
  MAX_RESUME_FILE_BYTES,
  parseResumeFile,
  prepareResumeText,
  ResumeParseError,
  SAMPLE_RESUMES,
} from './index';

// pdf.js needs its worker file and CMaps from disk under Node; the browser build uses bundled URLs.
vi.mock('./pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdf')>();
  const { fileURLToPath } = await import('node:url');
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = fileURLToPath(new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url));
  const cMapUrl = fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url));
  return { ...actual, extractPdfText: (bytes: Uint8Array) => actual.extractPdfText(bytes, { lib, init: { cMapUrl } }) };
});

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));
const file = (parts: BlobPart[], name: string, type = '') => new File(parts, name, { type });

async function parseError(f: File): Promise<ResumeParseError> {
  const error = await parseResumeFile(f).catch((e: unknown) => e);
  if (!(error instanceof ResumeParseError)) throw new Error(`expected ResumeParseError, got ${String(error)}`);
  return error;
}

describe('parseResumeFile — text formats', () => {
  it('reads UTF-8 text and normalises it', async () => {
    const result = await parseResumeFile(file(['Alex Chen  \r\n\r\n\r\n• React\r\n● TypeScript\r\n'], 'cv.txt', 'text/plain'));
    expect(result).toEqual({
      text: 'Alex Chen\n\n- React\n- TypeScript',
      fileName: 'cv.txt',
      kind: 'text',
      warnings: ['little_text:25'],
    });
  });

  it('strips the UTF-8 BOM from Markdown', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const result = await parseResumeFile(file([bom, SAMPLE_RESUMES.en.text], 'README.md'));
    expect(result.text).toBe(SAMPLE_RESUMES.en.text);
    expect(result.warnings).toEqual([]);
  });

  it('detects GBK/GB18030 text files', async () => {
    const hex = 'd5c5cffec3f720baf3b6cbb9a4b3cccaa620caeccfa420476f20d3eb205265646973a3acb8bad4f0b6a9b5a5cfb5cdb3a1a3475041a3ba332e38';
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const result = await parseResumeFile(file([bytes], '简历.txt'));
    expect(result.text).toBe('张晓明 后端工程师 熟悉 Go 与 Redis，负责订单系统。GPA：3.8');
    expect(result.warnings).toContain('encoding:gb18030');
  });

  it('truncates very long résumés with a warning', async () => {
    const line = '负责核心交易链路的性能优化与稳定性建设，QPS 提升 3 倍。\n';
    const long = line.repeat(Math.ceil((MAX_RESUME_CHARS * 1.5) / line.length));
    const result = await parseResumeFile(file([long], 'long.txt'));
    expect(result.text.length).toBeLessThanOrEqual(MAX_RESUME_CHARS);
    expect(result.text.endsWith('。')).toBe(true);
    expect(result.warnings).toEqual([`truncated:${long.trim().length}`]);
  });
});

describe('parseResumeFile — documents', () => {
  it('reads DOCX through mammoth', async () => {
    const result = await parseResumeFile(
      file([fixture('resume.docx')], 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    );
    expect(result.kind).toBe('docx');
    expect(result.text.split('\n')).toContain('星河云科技 · 后端开发实习生  2025.06 – 2025.12');
    expect(result.pageCount).toBeUndefined();
  });

  it('reads PDF through pdf.js with page count', async () => {
    const result = await parseResumeFile(file([fixture('two-column-zh.pdf')], '林雨桐.pdf', 'application/pdf'));
    expect(result.kind).toBe('pdf');
    expect(result.pageCount).toBe(1);
    expect(result.text.startsWith('林雨桐\n')).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseResumeFile — errors', () => {
  it('rejects empty files', async () => {
    expect(await parseError(file([], 'cv.pdf'))).toMatchObject({ code: 'empty' });
    expect(await parseError(file(['  \n\t \n'], 'cv.txt'))).toMatchObject({ code: 'empty' });
  });

  it('rejects files over 10 MB before reading them', async () => {
    const big = file([new Uint8Array(MAX_RESUME_FILE_BYTES + 1)], 'huge.pdf');
    expect(await parseError(big)).toMatchObject({ code: 'too_large' });
  });

  it('rejects unsupported formats', async () => {
    expect(await parseError(file([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'photo.png', 'image/png'))).toMatchObject({
      code: 'unsupported',
      reason: 'image',
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(await parseError(file([ole], 'cv.doc', 'application/msword'))).toMatchObject({
      code: 'unsupported',
      reason: 'legacy_doc',
    });
  });

  it('rejects corrupt documents', async () => {
    const zipJunk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9, 9, 9]);
    expect(await parseError(file([zipJunk], 'cv.docx'))).toMatchObject({ code: 'corrupt' });
    expect(await parseError(file(['%PDF-1.4 garbage'], 'cv.pdf'))).toMatchObject({ code: 'corrupt' });
    expect(await parseError(file(['plain text'], 'cv.pdf'))).toMatchObject({ code: 'corrupt', reason: 'wrong_format' });
  });
});

describe('prepareResumeText', () => {
  it('normalises pasted text and reports short input', () => {
    expect(prepareResumeText('  Alex\r\n\r\n\r\n* React  ')).toEqual({ text: 'Alex\n\n- React', warnings: ['little_text:10'] });
    expect(prepareResumeText('   ')).toEqual({ text: '', warnings: [] });
  });
});

describe('SAMPLE_RESUMES', () => {
  it.each(['zh', 'en'] as const)('%s sample is rich, clean and within limits', (lang) => {
    const { text, fileName } = SAMPLE_RESUMES[lang];
    const lines = text.split('\n');
    expect(fileName).toMatch(/\.txt$/);
    expect(lines.length).toBeGreaterThanOrEqual(40);
    expect(lines.length).toBeLessThanOrEqual(60);
    expect(text.length).toBeLessThan(MAX_RESUME_CHARS);
    expect(prepareResumeText(text)).toEqual({ text, warnings: [] });
    // Enough concrete numbers for grounded questions.
    expect(text.match(/\d+(?:\.\d+)?\s?(?:%|ms|s\b|k\b|万|倍|\+)/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('describes the documented personas', () => {
    expect(SAMPLE_RESUMES.zh.text).toMatch(/^张晓明\n/);
    expect(SAMPLE_RESUMES.zh.text).toContain('实习');
    expect(SAMPLE_RESUMES.en.text).toMatch(/^Alex Chen\n/);
    expect(SAMPLE_RESUMES.en.text).toContain('3 years');
  });
});

it('accepts the documented extensions', () => {
  expect(ACCEPTED_RESUME_TYPES.split(',')).toEqual(['.pdf', '.docx', '.txt', '.md', '.markdown']);
});
