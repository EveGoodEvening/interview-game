/**
 * Output schemas for the interviewer LLM + lenient normalizers.
 *
 * The zod schemas are what we hand to providers for structured outputs, so they only use
 * closed objects, strings, numbers, enums, arrays and nullable — no defaults, transforms,
 * refinements or numeric bounds (bounds are documented in descriptions and enforced by the
 * normalizers instead, so a slightly out-of-range value never fails a provider-side parse).
 *
 * The normalizers accept *anything* JSON.parse can produce and return valid typed objects,
 * or null when the output is unusable (which triggers a retry).
 */
import { z } from 'zod';
import type {
  AnswerAssessment,
  CharacterDef,
  DimensionKey,
  Expression,
  InterviewConfig,
  InterviewPlan,
  InterviewReport,
  InterviewerTurn,
  Lang,
  PlanTopic,
  QuestionReview,
  TurnKind,
} from '../types';
import { DIMENSION_KEYS } from '../types';
import { CANNED } from '../engine/canned';
import { type QAPair, reviewQuestionLabel } from '../engine/qa';
import { clamp } from '../engine/scoring';
import { cleanSpeech, joinSpeech, looksLikeQuestion, splitSentences, tidyText, truncate } from '../engine/text';
import { genericTopicsFor } from './genericTopics';
import { isJsonObject, type JsonObject } from './json';

export { extractJson } from './json';
export { cleanSpeech } from '../engine/text';

// ───────────────────────── Schemas ─────────────────────────

export const EXPRESSION_VALUES = ['neutral', 'smile', 'happy', 'thinking', 'serious', 'surprised', 'troubled'] as const satisfies readonly Expression[];
export const TURN_OUTPUT_KINDS = ['main', 'followup', 'reverse_prompt', 'reverse_answer', 'closing'] as const satisfies readonly TurnKind[];
export const DIMENSION_VALUES = ['communication', 'expertise', 'logic', 'impact', 'fit'] as const satisfies readonly DimensionKey[];

export const ExpressionSchema = z.enum(EXPRESSION_VALUES).describe('Facial expression while speaking');

export const PlanSchema = z
  .strictObject({
    candidateName: z.string().describe("Candidate's name from the résumé, or empty string if unknown"),
    targetRole: z.string().describe('Position being interviewed for'),
    summary: z.string().describe("Interviewer's private 1-2 sentence impression of the résumé"),
    highlights: z.array(z.string()).describe('2-4 strengths worth probing'),
    concerns: z.array(z.string()).describe('1-3 doubts, gaps or risks to verify'),
    topics: z
      .array(
        z.strictObject({
          title: z.string().describe('Short neutral topic title grounded in the résumé, shown to the candidate (<= 16 CJK chars or 6 words)'),
          goal: z.string().describe('Private: one sentence on what the interviewer wants to learn with this topic'),
        }),
      )
      .describe('Exactly the requested number of main topics, in asking order'),
    opening: z.strictObject({
      speech: z.string().describe('Spoken greeting ending with a request for a self-introduction'),
      expression: ExpressionSchema,
    }),
  })
  .describe('Interview plan');

export const AssessmentSchema = z.strictObject({
  score: z.number().describe("Integer 0-10 for the candidate's latest reply"),
  comment: z.string().describe('Private one-sentence note for the report; never spoken'),
  affinityDelta: z.number().describe('Integer -10..10: change in your impression of the candidate'),
});

export const TurnSchema = z
  .strictObject({
    assessment: AssessmentSchema,
    kind: z.enum(TURN_OUTPUT_KINDS).describe('Must be one of the kinds allowed by this turn'),
    reaction: z.string().describe("Spoken reaction to the candidate's latest reply, 1-3 short sentences"),
    question: z.string().describe('One self-contained spoken question; empty string for closing'),
    expression: ExpressionSchema,
  })
  .describe('Interviewer turn');

