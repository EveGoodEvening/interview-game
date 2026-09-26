import { describe, expect, it } from 'vitest';
import { isPageNumberLine, joinPages, layoutPageText, type LayoutItem } from './layout';

/** Fragment helper: monospace metrics (0.6 em per Latin char, 1 em per CJK char). */
function item(str: string, x: number, y: number, size = 10): LayoutItem {
  const width = [...str].reduce((w, c) => w + (/[\u3000-\u9FFF\uFF00-\uFFEF]/.test(c) ? size : 0.6 * size), 0);
  return { str, x, y, width, size };
}

/** A run of lines at a fixed pitch, one fragment per line. */
function column(x: number, y0: number, lines: string[], pitch = 14, size = 10): LayoutItem[] {
  return lines.map((text, i) => item(text, x, y0 + i * pitch, size));
}

describe('layoutPageText — lines and spacing', () => {
  it('orders lines top-to-bottom and fragments left-to-right regardless of input order', () => {
    const items = [item('world', 106, 100), item('Second line', 72, 114), item('Hello', 72, 100)];
    expect(layoutPageText(items)).toBe('Hello world\nSecond line');
  });

  it('glues fragments without a gap and inserts spaces for word gaps', () => {
    // "pay" ends at 72 + 3*6 = 90
    const items = [item('pay', 72, 100), item('ments', 90, 100), item('system', 123, 100)];
    expect(layoutPageText(items)).toBe('payments system');
  });

  it('does not put spaces between CJK glyphs, but keeps real gaps', () => {
    const items = [item('前端', 72, 100), item('开发', 92, 100), item('工程师', 113, 100), item('React', 150, 100)];
    expect(layoutPageText(items)).toBe('前端开发工程师 React');
  });

  it('marks wide gaps inside a line with two spaces', () => {
    const items = [item('Acme Corp', 72, 100), item('2019 - 2021', 450, 100)];
    expect(layoutPageText(items)).toBe('Acme Corp  2019 - 2021');
  });

  it('keeps baselines that differ slightly (superscripts, mixed fonts) on one line', () => {
    const items = [item('GPA 3.8', 72, 100), item('*', 114, 97.5, 7), item('/ 4.0', 120, 100.5)];
    expect(layoutPageText(items)).toBe('GPA 3.8* / 4.0');
  });

  it('respects explicit spaces at fragment edges and ignores whitespace-only fragments', () => {
    const items = [item('Skills: ', 72, 100), item('   ', 120, 100), item('Go', 120, 100)];
    expect(layoutPageText(items)).toBe('Skills: Go');
  });

  it('drops fake-bold duplicates', () => {
    const items = [item('张三', 72, 100, 18), item('张三', 72.3, 100, 18), item('工程师', 72, 124)];
    expect(layoutPageText(items)).toBe('张三\n工程师');
  });

  it('separates paragraphs at large vertical gaps', () => {
    const items = [...column(72, 100, ['EDUCATION', 'State University', 'B.S. CS']), ...column(72, 170, ['SKILLS', 'TypeScript'])];
    expect(layoutPageText(items)).toBe('EDUCATION\nState University\nB.S. CS\n\nSKILLS\nTypeScript');
  });

  it('ignores invalid fragments', () => {
    expect(layoutPageText([{ str: 'x', x: Number.NaN, y: 0, width: 1, size: 10 }])).toBe('');
    expect(layoutPageText([])).toBe('');
  });
});

describe('layoutPageText — columns and tables', () => {
  const header = [item('林雨桐', 72, 60, 22), item('求职意向：Java 后端开发工程师', 72, 84)];
  const sidebar = column(40, 120, ['基本信息', '现居：上海', '学历：硕士', '专业技能', 'Java / Spring', 'MySQL 调优'], 15);
  const main = column(220, 123, ['教育背景', '海川大学 软件工程 硕士', '工作经历', '星河云科技 后端开发工程师', '负责订单系统重构', '设计库存预扣方案', '项目经历', '智能排班系统'], 14);

  it('reads a sidebar layout column by column, below a full-width header', () => {
    const text = layoutPageText([...main, ...sidebar, ...header]);
    const lines = text.split('\n').filter(Boolean);
    expect(lines.slice(0, 2)).toEqual(['林雨桐', '求职意向：Java 后端开发工程师']);
    const sidebarEnd = lines.indexOf('MySQL 调优');
    const mainStart = lines.indexOf('教育背景');
    expect(sidebarEnd).toBeGreaterThan(1);
    expect(mainStart).toBe(sidebarEnd + 1);
    expect(lines.slice(mainStart)).toEqual(['教育背景', '海川大学 软件工程 硕士', '工作经历', '星河云科技 后端开发工程师', '负责订单系统重构', '设计库存预扣方案', '项目经历', '智能排班系统']);
  });

  it('keeps "title … date" rows together instead of treating dates as a column', () => {
    const items = [
      ...column(72, 100, ['Brightloop — Frontend Engineer', '- Led onboarding rebuild', '- Cut LCP to 1.6s', '- Built design system']),
      item('2023 – Present', 450, 100),
      ...column(72, 170, ['Pixelwise — Intern', '- Shipped annotations', '- Added Playwright tests']),
      item('2022', 450, 170),
      ...column(72, 226, ['Lakeshore State University', '- GPA 3.8']),
      item('2019 – 2023', 450, 226),
    ];
    const lines = layoutPageText(items).split('\n');
    expect(lines).toContain('Brightloop — Frontend Engineer  2023 – Present');
    expect(lines).toContain('Pixelwise — Intern  2022');
    expect(lines).toContain('Lakeshore State University  2019 – 2023');
  });

  it('keeps aligned two-cell tables as rows', () => {
    const left = column(72, 100, ['Name', 'Phone', 'Email', 'City']);
    const right = column(300, 100, ['Alex Chen', '555-0100', 'alex@example.com', 'Seattle']);
    expect(layoutPageText([...left, ...right])).toBe('Name  Alex Chen\nPhone  555-0100\nEmail  alex@example.com\nCity  Seattle');
  });

  it('strips page numbers in the header or footer', () => {
    const body = column(72, 100, ['Alex Chen', 'Frontend Engineer', 'Seattle']);
    expect(layoutPageText([...body, item('1 / 2', 300, 760)])).toBe('Alex Chen\nFrontend Engineer\nSeattle');
    expect(layoutPageText([item('- 3 -', 300, 30), ...body])).toBe('Alex Chen\nFrontend Engineer\nSeattle');
  });
});

describe('page helpers', () => {
  it('recognises page-number lines only', () => {
    for (const line of ['1', '- 2 -', '3 / 5', 'Page 2 of 3', 'page 4', '第 1 页', '第1页 共2页', '共 2 页，第 1 页']) {
      expect(isPageNumberLine(line), line).toBe(true);
    }
    for (const line of ['2021', 'GPA 3.8 / 4.0', 'Top 10%', '1. First item', '第一页']) {
      expect(isPageNumberLine(line), line).toBe(false);
    }
  });

  it('joins pages with a blank line and drops per-page numbering', () => {
    expect(joinPages(['Alex Chen\nEngineer\n\n1 / 2', '2 / 2\nEducation\nState U', '   '])).toBe('Alex Chen\nEngineer\n\nEducation\nState U');
  });
});
