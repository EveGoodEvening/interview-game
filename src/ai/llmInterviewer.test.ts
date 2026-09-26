import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../characters';
import { makeConfig } from '../engine/__fixtures__/builders';
import { computeEnding, computeFinalScore, referenceOverall } from '../engine/scoring';
import { applyAnswer } from '../engine/session';
import { LlmError } from '../llm/types';
import { FakeProvider } from './__fixtures__/fakeProvider';
import { evaluationContext, sessionAtClosing, sessionMidInterview, turnContext } from './__fixtures__/context';
import { DEFAULT_MAX_TOKENS, MAX_TOKENS_CEILING, createLlmInterviewer, reportMaxTokens } from './llmInterviewer';
import { TURN_TEMPLATE } from './prompts';
import { PlanSchema, ReportSchema, TurnSchema } from './schemas';

const PLAN_JSON = JSON.stringify({
  candidateName: '张三',
  targetRole: '后端开发工程师',
  summary: '经验扎实',
  highlights: ['订单系统'],
  concerns: ['缺少数据'],
  topics: [
    { title: '订单系统缓存', goal: '深度' },
    { title: '分歧处理', goal: '协作' },
    { title: '职业规划', goal: '动机' },
  ],
  opening: { speech: '你好，我是林小雪。请先做个自我介绍吧。', expression: 'smile' },
});

const TURN_JSON = JSON.stringify({
  assessment: { score: 7, comment: '有数据', affinityDelta: 3 },
  kind: 'followup',
  reaction: '用数据说服产品经理，这个思路很好。',
  question: '这个 12% 是怎么统计出来的？',
  expression: 'thinking',
});

