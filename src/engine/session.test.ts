import { describe, expect, it } from 'vitest';
import type { InterviewSession } from '../types';
import { makeConfig, makePlan, makeTurn } from './__fixtures__/builders';
import { CANNED } from './canned';
import { nextDirective } from './directive';
import { pairQuestionsAndAnswers, reverseQuestions, reviewQuestionLabel } from './qa';
import {
  MAX_SESSION_RESUME_CHARS,
  applyAnswer,
  applyEndReverse,
  applyPlan,
  applySkip,
  applyTurn,
  createSession,
  openingTurn,
  sanitizeConfig,
} from './session';

function started(): InterviewSession {
  return applyPlan(createSession(makeConfig()), makePlan(2)).session;
}

describe('createSession / sanitizeConfig', () => {
  it('starts in preparing with affinity 50', () => {
    const s = createSession(makeConfig());
    expect(s).toMatchObject({ phase: 'preparing', plan: null, affinity: 50, currentTopicIndex: -1, mainAsked: 0, transcript: [] });
    expect(s.id).toMatch(/^s_/);
  });

  it('clamps numeric options and caps the résumé', () => {
    const c = sanitizeConfig(makeConfig({ mainQuestions: 40, maxFollowUps: -2, answerTimeLimitSec: Number.NaN, resumeText: 'x'.repeat(30000) }));
    expect(c.mainQuestions).toBe(12);
    expect(c.maxFollowUps).toBe(0);
    expect(c.answerTimeLimitSec).toBe(0);
    expect(c.resumeText.length).toBe(MAX_SESSION_RESUME_CHARS);
  });
});

describe('applyPlan / openingTurn', () => {
  it('splits the opening into greeting and self-intro request', () => {
    const s = createSession(makeConfig());
    const t = openingTurn(makePlan(), s);
    expect(t.reaction).toBe('你好，欢迎来面试。我是林小雪。');
    expect(t.question).toBe('先请你做个自我介绍吧？');
  });

  it('enters the intro phase with a prologue chapter', () => {
    const { session, entry, chapter } = applyPlan(createSession(makeConfig()), makePlan());
    expect(session.phase).toBe('intro');
    expect(session.transcript).toEqual([entry]);
    expect(entry.turn?.kind).toBe('opening');
    expect(entry.text).toBe('你好，欢迎来面试。我是林小雪。先请你做个自我介绍吧？');
    expect(chapter).toEqual({ phase: 'intro', topicIndex: null, topicTitle: null });
  });
});

