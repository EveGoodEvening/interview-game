/**
 * Offline interview planning: turns résumé facts into grounded topics and an in-character opening.
 *
 * `buildTopicCandidates` is deterministic for a given (résumé, config), so the demo turn logic can
 * re-derive a topic's category and placeholders from its title — even after resuming an autosave
 * with a fresh AI instance. Only the *selection* and phrasing vary between sessions (seeded RNG).
 */
import type { CharacterDef, InterviewConfig, InterviewPlan, InterviewStyle, Lang, PlanTopic } from '../../types';
import { padCjkLatin, truncate } from '../../engine/text';
import { fitTopics } from '../schemas';
import { genericTopicsFor } from '../genericTopics';
import { findSkills, skillDisplay } from './lexicon';
import { CHARACTER_LINES, type QuestionCategory } from './lines';
import { type Rng, fill } from './random';
import { type ResumeFacts, extractResumeFacts, skillNames } from './resumeFacts';

export interface TopicCandidate extends PlanTopic {
  category: QuestionCategory;
  /** Placeholder values for question templates. */
  vars: Record<string, string>;
}

const NON_TECH_SWAP: Partial<Record<QuestionCategory, QuestionCategory>> = {
  design: 'prioritize',
  debugging: 'challenge',
  quality: 'ownership',
};

const SLOTS: Record<InterviewStyle, QuestionCategory[]> = {
  technical: ['project', 'skill', 'metric', 'design', 'project', 'debugging', 'skill', 'company', 'quality', 'learning', 'prioritize', 'teamwork', 'challenge', 'career'],
  behavioral: ['project', 'teamwork', 'company', 'challenge', 'metric', 'failure', 'pressure', 'learning', 'ownership', 'strengths', 'motivation', 'career', 'proudest'],
  mixed: ['project', 'teamwork', 'skill', 'scenario', 'metric', 'challenge', 'company', 'design', 'ownership', 'learning', 'motivation', 'career', 'failure'],
};

/** Categories that read best at the end of an interview. */
const LATE: ReadonlySet<QuestionCategory> = new Set(['motivation', 'career', 'strengths']);

function shortLabel(text: string, lang: Lang): string {
  return truncate(text.replace(/[，,。；;].*$/, ''), lang === 'zh' ? 14 : 36);
}

function jdSkills(config: InterviewConfig, facts: ResumeFacts, lang: Lang): { match: string[]; gap: string[] } {
  if (!config.jobDescription.trim()) return { match: [], gap: [] };
  const inJd = findSkills(config.jobDescription);
  const have = new Set(facts.skills.map((s) => s.name));
  return {
    match: inJd.filter((s) => have.has(s.name)).map((s) => skillDisplay(s, lang)),
    gap: inJd.filter((s) => !have.has(s.name)).map((s) => skillDisplay(s, lang)),
  };
}

/** The role named by the player or found on the résumé ('' when unknown). */
export function inferredRole(config: InterviewConfig, facts: ResumeFacts): string {
  return config.targetRole.trim() || facts.role;
}

/** Role label for the plan (never empty). */
export function targetRoleFor(config: InterviewConfig, facts: ResumeFacts): string {
  return inferredRole(config, facts) || (config.lang === 'zh' ? '综合岗位' : 'General position');
}

/** Every topic the demo could ask for this résumé, in a deterministic order. */
export function buildTopicCandidates(config: InterviewConfig, character: CharacterDef, facts: ResumeFacts): TopicCandidate[] {
  const lang = config.lang;
  const zh = lang === 'zh';
  const role = inferredRole(config, facts);
  const base = { us: character.company[lang], role: role || (zh ? '这个岗位' : 'this role') };
  const out: TopicCandidate[] = [];
  const add = (category: QuestionCategory, title: string, goal: string, vars: Record<string, string> = {}) => {
    if (!out.some((c) => c.title === title)) out.push({ category, title, goal, vars: { ...base, ...vars, title } });
  };

  for (const p of facts.projects.slice(0, 3)) {
    add('project', zh ? `项目深挖：${p}` : `Deep dive: ${p}`, zh ? '了解候选人在项目中的个人贡献、关键决策与结果' : 'Understand their personal contribution, key decisions and results in the project', { project: p });
  }
  for (const m of facts.metrics.slice(0, 2)) {
    add('metric', zh ? `成果背后：${shortLabel(m, lang)}` : `Behind the numbers: ${shortLabel(m, lang)}`, zh ? '验证量化成果是怎么做到、怎么衡量的' : 'Verify how the quantified result was achieved and measured', { metric: m });
  }
  const skills = [...skillNames(facts, lang, true), ...skillNames(facts, lang).filter((s) => !skillNames(facts, lang, true).includes(s))];
  for (const s of skills.slice(0, 3)) {
    add('skill', zh ? `${s} 实战` : `Hands-on ${s}`, zh ? `考察对 ${s} 的掌握深度和实际运用` : `Assess depth and real-world use of ${s}`, { skill: s });
  }
  for (const c of facts.companies.slice(0, 2)) {
    add('company', zh ? `在${c}的经历` : `Your time at ${c}`, zh ? '了解候选人在这段经历中面对的挑战和成长' : 'Learn about the challenges they faced and how they grew there', { company: c });
  }
  if (facts.schools[0]) {
    add('school', zh ? `在${facts.schools[0]}的学习与实践` : `Studies at ${facts.schools[0]}`, zh ? '了解候选人的专业基础和投入程度' : 'Understand their foundations and what they invested in', { school: facts.schools[0] });
  }
  const jd = jdSkills(config, facts, lang);
  for (const s of jd.match.slice(0, 2)) {
    add('jdMatch', zh ? `岗位要求：${s}` : `Role requirement: ${s}`, zh ? `考察候选人在 ${s} 上与岗位要求的匹配度` : `Check how well their ${s} experience matches the role`, { skill: s });
  }
  for (const s of jd.gap.slice(0, 1)) {
    add('jdGap', zh ? `能力补齐：${s}` : `Closing the gap: ${s}`, zh ? `了解候选人如何补上 ${s} 方面的差距` : `See how they would close the gap in ${s}`, { skill: s });
  }
  if (facts.isThin) add('thin', zh ? '最有代表性的一段经历' : 'Your most representative experience', zh ? '让候选人自己挑经历，挖出真实能力' : 'Let them pick an experience and dig out real ability');
  if (role) add('role', zh ? `对${role}的理解` : `What makes a great ${role}`, zh ? '考察对岗位的认知和自我定位' : 'Assess understanding of the role and self-positioning', { role });
  add('scenario', zh ? '情景模拟' : 'A hypothetical scenario', zh ? '考察在不确定情况下的思考和决策' : 'Assess thinking and decisions under uncertainty');
  for (const g of genericTopicsFor(config.style, lang)) add(g.id, g.title, g.goal);
  return out;
}

