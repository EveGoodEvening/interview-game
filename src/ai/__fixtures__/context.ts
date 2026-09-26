/** Builds realistic TurnContext / EvaluationContext values by driving the pure engine. */
import { CHARACTERS } from '../../characters';
import { makeConfig, makePlan, makeTurn } from '../../engine/__fixtures__/builders';
import { nextDirective } from '../../engine/directive';
import { applyAnswer, applyEndReverse, applyPlan, applySkip, applyTurn, createSession } from '../../engine/session';
import type { EvaluationContext, InterviewConfig, InterviewSession, TurnContext } from '../../types';

export function turnContext(session: InterviewSession): TurnContext {
  const directive = nextDirective(session);
  if (!directive || !session.plan) throw new Error('session is not waiting for a turn');
  return {
    config: session.config,
    character: CHARACTERS[session.config.characterId],
    plan: session.plan,
    transcript: session.transcript,
    directive,
    progress: {
      mainAsked: session.mainAsked,
      mainTotal: session.plan.topics.length,
      followUpsOnCurrent: session.followUpsOnCurrent,
      maxFollowUps: session.config.maxFollowUps,
      reverseAsked: session.reverseAsked,
    },
  };
}

export function evaluationContext(session: InterviewSession): EvaluationContext {
  if (!session.plan) throw new Error('no plan');
  return {
    config: session.config,
    character: CHARACTERS[session.config.characterId],
    plan: session.plan,
    transcript: session.transcript,
    scores: session.scores,
    affinity: session.affinity,
  };
}

/** Opening → self-intro answered → main #1 → (answer) … a small but complete history. */
export function sessionMidInterview(config: Partial<InterviewConfig> = {}): InterviewSession {
  let s = applyPlan(createSession(makeConfig({ maxFollowUps: 2, ...config })), makePlan(3)).session;
  s = applyAnswer(s, '我是张三，在某公司做后端开发三年。', { via: 'voice', durationSec: 20 }).session;
  s = applyTurn(s, makeTurn('main', { topicIndex: 0, question: '说说订单系统的缓存设计？' }), { type: 'main', topicIndex: 0 }).session;
  s = applySkip(s).session;
  s = applyTurn(s, makeTurn('main', { topicIndex: 1, question: '讲讲你和同事的一次分歧？' }), { type: 'main', topicIndex: 1 }).session;
  s = applyAnswer(s, '有一次我和产品经理在需求优先级上有分歧，我用数据说服了他，最后转化率提升了 12%。', { via: 'text', durationSec: 30 }).session;
  return s;
}

/** A finished-looking session (closing presented) for evaluation prompts. */
export function sessionAtClosing(): InterviewSession {
  let s = sessionMidInterview();
  s = applyTurn(s, makeTurn('followup', { topicIndex: 1, question: '这个 12% 是怎么算的？' }), {
    type: 'followup_or_next',
    currentTopicIndex: 1,
    next: { type: 'main', topicIndex: 2 },
  }).session;
  s = applyAnswer(s, '对比了上线前后两周的数据。', { via: 'text', durationSec: 10 }).session;
  s = applyTurn(s, makeTurn('reverse_prompt', { question: '你有什么想问我的吗？' }), { type: 'reverse_prompt' }).session;
  s = applyAnswer(s, '团队有多少人？', { via: 'text', durationSec: 3 }).session;
  s = applyTurn(s, makeTurn('reverse_answer', { reaction: '十个人左右。', question: '还有别的问题吗？' }), { type: 'reverse_answer' }).session;
  s = applyEndReverse(s).session;
  s = applyTurn(s, makeTurn('closing', { reaction: '今天就到这里，再见。', question: '' }), { type: 'closing' }).session;
  return s;
}
