import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDemoDelay } from '../ai/demoInterviewer';
import { createLlmInterviewer } from '../ai/llmInterviewer';
import { FakeProvider } from '../ai/__fixtures__/fakeProvider';
import type { ChatRequest } from '../llm/types';
import { ZH_RESUME } from '../ai/__fixtures__/resumes';
import { MemoryStorage } from '../engine/__fixtures__/memoryStorage';
import { makeConfig, makePlan, makeTurn } from '../engine/__fixtures__/builders';
import { STORAGE_KEYS, loadAutosave } from '../engine/persistence';
import { MAX_RECORD_RESUME_CHARS } from '../engine/records';
import { useSetupStore } from '../screens/setup/draft';
import { LlmError } from '../llm/types';
import type { InterviewConfig, InterviewReport, InterviewerAI, TurnContext } from '../types';
import { type GameEvent, fullConfigFor, setInterviewerAIFactory, useGameStore } from './game';

const store = () => useGameStore.getState();
const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

const REPORT: InterviewReport = {
  overallScore: 70,
  dimensions: [],
  strengths: ['s'],
  improvements: ['i'],
  questionReviews: [],
  summary: 'sum',
  finalMessage: 'bye',
};

const GOOD = '当时订单查询接口在大促时 P99 延迟很高。我负责缓存改造：首先分析热点数据，然后用 Redis 做二级缓存，因为本地缓存能挡住击穿，最后 P99 从 320ms 降到 80ms。';

function config(overrides: Partial<InterviewConfig> = {}): InterviewConfig {
  return makeConfig({ resumeText: ZH_RESUME, mainQuestions: 3, maxFollowUps: 1, ...overrides });
}

/** Scripted AI: turn kinds follow the directive's default; hooks allow failures and delays. */
function scriptedAI(hooks: { prepare?: () => Promise<void>; nextTurn?: (ctx: TurnContext, signal?: AbortSignal) => Promise<void>; evaluate?: () => Promise<void> } = {}): InterviewerAI & { signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  return {
    isDemo: false,
    signals,
    async prepare(_config, _character, signal) {
      signals.push(signal);
      await hooks.prepare?.();
      return makePlan(2);
    },
    async nextTurn(ctx, signal) {
      signals.push(signal);
      await hooks.nextTurn?.(ctx, signal);
      const d = ctx.directive;
      if (d.type === 'main') return makeTurn('main', { topicIndex: d.topicIndex, question: `主问题${d.topicIndex + 1}？` });
      if (d.type === 'followup_or_next') return makeTurn('followup', { question: '追问？' });
      if (d.type === 'reverse_prompt') return makeTurn('reverse_prompt', { question: '你有什么想问我的吗？' });
      if (d.type === 'reverse_answer') return makeTurn('reverse_answer', { reaction: '我们团队十个人。', question: '还有吗？', assessment: null });
      return makeTurn('closing', { reaction: '今天就到这里，再见。', question: '', assessment: null });
    },
    async evaluate(_ctx, signal) {
      signals.push(signal);
      await hooks.evaluate?.();
      return REPORT;
    },
  };
}

/** Advance the interview until `until` holds (answers every question with `answer`). */
async function drive(answer: (kind: string) => string, until: () => boolean = () => store().stage.kind === 'ended', limit = 80) {
  for (let i = 0; i < limit && !until(); i++) {
    const st = store();
    if (st.stage.kind === 'interviewer') st.interviewerDone();
    else if (st.stage.kind === 'answer') {
      const kind = st.session!.transcript.at(-1)!.turn!.kind;
      await st.submitAnswer(answer(kind), { via: 'text', durationSec: 12 });
    } else if (st.stage.kind === 'error') throw new Error(`unexpected error stage: ${st.stage.message}`);
    await flush(2);
  }
}

function eventsOf<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
  return store().events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  setDemoDelay(0);
  setInterviewerAIFactory(null);
  store().abandonInterview();
  useGameStore.setState({ records: [], endings: {}, events: [], lastRecord: null, screen: 'title', previousScreen: null });
});