export const ReportSchema = z
  .strictObject({
    overallScore: z.number().describe('Integer 0-100'),
    dimensions: z
      .array(
        z.strictObject({
          key: z.enum(DIMENSION_VALUES),
          score: z.number().describe('Integer 0-100'),
          comment: z.string(),
        }),
      )
      .describe('One entry per dimension: communication, expertise, logic, impact, fit'),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    questionReviews: z
      .array(
        z.strictObject({
          number: z.number().describe('The question number from question_list (Q3 → 3)'),
          question: z.string(),
          answerSummary: z.string(),
          score: z.number().describe('Integer 0-10'),
          feedback: z.string(),
          betterAnswer: z.string(),
        }),
      )
      .describe('One review per listed question, same order'),
    summary: z.string(),
    finalMessage: z.string().describe("Interviewer's spoken parting words, in character"),
  })
  .describe('Interview report');

export type PlanOutput = z.infer<typeof PlanSchema>;
export type TurnOutput = z.infer<typeof TurnSchema>;
export type ReportOutput = z.infer<typeof ReportSchema>;

// ───────────────────────── Coercion helpers ─────────────────────────

/** Read the first present key among aliases (camelCase, snake_case, …). */
function field(obj: JsonObject, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

/** Unwrap `{ plan: {...} }`-style wrappers. */
function unwrap(obj: JsonObject, ...keys: string[]): JsonObject {
  for (const k of keys) {
    const inner = obj[k];
    if (isJsonObject(inner) && Object.keys(obj).length <= 2) return inner;
  }
  return obj;
}

/** An echoed template placeholder ("…", "...") rather than content. */
const PLACEHOLDER_RE = /^[.…。·\s-]*$/;

export function asString(v: unknown): string {
  if (typeof v === 'string') {
    const t = v.trim();
    return PLACEHOLDER_RE.test(t) ? '' : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * Coerce numbers from numbers or numeric strings ("7", "7/10", "8.5分", "+3", "−4", "85%").
 * Fractions like "7/10" return the numerator.
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (typeof v !== 'string') return null;
  const m = /[-+−–]?\s*\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''));
  if (!m) return null;
  const n = Number(m[0].replace(/[−–]/, '-').replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toStringList(v: unknown, maxItems: number, maxLen: number): string[] {
  let items: unknown[] = [];
  if (Array.isArray(v)) items = v;
  else if (typeof v === 'string') items = v.split(/\n+|[；;]\s*/);
  const out: string[] = [];
  for (const item of items) {
    const s = isJsonObject(item) ? asString(field(item, 'text', 'content', 'title', 'point')) : asString(item);
    const clean = truncate(tidyText(s.replace(/^\s*(?:[-*•·]|\d{1,2}[.)、])\s*/, '')), maxLen);
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

const EXPRESSION_ALIASES: Record<string, Expression> = {
  neutral: 'neutral', calm: 'neutral', normal: 'neutral', default: 'neutral', 平静: 'neutral', 中性: 'neutral', 普通: 'neutral',
  smile: 'smile', smiling: 'smile', warm: 'smile', friendly: 'smile', gentle: 'smile', 微笑: 'smile', 温和: 'smile',
  happy: 'happy', excited: 'happy', joyful: 'happy', delighted: 'happy', pleased: 'happy', laugh: 'happy', laughing: 'happy', 开心: 'happy', 高兴: 'happy', 兴奋: 'happy',
  thinking: 'thinking', thoughtful: 'thinking', curious: 'thinking', pondering: 'thinking', think: 'thinking', 思考: 'thinking', 好奇: 'thinking',
  serious: 'serious', stern: 'serious', focused: 'serious', strict: 'serious', 严肃: 'serious', 认真: 'serious',
  surprised: 'surprised', surprise: 'surprised', impressed: 'surprised', shocked: 'surprised', amazed: 'surprised', 惊讶: 'surprised', 吃惊: 'surprised',
  troubled: 'troubled', worried: 'troubled', concerned: 'troubled', confused: 'troubled', sad: 'troubled', disappointed: 'troubled', awkward: 'troubled', 为难: 'troubled', 担心: 'troubled', 困惑: 'troubled', 失望: 'troubled',
};

export function toExpression(v: unknown): Expression {
  const key = asString(v).toLowerCase();
  return EXPRESSION_ALIASES[key] ?? 'neutral';
}

const KIND_ALIASES: Record<string, TurnKind> = {
  main: 'main', main_question: 'main', question: 'main', next: 'main', next_topic: 'main', new_topic: 'main',
  followup: 'followup', follow_up: 'followup', 'follow-up': 'followup', followupquestion: 'followup', probe: 'followup',
  reverse_prompt: 'reverse_prompt', reverse: 'reverse_prompt', reverseprompt: 'reverse_prompt', invite_questions: 'reverse_prompt', reverse_qa: 'reverse_prompt',
  reverse_answer: 'reverse_answer', reverseanswer: 'reverse_answer', answer: 'reverse_answer',
  closing: 'closing', close: 'closing', goodbye: 'closing', end: 'closing', farewell: 'closing',
};

/**
 * Map a model-supplied kind to a TurnKind. Unknown kinds map to 'opening', which no directive
 * allows, so the engine's coercion replaces it with the directed default step.
 */
export function toTurnKind(v: unknown): TurnKind {
  const key = asString(v).toLowerCase().replace(/\s+/g, '_');
  return KIND_ALIASES[key] ?? KIND_ALIASES[key.replace(/[_-]/g, '')] ?? 'opening';
}

/** Default impression change for a 0–10 score when the model omitted it. */
export function defaultAffinityDelta(score: number): number {
  const table = [-8, -6, -5, -3, -2, 0, 1, 2, 4, 6, 8];
  return table[Math.round(clamp(score, 0, 10))];
}

/**
 * Scores sometimes come back on a 0–100 scale; bring them to 0–10. Values just above 10 are
 * treated as an overflow of the 0–10 scale rather than a terrible percentage.
 */
function toTenScale(n: number): number {
  return n > 15 && n <= 100 ? n / 10 : n;
}

export function normalizeAssessment(v: unknown): AnswerAssessment | null {
  if (!isJsonObject(v)) return null;
  const rawScore = toNumber(field(v, 'score', 'rating', 'points'));
  if (rawScore === null) return null;
  const score = Math.round(clamp(toTenScale(rawScore), 0, 10));
  const rawDelta = toNumber(field(v, 'affinityDelta', 'affinity_delta', 'affinity', 'delta', 'impressionDelta'));
  const affinityDelta = Math.round(clamp(rawDelta ?? defaultAffinityDelta(score), -10, 10));
  const comment = truncate(tidyText(asString(field(v, 'comment', 'note', 'notes', 'reason', 'feedback'))), 240);
  return { score, comment, affinityDelta };
}

// ───────────────────────── Plan ─────────────────────────

const NAME_PLACEHOLDER_RE = /^(unknown|n\/?a|none|null|candidate|the candidate|未知|无|候选人|未提供|不详)$/i;

function normalizeTopics(v: unknown): PlanTopic[] {
  if (!Array.isArray(v)) return [];
  const out: PlanTopic[] = [];
  for (const item of v) {
    let title = '';
    let goal = '';
    if (typeof item === 'string') title = item;
    else if (isJsonObject(item)) {
      title = asString(field(item, 'title', 'topic', 'name', 'question'));
      goal = asString(field(item, 'goal', 'purpose', 'objective', 'focus', 'why'));
    }
    title = truncate(tidyText(title).replace(/^\s*\d{1,2}[.)、]\s*/, '').replace(/[“”"「」]/g, ''), 48);
    goal = truncate(tidyText(goal), 240);
    if (title && !out.some((t) => t.title === title)) out.push({ title, goal });
  }
  return out;
}

/** Trim or pad `topics` to exactly `count`, padding with generic topics suited to the style. */
export function fitTopics(topics: PlanTopic[], count: number, config: Pick<InterviewConfig, 'style' | 'lang'>): PlanTopic[] {
  const out = topics.slice(0, count);
  for (const g of genericTopicsFor(config.style, config.lang)) {
    if (out.length >= count) break;
    if (!out.some((t) => t.title === g.title)) out.push({ title: g.title, goal: g.goal });
  }
  // More topics requested than the generic list has: number the extras.
  for (let i = out.length; i < count; i++) {
    out.push(
      config.lang === 'zh'
        ? { title: `经历深挖 ${i + 1}`, goal: '深入了解候选人简历中的另一段经历' }
        : { title: `Experience deep-dive ${i + 1}`, goal: 'Dig into another experience from the résumé' },
    );
  }
  return out;
}

export function defaultOpening(character: CharacterDef, lang: Lang): string {
  return lang === 'zh'
    ? `你好，欢迎来参加今天的面试。我是${character.company.zh}的${character.title.zh}${character.name.zh}。${CANNED.selfIntro.zh}`
    : `Hi, welcome to today's interview. I'm ${character.name.en}, ${character.title.en} at ${character.company.en}. ${CANNED.selfIntro.en}`;
}

/**
 * Normalize a parsed plan. Returns null when there is not a single usable topic (the caller retries).
 * Always returns exactly `config.mainQuestions` topics and an opening that ends with a self-intro request.
 */
export function normalizePlan(raw: unknown, config: InterviewConfig, character: CharacterDef): InterviewPlan | null {
  if (!isJsonObject(raw)) return null;
  const obj = unwrap(raw, 'plan', 'interviewPlan', 'interview_plan');
  const lang = config.lang;
  const topics = normalizeTopics(field(obj, 'topics', 'questions', 'mainTopics', 'main_topics'));
  if (topics.length === 0) return null;

  let candidateName = truncate(tidyText(asString(field(obj, 'candidateName', 'candidate_name', 'name'))), 40);
  if (NAME_PLACEHOLDER_RE.test(candidateName)) candidateName = '';
  const targetRole =
    config.targetRole.trim() ||
    truncate(tidyText(asString(field(obj, 'targetRole', 'target_role', 'role', 'position'))), 60) ||
    (lang === 'zh' ? '未指定岗位' : 'Unspecified role');

  const openingRaw = field(obj, 'opening', 'openingLine', 'opening_line', 'greeting');
  let speech = '';
  let expression: Expression = 'smile';
  if (typeof openingRaw === 'string') speech = openingRaw;
  else if (isJsonObject(openingRaw)) {
    speech = asString(field(openingRaw, 'speech', 'text', 'line', 'content'));
    if (openingRaw.expression !== undefined) expression = toExpression(openingRaw.expression);
  }
  speech = truncate(cleanSpeech(speech, lang), 600);
  if (!speech) speech = defaultOpening(character, lang);
  else {
    const sentences = splitSentences(speech);
    if (!looksLikeQuestion(sentences[sentences.length - 1] ?? '')) speech = joinSpeech([speech, CANNED.selfIntro[lang]], lang);
  }

  return {
    candidateName,
    targetRole,
    summary: truncate(tidyText(asString(field(obj, 'summary', 'impression'))), 400),
    highlights: toStringList(field(obj, 'highlights', 'strengths'), 5, 120),
    concerns: toStringList(field(obj, 'concerns', 'risks', 'doubts', 'gaps'), 5, 120),
    topics: fitTopics(topics, config.mainQuestions, config),
    opening: { speech, expression },
  };
}

// ───────────────────────── Turn ─────────────────────────

export const MAX_REACTION_CHARS = 700;
export const MAX_QUESTION_CHARS = 400;

/**
 * Normalize a parsed interviewer turn (not yet checked against the directive — see
 * engine/coerceTurn). Returns null when there is nothing to say.
 */
export function normalizeTurn(raw: unknown, lang: Lang): InterviewerTurn | null {
  if (!isJsonObject(raw)) return null;
  const obj = unwrap(raw, 'turn', 'response', 'output');
  const reaction = truncate(cleanSpeech(asString(field(obj, 'reaction', 'response', 'comment_spoken', 'reply')), lang), MAX_REACTION_CHARS);
  const question = truncate(cleanSpeech(asString(field(obj, 'question', 'next_question', 'nextQuestion', 'prompt')), lang), MAX_QUESTION_CHARS);
  if (!reaction && !question) return null;

  // Assessment may be nested or flattened onto the turn.
  const assessmentRaw = field(obj, 'assessment', 'evaluation', 'score_info');
  const assessment = normalizeAssessment(isJsonObject(assessmentRaw) ? assessmentRaw : obj);
  const ti = toNumber(field(obj, 'topicIndex', 'topic_index'));

  return {
    kind: toTurnKind(field(obj, 'kind', 'type', 'turnKind', 'turn_kind')),
    reaction,
    question,
    expression: toExpression(field(obj, 'expression', 'emotion', 'face')),
    topicIndex: ti === null ? null : Math.max(0, Math.round(ti)),
    assessment,
  };
}

// ───────────────────────── Report ─────────────────────────

const DIMENSION_ALIASES: Record<string, DimensionKey> = {
  communication: 'communication', communicate: 'communication', expression: 'communication', clarity: 'communication', 沟通: 'communication', 沟通表达: 'communication', 表达: 'communication',
  expertise: 'expertise', technical: 'expertise', skills: 'expertise', knowledge: 'expertise', professional: 'expertise', competence: 'expertise', 专业: 'expertise', 专业能力: 'expertise', 专业知识: 'expertise',
  logic: 'logic', reasoning: 'logic', thinking: 'logic', problem_solving: 'logic', problemsolving: 'logic', structure: 'logic', 逻辑: 'logic', 逻辑思维: 'logic',
  impact: 'impact', results: 'impact', result: 'impact', achievement: 'impact', achievements: 'impact', 成果: 'impact', 影响: 'impact', 成果影响: 'impact', 影响力: 'impact',
  fit: 'fit', culture: 'fit', culture_fit: 'fit', motivation: 'fit', role_fit: 'fit', 匹配: 'fit', 岗位匹配: 'fit', 匹配度: 'fit', 动机: 'fit',
};

function toDimensionKey(v: unknown): DimensionKey | null {
  const key = asString(v).toLowerCase().replace(/[\s-]+/g, '_');
  return DIMENSION_ALIASES[key] ?? DIMENSION_ALIASES[key.replace(/_/g, '')] ?? null;
}

export const DIMENSION_LABELS: Record<DimensionKey, Record<Lang, string>> = {
  communication: { zh: '沟通表达', en: 'communication' },
  expertise: { zh: '专业能力', en: 'expertise' },
  logic: { zh: '逻辑思维', en: 'logical thinking' },
  impact: { zh: '成果影响', en: 'impact' },
  fit: { zh: '岗位匹配', en: 'role fit' },
};

export interface ReportNormalizeContext {
  lang: Lang;
  /** The questions actually asked (see engine/pairQuestionsAndAnswers); reviews are aligned to these. */
  qa: readonly QAPair[];
  /** Average in-interview score × 10, used to detect a 0–10 overall scale. */
  reference: number | null;
  /** Used when the model's finalMessage is empty. */
  fallbackFinalMessage: string;
}

/** Character-bigram Dice similarity, for matching reviews back to questions. */
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const A = grams(norm(a));
  const B = grams(norm(b));
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}

interface RawReview {
  /** 1-based question number the model gave (field or "Q3:" prefix), when any. */
  number: number | null;
  question: string;
  answerSummary: string;
  score: number | null;
  feedback: string;
  betterAnswer: string;
}

/** "Q3：…", "Q 3. …", "第3题…" → 3. */
const QUESTION_NUMBER_PREFIX_RE = /^\s*(?:Q\s*(\d{1,2})\s*(?:[:：.、·)\]]|\s)|第\s*(\d{1,2})\s*题)/i;

function reviewNumber(r: JsonObject, question: string): number | null {
  const n = toNumber(field(r, 'number', 'no', 'num', 'index', 'questionNumber', 'question_number', 'qNumber', 'id'));
  if (n !== null && Number.isInteger(n)) return n;
  const m = QUESTION_NUMBER_PREFIX_RE.exec(question);
  return m ? Number(m[1] ?? m[2]) : null;
}

function parseReviews(v: unknown): RawReview[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isJsonObject).map((r) => ({
    number: reviewNumber(r, asString(field(r, 'question', 'q'))),
    question: asString(field(r, 'question', 'q')),
    answerSummary: asString(field(r, 'answerSummary', 'answer_summary', 'summary', 'answer')),
    score: toNumber(field(r, 'score', 'rating')),
    feedback: asString(field(r, 'feedback', 'comment', 'review')),
    betterAnswer: asString(field(r, 'betterAnswer', 'better_answer', 'improvedAnswer', 'improved_answer', 'sampleAnswer', 'modelAnswer')),
  }));
}

/**
 * Align model reviews to the asked questions:
 * 1) by the question number the model gave, when at least half of the reviews carry a valid,
 *    unique one (0-based numbering is detected);
 * 2) otherwise by index when the counts match;
 * 3) otherwise by a global greedy matching on text similarity (ties broken by position);
 * then any run of unmatched questions whose neighbours are matched takes the unused reviews that
 * sit between those neighbours, when the counts agree (paraphrased questions). Without numbers,
 * falls back to index order when fewer than half of the questions find a match.
 */
function alignReviews(items: RawReview[], qa: readonly QAPair[]): (RawReview | undefined)[] {
  const n = qa.length;
  const out: (RawReview | undefined)[] = qa.map(() => undefined);
  const itemIndex: (number | undefined)[] = qa.map(() => undefined);
  const used = new Set<number>();
  const assign = (i: number, k: number) => {
    out[i] = items[k];
    itemIndex[i] = k;
    used.add(k);
  };

  // 1) Explicit numbers.
  const nums = items.map((it) => it.number);
  const zeroBased = nums.includes(0) && !nums.includes(n);
  const valid = nums.map((num) => (num === null ? null : zeroBased ? num + 1 : num)).map((num) => (num !== null && num >= 1 && num <= n ? num : null));
  const counts = new Map<number, number>();
  for (const num of valid) if (num !== null) counts.set(num, (counts.get(num) ?? 0) + 1);
  const unique = valid.map((num) => (num !== null && counts.get(num) === 1 ? num : null));
  const numbered = unique.filter((num) => num !== null).length;
  const byNumber = numbered > 0 && numbered * 2 >= items.length;
  if (byNumber) unique.forEach((num, k) => num !== null && assign(num - 1, k));
  else if (items.length === n) return items;

  // 2) Text similarity for what is left.
  const candidates: { i: number; k: number; score: number }[] = [];
  qa.forEach((pair, i) => {
    if (out[i]) return;
    items.forEach((item, k) => {
      if (used.has(k)) return;
      const score = similarity(item.question, pair.question) - 0.01 * Math.abs(k - i);
      if (score > 0.35) candidates.push({ i, k, score });
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) if (!out[c.i] && !used.has(c.k)) assign(c.i, c.k);

  // 3) Gaps between matched neighbours.
  for (let a = 0; a < n; a++) {
    if (out[a]) continue;
    let b = a;
    while (b + 1 < n && !out[b + 1]) b++;
    const before = a > 0 ? itemIndex[a - 1]! : -1;
    const after = b + 1 < n ? itemIndex[b + 1]! : items.length;
    const free: number[] = [];
    for (let k = before + 1; k < after; k++) if (!used.has(k)) free.push(k);
    if (free.length === b - a + 1) free.forEach((k, j) => assign(a + j, k));
    a = b;
  }

  const matched = out.filter(Boolean).length;
  if (!byNumber && matched * 2 < Math.min(items.length, n)) return qa.map((_, i) => items[i]);
  return out;
}

function genericFeedback(score: number, skipped: boolean, lang: Lang): string {
  if (skipped) return lang === 'zh' ? '这道题跳过了，面试中尽量不要空着，哪怕先说思路也比放弃好。' : 'This one was skipped. Even a partial answer or your line of thinking beats leaving it blank.';
  if (score >= 8) return lang === 'zh' ? '回答具体、有说服力，保持这种水准。' : 'Specific and convincing. Keep this standard.';
  if (score >= 6) return lang === 'zh' ? '回答基本到位，可以再多给一些具体细节和可量化的结果。' : 'Solid overall; add more concrete detail and measurable results.';
  if (score >= 4) return lang === 'zh' ? '回答偏笼统，缺少具体例子、个人贡献和结果。' : 'Too general: it lacks a concrete example, your personal contribution and the outcome.';
  return lang === 'zh' ? '回答没有抓住问题要点，建议先正面回答问题，再用经历来支撑。' : 'The answer missed the point. Address the question directly first, then back it up with experience.';
}

function genericBetterAnswer(lang: Lang): string {
  return lang === 'zh'
    ? '可以用 STAR 结构来回答：先用一两句话交代背景和你的任务，再重点讲你具体做了什么、为什么这么做，最后用数据说明结果和收获。'
    : 'Use the STAR structure: one or two sentences on the situation and your task, then focus on what you did and why, and close with measurable results and what you learned.';
}

/**
 * Normalize a parsed report. Returns null when neither an overall score nor dimension scores
 * are present. Guarantees all five dimensions (0–100, in DIMENSION_KEYS order), one review per
 * asked question (question text taken from the transcript, in-interview score preferred), and a
 * non-empty summary and final message.
 */
export function normalizeReport(raw: unknown, ctx: ReportNormalizeContext): InterviewReport | null {
  if (!isJsonObject(raw)) return null;
  const obj = unwrap(raw, 'report', 'evaluation');
  const lang = ctx.lang;

  // Dimensions: array of {key, score, comment} or a map {communication: 80 | {score, comment}}.
  const dimsRaw = field(obj, 'dimensions', 'dimension_scores', 'scores');
  const parsedDims = new Map<DimensionKey, { score: number; comment: string }>();
  const addDim = (keyRaw: unknown, value: unknown) => {
    const key = toDimensionKey(keyRaw);
    if (!key || parsedDims.has(key)) return;
    const score = isJsonObject(value) ? toNumber(field(value, 'score', 'value', 'rating')) : toNumber(value);
    if (score === null) return;
    const comment = isJsonObject(value) ? tidyText(asString(field(value, 'comment', 'feedback', 'note'))) : '';
    parsedDims.set(key, { score, comment: truncate(comment, 240) });
  };
  if (Array.isArray(dimsRaw)) {
    for (const d of dimsRaw) if (isJsonObject(d)) addDim(field(d, 'key', 'name', 'dimension', 'id'), d);
  } else if (isJsonObject(dimsRaw)) {
    for (const [k, v] of Object.entries(dimsRaw)) addDim(k, v);
  }

  let overall = toNumber(field(obj, 'overallScore', 'overall_score', 'overall', 'score', 'totalScore'));
  if (overall === null && parsedDims.size === 0) return null;

  // Dimension scale. The prompt asks for 0–100 (DIMENSION_SCORE_MAX); some models answer 0–10.
  // All ≤ 10 is ambiguous (a genuinely weak candidate scores ≤ 10 on 0–100 too), so compare
  // against an anchor — the in-interview reference, else a 0–100 overall score — and only
  // rescale when ×10 lands closer to it. Without any anchor, assume the 0–10 slip.
  const dimValues = [...parsedDims.values()];
  let dimsOnTenScale = false;
  if (dimValues.length > 0 && dimValues.every((d) => d.score <= 10)) {
    const mean = dimValues.reduce((s, d) => s + d.score, 0) / dimValues.length;
    const anchor = ctx.reference ?? (overall !== null && overall > 10 ? overall : null);
    if (anchor === null || Math.abs(mean * 10 - anchor) < Math.abs(mean - anchor)) {
      dimValues.forEach((d) => (d.score *= 10));
      dimsOnTenScale = true;
    }
  }
  const dimMean = dimValues.length ? dimValues.reduce((s, d) => s + d.score, 0) / dimValues.length : null;

  if (overall === null) overall = dimMean ?? ctx.reference ?? 50;
  else if (overall <= 10) {
    // Same scale as dimensions that were on 0–10, a fractional value ("7.2" is a 0–10 score), or ×10
    // closer to the evidence.
    const anchor = ctx.reference ?? dimMean;
    if (dimsOnTenScale || !Number.isInteger(overall) || anchor === null || Math.abs(overall * 10 - anchor) < Math.abs(overall - anchor)) overall *= 10;
  }
  const overallScore = Math.round(clamp(overall, 0, 100));

  const dimensions = DIMENSION_KEYS.map((key) => {
    const d = parsedDims.get(key);
    return {
      key,
      score: Math.round(clamp(d?.score ?? overallScore, 0, 100)),
      comment:
        d?.comment ||
        (lang === 'zh'
          ? `${DIMENSION_LABELS[key].zh}方面与整体表现基本一致。`
          : `Your ${DIMENSION_LABELS[key].en} was in line with your overall performance.`),
    };
  });

  const strengths = toStringList(field(obj, 'strengths', 'pros'), 5, 200);
  const improvements = toStringList(field(obj, 'improvements', 'weaknesses', 'cons', 'suggestions'), 5, 200);
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);
  if (strengths.length === 0) {
    const top = DIMENSION_LABELS[sorted[0].key][lang];
    strengths.push(lang === 'zh' ? `${top}是你这次表现最好的一面。` : `Your ${top} was the strongest part of this interview.`);
  }
  if (improvements.length === 0) {
    const low = DIMENSION_LABELS[sorted[sorted.length - 1].key][lang];
    improvements.push(lang === 'zh' ? `${low}还有提升空间，多准备具体的例子和数据。` : `There is room to improve your ${low}; prepare concrete examples with numbers.`);
  }

  const items = parseReviews(field(obj, 'questionReviews', 'question_reviews', 'reviews', 'questions'));
  let questionReviews: QuestionReview[];
  if (ctx.qa.length > 0) {
    const aligned = alignReviews(items, ctx.qa);
    questionReviews = ctx.qa.map((pair, i) => {
      const item = aligned[i];
      const modelScore = item?.score !== null && item?.score !== undefined ? toTenScale(item.score) : null;
      const score = Math.round(clamp(pair.score ?? modelScore ?? 0, 0, 10));
      const skippedSummary = lang === 'zh' ? '（未作答）' : '(No answer)';
      return {
        question: truncate(reviewQuestionLabel(pair, lang), 300),
        answerSummary: truncate(tidyText(item?.answerSummary ?? '') || (pair.skipped || !pair.answer ? skippedSummary : truncate(pair.answer, 90)), 240),
        score,
        feedback: truncate(tidyText(item?.feedback ?? ''), 600) || genericFeedback(score, pair.skipped, lang),
        betterAnswer: truncate(tidyText(item?.betterAnswer ?? ''), 900) || genericBetterAnswer(lang),
      };
    });
  } else {
    questionReviews = items
      .filter((r) => r.question)
      .map((r) => {
        const score = Math.round(clamp(toTenScale(r.score ?? 0), 0, 10));
        return {
          question: truncate(tidyText(r.question), 300),
          answerSummary: truncate(tidyText(r.answerSummary), 240),
          score,
          feedback: truncate(tidyText(r.feedback), 600) || genericFeedback(score, false, lang),
          betterAnswer: truncate(tidyText(r.betterAnswer), 900) || genericBetterAnswer(lang),
        };
      });
  }

  const summary =
    truncate(tidyText(asString(field(obj, 'summary', 'overall_comment', 'overallComment', 'evaluation'))), 1500) ||
    (lang === 'zh' ? '整体表现请参考下方各维度与逐题点评。' : 'See the dimension scores and per-question reviews below for details.');
  const finalMessage =
    truncate(cleanSpeech(asString(field(obj, 'finalMessage', 'final_message', 'farewell', 'parting_words')), lang), 600) ||
    ctx.fallbackFinalMessage;

  return { overallScore, dimensions, strengths, improvements, questionReviews, summary, finalMessage };
}
