import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CHARACTERS } from '../characters';
import { makeConfig } from '../engine/__fixtures__/builders';
import type { QAPair } from '../engine/qa';
import { DIMENSION_KEYS, EXPRESSIONS } from '../types';
import {
  EXPRESSION_VALUES,
  PlanSchema,
  ReportSchema,
  TurnSchema,
  normalizeAssessment,
  normalizePlan,
  normalizeReport,
  normalizeTurn,
  toExpression,
  toNumber,
  toTurnKind,
} from './schemas';

type JsonSchemaNode = { type?: string; properties?: Record<string, JsonSchemaNode>; required?: string[]; additionalProperties?: boolean; items?: JsonSchemaNode; anyOf?: JsonSchemaNode[] };

/** Every object in the schema is closed and requires all of its properties. */
function assertStrict(node: JsonSchemaNode, path = '$'): void {
  if (node.type === 'object') {
    expect(node.additionalProperties, path).toBe(false);
    expect([...(node.required ?? [])].sort(), path).toEqual(Object.keys(node.properties ?? {}).sort());
    for (const [k, v] of Object.entries(node.properties ?? {})) assertStrict(v, `${path}.${k}`);
  }
  if (node.items) assertStrict(node.items, `${path}[]`);
  for (const v of node.anyOf ?? []) assertStrict(v, path);
}

describe('schemas for structured outputs', () => {
  it.each([
    ['plan', PlanSchema],
    ['turn', TurnSchema],
    ['report', ReportSchema],
  ] as const)('%s schema is closed, fully required and accepted by the Anthropic transform', (_name, schema) => {
    const json = z.toJSONSchema(schema) as JsonSchemaNode;
    assertStrict(json);
    expect(() => transformJSONSchema(json as Record<string, unknown>)).not.toThrow();
    expect(JSON.stringify(json)).not.toMatch(/"default"|"minimum"|"maximum"/);
  });

  it('expression enum matches the shared contract', () => {
    expect([...EXPRESSION_VALUES]).toEqual([...EXPRESSIONS]);
  });
});

describe('coercion helpers', () => {
  it('coerces numbers', () => {
    expect(toNumber(7)).toBe(7);
    expect(toNumber('7')).toBe(7);
    expect(toNumber('7/10')).toBe(7);
    expect(toNumber('8.5分')).toBe(8.5);
    expect(toNumber('−4')).toBe(-4);
    expect(toNumber('+3')).toBe(3);
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(true)).toBeNull();
  });

  it('maps expressions and kinds leniently', () => {
    expect(toExpression('Happy')).toBe('happy');
    expect(toExpression('微笑')).toBe('smile');
    expect(toExpression('worried')).toBe('troubled');
    expect(toExpression('angry')).toBe('neutral');
    expect(toExpression(undefined)).toBe('neutral');
    expect(toTurnKind('follow-up')).toBe('followup');
    expect(toTurnKind('Follow Up')).toBe('followup');
    expect(toTurnKind('reverse')).toBe('reverse_prompt');
    expect(toTurnKind('goodbye')).toBe('closing');
    expect(toTurnKind('???')).toBe('opening');
  });

  it('normalizes assessments: 0–100 scale, clamps, derived affinity', () => {
    expect(normalizeAssessment({ score: '85', comment: ' ok ' })).toEqual({ score: 9, comment: 'ok', affinityDelta: 6 });
    expect(normalizeAssessment({ score: 12.4, affinityDelta: 50 })).toEqual({ score: 10, comment: '', affinityDelta: 10 });
    expect(normalizeAssessment({ score: -3, affinity_delta: '-15' })).toEqual({ score: 0, comment: '', affinityDelta: -10 });
    expect(normalizeAssessment({ comment: 'no score' })).toBeNull();
    expect(normalizeAssessment('x')).toBeNull();
  });
});