afterEach(() => {
  setInterviewerAIFactory(null);
  setDemoDelay(600);
  vi.unstubAllGlobals();
});

describe('game store with the demo interviewer', () => {
  it('plays a full interview from start to the result screen', async () => {
    await store().startInterview(config());
    expect(store().screen).toBe('interview');
    expect(store().stage.kind).toBe('interviewer');
    expect(store().session!.phase).toBe('intro');
    expect(eventsOf('chapter')[0]).toMatchObject({ phase: 'intro', topicIndex: null });
    expect(loadAutosave()?.id).toBe(store().session!.id);

    let reverse = 0;
    await drive((kind) => (kind === 'reverse_prompt' || kind === 'reverse_answer' ? ['团队多大？', '有导师吗？', '流程是怎样的？'][reverse++] : GOOD));

    const s = store();
    expect(s.screen).toBe('result');
    expect(s.stage).toEqual({ kind: 'ended' });
    expect(s.session!.phase).toBe('finished');
    expect(s.session!.reverseAsked).toBe(3);
    const rec = s.lastRecord!;
    expect(rec).toMatchObject({ characterId: 'yuki', lang: 'zh', ending: s.session!.ending, finalScore: s.session!.finalScore });
    expect(rec.report.questionReviews.length).toBe(s.session!.scores.length);
    expect(s.records).toEqual([rec]);
    expect(s.endings[`yuki:${rec.ending}`]).toBeTypeOf('number');
    expect(eventsOf('ending_unlocked').at(-1)).toMatchObject({ recordId: rec.id, characterId: 'yuki', ending: rec.ending, firstTime: true });
    const chapters = eventsOf('chapter').map((e) => e.phase);
    expect(chapters).toEqual(expect.arrayContaining(['questioning', 'reverse', 'closing']));
    expect(eventsOf('affinity').length).toBeGreaterThan(0);
    // Persistence: autosave cleared, record and ending stored.
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.records)!)).toHaveLength(1);
    expect(Object.keys(JSON.parse(storage.getItem(STORAGE_KEYS.endings)!))).toEqual([`yuki:${rec.ending}`]);
    expect(store().hasAutosave()).toBe(false);
    // Event ids increase monotonically.
    const ids = store().events.map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('a second run of the same ending is not a first unlock', async () => {
    setInterviewerAIFactory(() => scriptedAI());
    for (let run = 0; run < 2; run++) {
      await store().startInterview(config());
      await drive(() => GOOD);
    }
    expect(store().records).toHaveLength(2);
    expect(eventsOf('ending_unlocked').at(-1)!.firstTime).toBe(false);
  });
});

/** A scripted "model" that follows the turn instructions embedded in the prompt. */
function scriptedModel(req: ChatRequest): string {
  if (req.purpose === 'plan') {
    const n = Number(/恰好 (\d+) 个/.exec(req.messages[0].content)?.[1] ?? 3);
    return JSON.stringify({
      candidateName: '张明远',
      targetRole: '后端开发工程师',
      summary: '有大厂后端经验。',
      highlights: ['缓存改造'],
      concerns: ['个人贡献待验证'],
      topics: Array.from({ length: n }, (_, i) => ({ title: `LLM 话题 ${i + 1}`, goal: '考察深度' })),
      opening: { speech: '你好，我是顾言深。先做个自我介绍吧。', expression: 'neutral' },
    });
  }
  if (req.purpose === 'report') {
    return '```json\n' + JSON.stringify({ overallScore: 76, dimensions: [], strengths: ['数据扎实'], improvements: ['多讲取舍'], questionReviews: [], summary: '不错', finalMessage: '欢迎加入。' }) + '\n```';
  }
  const last = req.messages.at(-1)!.content;
  const kind = /允许的 kind："(\w+)"/.exec(last)?.[1] ?? 'main';
  return JSON.stringify({
    assessment: { score: 8, comment: '具体', affinityDelta: 4 },
    kind,
    reaction: '嗯，有数据支撑。',
    question: kind === 'closing' ? '' : kind === 'reverse_prompt' ? '你有什么想问我的吗？' : kind === 'reverse_answer' ? '还有吗？' : '为什么这么设计？',
    expression: 'serious',
  });
}

