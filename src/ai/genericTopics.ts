/**
 * Generic, résumé-independent interview topics. Used to pad a plan whose topic list is too
 * short and by the demo interviewer when the résumé has little to work with.
 */
import type { InterviewStyle, Lang, PlanTopic } from '../types';

export type GenericTopicId =
  | 'proudest'
  | 'challenge'
  | 'teamwork'
  | 'failure'
  | 'learning'
  | 'pressure'
  | 'motivation'
  | 'career'
  | 'strengths'
  | 'debugging'
  | 'design'
  | 'quality'
  | 'ownership'
  | 'prioritize';

type GenericTopic = { id: GenericTopicId; styles: readonly InterviewStyle[] } & Record<Lang, PlanTopic>;

export const GENERIC_TOPICS: readonly GenericTopic[] = [
  {
    id: 'proudest',
    styles: ['behavioral', 'technical', 'mixed'],
    zh: { title: '最有成就感的一段经历', goal: '了解候选人的核心能力、个人贡献与可量化的成果' },
    en: { title: 'Your proudest accomplishment', goal: "Understand the candidate's core strengths, personal contribution and measurable results" },
  },
  {
    id: 'challenge',
    styles: ['behavioral', 'technical', 'mixed'],
    zh: { title: '遇到过的最大挑战', goal: '考察分析问题、解决问题的思路和韧性' },
    en: { title: 'The toughest challenge you faced', goal: 'Assess problem-solving approach and resilience' },
  },
  {
    id: 'teamwork',
    styles: ['behavioral', 'mixed'],
    zh: { title: '团队协作与分歧处理', goal: '考察沟通方式、协作意识以及处理冲突的成熟度' },
    en: { title: 'Teamwork and disagreements', goal: 'Assess communication, collaboration and how conflicts are handled' },
  },
  {
    id: 'failure',
    styles: ['behavioral', 'mixed'],
    zh: { title: '一次失败与复盘', goal: '考察自我反思能力和从失败中成长的能力' },
    en: { title: 'A failure and what you learned', goal: 'Assess self-reflection and ability to grow from mistakes' },
  },
  {
    id: 'learning',
    styles: ['behavioral', 'technical', 'mixed'],
    zh: { title: '快速学习新东西', goal: '考察学习方法与上手速度' },
    en: { title: 'Learning something new fast', goal: 'Assess learning strategy and ramp-up speed' },
  },
  {
    id: 'pressure',
    styles: ['behavioral', 'mixed'],
    zh: { title: '压力与紧急情况', goal: '考察在截止日期和突发状况下的优先级判断与情绪管理' },
    en: { title: 'Working under pressure', goal: 'Assess prioritisation and composure under deadlines and incidents' },
  },
  {
    id: 'motivation',
    styles: ['behavioral', 'mixed'],
    zh: { title: '求职动机', goal: '了解候选人为什么想加入我们、为什么是这个岗位' },
    en: { title: 'Why this role', goal: 'Understand why the candidate wants this role and this company' },
  },
  {
    id: 'career',
    styles: ['behavioral', 'mixed'],
    zh: { title: '职业规划', goal: '了解候选人未来三到五年的方向，以及与岗位的匹配度' },
    en: { title: 'Career goals', goal: "Understand the candidate's 3–5 year direction and fit with the role" },
  },
  {
    id: 'strengths',
    styles: ['behavioral'],
    zh: { title: '优势与短板', goal: '考察自我认知是否清晰、是否有改进行动' },
    en: { title: 'Strengths and weaknesses', goal: 'Assess self-awareness and concrete improvement actions' },
  },
  {
    id: 'debugging',
    styles: ['technical', 'mixed'],
    zh: { title: '一次棘手问题的排查', goal: '考察定位问题的方法论和对底层原理的理解' },
    en: { title: 'Debugging a nasty problem', goal: 'Assess troubleshooting method and understanding of fundamentals' },
  },
  {
    id: 'design',
    styles: ['technical'],
    zh: { title: '方案设计与取舍', goal: '考察系统设计能力、技术选型的权衡和可扩展性思维' },
    en: { title: 'Design and trade-offs', goal: 'Assess system design, trade-off reasoning and scalability thinking' },
  },
  {
    id: 'quality',
    styles: ['technical'],
    zh: { title: '质量与工程规范', goal: '考察对代码质量、测试和可维护性的理解' },
    en: { title: 'Quality and engineering practice', goal: 'Assess views on code quality, testing and maintainability' },
  },
  {
    id: 'ownership',
    styles: ['mixed', 'behavioral'],
    zh: { title: '主动推动一件事', goal: '考察主人翁意识和在没有明确指令时推动结果的能力' },
    en: { title: 'Driving something on your own', goal: 'Assess ownership and ability to drive results without being told' },
  },
  {
    id: 'prioritize',
    styles: ['mixed', 'technical'],
    zh: { title: '资源有限时的取舍', goal: '考察在时间和资源受限时如何排优先级、做决策' },
    en: { title: 'Prioritising with limited resources', goal: 'Assess prioritisation and decision-making under constraints' },
  },
];

/** Generic topics suited to a style, in a sensible default order. */
export function genericTopicsFor(style: InterviewStyle, lang: Lang): (PlanTopic & { id: GenericTopicId })[] {
  const preferred = GENERIC_TOPICS.filter((t) => t.styles.includes(style));
  const rest = GENERIC_TOPICS.filter((t) => !t.styles.includes(style));
  return [...preferred, ...rest].map((t) => ({ id: t.id, ...t[lang] }));
}