describe('normalizePlan', () => {
  const config = makeConfig({ mainQuestions: 4, style: 'technical', lang: 'zh' });
  const yuki = CHARACTERS.yuki;

  it('pads topics to the requested count and cleans fields', () => {
    const plan = normalizePlan(
      {
        candidateName: 'Unknown',
        targetRole: '后端工程师',
        summary: '  有经验 ',
        highlights: '缓存优化\n高并发',
        concerns: [{ text: '缺少数据' }],
        topics: [{ title: '1. 订单系统缓存', goal: '看深度' }, '「Redis 选型」', { title: '订单系统缓存' }],
        opening: { speech: '**你好**！我是小雪😊（微笑）', expression: 'Happy' },
      },
      config,
      yuki,
    );
    expect(plan).not.toBeNull();
    expect(plan!.candidateName).toBe('');
    expect(plan!.highlights).toEqual(['缓存优化', '高并发']);
    expect(plan!.concerns).toEqual(['缺少数据']);
    expect(plan!.topics).toHaveLength(4);
    expect(plan!.topics.slice(0, 2).map((t) => t.title)).toEqual(['订单系统缓存', 'Redis 选型']);
    expect(plan!.opening.expression).toBe('happy');
    expect(plan!.opening.speech).toBe('你好！我是小雪。先请你简单做个自我介绍吧。');
  });

  it('trims extra topics, prefers the configured role, synthesizes an opening', () => {
    const plan = normalizePlan(
      { plan: { topics: Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, goal: 'g' })), role: 'X' } },
      makeConfig({ mainQuestions: 3, targetRole: '前端工程师', lang: 'en' }),
      yuki,
    );
    expect(plan!.topics.map((t) => t.title)).toEqual(['T0', 'T1', 'T2']);
    expect(plan!.targetRole).toBe('前端工程师');
    expect(plan!.opening.speech).toContain('Yuki Lin');
    expect(plan!.opening.speech).toMatch(/introduce yourself\?$/);
  });

  it('rejects output without any usable topic', () => {
    expect(normalizePlan({ topics: [] }, config, yuki)).toBeNull();
    expect(normalizePlan({ candidateName: 'a' }, config, yuki)).toBeNull();
    expect(normalizePlan('plan', config, yuki)).toBeNull();
    expect(normalizePlan(undefined, config, yuki)).toBeNull();
  });
});

describe('normalizeTurn', () => {
  it('accepts well-formed turns', () => {
    const t = normalizeTurn(
      { assessment: { score: 6, comment: 'ok', affinityDelta: 1 }, kind: 'followup', reaction: '嗯。', question: '为什么？', expression: 'thinking' },
      'zh',
    );
    expect(t).toEqual({ kind: 'followup', reaction: '嗯。', question: '为什么？', expression: 'thinking', topicIndex: null, assessment: { score: 6, comment: 'ok', affinityDelta: 1 } });
  });

  it('handles flattened assessments, wrappers, odd kinds and dirty speech', () => {
    const t = normalizeTurn({ turn: { type: 'Follow-Up', response: '*nods* Nice! 🎉', next_question: '- Why Redis?', score: '8/10', emotion: 'pleased', topic_index: '2' } }, 'en');
    expect(t).toMatchObject({ kind: 'followup', reaction: 'Nice!', question: 'Why Redis?', expression: 'happy', topicIndex: 2 });
    expect(t!.assessment).toEqual({ score: 8, comment: '', affinityDelta: 4 });
  });

  it('repairs the sloppy turns from the dry runs', () => {
    // deepseek: flattened assessment with "2/10" and "-2", kind "follow-up", emoji and a stage direction, empty question.
    const t = normalizeTurn({ kind: 'follow-up', reaction: '嗯 👍 *点头* 那我换个角度问：你当时是怎么验证效果的？', question: '', score: '2/10', affinityDelta: '-2', expression: '微笑' }, 'zh');
    expect(t).toMatchObject({ kind: 'followup', expression: 'smile', assessment: { score: 2, comment: '', affinityDelta: -2 } });
    expect(t!.reaction).toBe('嗯那我换个角度问：你当时是怎么验证效果的？');
    // Reverse answer labelled "answer", expression "calm".
    expect(normalizeTurn({ kind: 'answer', reaction: 'About forty engineers.', question: 'Anything else?', expression: 'calm' }, 'en')).toMatchObject({
      kind: 'reverse_answer',
      expression: 'neutral',
    });
    // An echoed template is not speech.
    expect(normalizeTurn({ assessment: { score: 6, comment: '…', affinityDelta: 1 }, kind: '…', reaction: '…', question: '...', expression: '…' }, 'zh')).toBeNull();
    const half = normalizeTurn({ assessment: { score: 6, comment: '…', affinityDelta: 1 }, kind: 'main', reaction: '…', question: '为什么？' }, 'zh');
    expect(half).toMatchObject({ reaction: '', question: '为什么？', assessment: { comment: '' } });
  });

  it('returns null when there is nothing to say', () => {
    expect(normalizeTurn({ kind: 'main', reaction: '', question: '  ' }, 'zh')).toBeNull();
    expect(normalizeTurn({ kind: 'main', reaction: '（微笑）', question: '' }, 'zh')).toBeNull();
    expect(normalizeTurn(null, 'zh')).toBeNull();
  });

  it('caps very long speech', () => {
    const t = normalizeTurn({ reaction: '好'.repeat(5000), question: '问'.repeat(5000) }, 'zh');
    expect(t!.reaction.length).toBeLessThanOrEqual(700);
    expect(t!.question.length).toBeLessThanOrEqual(400);
  });
});

