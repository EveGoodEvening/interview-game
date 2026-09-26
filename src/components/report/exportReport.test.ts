import { describe, expect, it } from 'vitest';
import type { InterviewRecord } from '../../types';
import { buildReportJson, buildReportMarkdown, mdCell, reportFileName } from './exportReport';
import { dimensionViews, fileStamp, formatDateTime } from './reportUtils';

const finishedAt = new Date(2026, 8, 26, 15, 2).getTime(); // local time

function record(overrides: Partial<InterviewRecord> = {}): InterviewRecord {
  return {
    id: 'r1',
    finishedAt,
    characterId: 'yuki',
    lang: 'zh',
    config: {
      characterId: 'yuki',
      lang: 'zh',
      resumeText: '…',
      resumeFileName: 'cv.pdf',
      targetRole: '后端工程师',
      jobDescription: '',
      style: 'behavioral',
      difficulty: 'normal',
      mainQuestions: 3,
      maxFollowUps: 1,
      answerTimeLimitSec: 0,
    },
    plan: {
      candidateName: '张晓明',
      targetRole: '后端工程师',
      summary: '',
      highlights: [],
      concerns: [],
      topics: [],
      opening: { speech: '', expression: 'smile' },
    },
    transcript: [
      { id: 'e1', role: 'interviewer', text: '请做个自我介绍吧？', at: 0 },
      { id: 'e2', role: 'candidate', text: '我叫张晓明。\n我做后端。', answer: { via: 'voice', durationSec: 30, skipped: false }, at: 1 },
      { id: 'e3', role: 'interviewer', text: '你如何处理分歧？', at: 2 },
      { id: 'e4', role: 'candidate', text: '', answer: { via: 'text', durationSec: 5, skipped: true }, at: 3 },
    ],
    report: {
      overallScore: 84,
      dimensions: [
        { key: 'communication', score: 86, comment: '清晰 | 有条理' },
        { key: 'expertise', score: 82, comment: '扎实' },
        { key: 'logic', score: 78, comment: '' },
        { key: 'impact', score: 88, comment: '有数据' },
        { key: 'fit', score: 80, comment: '契合' },
      ],
      strengths: ['用数据说话', '结构清晰'],
      improvements: ['多讲协作细节'],
      questionReviews: [{ question: '请做个自我介绍吧？', answerSummary: '背景 + 实习', score: 8, feedback: '不错', betterAnswer: '补充动机。' }],
      summary: '整体表现良好。',
      finalMessage: '今天聊得很开心！\n期待再见。',
    },
    ending: 'offer',
    finalScore: 82,
    affinity: 74,
    ...overrides,
  };
}