function slotPlan(config: InterviewConfig, character: CharacterDef, facts: ResumeFacts, rng: Rng): QuestionCategory[] {
  let slots = [...SLOTS[config.style]];
  if (!facts.isTech) slots = slots.map((s) => NON_TECH_SWAP[s] ?? s);
  if (facts.isStudent) slots = slots.map((s) => (s === 'company' ? 'school' : s));
  if (config.jobDescription.trim()) {
    slots.splice(1, 0, 'jdMatch');
    slots.splice(3, 0, 'jdGap');
  }
  if (facts.isThin) {
    slots.unshift('thin');
    slots.splice(2, 0, 'role');
  }
  // Signature topics per character.
  const signature: Record<CharacterDef['id'], QuestionCategory[]> = {
    yuki: ['motivation', 'teamwork'],
    ethan: facts.isTech ? ['design', 'scenario'] : ['prioritize'],
    haru: ['scenario', 'ownership'],
  };
  for (const sig of signature[character.id]) {
    if (!slots.slice(0, config.mainQuestions).includes(sig)) slots.splice(Math.min(slots.length, 2 + rng.int(Math.max(1, config.mainQuestions - 2))), 0, sig);
  }
  // A little variety: swap two adjacent middle slots.
  if (slots.length > 4 && rng.chance(0.6)) {
    const i = 1 + rng.int(slots.length - 3);
    [slots[i], slots[i + 1]] = [slots[i + 1], slots[i]];
  }
  return slots;
}

