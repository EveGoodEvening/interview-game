/**
 * Directive selection: what the interviewer must do next, derived purely from the session.
 * Being a pure function of the session makes "retry" and "resume from autosave" trivial:
 * the same session always yields the same directive.
 */
import type { InterviewSession, TurnDirective, TurnKind } from '../types';
import { isSkipped, pendingReply } from './transcript';

/** The reverse Q&A closes automatically once the candidate has asked this many questions. */
export const MAX_REVERSE_QUESTIONS = 3;

type SessionView = Pick<
  InterviewSession,
  'transcript' | 'plan' | 'currentTopicIndex' | 'followUpsOnCurrent' | 'reverseAsked' | 'config'
>;

function afterTopic(topicIndex: number, topicCount: number): { type: 'main'; topicIndex: number } | { type: 'reverse_prompt' } {
  return topicIndex + 1 < topicCount ? { type: 'main', topicIndex: topicIndex + 1 } : { type: 'reverse_prompt' };
}

/**
 * Directive for the turn that answers the candidate's latest entry, or null when the transcript
 * does not end with a candidate entry (nothing to respond to) or the interview is already closed.
 *
 * - self-intro answered → main topic 0
 * - main/follow-up answered, follow-ups left and not skipped → followup_or_next (AI decides)
 * - otherwise → next main topic, or reverse_prompt after the last topic
 * - reverse prompt/answer: skipped ("no more questions") → closing; the candidate's 3rd question → closing
 *   (the closing turn answers it briefly); otherwise reverse_answer
 */
export function nextDirective(session: SessionView): TurnDirective | null {
  const reply = pendingReply(session.transcript);
  if (!reply) return null;
  const topicCount = session.plan?.topics.length ?? 0;
  const skipped = isSkipped(reply.entry);
  const kind: TurnKind = reply.answered?.kind ?? 'opening';

  switch (kind) {
    case 'opening':
      return topicCount > 0 ? { type: 'main', topicIndex: 0 } : { type: 'reverse_prompt' };
    case 'main':
    case 'followup': {
      const current = Math.max(0, reply.answered?.topicIndex ?? session.currentTopicIndex);
      const next = afterTopic(current, topicCount);
      const maxFollowUps = Math.max(0, session.config.maxFollowUps);
      if (!skipped && session.followUpsOnCurrent < maxFollowUps) {
        return { type: 'followup_or_next', currentTopicIndex: current, next };
      }
      return next;
    }
    case 'reverse_prompt':
    case 'reverse_answer':
      if (skipped) return { type: 'closing' };
      if (session.reverseAsked + 1 >= MAX_REVERSE_QUESTIONS) return { type: 'closing' };
      return { type: 'reverse_answer' };
    case 'closing':
      return null;
  }
}

/** Turn kinds the AI may return for a directive. The first one is the default when coercing. */
export function allowedKinds(directive: TurnDirective): TurnKind[] {
  switch (directive.type) {
    case 'main':
      return ['main'];
    case 'followup_or_next':
      return [directive.next.type === 'main' ? 'main' : 'reverse_prompt', 'followup'];
    case 'reverse_prompt':
      return ['reverse_prompt'];
    case 'reverse_answer':
      // The candidate may say "no, that's all" by voice instead of pressing the button.
      return ['reverse_answer', 'closing'];
    case 'closing':
      return ['closing'];
  }
}

/** Topic index the directive's "next" step belongs to (null for reverse / closing). */
export function directiveTopicIndex(directive: TurnDirective, kind: TurnKind): number | null {
  switch (directive.type) {
    case 'main':
      return directive.topicIndex;
    case 'followup_or_next':
      if (kind === 'followup') return directive.currentTopicIndex;
      return directive.next.type === 'main' ? directive.next.topicIndex : null;
    default:
      return null;
  }
}
