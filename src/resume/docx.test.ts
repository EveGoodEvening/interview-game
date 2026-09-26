import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth/mammoth.browser.js';
import { docxHtmlToText, extractDocxText } from './docx';
import { ResumeParseError } from './errors';
import { normalizeResumeText } from './normalize';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const realMammoth = () => Promise.resolve(mammoth);

describe('docxHtmlToText', () => {
  it('turns paragraphs, breaks and empty paragraphs into lines and blank lines', () => {
    expect(docxHtmlToText('<p>A<br />B</p><p></p><p>C</p>')).toBe('A\nB\n\nC\n');
  });

  it('renders nested bullet and numbered lists', () => {
    const html = '<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul><ol><li>first</li><li>second</li></ol>';
    expect(docxHtmlToText(html)).toBe('- one\n  - inner\n- two\n1. first\n2. second\n');
  });

  it('puts table cells of a row on one line and keeps multi-paragraph cells readable', () => {
    const html =
      '<table><tr><td><p>Acme</p></td><td><p>2021 – 2023</p></td></tr>' +
      '<tr><td><p>Role</p><p>Backend</p></td><td><p>Remote</p></td></tr></table><p>After</p>';
    expect(docxHtmlToText(html)).toBe('Acme  2021 – 2023\nRole\nBackend  Remote\nAfter\n');
  });

  it('separates headings and decodes entities', () => {
    const html = '<h1>Title</h1><p>a &amp; b &lt;c&gt; &quot;d&quot; &#x4E2D;&#25991;</p><h2>Next</h2><p>x</p>';
    expect(docxHtmlToText(html)).toBe('Title\na & b <c> "d" 中文\n\nNext\nx\n');
  });

  it('ignores images and inline formatting tags', () => {
    expect(docxHtmlToText('<p><strong>Bold</strong> <em>and</em> <img src="" /> <a href="x">link</a></p>')).toBe('Bold and  link\n');
  });
});

describe('extractDocxText', () => {
  it('extracts the fixture with lists, soft breaks and table rows intact', async () => {
    const { text, warnings } = await extractDocxText(fixture('resume.docx'), realMammoth);
    expect(warnings).toEqual([]);
    expect(normalizeResumeText(text)).toBe(
      [
        '李雷 Li Lei',
        '电话：139-0000-0000',
        '邮箱：lilei@example.com',
        '',
        '工作经历',
        '星河云科技 · 后端开发实习生  2025.06 – 2025.12',
        '- 负责订单服务重构，峰值 QPS 提升 3 倍',
        '  - 使用 Go & Redis <cache>',
        '1. First achievement',
        '2. Second achievement',
        'Skills: Go, TypeScript',
        'Hello world',
      ].join('\n'),
    );
  });

  it('loads the browser bundle by default', async () => {
    const { text } = await extractDocxText(fixture('resume.docx'));
    expect(text).toContain('李雷 Li Lei');
  });

  it('reports a damaged file as corrupt', async () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(extractDocxText(broken, realMammoth)).rejects.toMatchObject({ name: 'ResumeParseError', code: 'corrupt' });
  });

  it('reports a reader that fails to load', async () => {
    const error = await extractDocxText(fixture('resume.docx'), () => Promise.reject(new Error('offline'))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResumeParseError);
    expect(error).toMatchObject({ code: 'corrupt', reason: 'engine' });
  });
});
