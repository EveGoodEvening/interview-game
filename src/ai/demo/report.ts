/**
 * Offline evaluation report: per-question reviews with feedback and résumé-grounded better
 * answers, five dimension scores, strengths / improvements, summary and parting words.
 */
import type { DimensionKey, EndingId, EvaluationContext, InterviewReport, Lang, QuestionReview } from '../../types';
import { DIMENSION_KEYS } from '../../types';
import { type QAPair, countReverseQuestions, pairQuestionsAndAnswers, reviewQuestionLabel } from '../../engine/qa';
import { alignOverallScore, clamp, computeEnding, computeFinalScore, projectedEnding, referenceOverall } from '../../engine/scoring';
import { padCjkLatin, splitSentences, truncate } from '../../engine/text';
import { type AnswerAnalysis, analyzeAnswer } from './analysis';
import { CHARACTER_LINES, type QuestionCategory } from './lines';
import { type TopicCandidate, buildTopicCandidates, findCandidate, inferredRole } from './planner';
import { createRng, hashString } from './random';
import { type ResumeFacts, extractResumeFacts, skillNames } from './resumeFacts';

interface Reviewed {
  pair: QAPair;
  a: AnswerAnalysis;
  score: number;
  category: QuestionCategory | 'intro' | 'followup';
}

function share(items: Reviewed[], pred: (r: Reviewed) => boolean): number {
  const answered = items.filter((r) => !r.pair.skipped);
  return answered.length ? answered.filter(pred).length / answered.length : 0;
}

// ───────────── per-question feedback ─────────────