describe('normalizeReport', () => {
  const qa = (n: number): QAPair[] =>
    Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      kind: i === 0 ? 'opening' : i === 2 ? 'followup' : 'main',
      topicIndex: i === 0 ? null : 0,
      questionEntryId: `q${i}`,
      question: `问题${i + 1}？`,
      questionFull: `问题${i + 1}？`,
      answerEntryId: `a${i}`,
      answer: i === 1 ? '' : `回答${i + 1}`,
      answered: true,
      skipped: i === 1,
      durationSec: 3,
      score: i === 1 ? 0 : 6,
      comment: '',
    }));
  const ctx = { lang: 'zh' as const, qa: qa(3), reference: 40, fallbackFinalMessage: '再见。' };

  it('fills dimensions, aligns reviews to the asked questions, prefers in-interview scores', () => {
    const r = normalizeReport(
      {
        overallScore: '72',
        dimensions: [{ key: '沟通', score: 80, comment: '清楚' }, { name: 'Technical', score: '70' }],
        strengths: ['好'],
        improvements: [],
        questionReviews: [
          { question: '问题1？', answerSummary: '介绍了自己', score: 9, feedback: '不错', betterAnswer: '示范' },
          { question: '问题2？', score: 3 },
          { question: '问题3？', feedback: '追问答得一般' },
        ],
        summary: '总体还行',
        finalMessage: '（微笑）加油！',
      },
      ctx,
    )!;
    expect(r.overallScore).toBe(72);
    expect(r.dimensions.map((d) => d.key)).toEqual([...DIMENSION_KEYS]);
    expect(r.dimensions[0]).toEqual({ key: 'communication', score: 80, comment: '清楚' });
    expect(r.dimensions[1].score).toBe(70);
    expect(r.dimensions[2].comment).not.toBe('');
    expect(r.questionReviews).toHaveLength(3);
    expect(r.questionReviews[0]).toMatchObject({ question: '问题1？', score: 6, answerSummary: '介绍了自己', feedback: '不错' });
    expect(r.questionReviews[1]).toMatchObject({ score: 0, answerSummary: '（未作答）' });
    expect(r.questionReviews[1].betterAnswer).not.toBe('');
    expect(r.questionReviews[2].question).toBe('追问：问题3？');
    expect(r.improvements.length).toBeGreaterThan(0);
    expect(r.finalMessage).toBe('加油！');
  });

  it('detects 0–10 dimension scales', () => {
    const r = normalizeReport({ overallScore: 60, dimensions: [{ key: 'logic', score: 7 }, { key: 'impact', score: '5.5' }] }, ctx)!;
    expect(r.dimensions.find((d) => d.key === 'logic')?.score).toBe(70);
    expect(r.dimensions.find((d) => d.key === 'impact')?.score).toBe(55);
  });

  it('keeps low 0–100 dimension scores of a genuinely weak candidate', () => {
    const dims = [
      { key: 'communication', score: 8 },
      { key: 'expertise', score: 5 },
      { key: 'logic', score: 10 },
      { key: 'impact', score: 3 },
      { key: 'fit', score: 6 },
    ];
    const weak = normalizeReport({ overallScore: 9, dimensions: dims }, { ...ctx, reference: 7 })!;
    expect(weak.dimensions.map((d) => d.score)).toEqual([8, 5, 10, 3, 6]);
    expect(weak.overallScore).toBe(9);
    // Same numbers from a decent candidate (reference 65): clearly a 0–10 slip → rescaled.
    const slip = normalizeReport({ overallScore: 64, dimensions: dims }, { ...ctx, reference: 65 })!;
    expect(slip.dimensions.map((d) => d.score)).toEqual([80, 50, 100, 30, 60]);
  });

  it('detects a 0–10 overall score, uses the fallback message, maps dimension objects', () => {
    const r = normalizeReport({ report: { overall: 4.5, dimensions: { logic: { score: 50, comment: 'x' }, fit: 60 } } }, { ...ctx, reference: 45 })!;
    expect(r.overallScore).toBe(45);
    expect(r.dimensions.find((d) => d.key === 'logic')?.score).toBe(50);
    expect(r.dimensions.find((d) => d.key === 'fit')?.score).toBe(60);
    expect(r.finalMessage).toBe('再见。');
    expect(r.questionReviews).toHaveLength(3);
    expect(r.summary).not.toBe('');
  });

  it('matches reviews by text when the counts differ', () => {
    const r = normalizeReport(
      { overallScore: 50, questionReviews: [{ question: '问题3？', feedback: 'F3' }, { question: '问题1？', feedback: 'F1' }] },
      ctx,
    )!;
    expect(r.questionReviews[2].feedback).toBe('F3');
  });

  it('detects a fractional or dimension-matched 0–10 overall score', () => {
    expect(normalizeReport({ overallScore: 7.2 }, { ...ctx, reference: 38 })!.overallScore).toBe(72);
    const dims = { 沟通表达: 6, 专业能力: 5, 逻辑思维: 6, 成果影响: 4, 岗位匹配: 5 };
    const r = normalizeReport({ overall_score: '5分', dimension_scores: dims }, { ...ctx, reference: 55 })!;
    expect(r.overallScore).toBe(50);
    expect(r.dimensions.map((d) => d.score)).toEqual([60, 50, 60, 40, 50]);
    // A genuinely low integer overall with 0–100 dimensions stays low.
    expect(normalizeReport({ overallScore: 8, dimensions: [{ key: 'logic', score: 12 }] }, { ...ctx, reference: 10 })!.overallScore).toBe(8);
  });

  it('places reviews by their question numbers, whatever the order or count', () => {
    const six = { ...ctx, qa: qa(6) };
    const reviews = [6, 2, 1, 4, 3].map((n) => ({ number: n, question: `某个改写过的问题 ${n}`, feedback: `F${n}` }));
    const r = normalizeReport({ overallScore: 50, questionReviews: reviews }, six)!;
    expect(r.questionReviews.map((q) => q.feedback)).toEqual(['F1', 'F2', 'F3', 'F4', expect.not.stringMatching(/^F/), 'F6']);
    // 0-based numbering and "Q3：" prefixes.
    const zero = normalizeReport({ overallScore: 50, questionReviews: [2, 0, 1].map((n) => ({ number: n, feedback: `Z${n + 1}` })) }, ctx)!;
    expect(zero.questionReviews.map((q) => q.feedback)).toEqual(['Z1', 'Z2', 'Z3']);
    const prefixed = normalizeReport(
      { overallScore: 50, questionReviews: [{ question: 'Q3：追问的内容', feedback: 'P3' }, { question: 'Q1: intro', feedback: 'P1' }] },
      ctx,
    )!;
    expect(prefixed.questionReviews[0].feedback).toBe('P1');
    expect(prefixed.questionReviews[2].feedback).toBe('P3');
    // Equal counts with valid numbers in another order still follow the numbers.
    const shuffled = normalizeReport({ overallScore: 50, questionReviews: [3, 1, 2].map((n) => ({ number: String(n), feedback: `S${n}` })) }, ctx)!;
    expect(shuffled.questionReviews.map((q) => q.feedback)).toEqual(['S1', 'S2', 'S3']);
  });

  it('fills a paraphrased review into the gap between matched neighbours', () => {
    const five = { ...ctx, qa: qa(5) };
    // Four reviews for five questions; the second is paraphrased beyond recognition, one question has none.
    const reviews = [
      { question: '问题1？', feedback: 'A' },
      { question: '完全改写的第二题', feedback: 'B' },
      { question: '问题3？', feedback: 'C' },
      { question: '问题5？', feedback: 'E' },
    ];
    const r = normalizeReport({ overallScore: 50, questionReviews: reviews }, five)!;
    expect(r.questionReviews.map((q) => q.feedback.length === 1 ? q.feedback : '·')).toEqual(['A', 'B', 'C', '·', 'E']);
  });

  it('normalizes the sloppy report from the dry run', () => {
    const raw = {
      overall_score: '42分',
      dimensions: { 沟通表达: { score: 5, comment: '表达清楚' }, 专业能力: 4, 逻辑思维: 4, 成果影响: 3, 岗位匹配: 5 },
      strengths: '数据意识；表达清楚',
      improvements: ['- 多讲个人贡献'],
      question_reviews: [
        { number: 1, question: 'Q1：自我介绍', answer_summary: '介绍了经历', score: '6/10', feedback: '清楚', better_answer: '示范' },
        { number: 3, question: 'Q3：…', score: 3, feedback: '空泛', better_answer: '…' },
      ],
      summary: '这次暂时不通过 😅',
      final_message: '（推了推眼镜）继续加油。',
    };
    const r = normalizeReport(raw, { ...ctx, reference: 40 })!;
    expect(r.overallScore).toBe(42);
    expect(r.dimensions.map((d) => d.score)).toEqual([50, 40, 40, 30, 50]);
    expect(r.dimensions[0].comment).toBe('表达清楚');
    expect(r.strengths).toEqual(['数据意识', '表达清楚']);
    expect(r.improvements).toEqual(['多讲个人贡献']);
    expect(r.questionReviews[0]).toMatchObject({ answerSummary: '介绍了经历', feedback: '清楚', betterAnswer: '示范', score: 6 });
    expect(r.questionReviews[2]).toMatchObject({ feedback: '空泛' });
    expect(r.questionReviews[2].betterAnswer).not.toBe('…');
    expect(r.finalMessage).toBe('继续加油。');
  });

  it('rejects output without scores', () => {
    expect(normalizeReport({ summary: 'nice' }, ctx)).toBeNull();
    expect(normalizeReport([], ctx)).toBeNull();
  });
});
