/**
 * Offline interviewer turns: reacts to the answer it just heard (echoing specifics), decides
 * whether to follow up, asks grounded main questions, answers reverse-Q&A questions about the
 * fictional company, and closes in character.
 */
import type { AnswerAssessment, Expression, InterviewerTurn, Lang, TurnContext, TurnKind } from '../../types';
import { joinSpeech, padCjkLatin } from '../../engine/text';
import { REVERSE_KINDS, pendingReply } from '../../engine/transcript';
import { type AnswerAnalysis, affinityFor, analyzeAnswer, assessmentComment, looksLikeQuestion } from './analysis';
import { CHARACTER_LINES, SHARED_QUESTIONS, type Band, type CharacterLines, type FollowupKind, type Lines, type ReverseTopic, type SpecialReaction } from './lines';
import { buildTopicCandidates, findCandidate } from './planner';
import { type Rng, createRng, fill, hashString } from './random';
import { extractResumeFacts } from './resumeFacts';

const ECHO: Record<Lang, readonly string[]> = {
  zh: ['尤其是你提到的{focus}，挺关键的。', '{focus}这一点我记下了。', '你讲到的{focus}很有说服力。'],
  en: ['Especially the part about {focus}.', "I'm noting what you said about {focus}.", 'What you said about {focus} was convincing.'],
};

const REVERSE_TOPIC_RES: [ReverseTopic, RegExp][] = [
  ['salary', /薪资|薪水|工资|待遇|福利|期权|股票|年终|salary|compensation|pay\b|benefit|equity|stock|bonus/i],
  ['process', /流程|下一步|多久|结果|几轮|后续|反馈|通知|next step|process|hear back|timeline|rounds?|feedback|when will/i],
  ['remote', /远程|在家|居家|办公地点|地址|坐班|remote|hybrid|office|location|work from home|wfh/i],
  ['culture', /文化|氛围|加班|工作时间|节奏|996|作息|work-?life|culture|atmosphere|overtime|hours|pace/i],
  ['growth', /成长|培训|培养|学习|导师|晋升|发展|mentor|growth|learn|training|career path|promotion/i],
  ['expectation', /期望|期待|前三个月|入职后|第一年|考核|绩效|表现好|expect|first (?:90|ninety) days|first few months|success look|onboarding|kpi|performance review/i],
  ['team', /团队|小组|同事|几个人|规模|汇报|上级|leader|team|colleague|report to|manager|who would i/i],
  ['tech', /技术栈|技术|架构|语言|框架|工具|tech|stack|architecture|framework|tools|language/i],
  ['product', /产品|业务|用户|客户|方向|战略|竞争|product|business|users?|customers?|strategy|roadmap|market|compet/i],
  ['interviewer', /您自己|你自己|您为什么|你为什么|您喜欢|你喜欢|您在这|你在这|why did you join|what do you like|your favou?rite|how long have you|about you/i],
];

/** Topic of the candidate's question: the earliest mention wins ("技术栈是什么？新人多久…" → tech), list order breaks ties. */
export function classifyReverse(text: string): ReverseTopic {
  let best: ReverseTopic = 'generic';
  let bestAt = Infinity;
  for (const [topic, re] of REVERSE_TOPIC_RES) {
    const at = text.search(re);
    if (at >= 0 && at < bestAt) {
      best = topic;
      bestAt = at;
    }
  }
  return best;
}

function band(score: number): Band {
  if (score >= 8) return 'great';
  if (score >= 6) return 'good';
  if (score >= 5) return 'ok';
  if (score >= 3) return 'weak';
  return 'poor';
}

interface Ctx {
  turn: TurnContext;
  lang: Lang;
  lines: CharacterLines;
  rng: Rng;
  /** Interviewer text already spoken this session (to avoid repeating lines). */
  spoken: string;
  /** The last few interviewer entries (cool-down window for non-blocking special remarks). */
  recent: string;
}

/**
 * A line from the bank: one not spoken yet this session when possible, otherwise the one spoken
 * longest ago, so a bank of two or more lines never repeats its latest line (no word-for-word loops).
 */
function say(c: Ctx, lines: Lines, vars: Record<string, string> = {}): string {
  const options = lines[c.lang].map((l) => fill(l, vars));
  if (options.length === 0) return '';
  const fresh = options.filter((l) => !c.spoken.includes(l));
  if (fresh.length > 0) return c.rng.pick(fresh);
  let oldest = options[0];
  for (const l of options) if (c.spoken.lastIndexOf(l) < c.spoken.lastIndexOf(oldest)) oldest = l;
  return oldest;
}

/** Interviewer turns within which a reminder ("please answer in English", "that was long") is not repeated. */
export const SPECIAL_REMARK_COOLDOWN = 3;

/** A non-blocking remark (off-language, long answer) the interviewer made in the last few turns. */
function remarkedRecently(c: Ctx, special: SpecialReaction): boolean {
  return c.lines.special[special][c.lang].some((l) => c.recent.includes(l));
}