describe('game store with the LLM interviewer (scripted model)', () => {
  it('plays a full interview through prompts, normalizers and coercion', async () => {
    const provider = new FakeProvider(Array.from({ length: 40 }, () => scriptedModel));
    setInterviewerAIFactory(() => createLlmInterviewer(provider));
    await store().startInterview(config({ characterId: 'ethan' }));
    let r = 0;
    await drive((kind) => (kind.startsWith('reverse') ? ['团队多大？', '技术栈？', '流程？'][r++] : GOOD));
    const s = store();
    expect(s.stage.kind).toBe('ended');
    expect(s.session!.plan!.topics.map((t) => t.title)).toEqual(['LLM 话题 1', 'LLM 话题 2', 'LLM 话题 3']);
    expect(s.session!.scores.every((x) => x.score === 8)).toBe(true);
    expect(s.lastRecord!.report.questionReviews).toHaveLength(s.session!.scores.length);
    expect(s.lastRecord!.report.finalMessage).toBe('欢迎加入。');
    const purposes = provider.requests.map((q) => q.purpose);
    expect(purposes[0]).toBe('plan');
    expect(purposes.at(-1)).toBe('report');
    // Every turn request of the session shares one system prompt (prompt caching).
    expect(new Set(provider.requests.filter((q) => q.purpose === 'turn').map((q) => q.system)).size).toBe(1);
  });
});

describe('answers, skips and the reverse Q&A', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  it('skipping costs affinity immediately and moves to the next main question', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'voice', durationSec: 30 });
    store().interviewerDone();
    const before = store().session!.affinity;
    await store().skipQuestion();
    const s = store().session!;
    const skipped = s.transcript.at(-2)!;
    expect(skipped.answer).toEqual({ via: 'text', durationSec: 0, skipped: true });
    expect(s.scores.find((x) => x.entryId === skipped.id)?.score).toBe(0);
    expect(eventsOf('affinity').some((e) => e.delta === -6 && e.value === before - 6)).toBe(true);
    expect(s.transcript.at(-1)!.turn).toMatchObject({ kind: 'main', topicIndex: 1 });
  });

  it('an empty answer counts as a skip; double submissions are ignored', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    const first = store().submitAnswer('回答', { via: 'text', durationSec: 5 });
    const second = store().submitAnswer('又一个回答', { via: 'text', durationSec: 5 });
    await Promise.all([first, second]);
    expect(store().session!.transcript.filter((e) => e.role === 'candidate')).toHaveLength(1);
    store().interviewerDone();
    await store().submitAnswer('   ', { via: 'voice', durationSec: 60 });
    expect(store().session!.transcript.filter((e) => e.answer?.skipped)).toHaveLength(1);
  });

  it('closes automatically after the third reverse question', async () => {
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答', () => store().session?.phase === 'reverse' && store().stage.kind === 'answer');
    expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('reverse_prompt');
    for (const q of ['一？', '二？']) {
      await store().submitAnswer(q, { via: 'text', durationSec: 1 });
      expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('reverse_answer');
      store().interviewerDone();
    }
    await store().submitAnswer('三？', { via: 'text', durationSec: 1 });
    expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('closing');
    expect(store().session!).toMatchObject({ phase: 'closing', reverseAsked: 3 });
    store().interviewerDone();
    await flush();
    expect(store().stage.kind).toBe('ended');
  });

  it('"No more questions" (and skip during the reverse Q&A) goes to the closing', async () => {
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答', () => store().session?.phase === 'reverse' && store().stage.kind === 'answer');
    const affinity = store().session!.affinity;
    await store().skipQuestion();
    const s = store().session!;
    expect(s.transcript.at(-2)).toMatchObject({ role: 'candidate', text: '我没有其他问题了，谢谢您。' });
    expect(s.transcript.at(-1)!.turn!.kind).toBe('closing');
    expect(s.affinity).toBe(affinity);
    expect(s.reverseAsked).toBe(0);
    // endReverseQA outside the reverse Q&A is a no-op.
    await store().endReverseQA();
    expect(store().session!.transcript).toHaveLength(s.transcript.length);
  });
});