describe('applyTurn', () => {
  it('records the assessment of the reply, applies affinity and opens the topic', () => {
    let s = started();
    s = applyAnswer(s, '我是张三，做后端。', { via: 'voice', durationSec: 12.34 }).session;
    const answerId = s.transcript[1].id;
    expect(s.transcript[1].answer).toEqual({ via: 'voice', durationSec: 12.3, skipped: false });
    const r = applyTurn(s, makeTurn('main', { topicIndex: 0, assessment: { score: 8, comment: '好', affinityDelta: 4 } }), { type: 'main', topicIndex: 0 });
    expect(r.session.scores).toEqual([{ entryId: answerId, score: 8, comment: '好' }]);
    expect(r.session.affinity).toBe(54);
    expect(r.affinityDelta).toBe(4);
    expect(r.session).toMatchObject({ phase: 'questioning', currentTopicIndex: 0, mainAsked: 1, followUpsOnCurrent: 0 });
    expect(r.chapter).toEqual({ phase: 'questioning', topicIndex: 0, topicTitle: '话题1' });
  });

  it('counts follow-ups without a chapter card, clamps affinity to 0–100', () => {
    let s = { ...started(), affinity: 98 };
    s = applyAnswer(s, 'a', { via: 'text', durationSec: 1 }).session;
    s = applyTurn(s, makeTurn('main', { topicIndex: 0, assessment: { score: 9, comment: '', affinityDelta: 9 } }), { type: 'main', topicIndex: 0 }).session;
    expect(s.affinity).toBe(100);
    s = applyAnswer(s, 'b', { via: 'text', durationSec: 1 }).session;
    const r = applyTurn(s, makeTurn('followup', { topicIndex: 0, assessment: { score: 9, comment: '', affinityDelta: 5 } }), {
      type: 'followup_or_next',
      currentTopicIndex: 0,
      next: { type: 'main', topicIndex: 1 },
    });
    expect(r.affinityDelta).toBe(0);
    expect(r.chapter).toBeNull();
    expect(r.session.followUpsOnCurrent).toBe(1);
  });

  it('does not score a reply twice or score a skipped reply', () => {
    let s = started();
    const skip = applySkip(s);
    expect(skip.affinityDelta).toBe(-6);
    expect(skip.session.scores).toEqual([{ entryId: skip.entry.id, score: 0, comment: '' }]);
    s = skip.session;
    const r = applyTurn(s, makeTurn('main', { topicIndex: 0 }), { type: 'main', topicIndex: 0 });
    expect(r.session.scores).toHaveLength(1);
    expect(r.session.affinity).toBe(44);
    expect(r.affinityDelta).toBe(0);
  });

  it('reverse Q&A: small affinity only, counts questions, closes', () => {
    let s: InterviewSession = { ...started(), phase: 'questioning', currentTopicIndex: 1, mainAsked: 2 };
    s = applyAnswer(s, 'x', { via: 'text', durationSec: 1 }).session;
    const rp = applyTurn(s, makeTurn('reverse_prompt', { question: '你有什么想问我的吗？' }), { type: 'reverse_prompt' });
    expect(rp.chapter).toEqual({ phase: 'reverse', topicIndex: null, topicTitle: null });
    s = rp.session;
    expect(s.phase).toBe('reverse');
    s = applyAnswer(s, '团队多大？', { via: 'text', durationSec: 1 }).session;
    const ra = applyTurn(s, makeTurn('reverse_answer', { assessment: { score: 8, comment: '', affinityDelta: 9 } }), { type: 'reverse_answer' });
    expect(ra.affinityDelta).toBe(5);
    expect(ra.session.reverseAsked).toBe(1);
    expect(ra.session.scores).toHaveLength(s.scores.length);
    s = applyAnswer(ra.session, '流程是什么？', { via: 'text', durationSec: 1 }).session;
    const cl = applyTurn(s, makeTurn('closing', { assessment: null }), { type: 'closing' });
    expect(cl.session).toMatchObject({ phase: 'closing', reverseAsked: 2 });
    expect(cl.chapter?.phase).toBe('closing');
  });

  it('endReverseQA records a skipped "no more questions" reply without penalty', () => {
    let s: InterviewSession = { ...started() };
    s = applyAnswer(s, 'x', { via: 'text', durationSec: 1 }).session;
    s = applyTurn(s, makeTurn('reverse_prompt'), { type: 'reverse_prompt' }).session;
    const r = applyEndReverse(s);
    expect(r.entry.text).toBe(CANNED.noMoreQuestions.zh);
    expect(r.entry.answer?.skipped).toBe(true);
    expect(r.affinityDelta).toBe(0);
    expect(nextDirective(r.session)).toEqual({ type: 'closing' });
    const cl = applyTurn(r.session, makeTurn('closing'), { type: 'closing' });
    expect(cl.session.reverseAsked).toBe(0);
  });
});

describe('qa pairing', () => {
  it('pairs assessable questions with answers and scores, and lists reverse questions', () => {
    let s = started();
    s = applyAnswer(s, '自我介绍', { via: 'text', durationSec: 1 }).session;
    s = applyTurn(s, makeTurn('main', { topicIndex: 0, question: '主问题？' }), { type: 'main', topicIndex: 0 }).session;
    s = applySkip(s).session;
    s = applyTurn(s, makeTurn('reverse_prompt', { question: '有问题吗？' }), { type: 'reverse_prompt' }).session;
    s = applyAnswer(s, '团队多大？', { via: 'text', durationSec: 1 }).session;
    s = applyTurn(s, makeTurn('reverse_answer', { reaction: '十个人。', question: '还有吗？' }), { type: 'reverse_answer' }).session;
    const qa = pairQuestionsAndAnswers(s.transcript, s.scores);
    expect(qa.map((p) => [p.kind, p.question, p.answer, p.skipped, p.score])).toEqual([
      ['opening', '先请你做个自我介绍吧？', '自我介绍', false, 7],
      ['main', '主问题？', '', true, 0],
    ]);
    expect(reverseQuestions(s.transcript)).toEqual([{ question: '团队多大？', questionEntryId: s.transcript[5].id, answer: '十个人。' }]);
    expect(reviewQuestionLabel({ kind: 'followup', question: 'Why?' }, 'en')).toBe('Follow-up: Why?');
    expect(reviewQuestionLabel({ kind: 'main', question: 'Why?' }, 'en')).toBe('Why?');
  });
});
