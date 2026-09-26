import { describe, expect, it } from 'vitest';
import { makeConfig, makePlan, makeTurn } from '../engine/__fixtures__/builders';
import { applyAnswer, applyPlan, applySkip, applyTurn, createSession } from '../engine/session';
import type { InterviewRecord, InterviewSession } from '../types';
import {
  answerTimeLimit,
  canSkip,
  currentInterviewerEntry,
  currentQuestionText,
  currentTurn,
  isReverseQA,
  presentingEntry,
  progressInfo,
  qaList,
  recordQA,
  reverseQAList,
  reverseQuestionsLeft,
  sessionCharacter,
  speechPages,
  turnPages,
} from './selectors';

function midSession(): InterviewSession {
  let s = applyPlan(createSession(makeConfig({ answerTimeLimitSec: 90 })), makePlan(3)).session;
  s = applyAnswer(s, '自我介绍', { via: 'text', durationSec: 1 }).session;
  s = applyTurn(s, makeTurn('main', { topicIndex: 0, question: '主问题一？' }), { type: 'main', topicIndex: 0 }).session;
  s = applyAnswer(s, '回答', { via: 'text', durationSec: 1 }).session;
  s = applyTurn(s, makeTurn('followup', { topicIndex: 0, question: '追问？' }), {
    type: 'followup_or_next',
    currentTopicIndex: 0,
    next: { type: 'main', topicIndex: 1 },
  }).session;
  return s;
}

describe('selectors', () => {
  it('reports progress and the pinned question', () => {
    const s = midSession();
    expect(progressInfo(null)).toBeNull();
    expect(progressInfo(s)).toEqual({ mainIndex: 1, mainTotal: 3, isFollowUp: true, phase: 'questioning', topicTitle: '话题1' });
    expect(currentInterviewerEntry(s)?.turn?.kind).toBe('followup');
    expect(currentTurn(s)?.question).toBe('追问？');
    expect(currentQuestionText(s)).toBe('追问？');
    expect(currentQuestionText(null)).toBe('');
    expect(sessionCharacter(s)?.id).toBe('yuki');
    expect(presentingEntry(s, { kind: 'interviewer', entryId: s.transcript.at(-1)!.id })).toBe(s.transcript.at(-1));
    expect(presentingEntry(s, { kind: 'answer' })).toBeNull();
  });

  it('knows about skipping, time limits and the reverse Q&A', () => {
    let s = midSession();
    expect(canSkip(s, { kind: 'answer' })).toBe(true);
    expect(canSkip(s, { kind: 'loading', reason: 'thinking' })).toBe(false);
    expect(answerTimeLimit(s)).toBe(90);
    expect(isReverseQA(s)).toBe(false);
    s = applySkip(s).session;
    s = applyTurn(s, makeTurn('reverse_prompt', { question: '有问题吗？' }), { type: 'reverse_prompt' }).session;
    expect(isReverseQA(s)).toBe(true);
    expect(canSkip(s, { kind: 'answer' })).toBe(false);
    expect(answerTimeLimit(s)).toBe(0);
    expect(reverseQuestionsLeft(s)).toBe(3);
    s = applyAnswer(s, '团队多大？', { via: 'text', durationSec: 1 }).session;
    s = applyTurn(s, makeTurn('reverse_answer', { reaction: '十人。', question: '还有吗？' }), { type: 'reverse_answer' }).session;
    expect(reverseQuestionsLeft(s)).toBe(2);
    expect(reverseQAList(s)).toEqual([expect.objectContaining({ question: '团队多大？', answer: '十人。' })]);
    const closed = applyTurn(applyAnswer(s, '流程？', { via: 'text', durationSec: 1 }).session, makeTurn('closing'), { type: 'closing' }).session;
    expect(currentQuestionText(closed)).toBe('');
  });

  it('hides scores in the live Q&A list and shows them after the interview', () => {
    const s = midSession();
    const live = qaList(s);
    expect(live.map((p) => [p.kind, p.question, p.score])).toEqual([
      ['opening', '先请你做个自我介绍吧？', null],
      ['main', '主问题一？', null],
    ]);
    expect(qaList(s, true).map((p) => p.score)).toEqual([7, 7]);
    const record = { transcript: s.transcript, report: { questionReviews: [{ score: 4 }, { score: 9 }] } } as unknown as InterviewRecord;
    expect(recordQA(record).map((p) => p.score)).toEqual([4, 9]);
  });

  it('splits speech into dialogue pages', () => {
    const zhLong = '这是第一句话，内容比较长，用来测试分页的效果。'.repeat(4);
    const pages = speechPages(zhLong, 'zh');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(zhLong);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(70);
    const en = 'Short one. ' + 'This sentence is intentionally long, and it keeps going, with commas, to force a split at commas when needed. '.repeat(2);
    const enPages = speechPages(en.trim(), 'en');
    for (const p of enPages) expect(p.length).toBeLessThanOrEqual(140);
    expect(speechPages('', 'en')).toEqual([]);
    expect(turnPages(makeTurn('main', { reaction: '好的。', question: '为什么？' }), 'zh')).toEqual(['好的。', '为什么？']);
  });
});