describe('errors, retry and cancellation', () => {
  it('prepare failure → error stage → retry re-runs prepare', async () => {
    let fail = true;
    setInterviewerAIFactory(() =>
      scriptedAI({
        prepare: async () => {
          if (fail) throw new LlmError('rate_limit', 'slow down', { status: 429 });
        },
      }),
    );
    await store().startInterview(config());
    expect(store().stage).toEqual({ kind: 'error', code: 'rate_limit', message: 'slow down', retry: 'prepare' });
    expect(store().session!.phase).toBe('preparing');
    fail = false;
    await store().retry();
    expect(store().stage.kind).toBe('interviewer');
  });

  it('a config error from the AI factory is reported with its code', async () => {
    setInterviewerAIFactory(() => {
      throw new LlmError('config', 'missing API key');
    });
    await store().startInterview(config());
    expect(store().stage).toMatchObject({ kind: 'error', code: 'config', retry: 'prepare' });
    setInterviewerAIFactory(() => scriptedAI());
    await store().retry();
    expect(store().stage.kind).toBe('interviewer');
  });

  it('turn failure keeps the session and retry re-runs exactly that turn', async () => {
    let failures = 1;
    setInterviewerAIFactory(() =>
      scriptedAI({
        nextTurn: async () => {
          if (failures-- > 0) throw new Error('socket hang up');
        },
      }),
    );
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    expect(store().stage).toEqual({ kind: 'error', code: 'unknown', message: 'socket hang up', retry: 'turn' });
    const transcriptLength = store().session!.transcript.length;
    expect(store().session!.transcript.at(-1)!.role).toBe('candidate');
    await store().retry();
    expect(store().stage.kind).toBe('interviewer');
    expect(store().session!.transcript).toHaveLength(transcriptLength + 1);
    expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('main');
  });

  it('evaluation failure → retry evaluate → result', async () => {
    let fail = true;
    setInterviewerAIFactory(() =>
      scriptedAI({
        evaluate: async () => {
          if (fail) throw new LlmError('server', 'boom', { status: 500 });
        },
      }),
    );
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答', () => store().stage.kind === 'error');
    expect(store().stage).toMatchObject({ code: 'server', retry: 'evaluate' });
    expect(store().session!.phase).toBe('evaluating');
    fail = false;
    await store().retry();
    expect(store().stage.kind).toBe('ended');
    expect(store().lastRecord!.report).toEqual(REPORT);
  });

  it('abandoning mid-request aborts it and ignores the late result', async () => {
    let release!: () => void;
    const ai = scriptedAI({ nextTurn: () => new Promise<void>((r) => (release = r)) });
    setInterviewerAIFactory(() => ai);
    await store().startInterview(config());
    store().interviewerDone();
    const pending = store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    expect(store().stage).toEqual({ kind: 'loading', reason: 'thinking' });
    store().abandonInterview();
    expect(ai.signals.at(-1)!.aborted).toBe(true);
    release();
    await pending;
    expect(store()).toMatchObject({ session: null, stage: { kind: 'idle' }, screen: 'title' });
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    expect(store().hasAutosave()).toBe(false);
  });

  it('a new interview started mid-request is not clobbered by the old result', async () => {
    let release!: () => void;
    let calls = 0;
    setInterviewerAIFactory(() => scriptedAI({ prepare: () => (calls++ === 0 ? new Promise<void>((r) => (release = r)) : Promise.resolve()) }));
    const first = store().startInterview(config());
    await flush(1);
    await store().startInterview(config({ lang: 'en' }));
    const id = store().session!.id;
    release();
    await first;
    expect(store().session!.id).toBe(id);
    expect(store().session!.transcript).toHaveLength(1);
  });
});

