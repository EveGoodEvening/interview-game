/**
 * Heuristic résumé reader for the offline interviewer: pulls out the name, role, skills,
 * employers, schools, project names and quantified results (zh + en résumés).
 */
import type { Lang } from '../../types';
import { countCjk, truncate } from '../../engine/text';
import { KNOWN_COMPANIES, type FieldId, type SkillTerm, findSkills, skillDisplay } from './lexicon';

export interface ResumeFacts {
  name: string;
  /** Explicit or inferred target role in the interview language ('' when unknown). */
  role: string;
  field: FieldId;
  skills: SkillTerm[];
  companies: string[];
  schools: string[];
  projects: string[];
  /** Short clauses with numbers, e.g. "接口 P99 延迟降低 40%". */
  metrics: string[];
  years: number | null;
  isTech: boolean;
  isStudent: boolean;
  /** Very little usable content. */
  isThin: boolean;
}

const HEADING_RE =
  /^(个人信息|基本信息|求职意向|教育(背景|经历)|工作(经历|经验)|实习(经历|经验)|项目(经历|经验)|个人项目|专业技能|技能|技术栈|自我评价|个人评价|获奖|荣誉|证书|校园经历|社团|summary|profile|objective|education|(work )?experience|employment|internships?|projects?|(selected|personal|side) projects|skills|technical skills|awards|certifications|activities|publications|languages)\s*[:：]?$/i;
const PROJECT_HEADING_RE = /^(项目(经历|经验)|个人项目|主要项目|projects?|(selected|personal|side|key) projects|project experience)\s*[:：]?$/i;
const DATE_RANGE_RE = /(19|20)\d{2}\s*[./年-]?\s*\d{0,2}\s*月?\s*[-–—~至到]+\s*((19|20)\d{2}|至今|现在|今|present|now|current)/i;

const ROLE_FROM_FIELD: Record<FieldId, Record<Lang, string>> = {
  frontend: { zh: '前端开发工程师', en: 'Frontend Engineer' },
  backend: { zh: '后端开发工程师', en: 'Backend Engineer' },
  mobile: { zh: '移动端开发工程师', en: 'Mobile Engineer' },
  data: { zh: '数据分析师', en: 'Data Analyst' },
  ai: { zh: '算法工程师', en: 'Machine Learning Engineer' },
  devops: { zh: '运维开发工程师', en: 'DevOps Engineer' },
  game: { zh: '游戏开发工程师', en: 'Game Developer' },
  product: { zh: '产品经理', en: 'Product Manager' },
  design: { zh: '设计师', en: 'Designer' },
  marketing: { zh: '市场营销专员', en: 'Marketing Specialist' },
  operations: { zh: '运营专员', en: 'Operations Specialist' },
  sales: { zh: '销售经理', en: 'Sales Manager' },
  finance: { zh: '财务分析师', en: 'Financial Analyst' },
  hr: { zh: '人力资源专员', en: 'HR Specialist' },
  education: { zh: '教师', en: 'Teacher' },
  general: { zh: '', en: '' },
};

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function uniq(items: string[], max: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item || out.some((o) => o.toLowerCase() === item.toLowerCase() || o.includes(item) || item.includes(o))) continue;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function extractName(ls: string[], text: string): string {
  const labelled = /(?:姓\s*名|name)\s*[:：]\s*([^\s|,，/]{2,24}(?:\s[A-Z][a-z]+)?)/i.exec(text);
  if (labelled) return labelled[1].trim();
  for (const l of ls.slice(0, 3)) {
    const compact = l.replace(/\s+/g, '');
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(compact) && !/简历|履历|个人|求职|资料/.test(compact)) return compact;
    if (/^[A-Z][a-z]+(?:[ -][A-Z][a-z.]+){1,2}$/.test(l) && !/resume|curriculum|vitae|profile/i.test(l)) return l;
    const head = /^([\u4e00-\u9fa5]{2,4})\s*[|｜·，,]/.exec(l);
    if (head) return head[1];
  }
  return '';
}

