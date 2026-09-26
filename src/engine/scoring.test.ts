import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterviewReport } from '../types';
import { MemoryStorage } from './__fixtures__/memoryStorage';
import { makeConfig, makePlan, makeTurn } from './__fixtures__/builders';
import {
  STORAGE_KEYS,
  clearAutosave,
  loadAutosave,
  loadEndings,
  loadRecords,
  readJson,
  saveAutosave,
  saveEndings,
  saveRecords,
  writeJson,
} from './persistence';
import { MAX_RECORDS, MAX_RECORD_RESUME_CHARS, addRecord, createRecord, endingKey, finishSession, unlockEnding } from './records';
import {
  alignOverallScore,
  answerMeanToOverall,
  computeEnding,
  computeFinalScore,
  meanAnswerScore,
  projectedEnding,
  referenceOverall,
} from './scoring';
import { applyAnswer, applyPlan, applyTurn, createSession } from './session';

const REPORT: InterviewReport = {
  overallScore: 80,
  dimensions: [],
  strengths: [],
  improvements: [],
  questionReviews: [],
  summary: 's',
  finalMessage: 'f',
};

describe('scores and endings', () => {
  it('blends report score and affinity', () => {
    expect(computeFinalScore(80, 50)).toBe(74);
    expect(computeFinalScore(100, 100)).toBe(100);
    expect(computeFinalScore(150, -20)).toBe(80);
  });

  it.each([
    [95, 85, 'perfect'],
    [95, 79, 'offer'],
    [90, 80, 'perfect'],
    [89, 99, 'offer'],
    [75, 10, 'offer'],
    [74, 90, 'pending'],
    [60, 50, 'pending'],
    [59, 100, 'rejected'],
  ] as const)('finalScore %i, affinity %i → %s', (score, affinity, ending) => {
    expect(computeEnding(score, affinity)).toBe(ending);
  });

  it('reference and projected ending follow the per-answer scores', () => {
    expect(referenceOverall([])).toBeNull();
    expect(referenceOverall([{ entryId: 'a', score: 6, comment: '' }, { entryId: 'b', score: 9, comment: '' }])).toBe(80);
    expect(projectedEnding([{ entryId: 'a', score: 9, comment: '' }], 90)).toBe('perfect');
    expect(projectedEnding([{ entryId: 'a', score: 3, comment: '' }], 50)).toBe('rejected');
  });

  it('maps the 0–10 rubric onto 0–100 so the rubric anchors land in the matching ending band', () => {
    expect([0, 3, 5, 6, 7, 8, 9, 10].map(answerMeanToOverall)).toEqual([0, 32, 55, 65, 75, 84, 92, 100]);
    expect(answerMeanToOverall(7.5)).toBe(80);
    expect(answerMeanToOverall(-3)).toBe(0);
    expect(answerMeanToOverall(14)).toBe(100);
    const endingFor = (answerScore: number, affinity: number) =>
      projectedEnding(Array.from({ length: 8 }, (_, i) => ({ entryId: `e${i}`, score: answerScore, comment: '' })), affinity);
    // Rubric: 5 "adequate" → borderline reject, 6 → pending, 7 "specific and solid" → offer, 9 "exceptional" → perfect.
    expect(endingFor(5, 55)).toBe('rejected');
    expect(endingFor(6, 60)).toBe('pending');
    expect(endingFor(7, 75)).toBe('offer');
    expect(endingFor(9, 90)).toBe('perfect');
  });

  it('averages answers per topic first when the transcript is known', () => {
    let s = applyPlan(createSession(makeConfig({ maxFollowUps: 2 })), makePlan(2)).session;
    const answer = (text: string) => (s = applyAnswer(s, text, { via: 'text', durationSec: 5 }).session);
    const turn = (kind: 'main' | 'followup', topicIndex: number, score: number, next: Parameters<typeof applyTurn>[2]) =>
      (s = applyTurn(s, makeTurn(kind, { topicIndex, assessment: { score, comment: '', affinityDelta: 0 } }), next).session);
    answer('自我介绍');
    turn('main', 0, 7, { type: 'main', topicIndex: 0 }); // intro scored 7
    answer('很扎实的回答');
    turn('main', 1, 9, { type: 'followup_or_next', currentTopicIndex: 0, next: { type: 'main', topicIndex: 1 } }); // topic 1 main: 9
    answer('空泛');
    turn('followup', 1, 3, { type: 'followup_or_next', currentTopicIndex: 1, next: { type: 'reverse_prompt' } }); // topic 2 main: 3
    answer('还是空泛');
    turn('followup', 1, 4, { type: 'followup_or_next', currentTopicIndex: 1, next: { type: 'reverse_prompt' } }); // topic 2 follow-up: 4
    answer('好一些了');
    s = applyTurn(s, makeTurn('reverse_prompt', { assessment: { score: 5, comment: '', affinityDelta: 0 } }), { type: 'reverse_prompt' }).session; // topic 2 follow-up: 5
    expect(s.scores.map((x) => x.score)).toEqual([7, 9, 3, 4, 5]);
    expect(meanAnswerScore(s.scores)).toBeCloseTo(5.6);
    // intro 7 · topic 1: 9 · topic 2: (3 + 4 + 5) / 3 = 4 → 20 / 3
    expect(meanAnswerScore(s.scores, s.transcript)).toBeCloseTo(20 / 3);
    expect(referenceOverall(s.scores, s.transcript)).toBe(answerMeanToOverall(20 / 3));
    expect(projectedEnding(s.scores, 70, s.transcript)).toBe('pending');
  });

  it('aligns an evaluator score to the evidence and the projected ending', () => {
    expect(alignOverallScore(95, { reference: 60, affinity: 50 })).toBe(75);
    expect(computeEnding(computeFinalScore(alignOverallScore(95, { reference: 75, affinity: 80, ending: 'offer' }), 80), 80)).toBe('offer');
    expect(alignOverallScore(40, { reference: 60, affinity: 50 })).toBe(45);
    const aligned = alignOverallScore(80, { reference: 70, affinity: 50, ending: 'pending' });
    expect(computeEnding(computeFinalScore(aligned, 50), 50)).toBe('pending');
    expect(alignOverallScore(70, { reference: null, affinity: 50, ending: null })).toBe(70);
  });
});