describe('suspend & resume', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  it('resumes a pinned question at the answer stage', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    store().suspendInterview();
    expect(store().screen).toBe('title');
    expect(store().hasAutosave()).toBe(true);
    useGameStore.setState({ session: null });
    await store().resumeAutosave();
    expect(store().screen).toBe('interview');
    expect(store().stage).toEqual({ kind: 'answer' });
    expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('main');
  });

  it('re-requests the next turn when suspended while the interviewer was thinking', async () => {
    let release!: () => void;
    let hold = true;
    setInterviewerAIFactory(() => scriptedAI({ nextTurn: () => (hold ? new Promise<void>((r) => (release = r)) : Promise.resolve()) }));
    await store().startInterview(config());
    store().interviewerDone();
    const pending = store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    store().suspendInterview();
    release();
    await pending;
    expect(loadAutosave()!.transcript.at(-1)!.role).toBe('candidate');
    hold = false;
    useGameStore.setState({ session: null });
    await store().resumeAutosave();
    expect(store().stage.kind).toBe('interviewer');
    expect(store().session!.transcript.at(-1)!.turn!.kind).toBe('main');
  });

  it('re-runs prepare / evaluation and re-presents a closing line on resume', async () => {
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答', () => store().session?.transcript.at(-1)?.turn?.kind === 'closing');
    store().suspendInterview();
    await store().resumeAutosave();
    const last = store().session!.transcript.at(-1)!;
    expect(store().stage).toEqual({ kind: 'interviewer', entryId: last.id });
    store().interviewerDone();
    await flush();
    expect(store().stage.kind).toBe('ended');

    const finished = store().session!;
    storage.setItem(STORAGE_KEYS.session, JSON.stringify({ ...finished, phase: 'evaluating', report: null, ending: null, finalScore: null }));
    await store().resumeAutosave();
    expect(store().stage.kind).toBe('ended');
    expect(store().records).toHaveLength(2);

    const saved = { ...finished, phase: 'preparing' as const, plan: null, transcript: [], report: null, ending: null, finalScore: null };
    storage.setItem(STORAGE_KEYS.session, JSON.stringify(saved));
    await store().resumeAutosave();
    expect(store().session!.phase).toBe('intro');
    expect(store().stage.kind).toBe('interviewer');
  });
});

describe('records & navigation', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  it('views, deletes and clears records; clears endings', async () => {
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答');
    const rec = store().lastRecord!;
    store().navigate('records');
    store().viewRecord('missing');
    expect(store().screen).toBe('records');
    store().viewRecord(rec.id);
    expect(store()).toMatchObject({ screen: 'result', lastRecord: rec });
    store().deleteRecord(rec.id);
    expect(store().records).toEqual([]);
    expect(store().lastRecord).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.records)!)).toEqual([]);
    store().clearEndings();
    expect(store().endings).toEqual({});
    store().clearRecords();
    expect(store().records).toEqual([]);
  });

  it('does not yank the player out of Settings when the evaluation finishes', async () => {
    let release!: () => void;
    setInterviewerAIFactory(() => scriptedAI({ evaluate: () => new Promise<void>((r) => (release = r)) }));
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答', () => store().stage.kind === 'loading' && store().session?.phase === 'evaluating');
    store().openSettings();
    expect(store().screen).toBe('settings');
    release();
    await flush();
    expect(store().screen).toBe('settings');
    expect(store().stage.kind).toBe('ended');
    store().closeSettings();
    expect(store().screen).toBe('result');
  });
});

describe('store creation', () => {
  it('loads records and endings from storage', async () => {
    const seeded = new MemoryStorage();
    const rec = {
      id: 'r1',
      finishedAt: 5,
      characterId: 'haru',
      lang: 'en',
      config: makeConfig({ characterId: 'haru', lang: 'en' }),
      plan: null,
      transcript: [],
      report: REPORT,
      ending: 'offer',
      finalScore: 80,
      affinity: 70,
    };
    seeded.setItem(STORAGE_KEYS.records, JSON.stringify([rec, { broken: true }]));
    seeded.setItem(STORAGE_KEYS.endings, JSON.stringify({ 'haru:offer': 5 }));
    vi.stubGlobal('localStorage', seeded);
    vi.resetModules();
    const fresh = await import('./game');
    expect(fresh.useGameStore.getState().records).toEqual([rec]);
    expect(fresh.useGameStore.getState().endings).toEqual({ 'haru:offer': 5 });
  });
});