function extractRole(ls: string[], text: string, lang: Lang, field: FieldId): string {
  const zh = /(?:求职意向|应聘(?:岗位|职位)|意向(?:岗位|职位)|目标(?:岗位|职位)|期望职位)\s*[:：]?\s*([^\n|,，;；/]{2,20})/.exec(text);
  if (zh) return zh[1].trim();
  const en = /(?:objective|target role|desired position|position)\s*[:：]\s*([^\n|;]{2,40})/i.exec(text);
  if (en) return en[1].trim().replace(/\.$/, '');
  for (const l of ls.slice(0, 6)) {
    const m =
      /^(?:(?:senior|junior|lead|staff|principal)\s+)?[A-Za-z/+ -]{0,30}(?:engineer|developer|designer|manager|analyst|scientist|specialist|consultant|marketer|writer|teacher|architect)\b/i.exec(l) ??
      /([\u4e00-\u9fa5A-Za-z+]{2,10}(?:工程师|开发|经理|设计师|分析师|专员|架构师|顾问|运营))/.exec(l);
    if (m && l.length <= 40 && !DATE_RANGE_RE.test(l)) return (m[1] ?? m[0]).trim();
  }
  return ROLE_FROM_FIELD[field][lang];
}

/** A line read as a section heading: decorations such as 【】, [], ■, ##, **…** and a trailing colon removed. */
function headingText(l: string): string {
  return l
    .replace(/^(?:\*\*|[\s#=_【[〔〖『「■□◆◇▶►▌])+/, '')
    .replace(/(?:\*\*|[\s#=_】\]〕〗』」■□◆◇◀◄▌:：])+$/, '')
    .trim();
}

/** For each line: true when it sits inside a "Projects" section (headings themselves are false). */
function projectSectionLines(ls: string[]): boolean[] {
  let inSection = false;
  return ls.map((l) => {
    const heading = headingText(l);
    if (PROJECT_HEADING_RE.test(heading)) {
      inSection = true;
      return false;
    }
    if (HEADING_RE.test(heading)) {
      inSection = false;
      return false;
    }
    return inSection;
  });
}

const ROLE_WORD_RE =
  /(工程师|开发|实习|经理|专员|设计师|分析师|架构师|顾问|运营|主管|总监|助理|负责人|engineer|developer|intern|manager|designer|analyst|scientist|specialist|consultant|lead|director|associate)/i;
const EDU_WORD_RE = /(大学|学院|学校|university|college|institute|school|本科|硕士|博士|bachelor|master|b\.s\.|m\.s\.)/i;

/** Lines that look like "date range + employer + title" headers. */
function isExperienceLine(l: string): boolean {
  return l.length <= 90 && !EDU_WORD_RE.test(l) && (DATE_RANGE_RE.test(l) || /\b(19|20)\d{2}\b|summer|至今/i.test(l)) && ROLE_WORD_RE.test(l);
}

function companyFromExperienceLine(l: string): string | null {
  const rest = l.replace(DATE_RANGE_RE, ' ').replace(/(19|20)\d{2}(\.\d{1,2})?|summer|spring|fall|winter|present|至今/gi, ' ');
  const segments = rest.split(/\s[—–-]\s|\s*[|｜]\s*|,\s|，|\s{2,}|\s(?=[\u4e00-\u9fa5])|(?<=[\u4e00-\u9fa5])\s/);
  for (const seg of segments) {
    const s = seg.trim().replace(/^[-–—:：·]+|[-–—:：·]+$/g, '').trim();
    if (s.length < 2 || s.length > 30 || ROLE_WORD_RE.test(s) || /^\d/.test(s)) continue;
    if (/^[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z&][A-Za-z0-9&.'-]*){0,3}$/.test(s) || /^[\u4e00-\u9fa5A-Za-z0-9（）()]{2,16}$/.test(s)) return s;
  }
  return null;
}

function extractCompanies(ls: string[], inProjects: boolean[]): string[] {
  const found: string[] = [];
  const strong = /([\u4e00-\u9fa5A-Za-z]{2,12}?(?:有限公司|股份公司|集团|公司|银行|证券|研究院|工作室))(?!大学|学院)|\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3},?\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Technologies|Labs|GmbH))/g;
  for (const [i, l] of ls.entries()) {
    // A project title line ("青柚集市 —— … 项目负责人  2023.10 – 2024.05") is not an employer.
    const exp = !inProjects[i] && isExperienceLine(l);
    if (exp) {
      for (const c of KNOWN_COMPANIES) {
        const re = /^[A-Za-z]/.test(c) ? new RegExp(`(?<![A-Za-z])${c}(?![A-Za-z])`) : new RegExp(c);
        if (re.test(l)) found.push(c);
      }
    }
    for (const m of l.matchAll(strong)) {
      const name = (m[1] ?? m[2] ?? '')
        .replace(/^(负责|参与|协助|帮助|服务|为|给|帮|在|于|就职于|任职于|曾在|加入|入职)+/, '')
        .replace(/,$/, '')
        .trim();
      if (name.length >= 4 && !/^(所在|本|该|一家|我们|这家|那家|全|分|子)/.test(name)) found.push(name);
    }
    if (exp) {
      const guess = companyFromExperienceLine(l);
      if (guess) found.push(guess);
    }
  }
  return uniq(found, 4);
}

function extractSchools(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([\u4e00-\u9fa5]{2,12}(?:大学|学院))/g)) {
    const name = m[1].replace(/^(毕业于|就读于|本科|硕士|博士|我在|在)/, '');
    if (name.length >= 4 && !/^(大学|学院)/.test(name)) out.push(name);
  }
  for (const m of text.matchAll(/(University of [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2}|(?:[A-Z][A-Za-z.&'-]+ +){1,4}(?:University|College|Institute of Technology))/g)) {
    out.push(m[1].replace(/,$/, '').trim());
  }
  return uniq(out, 3);
}

function cleanProjectName(raw: string): string {
  return raw
    .replace(DATE_RANGE_RE, '')
    .replace(/^[-*•·●▪\d.)、\s]+/, '')
    .split(/\s+[|｜—–-]{1,2}\s+|[|｜]|（|\(|:|：/)[0]
    .replace(/[「」《》“”"]/g, '')
    .trim();
}

/** Course lists ("主修课程：…数据库系统…") and tech-stack lines name subjects / tools, not projects. */
const NOT_PROJECT_LINE_RE = /课程|技术栈|coursework|courses?\b|tech(?:nology)? stack/i;

function extractProjects(ls: string[], inProjects: boolean[], text: string, companies: string[], skills: string[]): string[] {
  // 1) Titles inside a "Projects" section — the most reliable source.
  const titled: string[] = [];
  const titleLines = new Set<number>();
  for (const [i, l] of ls.entries()) {
    if (!inProjects[i] || /^[-*•·●▪]/.test(l) || l.length > 120) continue;
    const name = cleanProjectName(l);
    if (name.length >= 2 && name.length <= 30) {
      titled.push(name);
      titleLines.add(i);
    }
  }
  // 2) Quoted names and "…系统/平台" style nouns — not from course lists / tech stacks, nor from a
  //    project title line (its title already stands for it). Chinese curly quotes are mostly used
  //    for emphasis ("状态不一致"), so they only count when no project section was found.
  const out: string[] = [];
  const quoted = titled.length > 0 ? /[「《]([^」》]{2,20})[」》]/g : /[「《“]([^」》”]{2,20})[」》”]/g;
  for (const m of text.matchAll(quoted)) out.push(m[1]);
  for (const [i, line] of ls.entries()) {
    if (titleLines.has(i) || NOT_PROJECT_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:系统|平台|中台|小程序|引擎|工具|网站|插件|框架|SDK|机器人|App|APP))/g)) {
      const name = m[1].replace(/^(负责|参与|主导|开发|设计|搭建|基于|使用|一个|一套|整个|公司|团队|我们的|的)+/, '');
      if (name.length >= 4) out.push(name);
    }
  }
  for (const m of text.matchAll(/\b(?:Project|Built|Developed|Designed|Led|Created|Launched)\s*[:\-–]?\s+(?:an?\s+|the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/g)) {
    out.push(m[1]);
  }
  for (const m of text.matchAll(
    /\b(?:Led|Owned|Drove|Built|Designed|Launched|Shipped|Rebuilt|Developed|Created)\s+(?:the\s+|a\s+|an\s+|our\s+)?((?:[\w-]+\s){0,3}(?:redesign|migration|rewrite|platform|system|library|dashboard|app|service|pipeline|engine|tool|SDK|API|website|portal|framework))\b/gi,
  )) {
    out.push(`the ${m[1].trim()}`);
  }
  const blocked = new Set([...companies, ...skills].map((s) => s.toLowerCase()));
  const usable = (p: string) =>
    !blocked.has(p.toLowerCase()) &&
    !/^(管理系统|操作系统|系统|平台|工具|开源|开源项目|个人项目|其他项目|其他)$/.test(p) &&
    !/^(open[- ]?source(?: work| contributions?)?|side projects?|personal projects?|other projects?|misc(?:ellaneous)?)$/i.test(p);
  // Prefer projects with a quantified result nearby, then by position in the résumé.
  const rank = (p: string) => {
    const at = text.indexOf(p);
    const near = at >= 0 && METRIC_RE.test(text.slice(at, at + 300));
    return (near ? 0 : 1e6) + (at < 0 ? 1e5 : at);
  };
  const candidates = uniq([...titled, ...out].filter(usable), 6);
  return [...candidates].sort((a, b) => rank(a) - rank(b)).slice(0, 4);
}

const METRIC_RE =
  /(\d+(?:\.\d+)?\s*(?:%|％|倍|x\b|X\b|万|亿|千|k\b|K\b|w\b|W\b|ms|毫秒|秒|s\b|QPS|qps|TPS|DAU|MAU|个用户|名用户|用户|人|次|元|美元|million|billion|users|hours?|小时|天|周))|[$¥￥]\s?\d/;

/**
 * Grades, class ranks, scholarships and test scores: numbers about schooling, not results of the
 * candidate's work ("GPA 3.72 / 4.0（专业前 10%）" is not a project outcome).
 */
const EDUCATION_METRIC_RE =
  /\bGPA\b|绩点|均分|平均分|(?:专业|年级|班级|学院|系)(?:排名|前\s*\d)|奖学金|dean'?s list|scholarship|class rank|\b(?:top|first)\s*\d+\s*%\s*(?:of|in)\s+(?:my\s+|the\s+)?(?:class|cohort|major|department|year|graduating)|\bCET-?[46]\b|TOEFL|IELTS|\bGRE\b|\bGMAT\b|托福|雅思|英语[四六]级/i;

function extractMetrics(text: string): string[] {
  const clauses = text.split(/[\n。；;！!？?]|，(?=\D)|,\s(?=\D)/);
  const out: string[] = [];
  for (const raw of clauses) {
    const c = raw.replace(/^[-*•·●▪\d.)、\s]+/, '').trim();
    if (!METRIC_RE.test(c)) continue;
    if (/@|\d{11}|(19|20)\d{2}\s*[./年-]\s*\d{1,2}/.test(c)) continue; // phone, email, dates
    if (EDUCATION_METRIC_RE.test(c)) continue;
    const len = countCjk(c) + c.split(/\s+/).length;
    if (len < 4 || len > 60) continue;
    out.push(shortenMetric(c, countCjk(c) > 0 ? 48 : 80));
  }
  return uniq(out, 6);
}

/**
 * Keep a metric clause quotable: when it is too long, end it right after the last number that
 * still fits ("trial-to-activation rate rose from 31% to 44%") instead of cutting mid-word.
 */
function shortenMetric(clause: string, max: number): string {
  if (clause.length <= max) return clause;
  let cut = 0;
  for (const m of clause.matchAll(new RegExp(METRIC_RE.source, 'g'))) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > max) break;
    cut = end;
  }
  const head = clause.slice(0, cut).trim();
  return head.length >= 8 ? head : truncate(clause, max);
}

function inferField(skills: SkillTerm[], text: string): FieldId {
  const score = new Map<FieldId, number>();
  for (const s of skills) score.set(s.field, (score.get(s.field) ?? 0) + 1);
  const bump = (f: FieldId, re: RegExp, n = 2) => {
    if (re.test(text)) score.set(f, (score.get(f) ?? 0) + n);
  };
  bump('frontend', /前端|frontend|front-end|web 开发/i);
  bump('backend', /后端|服务端|backend|back-end|server-side/i);
  bump('ai', /算法|机器学习|深度学习|algorithm|machine learning/i);
  bump('data', /数据分析|数据科学|data analyst|data scien/i);
  bump('product', /产品经理|product manager|\bPM\b/);
  bump('design', /设计师|designer|UI|UX/);
  bump('marketing', /市场|营销|marketing/i);
  bump('operations', /运营|operations/i);
  bump('sales', /销售|sales/i);
  bump('finance', /财务|会计|finance|accounting/i);
  bump('hr', /人力资源|招聘|\bHR\b|recruit/i);
  bump('education', /教师|老师|教学|teacher|teaching/i);
  let best: FieldId = 'general';
  let bestScore = 0;
  for (const [f, n] of score) {
    if (n > bestScore) {
      best = f;
      bestScore = n;
    }
  }
  return best;
}

export function extractResumeFacts(text: string, lang: Lang): ResumeFacts {
  const src = text ?? '';
  const ls = lines(src);
  const skills = findSkills(src);
  const field = inferField(skills, src);
  const inProjects = projectSectionLines(ls);
  const companies = extractCompanies(ls, inProjects);
  const skillNames = skills.map((s) => skillDisplay(s, lang));
  const projects = extractProjects(ls, inProjects, src, companies, skillNames);
  const yearsMatch = /(\d{1,2})\s*\+?\s*年(?:以上)?(?:的)?(?:工作|开发|从业|相关|行业)?经验/.exec(src) ?? /(\d{1,2})\+?\s*years?(?:\s+of)?\s+(?:professional\s+|industry\s+|work\s+)?experience/i.exec(src);
  const techCount = skills.filter((s) => s.tech).length;
  const isStudent =
    /应届|在读|毕业生|大[一二三四]|实习生|本科生|研究生|new grad|graduat(?:e|ing) (?:student|in)|undergraduate|expected graduation|class of 20/i.test(src) &&
    companies.length <= 2;
  const facts: ResumeFacts = {
    name: extractName(ls, src),
    role: extractRole(ls, src, lang, field),
    field,
    skills,
    companies,
    schools: extractSchools(src),
    projects,
    metrics: extractMetrics(src),
    years: yearsMatch ? Number(yearsMatch[1]) : null,
    isTech: techCount >= 2 || ['frontend', 'backend', 'mobile', 'ai', 'devops', 'game'].includes(field),
    isStudent,
    isThin: false,
  };
  const detail = facts.projects.length + facts.companies.length + facts.metrics.length + Math.min(3, facts.skills.length);
  facts.isThin = src.trim().length < 120 || detail < 3;
  return facts;
}

/** Skill names for display in the interview language. */
export function skillNames(facts: ResumeFacts, lang: Lang, onlyTech = false): string[] {
  return facts.skills.filter((s) => !onlyTech || s.tech).map((s) => skillDisplay(s, lang));
}
