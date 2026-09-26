/**
 * Shape of a character's scripted line bank for the offline interviewer.
 * Placeholders (`{project}`, `{skill}`, …) are filled by the demo engine; every line must read
 * naturally when spoken aloud (no brackets, emoji or markdown).
 */
import type { EndingId, Expression, Localized } from '../../../types';
import type { GenericTopicId } from '../../genericTopics';

export type Lines = Localized<readonly string[]>;

/** Answer quality band used to choose reactions. */
export type Band = 'great' | 'good' | 'ok' | 'weak' | 'poor';

export type SpecialReaction = 'skipped' | 'refusal' | 'dontKnow' | 'manipulation' | 'joking' | 'offLanguage' | 'long';

/** Why the interviewer follows up. `{focus}` = a term from the answer, `{topic}` = topic title. */
export type FollowupKind = 'short' | 'numbers' | 'personal' | 'result' | 'why' | 'deeper' | 'dontKnow' | 'vague';

/** Résumé-grounded question categories (generic topics use GenericTopicId). */
export type GroundedCategory = 'project' | 'skill' | 'metric' | 'company' | 'school' | 'jdMatch' | 'jdGap' | 'thin' | 'role' | 'custom';
export type QuestionCategory = GroundedCategory | GenericTopicId | 'scenario';

export type ReverseTopic =
  | 'team'
  | 'tech'
  | 'growth'
  | 'process'
  | 'culture'
  | 'salary'
  | 'product'
  | 'remote'
  | 'expectation'
  | 'interviewer'
  | 'generic';

export interface CharacterLines {
  /** `{hi}` greeting, `{hook}` optional ice-breaker sentence. Must end with the self-intro request. */
  openings: Lines;
  /** Ice-breakers about the résumé: `{project}`, `{company}`, `{school}`, `{skill}`. '' allowed. */
  hooks: Localized<{ project: readonly string[]; company: readonly string[]; school: readonly string[]; skill: readonly string[]; none: readonly string[] }>;
  reactions: Record<Band, Lines>;
  special: Record<SpecialReaction, Lines>;
  /** Reaction to the self-introduction (strong = specific and substantial). */
  introReactions: { strong: Lines; weak: Lines };
  /** Lead-in after the self-introduction, before the first topic (no thanks — the reaction did that). */
  firstTopic: Lines;
  /** Lead-in before later main topics. */
  transitions: Lines;
  /** Character-specific question phrasings; falls back to the shared bank. */
  questions: Partial<Record<QuestionCategory, Lines>>;
  followups: Record<FollowupKind, Lines>;
  reversePrompt: Lines;
  reverseAnswers: Record<ReverseTopic, Lines>;
  /** "Anything else?" */
  reverseMore: Lines;
  /** Short lead-in when closing right after answering the last question. */
  lastAnswerBridge: Lines;
  closings: Lines;
  finalMessages: Record<EndingId, Lines>;
  expressions: {
    band: Record<Band, readonly Expression[]>;
    followup: readonly Expression[];
    main: readonly Expression[];
    reverse: Expression;
    closing: Expression;
    special: Record<SpecialReaction, Expression>;
  };
}