describe('autosave failures and Continue (review A6)', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  const storedLength = () => (JSON.parse(storage.getItem(STORAGE_KEYS.session)!) as { transcript: unknown[] }).transcript.length;

  it('emits one storage_warning per failure streak', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    expect(eventsOf('storage_warning')).toHaveLength(0);
    storage.quota = 10;
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    expect(eventsOf('storage_warning')).toHaveLength(1);
    store().interviewerDone();
    await store().submitAnswer('回答', { via: 'text', durationSec: 5 });
    expect(eventsOf('storage_warning')).toHaveLength(1);
    // A successful write ends the streak; the next failure warns again.
    storage.quota = null;
    store().interviewerDone();
    await store().submitAnswer('回答二', { via: 'text', durationSec: 5 });
    expect(eventsOf('storage_warning')).toHaveLength(1);
    storage.quota = 10;
    store().interviewerDone();
    await store().submitAnswer('回答三', { via: 'text', durationSec: 5 });
    expect(eventsOf('storage_warning')).toHaveLength(2);
    // The session in memory is intact.
    expect(store().stage.kind).toBe('interviewer');
  });

  it('Continue resumes the newer in-memory session, not the stale stored copy', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    const stored = storedLength();
    storage.quota = storage.getItem(STORAGE_KEYS.session)!.length + 20; // later (bigger) writes fail
    store().interviewerDone();
    await store().submitAnswer('这是一个比较长的回答，用来让存档写入失败。', { via: 'text', durationSec: 5 });
    const inMemory = store().session!.transcript.length;
    expect(inMemory).toBeGreaterThan(stored);
    expect(storedLength()).toBe(stored);
    store().suspendInterview();
    expect(store().hasAutosave()).toBe(true);
    await store().resumeAutosave();
    expect(store().session!.transcript.length).toBe(inMemory);
    expect(store().stage).toEqual({ kind: 'answer' });
  });

  it('a new interview that cannot be saved warns and does not leave the previous save as Continue', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    store().suspendInterview();
    const old = loadAutosave()!.id;
    storage.quota = 10;
    await store().startInterview(config());
    expect(store().session!.id).not.toBe(old);
    expect(eventsOf('storage_warning')).toHaveLength(1);
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    useGameStore.setState({ session: null });
    expect(store().hasAutosave()).toBe(false);
  });

  it('Continue still prefers the stored save when the tab has no session or an older one', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    store().suspendInterview();
    const saved = loadAutosave()!;
    // Another interview (e.g. from another tab) is newer than the one in memory.
    storage.setItem(STORAGE_KEYS.session, JSON.stringify({ ...saved, id: 'other', createdAt: saved.createdAt + 1000 }));
    await store().resumeAutosave();
    expect(store().session!.id).toBe('other');
  });

  it('frees the autosave before writing the records when the interview finishes', async () => {
    const ops: string[] = [];
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.setItem = (k, v) => {
      ops.push(`set:${k}`);
      setItem(k, v);
    };
    storage.removeItem = (k) => {
      ops.push(`remove:${k}`);
      removeItem(k);
    };
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答');
    const cleared = ops.lastIndexOf(`remove:${STORAGE_KEYS.session}`);
    expect(cleared).toBeGreaterThanOrEqual(0);
    expect(cleared).toBeLessThan(ops.lastIndexOf(`set:${STORAGE_KEYS.records}`));
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
  });
});

