import { beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../engine/session';
import { createRecord, MAX_RECORD_RESUME_CHARS } from '../../engine/records';
import { SAMPLE_RESUMES } from '../../resume';
import type { InterviewConfig, InterviewRecord } from '../../types';
import { requestSetupPrefill, useSetupStore } from './draft';
import {
  buildConfig,
  canLeaveStep,
  clearPersistedSetup,
  createDraft,
  defaultOptions,
  draftFromConfig,
  estimateMinutes,
  isTruncatedRecordResume,
  loadPersistedSetup,
  maxReachableStep,
  parsePersistedSetup,
  parseSetupWarning,
  sanitizeOptions,
  savePersistedSetup,
  SETUP_STORAGE_KEY,
  SETUP_WARNING,
  validateDraft,
  type SetupDraft,
} from './model';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const RESUME = '张三 | 后端工程师\n'.repeat(12);

function draftWith(patch: Partial<SetupDraft> = {}): SetupDraft {
  const base = createDraft('zh');
  return { ...base, resume: { ...base.resume, text: RESUME, source: 'paste' }, ...patch };
}

const CONFIG: InterviewConfig = {
  characterId: 'ethan',
  lang: 'en',
  resumeText: 'Jane Doe — Frontend engineer. Built things with React for five years at two startups.',
  resumeFileName: 'jane.pdf',
  targetRole: 'Staff Engineer',
  jobDescription: 'Lead the web platform.',
  style: 'mixed',
  difficulty: 'hard',
  mainQuestions: 8,
  maxFollowUps: 1,
  answerTimeLimitSec: 120,
};

describe('setup validation', () => {
  it('requires a résumé before leaving step 2', () => {
    const issues = validateDraft(createDraft('zh'));
    expect(issues).toContainEqual({ step: 1, code: 'resumeEmpty', level: 'error' });
    expect(canLeaveStep(issues, 0)).toBe(true);
    expect(canLeaveStep(issues, 1)).toBe(false);
    expect(maxReachableStep(issues)).toBe(1);
  });

  it('treats whitespace-only text as empty', () => {
    const d = draftWith();
    const issues = validateDraft({ ...d, resume: { ...d.resume, text: '  \n\t ' } });
    expect(issues.map((i) => i.code)).toEqual(['resumeEmpty']);
  });

  it('warns (without blocking) on a very short résumé', () => {
    const d = draftWith();
    const issues = validateDraft({ ...d, resume: { ...d.resume, text: 'Hello, I am Bob.' } });
    expect(issues).toEqual([{ step: 1, code: 'resumeShort', level: 'warning' }]);
    expect(canLeaveStep(issues, 2)).toBe(true);
    expect(maxReachableStep(issues)).toBe(2);
  });

  it('blocks an over-long target role or JD on the options step', () => {
    const d = draftWith();
    const issues = validateDraft({ ...d, options: { ...d.options, targetRole: 'x'.repeat(81), jobDescription: 'y'.repeat(8001) } });
    expect(issues.map((i) => i.code).sort()).toEqual(['jdTooLong', 'roleTooLong']);
    expect(canLeaveStep(issues, 1)).toBe(true);
    expect(canLeaveStep(issues, 2)).toBe(false);
  });

  it('accepts a complete draft', () => {
    expect(validateDraft(draftWith())).toEqual([]);
  });
});

describe('sanitizeOptions', () => {
  const fallback = defaultOptions('zh', 'yuki');

  it('clamps numbers and rejects unknown enum values field by field', () => {
    const out = sanitizeOptions(
      {
        lang: 'fr',
        style: 'technical',
        difficulty: 'nightmare',
        mainQuestions: 99,
        maxFollowUps: -2,
        answerTimeLimitSec: 45,
        targetRole: 7,
      },
      fallback,
    );
    expect(out).toEqual({ ...fallback, style: 'technical', mainQuestions: 12, maxFollowUps: 0 });
  });

  it('returns the fallback for non-objects', () => {
    expect(sanitizeOptions(null, fallback)).toBe(fallback);
    expect(sanitizeOptions('x', fallback)).toBe(fallback);
  });
});

describe('persistence', () => {
  it('round-trips options but never the résumé', () => {
    const store = memoryStorage();
    const d = draftWith({ characterId: 'haru' });
    savePersistedSetup(d, store);
    const raw = store.getItem(SETUP_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('后端工程师');
    expect(loadPersistedSetup('en', store)).toEqual({ characterId: 'haru', options: d.options });
  });

  it('survives garbage in storage', () => {
    const store = memoryStorage();
    store.setItem(SETUP_STORAGE_KEY, '{not json');
    expect(loadPersistedSetup('zh', store)).toBeNull();
    expect(parsePersistedSetup({ characterId: 'nobody', options: { mainQuestions: 4 } }, 'en')).toEqual({
      characterId: 'yuki',
      options: { ...defaultOptions('en', 'yuki'), mainQuestions: 4 },
    });
  });
});

describe('prefill and config', () => {
  it('rebuilds the draft from a previous config on the options step', () => {
    const d = draftFromConfig(CONFIG);
    expect(d.step).toBe(2);
    expect(d.prefilled).toBe(true);
    expect(d.characterId).toBe('ethan');
    expect(d.options).toMatchObject({ lang: 'en', style: 'mixed', styleTouched: true, difficulty: 'hard', mainQuestions: 8 });
    expect(d.resume).toMatchObject({ source: 'file', fileName: 'jane.pdf' });
  });

  it('recognises the built-in sample résumé', () => {
    expect(draftFromConfig({ ...CONFIG, resumeText: SAMPLE_RESUMES.zh.text }).resume.source).toBe('sample');
  });

  it('builds a normalised InterviewConfig', () => {
    const d = draftWith({ characterId: 'haru' });
    const cfg = buildConfig({ ...d, options: { ...d.options, targetRole: '  PM  ' }, resume: { ...d.resume, fileName: '' } });
    expect(cfg).toMatchObject({
      characterId: 'haru',
      lang: 'zh',
      targetRole: 'PM',
      mainQuestions: 5,
      maxFollowUps: 2,
      answerTimeLimitSec: 0,
    });
    expect(cfg.resumeFileName).toBe('pasted-resume.txt');
    expect(cfg.resumeText.length).toBeGreaterThan(0);
    expect(buildConfig(draftFromConfig(CONFIG))).toMatchObject({ ...CONFIG, resumeText: expect.any(String) });
  });

  it('estimates a plausible duration', () => {
    expect(estimateMinutes({ mainQuestions: 5, maxFollowUps: 2 })).toBeGreaterThanOrEqual(10);
    expect(estimateMinutes({ mainQuestions: 12, maxFollowUps: 3 })).toBeGreaterThan(estimateMinutes({ mainQuestions: 3, maxFollowUps: 0 }));
  });
});

describe('setup draft store', () => {
  beforeEach(() => {
    useSetupStore.setState({ ...createDraft('zh'), initialized: false, direction: 1 });
  });

  it('style follows the interviewer until the player picks one', () => {
    const s = useSetupStore.getState();
    s.init({ from: 'title', lastRecord: null, uiLang: 'zh' });
    useSetupStore.getState().setCharacter('ethan');
    expect(useSetupStore.getState().options.style).toBe('technical');
    useSetupStore.getState().setOptions({ style: 'behavioral', styleTouched: true });
    useSetupStore.getState().setCharacter('haru');
    expect(useSetupStore.getState().options.style).toBe('behavioral');
  });

  it('swaps an untouched sample résumé when the interview language changes', () => {
    useSetupStore.getState().init({ from: 'title', lastRecord: null, uiLang: 'zh' });
    useSetupStore.getState().setResume({ ...draftFromConfig({ ...CONFIG, resumeText: SAMPLE_RESUMES.zh.text }).resume });
    useSetupStore.getState().setLang('en');
    expect(useSetupStore.getState().resume.text).toBe(SAMPLE_RESUMES.en.text);
    useSetupStore.getState().editResumeText('my own words');
    useSetupStore.getState().setLang('zh');
    expect(useSetupStore.getState().resume.text).toBe('my own words');
  });

  it('restores the wizard after Config and prefills after Result', () => {
    const st = useSetupStore.getState;
    st().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    st().editResumeText('hello résumé');
    st().goTo(2);
    st().init({ from: 'settings', lastRecord: null, uiLang: 'en' });
    expect(st().step).toBe(2);
    expect(st().resume.text).toBe('hello résumé');

    st().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    expect(st().step).toBe(0);
    expect(st().resume.text).toBe('hello résumé');

    requestSetupPrefill(CONFIG);
    st().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    expect(st()).toMatchObject({ step: 2, prefilled: true, characterId: 'ethan' });
  });
});

/** A long English résumé whose skills section sits at the very end. */
const LONG_RESUME = `${'Built and scaled payment services, cut p99 latency by 40%. '.repeat(110)}\nSKILLS: Rust, WebAssembly`;

/** The record "Try again" sees after a reload: its config keeps only MAX_RECORD_RESUME_CHARS of the résumé. */
function finishedRecord(config: InterviewConfig): InterviewRecord {
  const session = createSession(config);
  return createRecord({
    ...session,
    phase: 'finished',
    finalScore: 80,
    ending: 'offer',
    report: { overallScore: 80, dimensions: [], strengths: [], improvements: [], questionReviews: [], summary: '', finalMessage: '' },
  });
}

describe('prefill from a saved record ("Try again")', () => {
  it('detects a résumé the record shortened and lands on the résumé step with a warning', () => {
    const record = finishedRecord({ ...CONFIG, resumeText: LONG_RESUME });
    expect(record.config.resumeText.length).toBeLessThanOrEqual(MAX_RECORD_RESUME_CHARS);
    expect(isTruncatedRecordResume(record.config.resumeText)).toBe(true);

    const d = draftFromConfig(record.config);
    expect(d.step).toBe(1);
    expect(d.resume.text).toBe(record.config.resumeText);
    expect(d.resume.warnings).toEqual([`${SETUP_WARNING.recordTruncated}:${MAX_RECORD_RESUME_CHARS}`]);
    expect(parseSetupWarning(d.resume.warnings[0])).toEqual({ code: 'record_truncated', detail: String(MAX_RECORD_RESUME_CHARS) });
    // Options are still prefilled.
    expect(d.options).toMatchObject({ difficulty: 'hard', mainQuestions: 8 });
  });

  it('keeps the options step for a full résumé, even a long one', () => {
    expect(isTruncatedRecordResume(LONG_RESUME)).toBe(false);
    const d = draftFromConfig({ ...CONFIG, resumeText: LONG_RESUME });
    expect(d.step).toBe(2);
    expect(d.resume.warnings).toEqual([]);
    // A short résumé that happens to end with an ellipsis is not mistaken for a shortened one.
    expect(isTruncatedRecordResume('Jane Doe. To be continued…')).toBe(false);
    expect(parseSetupWarning('truncated:25000')).toBeNull();
  });

  it('keeps pasted text classified as pasted (not as a file called pasted-resume.txt)', () => {
    const pasted = buildConfig(draftWith());
    expect(pasted.resumeFileName).toBe('pasted-resume.txt');
    const d = draftFromConfig(pasted);
    expect(d.resume).toMatchObject({ source: 'paste', fileName: '' });
    expect(buildConfig(d).resumeFileName).toBe('pasted-resume.txt');
    expect(draftFromConfig({ ...CONFIG, resumeFileName: '' }).resume.source).toBe('paste');
    expect(draftFromConfig(CONFIG).resume).toMatchObject({ source: 'file', fileName: 'jane.pdf' });
  });

  it('prefers the full in-memory config of a just-finished interview over the stored record', () => {
    const full = { ...CONFIG, resumeText: LONG_RESUME };
    const record = finishedRecord(full);
    useSetupStore.setState({ ...createDraft('en'), initialized: false, direction: 1 });
    useSetupStore.getState().init({ from: 'result', lastRecord: record, lastConfig: full, uiLang: 'en' });
    expect(useSetupStore.getState()).toMatchObject({ step: 2, prefilled: true });
    expect(useSetupStore.getState().resume.text).toBe(LONG_RESUME);
    expect(useSetupStore.getState().resume.text.endsWith('SKILLS: Rust, WebAssembly')).toBe(true);

    // After a reload only the stored (shortened) record exists: warn on the résumé step instead.
    useSetupStore.setState({ ...createDraft('en'), initialized: false, direction: 1 });
    useSetupStore.getState().init({ from: 'result', lastRecord: record, lastConfig: null, uiLang: 'en' });
    expect(useSetupStore.getState().step).toBe(1);
    expect(useSetupStore.getState().resume.warnings[0]).toMatch(/^record_truncated:/);
  });
});

describe('forgetting setup data (Config → Data)', () => {
  it('removes the remembered options and resets the in-memory wizard', () => {
    const store = memoryStorage();
    savePersistedSetup({ characterId: 'haru', options: { ...defaultOptions('en', 'haru'), targetRole: 'PM', jobDescription: 'JD' } }, store);
    expect(store.getItem(SETUP_STORAGE_KEY)).not.toBeNull();
    clearPersistedSetup(store);
    expect(store.getItem(SETUP_STORAGE_KEY)).toBeNull();
    expect(loadPersistedSetup('en', store)).toBeNull();

    const st = useSetupStore.getState;
    st().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    st().editResumeText('Jane Doe · jane@example.com');
    st().setOptions({ targetRole: 'Staff Backend Engineer' });
    st().goTo(2);
    requestSetupPrefill(CONFIG);
    st().reset();
    expect(st()).toMatchObject({ step: 0, initialized: false, prefilled: false });
    expect(st().resume.text).toBe('');
    expect(st().options.targetRole).toBe('');
    // A prefill requested before the reset is dropped too.
    st().init({ from: 'title', lastRecord: null, uiLang: 'en' });
    expect(st().prefilled).toBe(false);
    expect(st().resume.text).toBe('');
  });
});