/** Pick `config.mainQuestions` topics for this session. */
export function chooseTopics(config: InterviewConfig, character: CharacterDef, facts: ResumeFacts, rng: Rng): TopicCandidate[] {
  const candidates = buildTopicCandidates(config, character, facts);
  const pools = new Map<QuestionCategory, TopicCandidate[]>();
  for (const c of candidates) {
    const pool = pools.get(c.category) ?? [];
    pool.push(c);
    pools.set(c.category, pool);
  }
  // Vary which project / skill / … comes up, but usually keep the strongest one (listed first).
  for (const [cat, pool] of pools) {
    if (pool.length < 2) continue;
    const [first, ...rest] = pool;
    const shuffled = rng.shuffle(rest);
    pools.set(cat, rng.chance(0.7) ? [first, ...shuffled] : [shuffled[0], first, ...shuffled.slice(1)]);
  }

  const chosen: TopicCandidate[] = [];
  for (const cat of slotPlan(config, character, facts, rng)) {
    if (chosen.length >= config.mainQuestions) break;
    const next = pools.get(cat)?.find((c) => !chosen.includes(c));
    if (next) chosen.push(next);
  }
  for (const c of candidates) {
    if (chosen.length >= config.mainQuestions) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  // Keep the first topic résumé-grounded; move reflective topics to the end.
  const early = chosen.filter((c) => !LATE.has(c.category));
  const late = chosen.filter((c) => LATE.has(c.category));
  return [...early, ...late].slice(0, config.mainQuestions);
}

/** Find the candidate for a plan topic (by title), or null for topics that came from elsewhere. */
export function findCandidate(topic: PlanTopic | undefined, candidates: readonly TopicCandidate[]): TopicCandidate | null {
  if (!topic) return null;
  return candidates.find((c) => c.title === topic.title) ?? null;
}

function greeting(facts: ResumeFacts, lang: Lang): string {
  if (lang === 'zh') return facts.name ? `${facts.name}你好` : '你好';
  const first = facts.name.split(/\s+/)[0];
  return first ? `Hi ${first}` : 'Hi there';
}

function hookLine(character: CharacterDef, facts: ResumeFacts, lang: Lang, rng: Rng): string {
  const hooks = CHARACTER_LINES[character.id].hooks[lang];
  const options: string[] = [];
  if (facts.projects[0]) options.push(...hooks.project.map((h) => fill(h, { project: facts.projects[0] })));
  if (facts.companies[0]) options.push(...hooks.company.map((h) => fill(h, { company: facts.companies[0] })));
  if (facts.schools[0]) options.push(...hooks.school.map((h) => fill(h, { school: facts.schools[0] })));
  if (facts.skills.length >= 4) options.push(...hooks.skill);
  const usable = options.filter(Boolean);
  if (usable.length === 0 || rng.chance(0.2)) return '';
  return rng.pick(usable);
}

function summaryFor(facts: ResumeFacts, role: string, lang: Lang): string {
  const skills = skillNames(facts, lang).slice(0, 3);
  if (lang === 'zh') {
    const parts = [
      `候选人应聘${role}`,
      facts.companies.length ? `有${facts.companies.slice(0, 2).join('、')}的经历` : facts.isStudent ? '以在校和实习经历为主' : '',
      skills.length ? `技能集中在${skills.join('、')}` : '',
    ].filter(Boolean);
    const tail = facts.isThin ? '简历信息较少，需要多追问细节。' : facts.metrics.length ? '简历中有量化成果，值得逐一验证。' : '简历缺少量化成果，需要追问实际效果。';
    return `${parts.join('，')}。${tail}`;
  }
  const parts = [
    `Candidate for ${role}`,
    facts.companies.length ? `with experience at ${facts.companies.slice(0, 2).join(' and ')}` : facts.isStudent ? 'mostly with academic and internship experience' : '',
    skills.length ? `skills centred on ${skills.join(', ')}` : '',
  ].filter(Boolean);
  const tail = facts.isThin ? 'The résumé is thin, so I need to dig for details.' : facts.metrics.length ? 'There are quantified results worth verifying.' : 'Results are not quantified; I need to probe the real impact.';
  return `${parts.join(', ')}. ${tail}`;
}

function concernsFor(config: InterviewConfig, facts: ResumeFacts, lang: Lang): string[] {
  const zh = lang === 'zh';
  const out: string[] = [];
  if (!facts.metrics.length) out.push(zh ? '成果缺少量化数据' : 'Results lack numbers');
  if (facts.isThin) out.push(zh ? '简历信息较少' : 'Very little detail on the résumé');
  if (facts.skills.length >= 6 && facts.projects.length <= 1) out.push(zh ? '技能列表较长，但缺少项目佐证' : 'Long skill list with little project evidence');
  if (facts.isStudent) out.push(zh ? '实际工作经验有限' : 'Limited professional experience');
  const gap = jdSkills(config, facts, lang).gap[0];
  if (gap) out.push(zh ? `职位要求的${gap}在简历中没有体现` : `No evidence of ${gap}, which the role requires`);
  return out.slice(0, 3);
}

function highlightsFor(facts: ResumeFacts, lang: Lang): string[] {
  const zh = lang === 'zh';
  const out: string[] = [];
  if (facts.projects[0]) out.push(zh ? `项目：${facts.projects[0]}` : `Project: ${facts.projects[0]}`);
  if (facts.metrics[0]) out.push(zh ? `成果：${facts.metrics[0]}` : `Result: ${facts.metrics[0]}`);
  if (facts.companies[0]) out.push(zh ? `经历：${facts.companies[0]}` : `Experience: ${facts.companies[0]}`);
  const skills = skillNames(facts, lang).slice(0, 3);
  if (skills.length) out.push(zh ? `技能：${skills.join('、')}` : `Skills: ${skills.join(', ')}`);
  return out.slice(0, 4);
}

export function buildDemoPlan(config: InterviewConfig, character: CharacterDef, rng: Rng): InterviewPlan {
  const lang = config.lang;
  const facts = extractResumeFacts(config.resumeText, lang);
  const lines = CHARACTER_LINES[character.id];
  const topics = fitTopics(
    chooseTopics(config, character, facts, rng).map(({ title, goal }) => ({ title, goal })),
    config.mainQuestions,
    config,
  );
  const opening = fill(rng.pick(lines.openings[lang]), { hi: greeting(facts, lang), hook: hookLine(character, facts, lang, rng) });
  return {
    candidateName: facts.name,
    targetRole: targetRoleFor(config, facts),
    summary: summaryFor(facts, targetRoleFor(config, facts), lang),
    highlights: highlightsFor(facts, lang),
    concerns: concernsFor(config, facts, lang),
    topics,
    opening: { speech: (lang === 'zh' ? padCjkLatin(opening) : opening).replace(/\s{2,}/g, ' ').trim(), expression: lines.expressions.main[0] },
  };
}
