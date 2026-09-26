/**
 * Loaded autosaves and records are re-sanitised (review A7): a save from an older / newer build or a
 * hand-edited one must not reach the engine or the UI with missing or invalid fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterviewReport } from '../types';
import { MemoryStorage } from './__fixtures__/memoryStorage';
import { makeConfig, makePlan, makeTurn } from './__fixtures__/builders';
import { nextDirective } from './directive';
import { STORAGE_KEYS, clearAutosave, loadAutosave, loadRecords, saveAutosave } from './persistence';
import { createRecord, finishSession } from './records';
import { applyAnswer, applyPlan, applyTurn, createSession } from './session';

const REPORT: InterviewReport = {
  overallScore: 70,
  dimensions: [],
  strengths: ['s'],
  improvements: ['i'],
  questionReviews: [],
  summary: 'sum',
  finalMessage: 'bye',
};

/** Opening → intro answered → main 0 → answered → follow-up → answered (waiting for a turn). */
function midSession() {
  let s = applyPlan(createSession(makeConfig({ maxFollowUps: 2, answerTimeLimitSec: 90 })), makePlan(3)).session;
  s = applyAnswer(s, '自我介绍', { via: 'text', durationSec: 5 }).session;
  s = applyTurn(s, makeTurn('main', { topicIndex: 0 }), { type: 'main', topicIndex: 0 }).session;
  s = applyAnswer(s, '回答一', { via: 'text', durationSec: 5 }).session;
  s = applyTurn(s, makeTurn('followup', { topicIndex: 0 }), { type: 'followup_or_next', currentTopicIndex: 0, next: { type: 'main', topicIndex: 1 } }).session;
  s = applyAnswer(s, '回答二', { via: 'voice', durationSec: 7 }).session;
  return s;
}

let storage: MemoryStorage;
const store = (value: unknown) => storage.setItem(STORAGE_KEYS.session, JSON.stringify(value));

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadAutosave re-sanitises the stored session', () => {
  it('leaves a well-formed save untouched', () => {
    const s = midSession();
    expect(saveAutosave(s)).toBe(true);
    expect(loadAutosave()).toEqual(s);
  });

  it('a save without answerTimeLimitSec loads with no time limit (not NaN → instant auto-skip)', () => {
    const s = midSession();
    const { answerTimeLimitSec: _drop, ...config } = s.config;
    store({ ...s, config });
    const loaded = loadAutosave()!;
    expect(loaded.config.answerTimeLimitSec).toBe(0);
    expect(Number.isFinite(loaded.config.answerTimeLimitSec)).toBe(true);
  });

  it('replaces unknown / invalid config values with defaults', () => {
    const s = midSession();
    store({ ...s, config: { characterId: 'yuki', lang: 'zh', resumeText: 'r', style: 'freestyle', difficulty: 'nightmare', maxFollowUps: 'two', answerTimeLimitSec: null, mainQuestions: null } });
    const c = loadAutosave()!.config;
    expect(c).toMatchObject({ style: 'mixed', difficulty: 'normal', maxFollowUps: 2, answerTimeLimitSec: 0, resumeFileName: '', targetRole: '', jobDescription: '' });
    // The plan already fixes the number of topics.
    expect(c.mainQuestions).toBe(3);
  });

  it('re-derives missing counters from the transcript so the next directive is unchanged', () => {
    const s = midSession();
    const expected = nextDirective(s);
    const { currentTopicIndex: _a, mainAsked: _b, followUpsOnCurrent: _c, reverseAsked: _d, affinity: _e, scores: _f, ...rest } = s;
    store(rest);
    const loaded = loadAutosave()!;
    expect(loaded).toMatchObject({ currentTopicIndex: 0, mainAsked: 1, followUpsOnCurrent: 1, reverseAsked: 0, affinity: 50, scores: [] });
    expect(nextDirective(loaded)).toEqual(expected);
  });

  it('fills missing turn / answer fields', () => {
    const s = midSession();
    const transcript = s.transcript.map((e) =>
      e.role === 'interviewer' ? { ...e, turn: { kind: e.turn!.kind, question: e.turn!.question } } : { ...e, answer: { skipped: false } },
    );
    store({ ...s, transcript });
    const loaded = loadAutosave()!;
    for (const e of loaded.transcript) {
      if (e.role === 'interviewer') expect(e.turn).toMatchObject({ reaction: '', expression: 'neutral', assessment: null });
      else expect(e.answer).toEqual({ skipped: false, via: 'text', durationSec: 0 });
    }
  });

  it('drops unusable saves and deletes them', () => {
    const s = midSession();
    for (const bad of [
      { ...s, phase: 'dancing' },
      { ...s, config: { ...s.config, characterId: 'bob' } },
      { ...s, transcript: [{ role: 'interviewer', id: 'x', text: 't', at: 1, turn: { kind: 'monologue', question: '' } }] },
      { ...s, plan: { topics: 'none' } },
      { ...s, phase: 'finished' },
    ]) {
      store(bad);
      expect(loadAutosave()).toBeNull();
      expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    }
  });

  it('saveAutosave reports a failed write', () => {
    const s = midSession();
    storage.quota = 10;
    expect(saveAutosave(s)).toBe(false);
    storage.quota = null;
    expect(saveAutosave(s)).toBe(true);
    clearAutosave();
    vi.stubGlobal('localStorage', undefined);
    expect(saveAutosave(s)).toBe(false);
  });
});

describe('loadRecords re-sanitises stored records', () => {
  it('fills missing config fields and drops junk entries / dimensions', () => {
    const rec = createRecord(finishSession(midSession(), { ...REPORT, dimensions: [{ key: 'logic', score: 70, comment: 'ok' }] }), 5);
    const { answerTimeLimitSec: _t, style: _s, ...config } = rec.config;
    storage.setItem(
      STORAGE_KEYS.records,
      JSON.stringify([
        {
          ...rec,
          config: { ...config, difficulty: 'impossible' },
          transcript: [...rec.transcript, { junk: true }],
          report: { ...rec.report, dimensions: [...rec.report.dimensions, { key: 'charm', score: 99 }], strengths: ['s', 3] },
        },
      ]),
    );
    const [loaded] = loadRecords();
    expect(loaded.config).toMatchObject({ answerTimeLimitSec: 0, style: 'mixed', difficulty: 'normal' });
    expect(loaded.transcript).toEqual(rec.transcript);
    expect(loaded.report.dimensions).toEqual([{ key: 'logic', score: 70, comment: 'ok' }]);
    expect(loaded.report.strengths).toEqual(['s']);
  });

  it('leaves a well-formed record untouched', () => {
    const rec = createRecord(finishSession(midSession(), REPORT), 5);
    storage.setItem(STORAGE_KEYS.records, JSON.stringify([rec]));
    expect(loadRecords()).toEqual([rec]);
  });
});