describe('createLlmInterviewer', () => {
  it('prepare: sends the plan prompt with schema + token budget and normalizes the reply', async () => {
    const provider = new FakeProvider(['Here is the plan:\n```json\n' + PLAN_JSON + '\n```']);
    const ai = createLlmInterviewer(provider);
    const plan = await ai.prepare(makeConfig({ mainQuestions: 3 }), CHARACTERS.yuki);
    expect(ai.isDemo).toBe(false);
    expect(plan.topics.map((t) => t.title)).toEqual(['订单系统缓存', '分歧处理', '职业规划']);
    expect(provider.requests[0]).toMatchObject({ purpose: 'plan', maxTokens: DEFAULT_MAX_TOKENS.openai.plan, jsonSchema: PlanSchema });
    expect(provider.requests[0].system).toContain('<resume>');
  });

  it('nextTurn: uses provider-parsed output when present', async () => {
    const provider = new FakeProvider([{ text: 'ignored', parsed: JSON.parse(TURN_JSON) }]);
    const turn = await createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()));
    expect(turn).toMatchObject({ kind: 'followup', question: '这个 12% 是怎么统计出来的？', expression: 'thinking', assessment: { score: 7, affinityDelta: 3 } });
    expect(provider.requests[0]).toMatchObject({ purpose: 'turn', jsonSchema: TurnSchema, maxTokens: DEFAULT_MAX_TOKENS.openai.turn });
  });

  it('retries once with the bad output and a correction nudge, then succeeds', async () => {
    const provider = new FakeProvider(['抱歉，我无法按格式回答。', TURN_JSON]);
    const turn = await createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()));
    expect(turn.kind).toBe('followup');
    expect(provider.requests).toHaveLength(2);
    const retry = provider.requests[1].messages;
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: '抱歉，我无法按格式回答。' });
    expect(retry.at(-1)?.content).toContain('不符合要求');
    expect(retry.at(-1)?.content).toContain('没有找到 JSON 对象');
    expect(retry.at(-1)?.content).toContain(`格式：${TURN_TEMPLATE}`);
    expect(provider.requests[1].system).toBe(provider.requests[0].system);
  });

  it('throws LlmError("parse") after two unusable replies', async () => {
    const provider = new FakeProvider(['{"foo": 1}', 'still not it']);
    const err = await createLlmInterviewer(provider)
      .nextTurn(turnContext(sessionMidInterview()))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('parse');
    expect((err as LlmError).detail).toBe('still not it');
    expect(provider.requests[1].messages.at(-1)?.content).toContain('缺少必需字段');
  });

  it('retries with a bigger budget after truncation, and passes other errors through', async () => {
    const truncated = new FakeProvider([new LlmError('truncated', 'max tokens'), TURN_JSON]);
    await createLlmInterviewer(truncated).nextTurn(turnContext(sessionMidInterview()));
    expect(truncated.requests.map((r) => r.maxTokens)).toEqual([DEFAULT_MAX_TOKENS.openai.turn, DEFAULT_MAX_TOKENS.openai.turn * 2]);

    const cut = new FakeProvider([{ text: '{"reaction": "好', stopReason: 'max_tokens' }, TURN_JSON]);
    await createLlmInterviewer(cut, { maxTokens: { turn: 500 } }).nextTurn(turnContext(sessionMidInterview()));
    expect(cut.requests.map((r) => r.maxTokens)).toEqual([500, 1000]);

    const auth = new FakeProvider([new LlmError('auth', 'bad key', { status: 401 })]);
    await expect(createLlmInterviewer(auth).nextTurn(turnContext(sessionMidInterview()))).rejects.toMatchObject({ code: 'auth' });
    expect(auth.requests).toHaveLength(1);
  });

  it('the truncation retry never exceeds the protocol ceiling (OpenAI-compatible servers capped at 8192)', async () => {
    const report = JSON.stringify({
      overallScore: 70,
      dimensions: [],
      strengths: [],
      improvements: [],
      questionReviews: [],
      summary: 's',
      finalMessage: 'bye',
    });
    // Report on an OpenAI-compatible provider: 6000 → 8192, not 12000.
    const thrown = new FakeProvider([new LlmError('truncated', 'max tokens'), report]);
    await createLlmInterviewer(thrown).evaluate(evaluationContext(sessionAtClosing()));
    expect(thrown.requests.map((r) => r.maxTokens)).toEqual([DEFAULT_MAX_TOKENS.openai.report, MAX_TOKENS_CEILING.openai]);
    expect(MAX_TOKENS_CEILING.openai).toBe(8192);

    const stopped = new FakeProvider([{ text: '{"overallScore": 7', stopReason: 'length' }, report]);
    await createLlmInterviewer(stopped).evaluate(evaluationContext(sessionAtClosing()));
    expect(stopped.requests.map((r) => r.maxTokens)).toEqual([DEFAULT_MAX_TOKENS.openai.report, 8192]);

    // Already at the ceiling: no bigger retry, the truncation is reported.
    const capped = new FakeProvider([new LlmError('truncated', 'max tokens')]);
    const err = await createLlmInterviewer(capped, { maxTokens: { report: 8192 } })
      .evaluate(evaluationContext(sessionAtClosing()))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'truncated' });
    expect(capped.requests.map((r) => r.maxTokens)).toEqual([8192]);

    // Claude keeps its larger ceiling.
    const claude = new FakeProvider([new LlmError('truncated', 'max tokens'), report], 'anthropic');
    await createLlmInterviewer(claude).evaluate(evaluationContext(sessionAtClosing()));
    expect(claude.requests.map((r) => r.maxTokens)).toEqual([DEFAULT_MAX_TOKENS.anthropic.report, MAX_TOKENS_CEILING.anthropic]);
  });

  it('retries once when the kind is not allowed, naming the allowed kinds', async () => {
    // Directive for this context: follow up on topic 2 or move on to topic 3 (main).
    const wrong = JSON.stringify({ ...JSON.parse(TURN_JSON), kind: 'reverse_prompt', question: '你有什么想问我的吗？' });
    const provider = new FakeProvider([wrong, TURN_JSON]);
    const turn = await createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()));
    expect(turn.kind).toBe('followup');
    expect(provider.requests).toHaveLength(2);
    const nudge = provider.requests[1].messages.at(-1)!.content;
    expect(nudge).toContain('kind "reverse_prompt" 在这一轮不允许，只能用 "main" 或 "followup"');
    expect(nudge).toContain(`格式：${TURN_TEMPLATE}`);
    expect(provider.requests[1].messages.at(-2)).toEqual({ role: 'assistant', content: wrong });
  });

  it('after one kind correction, returns the best usable reply for the engine to coerce', async () => {
    const wrong = JSON.stringify({ ...JSON.parse(TURN_JSON), kind: 'closing' });
    const stillWrong = new FakeProvider([wrong, wrong]);
    expect((await createLlmInterviewer(stillWrong).nextTurn(turnContext(sessionMidInterview()))).kind).toBe('closing');
    expect(stillWrong.requests).toHaveLength(2);
    const thenGarbage = new FakeProvider([wrong, 'sorry']);
    expect((await createLlmInterviewer(thenGarbage).nextTurn(turnContext(sessionMidInterview()))).reaction).toBe('用数据说服产品经理，这个思路很好。');
    // An unknown kind label is harmless when only one kind is allowed: no retry.
    const s = sessionMidInterview({ maxFollowUps: 0 });
    const unknown = new FakeProvider([JSON.stringify({ ...JSON.parse(TURN_JSON), kind: 'next_question' })]);
    await createLlmInterviewer(unknown).nextTurn(turnContext(s));
    expect(unknown.requests).toHaveLength(1);
  });

  it('gives Claude room for adaptive thinking and scales the report budget with the interview', async () => {
    const provider = new FakeProvider([TURN_JSON], 'anthropic');
    await createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()));
    expect(provider.requests[0].maxTokens).toBe(DEFAULT_MAX_TOKENS.anthropic.turn);
    expect(DEFAULT_MAX_TOKENS.anthropic.turn).toBeGreaterThanOrEqual(3000);
    expect(reportMaxTokens('anthropic', 5)).toBe(DEFAULT_MAX_TOKENS.anthropic.report);
    expect(reportMaxTokens('anthropic', 30)).toBe(15000);
    expect(reportMaxTokens('anthropic', 49)).toBe(16000);
    // OpenAI-compatible servers often cap max_tokens at 8192.
    expect(reportMaxTokens('openai', 5)).toBe(DEFAULT_MAX_TOKENS.openai.report);
    expect(reportMaxTokens('openai', 49)).toBe(8192);
    expect(Math.max(...Object.values(DEFAULT_MAX_TOKENS.openai))).toBeLessThanOrEqual(8192);
  });

  it('fills a missing assessment heuristically for assessable answers', async () => {
    const provider = new FakeProvider([JSON.stringify({ kind: 'main', reaction: '好的。', question: '下一个问题？', expression: 'smile' })]);
    const turn = await createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()));
    expect(turn.assessment).not.toBeNull();
    expect(turn.assessment!.score).toBeGreaterThan(0);
    // The stand-in can't judge quality, so a long, number-heavy answer is capped at "adequate".
    let rich = sessionMidInterview();
    rich = { ...rich, transcript: rich.transcript.slice(0, -1) };
    rich = applyAnswer(
      rich,
      '首先，我主导了订单系统重构，用 Redis 和 Kafka 把 P99 从 800ms 降到 120ms，QPS 提升 3 倍；然后我设计了灰度方案，因为风险可控；最后转化率提升 12%，每年节省 200 万成本。',
      { via: 'text', durationSec: 60 },
    ).session;
    const capped = await createLlmInterviewer(new FakeProvider([JSON.stringify({ kind: 'main', reaction: '好的。', question: '下一个？' })])).nextTurn(turnContext(rich));
    expect(capped.assessment!.score).toBeLessThanOrEqual(6);
    expect(capped.assessment!.affinityDelta).toBeLessThanOrEqual(1);
  });

  it('stops when the signal is aborted', async () => {
    const ctrl = new AbortController();
    const provider = new FakeProvider([
      () => {
        ctrl.abort();
        return TURN_JSON;
      },
    ]);
    await expect(createLlmInterviewer(provider).nextTurn(turnContext(sessionMidInterview()), ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('evaluate: normalizes the report and keeps the ending consistent with the projected outcome', async () => {
    const s = sessionAtClosing();
    const provider = new FakeProvider([
      JSON.stringify({
        overallScore: 98,
        dimensions: [{ key: 'communication', score: 90, comment: 'ok' }],
        strengths: ['a'],
        improvements: ['b'],
        questionReviews: [],
        summary: 'sum',
        finalMessage: '期待再见！',
      }),
    ]);
    const ctx = evaluationContext(s);
    const report = await createLlmInterviewer(provider).evaluate(ctx);
    expect(provider.requests[0]).toMatchObject({ purpose: 'report', jsonSchema: ReportSchema, maxTokens: DEFAULT_MAX_TOKENS.openai.report });
    expect(report.questionReviews).toHaveLength(4);
    expect(report.dimensions).toHaveLength(5);
    // scores: intro 7 · topic 1 skipped 0 · topic 2 main 7 (+ ungraded follow-up), averaged per topic → the 98 is
    // pulled down to the evidence.
    const reference = referenceOverall(ctx.scores, ctx.transcript)!;
    expect(provider.requests[0].system).toContain(`折算后约为 ${reference}`);
    expect(report.overallScore).toBeLessThanOrEqual(reference + 15);
    const ending = computeEnding(computeFinalScore(report.overallScore, ctx.affinity), ctx.affinity);
    expect(provider.requests[0].system).toContain(ending === 'rejected' ? '暂时不通过' : '待定');
    expect(report.finalMessage).toBe('期待再见！');
  });
});