function feedbackFor(r: Reviewed, lang: Lang): string {
  const zh = lang === 'zh';
  const a = r.a;
  if (r.pair.skipped) return zh ? '这道题跳过了。面试中尽量不要空着，哪怕先说说思路，也比放弃更能打动面试官。' : 'This one was skipped. Even sharing your line of thinking beats leaving it blank.';
  if (a.manipulation) return zh ? '试图绕开问题或影响评分，这在真实面试里会直接减分。请正面回答问题。' : 'Trying to sidestep the question or game the score costs points in a real interview. Answer the question directly.';
  const pos: string[] = [];
  const neg: string[] = [];
  if (a.numbers.length) pos.push(zh ? `用具体数据（如“${a.numbers[0]}”）支撑了结论` : `backed it up with numbers ("${a.numbers[0]}")`);
  if (a.techTerms.length) pos.push(zh ? `提到了${a.techTerms.slice(0, 2).join('、')}等具体细节` : `named specifics like ${a.techTerms.slice(0, 2).join(' and ')}`);
  if (a.hasPersonal) pos.push(zh ? '讲清楚了你个人的贡献' : 'made your own contribution clear');
  if (a.hasReasoning) pos.push(zh ? '解释了背后的原因' : 'explained the reasoning');
  if (a.structureHits >= 2) pos.push(zh ? '表达有条理' : 'kept a clear structure');
  if (a.lengthBand === 'tiny') neg.push(zh ? '几乎没有展开' : 'barely expanded on it');
  else if (a.lengthBand === 'short') neg.push(zh ? '回答偏短，信息量不够' : 'the answer was too short');
  if (a.dontKnow && a.units < 50) neg.push(zh ? '没有给出答案，其实可以先讲讲思路' : 'no answer was given; walking through your reasoning would have helped');
  if (!a.numbers.length) neg.push(zh ? '缺少可量化的结果' : 'no measurable results');
  if (!a.hasPersonal && r.category !== 'intro') neg.push(zh ? '没说清你个人具体做了什么' : 'your personal part was unclear');
  if (a.vagueHits >= 2) neg.push(zh ? '“大概”“可能”这类模糊说法偏多' : 'too many hedges like "maybe" or "kind of"');
  if (a.lengthBand === 'rambling') neg.push(zh ? '篇幅太长，重点被淹没了' : 'it ran long and the key point got lost');
  if (a.offLanguage) neg.push(zh ? '没有使用面试语言作答' : 'it was not in the interview language');
  if (zh) {
    const p = pos.length ? `${pos.slice(0, 2).join('，')}。` : '';
    const n = neg.length ? `不足之处是${neg.slice(0, 2).join('，')}。` : '整体完成度不错。';
    return p + n;
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const p = pos.length ? `${cap(pos.slice(0, 2).join(' and '))}. ` : '';
  const n = neg.length ? `To improve: ${neg.slice(0, 2).join('; ')}.` : 'Well rounded overall.';
  return p + n;
}

interface BetterVars {
  name: string;
  role: string;
  us: string;
  /** Employer relevant to the question ('' when the topic is not about an employer). */
  company: string;
  project: string;
  /** A quantified result that belongs to the project / topic ('' when none is known). */
  metric: string;
  skill: string;
  skills: string;
  school: string;
  projects: string[];
  isStudent: boolean;
}

/** The résumé metric mentioned closest after `anchor` (within ~300 chars), or ''. */
function metricNear(text: string, anchor: string, metrics: readonly string[]): string {
  const at = anchor ? text.indexOf(anchor) : -1;
  if (at < 0) return '';
  let best = '';
  let bestDistance = 300;
  for (const m of metrics) {
    const j = text.indexOf(m.replace(/…$/, ''), at);
    if (j >= at && j - at < bestDistance) {
      best = m;
      bestDistance = j - at;
    }
  }
  return best;
}

function betterVars(facts: ResumeFacts, ctx: EvaluationContext, lang: Lang, cand: TopicCandidate | null): BetterVars {
  const vars = cand?.vars ?? {};
  const skills = skillNames(facts, lang);
  const company = vars.company ?? '';
  const project = vars.project ?? (company || vars.school ? '' : (facts.projects[0] ?? ''));
  return {
    name: facts.name,
    role: inferredRole(ctx.config, facts),
    us: ctx.character.company[lang],
    company,
    project,
    metric: vars.metric ?? metricNear(ctx.config.resumeText, project || company, facts.metrics),
    skill: vars.skill ?? skills[0] ?? '',
    skills: skills.slice(0, 3).join(lang === 'zh' ? '、' : ', '),
    school: vars.school ?? (facts.isStudent ? (facts.schools[0] ?? '') : ''),
    projects: facts.projects.slice(0, 2),
    isStudent: facts.isStudent,
  };
}

type FollowupFocus = 'numbers' | 'personal' | 'why' | 'scale' | 'expand';

function followupFocus(question: string): FollowupFocus {
  if (/十倍|规模|预算|重来|不一样|10x|ten times|scale|budget|differently|again/i.test(question)) return 'scale';
  if (/数据|数字|效果|量化|衡量|指标|结果|numbers?|metric|measure|result|outcome|impact|changed/i.test(question)) return 'numbers';
  if (/你个人|你自己|负责|贡献|亲手|your (?:own )?(?:part|role|contribution)|personally|yourself/i.test(question)) return 'personal';
  if (/为什么|怎么考虑|怎么想|代价|替代|why|alternative|trade-?off|cost of|thinking/i.test(question)) return 'why';
  return 'expand';
}

function followupBetterAnswer(question: string, v: BetterVars, lang: Lang): string {
  const focus = followupFocus(question);
  if (lang === 'zh') {
    switch (focus) {
      case 'numbers':
        return `直接给出数字：之前是【基线】，之后是【结果】${v.metric ? `，比如简历上写的“${v.metric}”` : ''}；再说明是怎么测的（压测、埋点或业务报表），以及它对用户或业务意味着什么。`;
      case 'personal':
        return '明确说“我”做了什么：这件事里我负责【模块或环节】，具体做了【两三件关键的事】，其中【最难的一件】是我独立完成的；团队其他人负责【其他部分】。';
      case 'why':
        return '先讲约束（性能、成本、工期、团队熟悉度），再讲对比过的方案：【方案 A】和【方案 B】，最后说明为什么选它、付出了什么代价，以及在什么情况下会换方案。';
      case 'scale':
        return '先指出现有方案最先出问题的地方（比如数据库、单点或带宽），再给出分步改进：短期用【应急手段】顶住，中期做【架构调整】，同时说明要盯哪些指标来提前发现问题。';
      default:
        return `把刚才的回答展开成一个完整的小故事：一句话背景，一句话你的任务，重点讲两三个具体动作，最后用结果收尾${v.metric ? `（比如“${v.metric}”）` : ''}。`;
    }
  }
  switch (focus) {
    case 'numbers':
      return `Give the numbers directly: it was [baseline] before and [result] after${v.metric ? `, like the "${v.metric}" on your résumé` : ''}. Then explain how it was measured (load tests, analytics, business reports) and what it meant for users or the business.`;
    case 'personal':
      return 'Say clearly what you did: I owned [the module or step], I did [two or three key things], and [the hardest one] I handled on my own, while teammates covered [the other parts].';
    case 'why':
      return 'Start with the constraints (performance, cost, deadline, team familiarity), then the options you compared, [A] and [B], and finish with why you chose one, what it cost, and when you would switch.';
    case 'scale':
      return 'Name where the current design breaks first (database, single point of failure, bandwidth), then give a staged plan: a short-term [stopgap], a medium-term [architecture change], and the metrics you would watch to catch problems early.';
    default:
      return `Turn the answer into a complete mini story: one line of context, one line on your task, two or three concrete actions, and close with the result${v.metric ? ` (e.g. "${v.metric}")` : ''}.`;
  }
}

function betterAnswerZh(cat: Reviewed['category'], v: BetterVars): string {
  const where = v.project ? `做${v.project}时` : v.company ? `在${v.company}的时候` : v.school ? `在${v.school}读书时` : '在上一段经历中';
  const result = v.metric ? `最终${v.metric}` : '最后用数据说明结果（比如耗时降了多少、影响了多少用户）';
  switch (cat) {
    case 'intro':
      return [
        `您好，我是${v.name || '（你的名字）'}。`,
        `${v.company ? `目前在${v.company}工作，` : v.school ? `我毕业于${v.school}，` : ''}这次想应聘${v.role || '这个岗位'}。`,
        v.projects.length ? `我做过${v.projects.join('和')}${v.metric ? `，其中最有代表性的成果是“${v.metric}”。` : '。'}` : v.metric ? `我最有代表性的成果是“${v.metric}”。` : '',
        v.skills ? `我比较擅长${v.skills}。` : '',
        `我很看好${v.us}在这个方向上的机会，希望把这些经验带过来。`,
      ].join('');
    case 'skill':
    case 'jdMatch':
      return `我${where}用${v.skill || '这项技能'}解决过【具体问题】。当时对比过【备选方案】，选它是因为【关键原因】。踩过的坑是【问题】，后来通过【方法】解决，${result}。`;
    case 'jdGap':
      return `我还没在正式项目里用过${v.skill || '这项技能'}，但我${v.project ? `在${v.project}里` : '之前'}积累的${v.skills || '相关经验'}和它是相通的。我的计划是：第一周读文档、做一个小 demo，第二周在真实需求里用起来，并请有经验的同事帮我 review，一个月内独立上手。`;
    case 'teamwork':
      return `${where}，我和同事在【分歧点】上意见不同。我先约他一对一，把双方的目标和顾虑摊开，再用【数据或小实验】验证两种方案，最后选了【方案】，并约定上线后复盘。结果项目按期交付，我们的合作也更顺了。`;
    case 'failure':
      return `${where}，我曾因为【原因】导致【问题】。发现后我第一时间【止损动作】，然后复盘根因，补上了【机制，比如检查清单或自动化测试】。之后同类问题没再出现，这件事让我养成了【习惯】。`;
    case 'design':
    case 'debugging':
    case 'quality':
    case 'scenario':
    case 'prioritize':
      return `先澄清目标和约束（规模、时间、资源），再给出整体方案：【核心思路】。关键取舍是【A 与 B】，我选【A】，因为【原因】。然后讲风险和兜底：【监控、回滚、降级】。最后用经历举证，比如我${where}${v.metric ? `做到了${v.metric}` : '就是这样处理的'}。`;
    case 'motivation':
    case 'career':
    case 'role':
    case 'strengths':
      return `${v.project ? `做${v.project}的经历` : '过去的经历'}让我确定自己想在${v.role ? `${v.role}这个方向` : '这个方向'}深耕。${v.us}吸引我的是【具体的业务或产品点】，这和我擅长的${v.skills || '能力'}很契合。未来三年，我希望先成为团队里【某方面】最靠谱的人，再往【方向】发展。`;
    default:
      return `${where}，我们面临的核心问题是【具体问题】（情境）。我负责【你的任务】（任务），先【关键动作一】，再${v.skill ? `用${v.skill}` : ''}【关键动作二】（行动），${result}（结果）。复盘下来，如果重来我会【改进点】。`;
  }
}

function betterAnswerEn(cat: Reviewed['category'], v: BetterVars): string {
  const where = v.project ? `on ${v.project}` : v.company ? `at ${v.company}` : v.school ? `at ${v.school}` : 'in my last role';
  switch (cat) {
    case 'intro':
      return [
        `Hi, I'm ${v.name || '[your name]'}.`,
        `${v.company ? `I'm currently at ${v.company}, and I'm` : v.school ? `I studied at ${v.school}, and I'm` : "I'm"} applying for ${v.role ? `the ${v.role} role` : 'this position'}.`,
        v.projects.length ? `I've worked on ${v.projects.join(' and ')}${v.metric ? `, and my most representative result is "${v.metric}".` : '.'}` : v.metric ? `My most representative result: "${v.metric}".` : '',
        v.skills ? `My core strengths are ${v.skills}.` : '',
        `I'm excited about what ${v.us} is doing and would love to bring that experience here.`,
      ]
        .filter(Boolean)
        .join(' ');
    case 'skill':
    case 'jdMatch':
      return `Working ${where}, I used ${v.skill || 'it'} to solve [the specific problem]. I compared it with [the alternative] and chose it because [the key reason]. The pitfall I hit was [the issue], which I fixed by [the approach]. ${v.metric ? `The result: ${v.metric}.` : 'Close with a measurable result.'}`;
    case 'jdGap':
      return `I haven't used ${v.skill || 'it'} in production yet, but my experience with ${v.skills || 'related tools'}${v.project ? ` on ${v.project}` : ''} builds on the same ideas. My plan: in week one, read the docs and build a small demo; in week two, use it on a real task with a teammate reviewing my work. I'd expect to be independent within a month.`;
    case 'teamwork':
      return `Working ${where}, a teammate and I disagreed about [the issue]. I set up a one-on-one to lay out both goals and concerns, we tested both options with [data or a small experiment], went with [the option], and agreed to review it after launch. We shipped on time and worked together better afterwards.`;
    case 'failure':
      return `Working ${where}, I caused [the problem] because [the reason]. I immediately [contained it], then dug into the root cause and added [a safeguard like a checklist or automated test]. It hasn't happened again, and it taught me to [the habit].`;
    case 'design':
    case 'debugging':
    case 'quality':
    case 'scenario':
    case 'prioritize':
      return `Start by clarifying goals and constraints (scale, time, resources), then outline the approach: [core idea]. The key trade-off is [A vs B]; I'd pick [A] because [reason]. Cover risks and fallbacks: [monitoring, rollback, degradation]. Then back it with experience, e.g. what I did ${where}${v.metric ? ` (result: ${v.metric})` : ''}.`;
    case 'motivation':
    case 'career':
    case 'role':
    case 'strengths':
      return `${v.project ? `Working on ${v.project}` : 'My experience so far'} convinced me I want to go deep ${v.role ? `as a ${v.role}` : 'in this field'}. What draws me to ${v.us} is [a specific product or business point], which fits my strengths in ${v.skills || 'this area'}. In three years I want to be the go-to person for [area], then grow toward [direction].`;
    default:
      return `Situation: ${where}, the core problem was [the specific issue]. Task: I was responsible for [your part]. Action: I first [key step one], then ${v.skill ? `used ${v.skill} to ` : ''}[key step two]. Result: ${v.metric ? `${v.metric}.` : '[a measurable outcome].'} Looking back, I would [one improvement].`;
  }
}

function betterAnswer(r: Reviewed, v: BetterVars, lang: Lang): string {
  if (r.pair.kind === 'followup') return followupBetterAnswer(r.pair.question, v, lang);
  return lang === 'zh' ? betterAnswerZh(r.category, v) : betterAnswerEn(r.category, v);
}

// ───────────── dimensions, strengths, summary ─────────────

const DIM_COMMENTS: Record<DimensionKey, Record<Lang, [string, string, string]>> = {
  communication: {
    zh: ['表达清晰流畅，结构感强，听起来很舒服。', '表达基本清楚，个别回答可以更有条理。', '回答偏短或偏散，建议先说结论再展开。'],
    en: ['Clear, fluent and well structured — easy to follow.', 'Mostly clear; a few answers could be better organised.', 'Answers were short or scattered; lead with the conclusion, then expand.'],
  },
  expertise: {
    zh: ['专业细节扎实，能说出具体的方法和取舍。', '专业基础不错，但深度还可以再挖。', '专业细节较少，需要用具体的技术或方法来证明能力。'],
    en: ['Solid professional depth with concrete methods and trade-offs.', 'Good foundations, but depth could go further.', 'Few professional details; prove your skills with specific methods or tools.'],
  },
  logic: {
    zh: ['思路严谨，能解释每个决定背后的原因。', '逻辑基本连贯，部分回答缺少“为什么”。', '回答跳跃，缺少因果和推理过程。'],
    en: ['Rigorous thinking; you explain the why behind decisions.', 'Mostly coherent, though some answers skip the why.', 'Answers jump around without cause and effect.'],
  },
  impact: {
    zh: ['善于用数据说明成果，影响力清晰可见。', '提到了一些成果，但量化还不够。', '成果不清楚，缺少可以衡量的结果。'],
    en: ['Results are quantified and the impact is clear.', 'Some results, but not enough numbers.', 'Unclear outcomes with nothing measurable.'],
  },
  fit: {
    zh: ['和岗位、团队的契合度很高，面试官印象很好。', '与岗位基本匹配，动机可以讲得更具体。', '与岗位的匹配度还不够明确，需要更好地说明动机。'],
    en: ['Strong fit with the role and team; a very good impression.', 'A reasonable fit; your motivation could be more specific.', 'Fit with the role is unclear; explain your motivation better.'],
  },
};

function dimComment(key: DimensionKey, score: number, lang: Lang): string {
  const [hi, mid, lo] = DIM_COMMENTS[key][lang];
  return score >= 75 ? hi : score >= 55 ? mid : lo;
}

const VERDICT: Record<EndingId, Record<Lang, string>> = {
  perfect: { zh: '这是一场非常出色的面试。', en: 'This was an outstanding interview.' },
  offer: { zh: '整体表现良好，达到了录用标准。', en: 'A good performance that meets the hiring bar.' },
  pending: { zh: '表现有亮点也有短板，处在录用边缘。', en: 'There were highlights and gaps; this is a borderline result.' },
  rejected: { zh: '这次表现和岗位要求还有一定差距。', en: 'This performance fell short of what the role needs.' },
};

const DIM_NAMES: Record<DimensionKey, Record<Lang, string>> = {
  communication: { zh: '沟通表达', en: 'communication' },
  expertise: { zh: '专业能力', en: 'expertise' },
  logic: { zh: '逻辑思维', en: 'logic' },
  impact: { zh: '成果影响', en: 'impact' },
  fit: { zh: '岗位匹配', en: 'role fit' },
};

function shortQuestion(q: string, lang: Lang): string {
  return truncate(splitSentences(q).find((s) => /[?？]/.test(s)) ?? q, lang === 'zh' ? 24 : 60);
}

export function buildDemoReport(ctx: EvaluationContext): InterviewReport {
  const { config, character, plan, transcript, scores, affinity } = ctx;
  const lang = config.lang;
  const zh = lang === 'zh';
  const facts = extractResumeFacts(config.resumeText, lang);
  const candidates = buildTopicCandidates(config, character, facts);
  const qa = pairQuestionsAndAnswers(transcript, scores);
  const rng = createRng(hashString(`${plan.opening.speech}|report|${transcript.length}`));

  const reviewed: Reviewed[] = qa.map((pair) => {
    const a = analyzeAnswer(pair.answer, lang, { difficulty: config.difficulty, strictness: character.strictness });
    const topic = pair.topicIndex !== null ? plan.topics[pair.topicIndex] : undefined;
    const cand = findCandidate(topic, candidates);
    const category: Reviewed['category'] = pair.kind === 'opening' ? 'intro' : (cand?.category ?? 'custom');
    return { pair, a, score: Math.round(clamp(pair.score ?? (pair.skipped ? 0 : a.score), 0, 10)), category };
  });

  const polish = (text: string) => (zh ? padCjkLatin(text) : text);
  const questionReviews: QuestionReview[] = reviewed.map((r) => {
    const topic = r.pair.topicIndex !== null ? plan.topics[r.pair.topicIndex] : undefined;
    const cand = r.pair.kind === 'opening' ? null : findCandidate(topic, candidates);
    const v = betterVars(facts, ctx, lang, cand);
    if (r.pair.kind === 'opening') {
      v.company = facts.companies[0] ?? '';
      // "Most representative result": one from the work / project history, not the first number found.
      v.metric = metricNear(config.resumeText, facts.companies[0] || facts.projects[0] || '', facts.metrics) || facts.metrics[0] || '';
    }
    const firstSentence = splitSentences(r.pair.answer)[0] ?? '';
    return {
      question: reviewQuestionLabel(r.pair, lang),
      answerSummary: r.pair.skipped || !r.pair.answer ? (zh ? '（未作答）' : '(No answer)') : truncate(firstSentence || r.pair.answer, zh ? 60 : 120),
      score: r.score,
      feedback: polish(feedbackFor(r, lang)),
      betterAnswer: polish(betterAnswer(r, v, lang)),
    };
  });

  // Same base as the LLM evaluator (engine/scoring): answers averaged per topic (follow-ups on a weak
  // topic don't count it two or three times) and mapped through the rubric curve (7 ≈ 75).
  const reference = referenceOverall(scores, transcript);
  const base = reference ?? 50;
  const skipRate = reviewed.length ? reviewed.filter((r) => r.pair.skipped).length / reviewed.length : 0;
  const goodLen = share(reviewed, (r) => r.a.lengthBand === 'medium' || r.a.lengthBand === 'long');
  const structured = share(reviewed, (r) => r.a.structureHits >= 1);
  const reasoning = share(reviewed, (r) => r.a.hasReasoning);
  const tech = share(reviewed, (r) => r.a.techTerms.length > 0);
  const numbers = share(reviewed, (r) => r.a.numbers.length > 0);
  const results = share(reviewed, (r) => r.a.hasResult);
  const personal = share(reviewed, (r) => r.a.hasPersonal);
  const reverseCount = countReverseQuestions(transcript);

  const dimScore: Record<DimensionKey, number> = {
    communication: base + 12 * (goodLen - 0.5) + 10 * (structured - 0.3) - 15 * skipRate,
    expertise: base + 14 * (tech - 0.35),
    logic: base + 12 * (reasoning - 0.3) + 6 * (structured - 0.3),
    impact: base + 16 * (numbers - 0.3) + 8 * (results - 0.4),
    fit: 0.55 * base + 0.45 * affinity + 3 * Math.min(2, reverseCount),
  };
  const dimensions = DIMENSION_KEYS.map((key) => {
    const score = Math.round(clamp(dimScore[key], 5, 98));
    return { key, score, comment: dimComment(key, score, lang) };
  });
  const dimMean = dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length;
  // Then aligned exactly like the LLM report: within ±15 of the reference and inside the band of the
  // ending the per-answer scores project, so identical in-interview scores give identical endings.
  const overallScore = alignOverallScore(Math.round(clamp(0.8 * base + 0.2 * dimMean, 0, 100)), {
    reference,
    affinity,
    ending: qa.length ? projectedEnding(scores, affinity, transcript) : null,
  });
  const ending = computeEnding(computeFinalScore(overallScore, affinity), affinity);

  // Strengths & improvements.
  const answered = reviewed.filter((r) => !r.pair.skipped);
  const best = [...answered].sort((x, y) => y.score - x.score)[0];
  const worst = [...reviewed].sort((x, y) => x.score - y.score)[0];
  const strengths: string[] = [];
  const improvements: string[] = [];
  const S = (cond: boolean, zhText: string, enText: string, list: string[]) => {
    if (cond) list.push(zh ? zhText : enText);
  };
  S(numbers >= 0.4, '善于用数据说明成果，说服力强。', 'You back up results with numbers, which is persuasive.', strengths);
  S(personal >= 0.5, '能讲清楚自己的具体贡献，而不是躲在团队后面。', 'You make your own contribution clear instead of hiding behind the team.', strengths);
  S(tech >= 0.4, '专业细节扎实，能说出具体的方法和工具。', 'Solid professional detail with concrete methods and tools.', strengths);
  S(structured >= 0.4, '表达有条理，结构清晰。', 'Well-organised, structured answers.', strengths);
  S(reasoning >= 0.4, '能解释决策背后的原因和取舍。', 'You explain the reasoning and trade-offs behind decisions.', strengths);
  S(reverseCount >= 2, '反问环节提问积极，体现了对岗位的兴趣。', 'Engaged questions at the end showed real interest in the role.', strengths);
  if (best && best.score >= 6) strengths.push(zh ? `“${shortQuestion(best.pair.question, lang)}”这道题答得最好。` : `Your best answer was to "${shortQuestion(best.pair.question, lang)}".`);
  S(numbers < 0.3, '多用数据量化结果，比如提升了多少、影响了多少用户。', 'Quantify results more: how much improved, how many users were affected.', improvements);
  S(personal < 0.4, '多讲你亲手做的事，用“我”而不是“我们”。', 'Talk about what you did yourself — say "I", not just "we".', improvements);
  S(goodLen < 0.5, '回答普遍偏短，可以用 STAR 结构展开。', 'Answers were often short; expand them with the STAR structure.', improvements);
  S(share(reviewed, (r) => r.a.lengthBand === 'rambling') > 0.3, '回答可以更精炼，先说结论再展开。', 'Be more concise: conclusion first, then details.', improvements);
  S(share(reviewed, (r) => r.a.vagueHits >= 2) > 0.3, '减少“大概”“可能”这类模糊说法。', 'Cut down on hedges like "maybe" and "kind of".', improvements);
  S(skipRate > 0, '尽量不要跳过问题，哪怕先说说思路。', "Avoid skipping questions; share your thinking even if you're unsure.", improvements);
  S(reverseCount === 0, '反问环节可以准备一两个有深度的问题。', 'Prepare one or two thoughtful questions for the end of the interview.', improvements);
  if (worst && worst.score <= 5) improvements.push(zh ? `重点准备“${shortQuestion(worst.pair.question, lang)}”这类问题。` : `Prepare for questions like "${shortQuestion(worst.pair.question, lang)}".`);
  if (strengths.length === 0) strengths.push(zh ? '态度认真，完整地完成了整场面试。' : 'You stayed engaged and completed the whole interview.');
  if (improvements.length === 0) improvements.push(zh ? '可以在回答里多加入对业务影响的思考。' : 'Add more thinking about business impact to your answers.');

  const sorted = [...dimensions].sort((x, y) => y.score - x.score);
  const strong = sorted.slice(0, 2).map((d) => DIM_NAMES[d.key][lang]);
  const weak = sorted[sorted.length - 1];
  const answeredCount = answered.length;
  const skippedCount = reviewed.length - answeredCount;
  const summary = zh
    ? `${VERDICT[ending].zh}亮点在于${strong.join('和')}，${DIM_NAMES[weak.key].zh}方面还有提升空间。整场共回答了 ${answeredCount} 道题${skippedCount ? `，跳过 ${skippedCount} 道` : ''}，面试官的最终好感度为 ${affinity}。${improvements[0]}`
    : `${VERDICT[ending].en} Your strongest areas were ${strong.join(' and ')}, while ${DIM_NAMES[weak.key].en} has the most room to grow. You answered ${answeredCount} question${answeredCount === 1 ? '' : 's'}${skippedCount ? ` and skipped ${skippedCount}` : ''}, and the interviewer's final impression was ${affinity}/100. ${improvements[0]}`;

  const lines = CHARACTER_LINES[character.id];
  return {
    overallScore,
    dimensions,
    strengths: strengths.slice(0, 4).map(polish),
    improvements: improvements.slice(0, 4).map(polish),
    questionReviews,
    summary: polish(summary),
    finalMessage: rng.pick(lines.finalMessages[ending][lang]),
  };
}

/** In-character parting words for an ending (used as a fallback by the LLM interviewer). */
export function demoFinalMessage(characterId: EvaluationContext['character']['id'], ending: EndingId, lang: Lang): string {
  return CHARACTER_LINES[characterId].finalMessages[ending][lang][0];
}
