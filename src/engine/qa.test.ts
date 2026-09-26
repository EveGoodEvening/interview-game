import { describe, expect, it } from 'vitest';
import { makeConfig, makePlan, makeTurn } from './__fixtures__/builders';
import { countReverseQuestions, reverseQuestions } from './qa';
import { applyAnswer, applyEndReverse, applyPlan, applyTurn, createSession } from './session';
import type { InterviewSession } from '../types';

function atReverse(): InterviewSession {
  let s = applyPlan(createSession(makeConfig()), makePlan(1)).session;
  s = applyAnswer(s, '自我介绍', { via: 'text', durationSec: 3 }).session;
  s = applyTurn(s, makeTurn('main', { topicIndex: 0 }), { type: 'main', topicIndex: 0 }).session;
  s = applyAnswer(s, '回答', { via: 'text', durationSec: 3 }).session;
  return applyTurn(s, makeTurn('reverse_prompt', { question: '你有什么想问我的吗？' }), { type: 'reverse_prompt' }).session;
}

describe('countReverseQuestions', () => {
  it('does not count a spoken "no more questions" that the model closed on', () => {
    let s = atReverse();
    s = applyAnswer(s, '团队多少人？', { via: 'text', durationSec: 2 }).session;
    s = applyTurn(s, makeTurn('reverse_answer', { question: '还有吗？' }), { type: 'reverse_answer' }).session;
    s = applyAnswer(s, '没有了，谢谢您！', { via: 'voice', durationSec: 2 }).session;
    s = applyTurn(s, makeTurn('closing'), { type: 'reverse_answer' }).session;
    expect(reverseQuestions(s.transcript)).toHaveLength(2);
    expect(countReverseQuestions(s.transcript)).toBe(1);
  });

  it('counts the last allowed question answered inside the closing, but not the button', () => {
    let s = atReverse();
    for (const q of ['团队多少人？', '技术栈是什么？']) {
      s = applyAnswer(s, q, { via: 'text', durationSec: 2 }).session;
      s = applyTurn(s, makeTurn('reverse_answer', { question: '还有吗？' }), { type: 'reverse_answer' }).session;
    }
    s = applyAnswer(s, '后续流程是怎样的？', { via: 'text', durationSec: 2 }).session;
    s = applyTurn(s, makeTurn('closing'), { type: 'closing' }).session;
    expect(countReverseQuestions(s.transcript)).toBe(3);

    let b = atReverse();
    b = applyEndReverse(b).session;
    b = applyTurn(b, makeTurn('closing'), { type: 'closing' }).session;
    expect(countReverseQuestions(b.transcript)).toBe(0);
  });
});