function specialFor(a: AnswerAnalysis): SpecialReaction | null {
  if (a.manipulation) return 'manipulation';
  if (a.refusal) return 'refusal';
  if (a.dontKnow && a.units < 50) return 'dontKnow';
  if (a.joking && a.score < 6) return 'joking';
  if (a.offLanguage) return 'offLanguage';
  if (a.lengthBand === 'rambling') return 'long';
  return null;
}

const OPENER_RE = /^(okay|ok|alright|all right|right|good|great|so|well|hm+|好的|好啦|好|嗯+|那)[,，.。!！\s]+/i;
const openerKey = (text: string): string | null => {
  const m = OPENER_RE.exec(text.trim());
  if (!m) return null;
  const w = m[1].toLowerCase();
  return w.startsWith('好') ? '好' : w.startsWith('嗯') ? '嗯' : w === 'ok' || w === 'all right' ? 'okay' : w;
};

/** Drop `next`'s opening interjection when `prev` opened with the same one ("Okay, that works. Okay, moving on."). */
export function withoutEchoedOpener(prev: string, next: string): string {
  const key = openerKey(next);
  if (!key || openerKey(prev) !== key) return next;
  const rest = next.trim().replace(OPENER_RE, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : next;
}

/** Spoken reaction to the candidate's reply + the expression to wear while saying it. */
function react(c: Ctx, a: AnswerAnalysis | null, skipped: boolean, fromIntro: boolean): { text: string; expression: Expression } {
  const ex = c.lines.expressions;
  if (skipped) return { text: say(c, c.lines.special.skipped), expression: ex.special.skipped };
  if (!a) return { text: '', expression: ex.main[0] };
  let special = specialFor(a);
  // Reminders about the answer's form are not repeated before every line.
  if ((special === 'offLanguage' || special === 'long') && remarkedRecently(c, special)) special = null;
  const b = band(a.score);
  if (special === 'manipulation' || special === 'refusal' || special === 'dontKnow' || special === 'joking') {
    return { text: say(c, c.lines.special[special]), expression: ex.special[special] };
  }
  if (fromIntro) {
    const strong = a.score >= 6;
    const text = joinSpeech([special ? say(c, c.lines.special[special]) : '', say(c, c.lines.introReactions[strong ? 'strong' : 'weak'])], c.lang);
    return { text, expression: strong ? c.rng.pick(ex.band.good) : c.rng.pick(ex.band.ok) };
  }
  const parts: string[] = [];
  if (special) parts.push(say(c, c.lines.special[special]));
  parts.push(say(c, c.lines.reactions[b]));
  if ((b === 'great' || b === 'good') && a.focus && c.rng.chance(0.6)) parts.push(fill(c.rng.pick(ECHO[c.lang]), { focus: a.focus }));
  return { text: joinSpeech(parts, c.lang), expression: special ? ex.special[special] : c.rng.pick(ex.band[b]) };
}

function mainQuestion(c: Ctx, topicIndex: number): string {
  const { config, character, plan } = c.turn;
  const topic = plan.topics[topicIndex];
  const facts = extractResumeFacts(config.resumeText, c.lang);
  const candidate = findCandidate(topic, buildTopicCandidates(config, character, facts));
  const category = candidate?.category ?? 'custom';
  const vars = candidate?.vars ?? { title: topic?.title ?? '', us: character.company[c.lang], role: plan.targetRole };
  const bank = c.lines.questions[category] ?? SHARED_QUESTIONS[category];
  return say(c, bank, vars);
}

function followupKind(a: AnswerAnalysis, rng: Rng): FollowupKind {
  if (a.dontKnow && a.units < 50) return 'dontKnow';
  if (a.lengthBand === 'tiny' || a.lengthBand === 'short') return 'short';
  if (a.vagueHits >= 2) return 'vague';
  if (!a.hasPersonal && rng.chance(0.6)) return 'personal';
  if (a.numbers.length === 0 && rng.chance(0.7)) return 'numbers';
  if (a.focus && rng.chance(0.65)) return 'why';
  if (!a.hasResult && rng.chance(0.5)) return 'result';
  return 'deeper';
}

function wantsFollowup(c: Ctx, a: AnswerAnalysis): boolean {
  const { config, character, progress } = c.turn;
  if (a.manipulation) return false;
  if (a.refusal) return c.rng.chance(0.2);
  let p = a.score <= 3 ? 0.85 : a.score <= 5 ? 0.65 : a.score <= 7 ? 0.45 : 0.3;
  if (config.difficulty === 'hard') p += 0.15;
  if (config.difficulty === 'easy') p -= 0.2;
  if (character.id === 'ethan') p += 0.1;
  if (progress.followUpsOnCurrent >= 1) p *= 0.7;
  return c.rng.chance(p);
}

function turn(
  kind: TurnKind,
  reaction: string,
  question: string,
  expression: Expression,
  assessment: AnswerAssessment | null,
  topicIndex: number | null = null,
): InterviewerTurn {
  return { kind, reaction, question, expression, topicIndex, assessment };
}

function reverseAnswer(c: Ctx, question: string): string {
  return say(c, c.lines.reverseAnswers[classifyReverse(question)]);
}

/**
 * The candidate's reverse-Q&A reply asks something: not "no more questions", and either phrased as a
 * question or about a topic the interviewer can talk about. Thanks / small talk ("谢谢您今天的时间",
 * "I think I'm all set") must not be answered with "Good question…".
 */
function asksSomething(a: AnswerAnalysis | null, text: string): boolean {
  if (!a || a.saysNoMore) return false;
  return looksLikeQuestion(text) || classifyReverse(text) !== 'generic';
}

/** Build the demo interviewer's next turn for `ctx.directive`. */
export function demoNextTurn(ctx: TurnContext): InterviewerTurn {
  const t = buildTurn(ctx);
  if (ctx.config.lang !== 'zh') return t;
  return { ...t, reaction: padCjkLatin(t.reaction), question: padCjkLatin(t.question) };
}

function buildTurn(ctx: TurnContext): InterviewerTurn {
  const { config, character, plan, directive, transcript } = ctx;
  const lang = config.lang;
  const reply = pendingReply(transcript);
  const skipped = reply?.entry.answer?.skipped === true;
  const answeredKind: TurnKind = reply?.answered?.kind ?? 'opening';
  const inReverse = REVERSE_KINDS.includes(answeredKind);
  const answer = reply && !skipped ? reply.entry.text : '';
  const interviewerTexts = transcript.filter((e) => e.role === 'interviewer').map((e) => e.text);
  const c: Ctx = {
    turn: ctx,
    lang,
    lines: CHARACTER_LINES[character.id],
    rng: createRng(hashString(`${plan.opening.speech}|${plan.topics.map((t) => t.title).join('|')}|${transcript.length}|${answer}`)),
    spoken: interviewerTexts.join('\n'),
    recent: interviewerTexts.slice(-SPECIAL_REMARK_COOLDOWN).join('\n'),
  };

  const a = reply && !skipped ? analyzeAnswer(answer, lang, { difficulty: config.difficulty, strictness: character.strictness }) : null;
  let assessment: AnswerAssessment | null = null;
  if (a && !inReverse) {
    assessment = { score: a.score, comment: assessmentComment(a, lang), affinityDelta: affinityFor(a, character) };
  } else if (a && inReverse) {
    const thoughtful = a.units >= 12 && asksSomething(a, answer);
    assessment = { score: thoughtful ? 7 : 5, comment: '', affinityDelta: a.manipulation ? -3 : thoughtful ? 1 + (a.units >= 30 ? 1 : 0) : 0 };
  }

  const reaction = inReverse ? { text: '', expression: c.lines.expressions.reverse } : react(c, a, skipped, answeredKind === 'opening');
  const mainTurn = (topicIndex: number): InterviewerTurn => {
    // The skip reaction already moves on ("好的，不勉强，我们看下一个。"): no second transition.
    const lead = skipped ? '' : say(c, answeredKind === 'opening' ? c.lines.firstTopic : c.lines.transitions);
    const expression = reaction.expression === 'troubled' ? c.rng.pick(c.lines.expressions.main) : reaction.expression;
    return turn('main', joinSpeech([reaction.text, withoutEchoedOpener(reaction.text, lead)], lang), mainQuestion(c, topicIndex), expression, assessment, topicIndex);
  };
  const reversePromptTurn = (): InterviewerTurn =>
    turn('reverse_prompt', reaction.text, withoutEchoedOpener(reaction.text, say(c, c.lines.reversePrompt)), c.lines.expressions.reverse, assessment);
  const closingTurn = (answerFirst: boolean): InterviewerTurn => {
    const parts = answerFirst ? [reverseAnswer(c, answer), say(c, c.lines.lastAnswerBridge)] : [];
    parts.push(say(c, c.lines.closings));
    return turn('closing', joinSpeech(parts, lang), '', c.lines.expressions.closing, assessment);
  };

  switch (directive.type) {
    case 'main':
      return mainTurn(directive.topicIndex);
    case 'followup_or_next': {
      if (a && wantsFollowup(c, a)) {
        const kind = followupKind(a, c.rng);
        const question = say(c, c.lines.followups[kind], { focus: a.focus ?? plan.topics[directive.currentTopicIndex]?.title ?? '' });
        return turn('followup', reaction.text, withoutEchoedOpener(reaction.text, question), c.rng.pick(c.lines.expressions.followup), assessment, directive.currentTopicIndex);
      }
      return directive.next.type === 'main' ? mainTurn(directive.next.topicIndex) : reversePromptTurn();
    }
    case 'reverse_prompt':
      return reversePromptTurn();
    case 'reverse_answer':
      if (!asksSomething(a, answer)) return closingTurn(false);
      return turn('reverse_answer', reverseAnswer(c, answer), say(c, c.lines.reverseMore), c.lines.expressions.reverse, assessment);
    case 'closing':
      return closingTurn(inReverse && !skipped && asksSomething(a, answer));
  }
}