describe('Try again keeps the full résumé (review A5)', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  it('the in-memory record keeps the untruncated config; storage keeps the truncated copy', async () => {
    const resumeText = `${ZH_RESUME}\n${'项目经历：负责订单系统的性能优化，P99 降低 40%。\n'.repeat(160)}SKILLS: Rust, WebAssembly`;
    expect(resumeText.length).toBeGreaterThan(MAX_RECORD_RESUME_CHARS + 1000);
    await store().startInterview(config({ resumeText, maxFollowUps: 0 }));
    await drive(() => '回答');
    const rec = store().lastRecord!;
    expect(rec.config.resumeText).toBe(resumeText);
    expect(fullConfigFor(rec.id)?.resumeText).toBe(resumeText);
    // Persisted and listed records stay truncated.
    expect(store().records[0].config.resumeText.length).toBeLessThanOrEqual(MAX_RECORD_RESUME_CHARS);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEYS.records)!) as { config: { resumeText: string } }[];
    expect(persisted[0].config.resumeText.length).toBeLessThanOrEqual(MAX_RECORD_RESUME_CHARS);

    // Try again → Setup is prefilled with the full résumé.
    useSetupStore.getState().init({ from: 'result', lastRecord: rec, lastConfig: fullConfigFor(rec.id), uiLang: 'zh' });
    expect(useSetupStore.getState().resume.text).toBe(resumeText);

    // Re-opening the record from the list during this page session still has the full config.
    store().navigate('records');
    store().viewRecord(rec.id);
    expect(store().lastRecord!.config.resumeText).toBe(resumeText);
    store().deleteRecord(rec.id);
    expect(fullConfigFor(rec.id)).toBeNull();
  });

  it('records loaded from storage have no full config in memory', () => {
    expect(fullConfigFor('r-from-storage')).toBeNull();
  });
});

describe('discardSavedInterview', () => {
  beforeEach(() => setInterviewerAIFactory(() => scriptedAI()));

  it('deletes a suspended interview (storage and memory), so Continue disappears', async () => {
    await store().startInterview(config());
    store().interviewerDone();
    await store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    store().suspendInterview();
    expect(store().hasAutosave()).toBe(true);
    store().openSettings();
    store().discardSavedInterview();
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    expect(store().session).toBeNull();
    expect(store().hasAutosave()).toBe(false);
    expect(store().screen).toBe('settings');
  });

  it('clears a stored save left by an earlier page session', () => {
    const saved = { ...createSessionLike(), id: 'old' };
    storage.setItem(STORAGE_KEYS.session, JSON.stringify(saved));
    expect(store().hasAutosave()).toBe(true);
    store().discardSavedInterview();
    expect(store().hasAutosave()).toBe(false);
  });

  it('is a no-op while the interview is live (on screen, or behind Settings opened from it)', async () => {
    await store().startInterview(config());
    const id = store().session!.id;
    store().discardSavedInterview();
    expect(store().session!.id).toBe(id);
    expect(loadAutosave()?.id).toBe(id);
    store().openSettings();
    store().discardSavedInterview();
    expect(store().session!.id).toBe(id);
    expect(loadAutosave()?.id).toBe(id);
    store().closeSettings();
    expect(store().screen).toBe('interview');
  });

  it('cancels a request still running for the suspended session', async () => {
    let release!: () => void;
    const ai = scriptedAI({ nextTurn: () => new Promise<void>((r) => (release = r)) });
    setInterviewerAIFactory(() => ai);
    await store().startInterview(config());
    store().interviewerDone();
    const pending = store().submitAnswer('自我介绍', { via: 'text', durationSec: 5 });
    useGameStore.setState({ screen: 'title' });
    store().discardSavedInterview();
    expect(ai.signals.at(-1)?.aborted).toBe(true);
    release();
    await pending;
    expect(store().session).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
  });

  it('keeps a finished interview on the Result screen', async () => {
    await store().startInterview(config({ maxFollowUps: 0 }));
    await drive(() => '回答');
    const finished = store().session;
    store().discardSavedInterview();
    expect(store().session).toBe(finished);
    expect(store().lastRecord).not.toBeNull();
  });
});

/** A minimal valid stored session (as an older page session would have left it). */
function createSessionLike() {
  return {
    id: 's',
    createdAt: 1,
    config: makeConfig(),
    plan: makePlan(2),
    phase: 'intro',
    transcript: [{ id: 'e1', role: 'interviewer', text: '你好', at: 1, turn: makeTurn('opening', { question: '自我介绍？', assessment: null }) }],
    currentTopicIndex: -1,
    mainAsked: 0,
    followUpsOnCurrent: 0,
    reverseAsked: 0,
    affinity: 50,
    scores: [],
    report: null,
    ending: null,
    finalScore: null,
  };
}
