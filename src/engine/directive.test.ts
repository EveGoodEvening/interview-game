import { describe, expect, it } from 'vitest';
import type { InterviewSession, TurnDirective, TurnKind } from '../types';
import { makeConfig, makePlan, makeTurn } from './__fixtures__/builders';
import { MAX_REVERSE_QUESTIONS, allowedKinds, directiveTopicIndex, nextDirective } from './directive';
import { createSession, makeCandidateEntry, makeInterviewerEntry } from './session';

function sessionAfter(
  answered: TurnKind,
  opts: { skipped?: boolean; topicIndex?: number; followUps?: number; reverseAsked?: number; topics?: number; maxFollowUps?: number } = {},
): InterviewSession {
  const base = createSession(makeConfig({ maxFollowUps: opts.maxFollowUps ?? 2 }));
  const s: InterviewSession = {
    ...base,
    plan: makePlan(opts.topics ?? 3),
    currentTopicIndex: opts.topicIndex ?? -1,
    followUpsOnCurrent: opts.followUps ?? 0,
    reverseAsked: opts.reverseAsked ?? 0,
  };
  const q = makeInterviewerEntry(makeTurn(answered, { topicIndex: opts.topicIndex ?? null }), s);
  const a = makeCandidateEntry(opts.skipped ? '' : '我的回答', { via: 'text', durationSec: 3, skipped: opts.skipped ?? false });
  return { ...s, transcript: [q, a] };
}

describe('nextDirective', () => {
  const cases: [string, InterviewSession, TurnDirective | null][] = [
    ['self-intro → first main topic', sessionAfter('opening'), { type: 'main', topicIndex: 0 }],
    ['skipped self-intro → first main topic', sessionAfter('opening', { skipped: true }), { type: 'main', topicIndex: 0 }],
    [
      'main answered, follow-ups left → followup_or_next (next main)',
      sessionAfter('main', { topicIndex: 0 }),
      { type: 'followup_or_next', currentTopicIndex: 0, next: { type: 'main', topicIndex: 1 } },
    ],
    [
      'last topic answered, follow-ups left → followup_or_next (reverse)',
      sessionAfter('main', { topicIndex: 2 }),
      { type: 'followup_or_next', currentTopicIndex: 2, next: { type: 'reverse_prompt' } },
    ],
    ['main skipped → next main', sessionAfter('main', { topicIndex: 0, skipped: true }), { type: 'main', topicIndex: 1 }],
    ['no follow-ups left → next main', sessionAfter('followup', { topicIndex: 1, followUps: 2 }), { type: 'main', topicIndex: 2 }],
    ['maxFollowUps 0 → next main', sessionAfter('main', { topicIndex: 0, maxFollowUps: 0 }), { type: 'main', topicIndex: 1 }],
    ['last topic, no follow-ups left → reverse_prompt', sessionAfter('followup', { topicIndex: 2, followUps: 2 }), { type: 'reverse_prompt' }],
    ['reverse prompt answered → reverse_answer', sessionAfter('reverse_prompt'), { type: 'reverse_answer' }],
    ['reverse prompt skipped (no questions) → closing', sessionAfter('reverse_prompt', { skipped: true }), { type: 'closing' }],
    ['2nd reverse question → reverse_answer', sessionAfter('reverse_answer', { reverseAsked: 1 }), { type: 'reverse_answer' }],
    [
      `question #${MAX_REVERSE_QUESTIONS} → closing (auto-close)`,
      sessionAfter('reverse_answer', { reverseAsked: MAX_REVERSE_QUESTIONS - 1 }),
      { type: 'closing' },
    ],
    ['after closing → nothing', sessionAfter('closing'), null],
  ];
  it.each(cases)('%s', (_name, session, expected) => {
    expect(nextDirective(session)).toEqual(expected);
  });

  it('returns null when the transcript ends with the interviewer', () => {
    const s = sessionAfter('main', { topicIndex: 0 });
    expect(nextDirective({ ...s, transcript: s.transcript.slice(0, 1) })).toBeNull();
    expect(nextDirective({ ...s, transcript: [] })).toBeNull();
  });

  it('goes straight to the reverse prompt when the plan has no topics', () => {
    expect(nextDirective(sessionAfter('opening', { topics: 0 }))).toEqual({ type: 'reverse_prompt' });
  });
});

describe('allowedKinds / directiveTopicIndex', () => {
  it('lists the default kind first', () => {
    expect(allowedKinds({ type: 'main', topicIndex: 1 })).toEqual(['main']);
    expect(allowedKinds({ type: 'followup_or_next', currentTopicIndex: 0, next: { type: 'main', topicIndex: 1 } })).toEqual(['main', 'followup']);
    expect(allowedKinds({ type: 'followup_or_next', currentTopicIndex: 2, next: { type: 'reverse_prompt' } })).toEqual(['reverse_prompt', 'followup']);
    expect(allowedKinds({ type: 'reverse_prompt' })).toEqual(['reverse_prompt']);
    expect(allowedKinds({ type: 'reverse_answer' })).toEqual(['reverse_answer', 'closing']);
    expect(allowedKinds({ type: 'closing' })).toEqual(['closing']);
  });

  it('maps kinds to topic indices', () => {
    const d: TurnDirective = { type: 'followup_or_next', currentTopicIndex: 1, next: { type: 'main', topicIndex: 2 } };
    expect(directiveTopicIndex(d, 'followup')).toBe(1);
    expect(directiveTopicIndex(d, 'main')).toBe(2);
    expect(directiveTopicIndex({ type: 'main', topicIndex: 0 }, 'main')).toBe(0);
    expect(directiveTopicIndex({ type: 'reverse_prompt' }, 'reverse_prompt')).toBeNull();
  });
});
