import { describe, expect, it } from 'vitest';
import type { Expression, TurnDirective } from '../types';
import { makePlan, makeTurn } from './__fixtures__/builders';
import { CANNED } from './canned';
import { coerceTurn } from './turn';

const plan = makePlan(3);
const nextMain: TurnDirective = { type: 'followup_or_next', currentTopicIndex: 0, next: { type: 'main', topicIndex: 1 } };
const nextReverse: TurnDirective = { type: 'followup_or_next', currentTopicIndex: 2, next: { type: 'reverse_prompt' } };

describe('coerceTurn', () => {
  it('keeps an allowed follow-up and fixes its topic index', () => {
    const t = coerceTurn(makeTurn('followup', { topicIndex: 7 }), nextMain, plan, 'zh');
    expect(t.kind).toBe('followup');
    expect(t.topicIndex).toBe(0);
  });

  it('keeps an allowed main question and points it at the next topic', () => {
    const t = coerceTurn(makeTurn('main', { question: '聊聊话题2吧？' }), nextMain, plan, 'zh');
    expect(t).toMatchObject({ kind: 'main', topicIndex: 1, question: '聊聊话题2吧？' });
  });

  it('turns a disallowed follow-up into the directed main question, replacing its old-topic question', () => {
    const t = coerceTurn(makeTurn('followup', { reaction: '明白。', question: '那这个对照实验你会怎么设计？' }), { type: 'main', topicIndex: 2 }, plan, 'zh');
    expect(t).toMatchObject({ kind: 'main', topicIndex: 2, reaction: '明白。' });
    expect(t.question).toContain('话题3');
    expect(t.question).not.toContain('对照实验');
    // A reverse-Q&A invite where a main question was due is replaced too.
    const r = coerceTurn(makeTurn('reverse_prompt', { question: 'Any questions for me?' }), nextMain, plan, 'en');
    expect(r).toMatchObject({ kind: 'main', topicIndex: 1 });
    expect(r.question).toContain('话题2');
  });

  it('keeps the question when only the kind label was unknown', () => {
    const t = coerceTurn(makeTurn('opening', { question: '说说话题3里你最难的一个决定？' }), { type: 'main', topicIndex: 2 }, plan, 'zh');
    expect(t).toMatchObject({ kind: 'main', topicIndex: 2, question: '说说话题3里你最难的一个决定？' });
  });

  it('turns an unexpected main question into the reverse prompt with an inviting question', () => {
    const t = coerceTurn(makeTurn('main', { question: '说说你的缺点？' }), nextReverse, plan, 'zh');
    expect(t.kind).toBe('reverse_prompt');
    expect(t.question).toBe(CANNED.reversePrompt.zh);
    expect(t.topicIndex).toBeNull();
  });

  it('keeps a reverse prompt that already invites questions', () => {
    const t = coerceTurn(makeTurn('main', { question: 'Do you have any questions for me?' }), { type: 'reverse_prompt' }, plan, 'en');
    expect(t).toMatchObject({ kind: 'reverse_prompt', question: 'Do you have any questions for me?' });
  });

  it('closing never keeps a question: it is merged into the goodbye', () => {
    const t = coerceTurn(makeTurn('reverse_answer', { reaction: '好的。', question: '今天就到这里，再见！' }), { type: 'closing' }, plan, 'zh');
    expect(t).toMatchObject({ kind: 'closing', question: '', reaction: '好的。今天就到这里，再见！' });
  });

  it('allows closing during the reverse Q&A (candidate said no more questions)', () => {
    const t = coerceTurn(makeTurn('closing', { reaction: 'Thanks, goodbye!', question: '' }), { type: 'reverse_answer' }, plan, 'en');
    expect(t.kind).toBe('closing');
  });

  it('never lets a reverse answer quiz the candidate', () => {
    const quiz = coerceTurn(makeTurn('followup', { reaction: 'We are ten people.', question: 'Why do you want to join us?' }), { type: 'reverse_answer' }, plan, 'en');
    expect(quiz).toMatchObject({ kind: 'reverse_answer', reaction: 'We are ten people.', question: CANNED.anythingElse.en });
    const invite = coerceTurn(makeTurn('main', { reaction: '十个人左右。', question: '你还有其他想了解的吗？' }), { type: 'reverse_answer' }, plan, 'zh');
    expect(invite.question).toBe('你还有其他想了解的吗？');
  });

  it('adds "anything else?" to a reverse answer without a question', () => {
    const t = coerceTurn(makeTurn('reverse_answer', { reaction: 'We are a team of ten.', question: '' }), { type: 'reverse_answer' }, plan, 'en');
    expect(t.question).toBe(CANNED.anythingElse.en);
  });

  it('recovers an empty question from the reaction, or falls back to a canned one', () => {
    const split = coerceTurn(makeTurn('main', { reaction: '明白了。那我们聊聊话题2，你怎么看？', question: '' }), { type: 'main', topicIndex: 1 }, plan, 'zh');
    expect(split.reaction).toBe('明白了。');
    expect(split.question).toBe('那我们聊聊话题2，你怎么看？');
    const canned = coerceTurn(makeTurn('main', { reaction: '', question: '' }), { type: 'main', topicIndex: 1 }, plan, 'zh');
    expect(canned.question).toContain('话题2');
    const fu = coerceTurn(makeTurn('followup', { reaction: '', question: '' }), nextMain, plan, 'en');
    expect(fu.question).toBe(CANNED.followup.en);
  });

  it('sanitises expression and assessment ranges', () => {
    const t = coerceTurn(
      makeTurn('main', { expression: 'angry' as Expression, assessment: { score: 14, comment: ' x ', affinityDelta: -25 } }),
      { type: 'main', topicIndex: 0 },
      plan,
      'zh',
    );
    expect(t.expression).toBe('neutral');
    expect(t.assessment).toEqual({ score: 10, comment: 'x', affinityDelta: -10 });
  });

  it('unknown kinds (normalizer sentinel "opening") become the directed default', () => {
    expect(coerceTurn(makeTurn('opening'), nextMain, plan, 'zh').kind).toBe('main');
    expect(coerceTurn(makeTurn('opening'), { type: 'reverse_answer' }, plan, 'zh').kind).toBe('reverse_answer');
  });
});
