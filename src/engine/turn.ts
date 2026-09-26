/**
 * Validate an AI turn against the directive it was produced for and repair it.
 */
import type { InterviewPlan, InterviewerTurn, Lang, TurnDirective, TurnKind } from '../types';
import { EXPRESSIONS } from '../types';
import { CANNED, cannedMainQuestion } from './canned';
import { allowedKinds, directiveTopicIndex } from './directive';
import { clampAffinityDelta, clampScore } from './scoring';
import { joinSpeech, splitReactionQuestion } from './text';

/** Kinds whose question is addressed to the candidate as an interview question. */
const ASKS_CANDIDATE_KINDS: readonly TurnKind[] = ['main', 'followup'];

const INVITES_QUESTIONS_RE =
  /(问我|问我们|想问|想了解|有什么问题|有没有什么问题|有什么疑问|questions? for (me|us)|anything (you'?d like|you want) to ask|like to know|ask (me|us)|any questions)/i;

/**
 * Coerce `turn` so that it obeys `directive`:
 * - a kind the directive does not allow becomes the directed next step (e.g. a follow-up when no
 *   follow-ups are left → the next main question), and texts are repaired where the flow depends on them
 *   (a coerced main question is replaced with the topic's canned one, since the model's question belongs
 *   to the old topic; reverse prompt must invite questions; a reverse answer must not quiz the candidate;
 *   closing has no question);
 * - topicIndex is fixed up from the directive;
 * - an empty question is recovered from the reaction's last sentence or replaced with a canned one;
 * - expression / assessment ranges are sanitised.
 */
export function coerceTurn(turn: InterviewerTurn, directive: TurnDirective, plan: InterviewPlan, lang: Lang): InterviewerTurn {
  const allowed = allowedKinds(directive);
  const kind = allowed.includes(turn.kind) ? turn.kind : allowed[0];
  const kindChanged = kind !== turn.kind;
  let reaction = turn.reaction.trim();
  let question = turn.question.trim();

  switch (kind) {
    case 'closing':
      // Everything is said as the goodbye; nothing is pinned for an answer.
      reaction = joinSpeech([reaction, question], lang);
      question = '';
      if (!reaction) reaction = CANNED.closing[lang];
      break;
    case 'reverse_prompt':
      if (!question && reaction) ({ reaction, question } = splitReactionQuestion(reaction, lang));
      if (!question || (kindChanged && !INVITES_QUESTIONS_RE.test(question))) {
        // The model asked something else (e.g. another main question) — keep its reaction only.
        question = CANNED.reversePrompt[lang];
      }
      break;
    case 'reverse_answer':
      // The model asked the candidate an interview question instead of answering theirs.
      if (kindChanged && ASKS_CANDIDATE_KINDS.includes(turn.kind) && !INVITES_QUESTIONS_RE.test(question)) {
        question = CANNED.anythingElse[lang];
        break;
      }
      if (!question && reaction) {
        const split = splitReactionQuestion(reaction, lang);
        if (INVITES_QUESTIONS_RE.test(split.question) || /[?？]$/.test(split.question)) ({ reaction, question } = split);
      }
      if (!question) question = CANNED.anythingElse[lang];
      break;
    case 'main':
    case 'followup':
    case 'opening':
      // A main question was required but the model asked something else (a follow-up on the old
      // topic, a reverse-Q&A invite…): its question does not belong to the new topic, so it must not be
      // pinned under the new chapter card. (An unknown kind — the 'opening' sentinel — is only a bad
      // label, so its question is kept.)
      if (kind === 'main' && kindChanged && turn.kind !== 'opening') {
        const ti = directiveTopicIndex(directive, kind);
        question = cannedMainQuestion(ti !== null ? plan.topics[ti] : undefined, lang);
      }
      if (!question && reaction) ({ reaction, question } = splitReactionQuestion(reaction, lang));
      if (!question) {
        const ti = directiveTopicIndex(directive, kind);
        question = kind === 'followup' ? CANNED.followup[lang] : cannedMainQuestion(ti !== null ? plan.topics[ti] : undefined, lang);
      }
      break;
  }

  const directed = directiveTopicIndex(directive, kind);
  const topicIndex =
    kind === 'main' || kind === 'followup'
      ? Math.max(0, Math.min(plan.topics.length - 1, directed ?? 0))
      : null;
  const assessment = turn.assessment
    ? {
        score: clampScore(turn.assessment.score),
        comment: turn.assessment.comment.trim(),
        affinityDelta: clampAffinityDelta(turn.assessment.affinityDelta),
      }
    : null;

  return {
    kind,
    reaction,
    question,
    expression: EXPRESSIONS.includes(turn.expression) ? turn.expression : 'neutral',
    topicIndex,
    assessment,
  };
}
