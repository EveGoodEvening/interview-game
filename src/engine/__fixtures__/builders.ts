/** Test builders for configs, plans and turns. */
import type { InterviewConfig, InterviewPlan, InterviewerTurn, TurnKind } from '../../types';

export function makeConfig(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return {
    characterId: 'yuki',
    lang: 'zh',
    resumeText: '张三\n后端开发工程师\n负责订单系统，使用 Go 和 Redis，P99 延迟降低 40%。',
    resumeFileName: 'resume.txt',
    targetRole: '',
    jobDescription: '',
    style: 'mixed',
    difficulty: 'normal',
    mainQuestions: 3,
    maxFollowUps: 1,
    answerTimeLimitSec: 0,
    ...overrides,
  };
}

export function makePlan(topicCount = 3): InterviewPlan {
  return {
    candidateName: '张三',
    targetRole: '后端开发工程师',
    summary: '有后端经验。',
    highlights: ['订单系统'],
    concerns: [],
    topics: Array.from({ length: topicCount }, (_, i) => ({ title: `话题${i + 1}`, goal: `目的${i + 1}` })),
    opening: { speech: '你好，欢迎来面试。我是林小雪。先请你做个自我介绍吧？', expression: 'smile' },
  };
}

export function makeTurn(kind: TurnKind, overrides: Partial<InterviewerTurn> = {}): InterviewerTurn {
  return {
    kind,
    reaction: '嗯，了解。',
    question: kind === 'closing' ? '' : '能具体说说吗？',
    expression: 'neutral',
    topicIndex: null,
    assessment: { score: 7, comment: '具体', affinityDelta: 3 },
    ...overrides,
  };
}