describe('records & endings', () => {
  it('finishes a session and builds a record with a truncated résumé', () => {
    const s = applyPlan(createSession(makeConfig({ resumeText: 'r'.repeat(9000) })), makePlan()).session;
    const done = finishSession({ ...s, affinity: 50 }, REPORT);
    expect(done).toMatchObject({ phase: 'finished', finalScore: 74, ending: 'pending', report: REPORT });
    const rec = createRecord(done, 1000);
    expect(rec.config.resumeText.length).toBe(MAX_RECORD_RESUME_CHARS);
    expect(rec).toMatchObject({ finishedAt: 1000, characterId: 'yuki', lang: 'zh', ending: 'pending', finalScore: 74, affinity: 50 });
    expect(() => createRecord(s)).toThrow();
  });

  it('keeps newest records first, max 30, no duplicates', () => {
    const s = finishSession(applyPlan(createSession(makeConfig()), makePlan()).session, REPORT);
    let records = [createRecord(s, 1)];
    for (let i = 0; i < 40; i++) records = addRecord(records, createRecord(s, i + 2));
    expect(records).toHaveLength(MAX_RECORDS);
    expect(records[0].finishedAt).toBe(41);
    expect(addRecord(records, records[3])[0].id).toBe(records[3].id);
    expect(addRecord(records, records[3])).toHaveLength(MAX_RECORDS);
  });

  it('unlocks endings once', () => {
    const first = unlockEnding({}, 'haru', 'offer', 5);
    expect(first).toEqual({ endings: { 'haru:offer': 5 }, firstTime: true });
    const again = unlockEnding(first.endings, 'haru', 'offer', 9);
    expect(again).toEqual({ endings: { 'haru:offer': 5 }, firstTime: false });
    expect(endingKey('yuki', 'perfect')).toBe('yuki:perfect');
  });
});

describe('persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a silent no-op without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writeJson('k', 1)).toBe(false);
    expect(readJson('k')).toBeNull();
    expect(loadRecords()).toEqual([]);
    expect(loadEndings()).toEqual({});
    expect(loadAutosave()).toBeNull();
    expect(() => clearAutosave()).not.toThrow();
  });

  it('survives a throwing localStorage getter', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readJson('k')).toBeNull();
      expect(writeJson('k', 1)).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('round-trips autosave, records and endings, and drops invalid data', () => {
    const store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
    const s = applyPlan(createSession(makeConfig()), makePlan()).session;
    saveAutosave(s);
    expect(loadAutosave()).toEqual(s);
    clearAutosave();
    expect(loadAutosave()).toBeNull();

    store.setItem(STORAGE_KEYS.session, JSON.stringify({ id: 1 }));
    expect(loadAutosave()).toBeNull();
    expect(store.getItem(STORAGE_KEYS.session)).toBeNull();
    store.setItem(STORAGE_KEYS.session, '{not json');
    expect(loadAutosave()).toBeNull();

    const rec = createRecord(finishSession(s, REPORT), 7);
    saveRecords([rec]);
    store.setItem(STORAGE_KEYS.records, JSON.stringify([rec, { junk: true }]));
    expect(loadRecords()).toEqual([rec]);

    saveEndings({ 'yuki:offer': 3 });
    store.setItem(STORAGE_KEYS.endings, JSON.stringify({ 'yuki:offer': 3, 'bob:offer': 1, 'haru:nope': 2, 'ethan:perfect': 'x' }));
    expect(loadEndings()).toEqual({ 'yuki:offer': 3 });
  });

  it('drops the oldest records when the quota is exceeded', () => {
    const store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
    const rec = createRecord(finishSession(applyPlan(createSession(makeConfig()), makePlan()).session, REPORT));
    const size = JSON.stringify([rec]).length;
    store.quota = size * 3 + 10;
    const kept = saveRecords(Array.from({ length: 12 }, () => rec));
    expect(kept).toBeLessThanOrEqual(3);
    expect(kept).toBeGreaterThan(0);
    expect(loadRecords()).toHaveLength(kept);
  });
});