describe('buildReportMarkdown (zh)', () => {
  const md = buildReportMarkdown(record(), 'zh');

  it('has a localized title, meta table and sections', () => {
    expect(md.startsWith('# 面试报告 · 星辰科技 · 林小雪\n')).toBe(true);
    expect(md).toContain('| 应聘者 | 张晓明 |');
    expect(md).toContain('| 应聘岗位 | 后端工程师 |');
    expect(md).toContain(`| 面试时间 | ${formatDateTime(finishedAt)} |`);
    expect(md).toContain('| 结局 | 顺利录用（录用） |');
    expect(md).toContain('| 最终得分 | **82** / 100（面试评分 84 · 好感度 74） |');
    for (const h of ['## 总评', '## 能力维度', '## 亮点', '## 改进建议', '## 逐题复盘', '## 面试实录', '## 面试官寄语']) expect(md).toContain(h);
  });

  it('renders dimensions as an escaped table', () => {
    expect(md).toContain('| 沟通表达 | 86 | 清晰 \\| 有条理 |');
    expect(md).toContain('| 逻辑思维 | 78 | — |');
  });

  it('renders question reviews, the transcript (with skips) and the parting words', () => {
    expect(md).toContain('### Q1 · 请做个自我介绍吧？');
    expect(md).toContain('- **得分**：8 / 10');
    expect(md).toContain('- **参考回答**：补充动机。');
    expect(md).toContain('**林小雪**：请做个自我介绍吧？');
    expect(md).toContain('**张晓明**：我叫张晓明。  \n我做后端。');
    expect(md).toContain('**张晓明**：*（跳过了这道题）*');
    expect(md).toContain('> 今天聊得很开心！\n> 期待再见。');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('buildReportMarkdown (en)', () => {
  it('uses English headings and punctuation', () => {
    const md = buildReportMarkdown(record({ lang: 'en', ending: 'pending' }), 'en');
    expect(md.startsWith('# Interview Report · Stellar Tech · Yuki Lin\n')).toBe(true);
    expect(md).toContain('| Ending | On the Waitlist (PENDING) |');
    expect(md).toContain('| Final score | **82** / 100 (interview 84 · affinity 74) |');
    expect(md).toContain('## Question review');
    expect(md).toContain('- **Score**: 8 / 10');
    expect(md).toContain('**Yuki Lin**: 请做个自我介绍吧？');
    expect(md).toContain('*(skipped this question)*');
  });

  it("shows the reverse Q&A's canned 'no more questions' reply instead of a skipped label", () => {
    const r = record({ lang: 'en' });
    const transcript = [
      ...r.transcript,
      { id: 'e5', role: 'interviewer' as const, text: 'Anything you would like to ask me?', at: 4 },
      { id: 'e6', role: 'candidate' as const, text: 'No more questions from me. Thank you.', answer: { via: 'text' as const, durationSec: 0, skipped: true }, at: 5 },
    ];
    const md = buildReportMarkdown({ ...r, transcript }, 'en');
    expect(md).toContain('**张晓明**: *No more questions from me. Thank you.*');
    expect(md.match(/\(skipped this question\)/g)).toHaveLength(1);
  });

  it('defaults to the interview language', () => {
    expect(buildReportMarkdown(record({ lang: 'en' }))).toContain('## Transcript');
  });

  it('omits empty sections', () => {
    const r = record();
    const md = buildReportMarkdown({ ...r, report: { ...r.report, strengths: [], questionReviews: [], summary: '', finalMessage: '' }, transcript: [] }, 'en');
    expect(md).not.toContain('## Strengths');
    expect(md).not.toContain('## Question review');
    expect(md).not.toContain('## Summary');
    expect(md).not.toContain('## Transcript');
    expect(md).toContain('## Dimensions');
  });
});

describe('dimensionViews', () => {
  it('keeps the 0–100 scale, rounds, and fills missing keys', () => {
    const r = record();
    const views = dimensionViews({ report: { ...r.report, dimensions: [{ key: 'logic', score: 72.6, comment: 'ok' }] } });
    expect(views.map((v) => v.key)).toEqual(['communication', 'expertise', 'logic', 'impact', 'fit']);
    expect(views.find((v) => v.key === 'logic')?.score).toBe(73);
    expect(views.find((v) => v.key === 'fit')?.score).toBe(0);
  });

  it('does not rescale a genuinely weak candidate (all scores ≤ 10 on the 0–100 scale)', () => {
    const r = record();
    const weak = [
      { key: 'communication' as const, score: 8, comment: '' },
      { key: 'expertise' as const, score: 5, comment: '' },
      { key: 'logic' as const, score: 10, comment: '' },
      { key: 'impact' as const, score: 3, comment: '' },
      { key: 'fit' as const, score: 6, comment: '' },
    ];
    const views = dimensionViews({ report: { ...r.report, dimensions: weak } });
    expect(views.map((v) => v.score)).toEqual([8, 5, 10, 3, 6]);
    expect(buildReportMarkdown({ ...r, report: { ...r.report, dimensions: weak } }, 'zh')).toContain('| 沟通表达 | 8 |');
  });

  it('clamps out-of-range and non-finite scores to 0–100', () => {
    const r = record();
    const views = dimensionViews({
      report: {
        ...r.report,
        dimensions: [
          { key: 'communication', score: 140, comment: '' },
          { key: 'expertise', score: -5, comment: '' },
          { key: 'logic', score: Number.NaN, comment: '' },
        ],
      },
    });
    expect(views.slice(0, 3).map((v) => v.score)).toEqual([100, 0, 0]);
  });
});

describe('exports', () => {
  it('names files with the character and date', () => {
    expect(fileStamp(finishedAt)).toBe('20260926-1502');
    expect(reportFileName(record(), 'md')).toBe('interview-story_yuki_20260926-1502.md');
    expect(reportFileName(record(), 'json')).toBe('interview-story_yuki_20260926-1502.json');
  });

  it('exports JSON that round-trips the record', () => {
    const json = JSON.parse(buildReportJson(record(), Date.UTC(2026, 8, 26)));
    expect(json.app).toBe('interview-story');
    expect(json.format).toBe(1);
    expect(json.exportedAt).toBe('2026-09-26T00:00:00.000Z');
    expect(json.record).toEqual(record());
  });

  it('escapes table cells', () => {
    expect(mdCell('a|b\nc')).toBe('a\\|b<br>c');
    expect(mdCell('   ')).toBe('—');
  });
});
