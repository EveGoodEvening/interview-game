/**
 * Setup wizard model: draft shape, defaults, validation, persistence of the last used options
 * (`igg.setup.v1`, never the résumé) and conversion to an InterviewConfig. Pure — no React.
 */
import { CHARACTERS } from '../../characters';
import { MAX_RECORD_RESUME_CHARS } from '../../engine/records';
import { MAX_RESUME_CHARS, MIN_RESUME_CHARS, prepareResumeText, SAMPLE_RESUMES } from '../../resume';
import type { CharacterId, Difficulty, InterviewConfig, InterviewStyle, Lang } from '../../types';
import { CHARACTER_IDS, LANGS } from '../../types';

export const SETUP_STORAGE_KEY = 'igg.setup.v1';
/** File name given to pasted résumé text in the interview config (read back as source 'paste'). */
export const PASTED_RESUME_FILE_NAME = 'pasted-resume.txt';

export const STYLES: readonly InterviewStyle[] = ['behavioral', 'technical', 'mixed'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const TIME_LIMITS: readonly number[] = [0, 60, 120, 180];
export const MAIN_QUESTIONS_RANGE = { min: 3, max: 12, default: 5 } as const;
export const FOLLOW_UPS_RANGE = { min: 0, max: 3, default: 2 } as const;
export const MAX_ROLE_CHARS = 80;
export const MAX_JD_CHARS = 8000;

export type SetupStep = 0 | 1 | 2;
export const SETUP_STEPS: readonly SetupStep[] = [0, 1, 2];

export type ResumeSource = 'none' | 'file' | 'sample' | 'paste';

/** Setup's own résumé warnings (`code[:detail]`), stored beside the parser's (see {@link parseSetupWarning}). */
export const SETUP_WARNING = {
  /** Prefilled from a saved record whose résumé was shortened. Detail: the kept length in characters. */
  recordTruncated: 'record_truncated',
} as const;

export type SetupWarningCode = (typeof SETUP_WARNING)[keyof typeof SETUP_WARNING];

const SETUP_WARNING_CODES = new Set<string>(Object.values(SETUP_WARNING));

/** Split one of Setup's own warnings into code and detail; null for anything else (e.g. a parser warning). */
export function parseSetupWarning(warning: string): { code: SetupWarningCode; detail: string } | null {
  const sep = warning.indexOf(':');
  const code = sep === -1 ? warning : warning.slice(0, sep);
  if (!SETUP_WARNING_CODES.has(code)) return null;
  return { code: code as SetupWarningCode, detail: sep === -1 ? '' : warning.slice(sep + 1) };
}

export interface ResumeDraft {
  text: string;
  /** Original file name ('' for pasted text). */
  fileName: string;
  source: ResumeSource;
  /**
   * Parser warnings (`code[:detail]`, see src/resume/warnings.ts) and {@link SETUP_WARNING}s.
   * Cleared when the text is edited.
   */
  warnings: string[];
  /** True once the player edited the text by hand (a sample is then no longer swapped on language change). */
  edited: boolean;
  pageCount?: number;
}

export interface SetupOptions {
  lang: Lang;
  targetRole: string;
  jobDescription: string;
  style: InterviewStyle;
  /** The player picked a style explicitly; otherwise it follows the interviewer's default. */
  styleTouched: boolean;
  difficulty: Difficulty;
  mainQuestions: number;
  maxFollowUps: number;
  answerTimeLimitSec: number;
}

export interface SetupDraft {
  step: SetupStep;
  characterId: CharacterId;
  resume: ResumeDraft;
  options: SetupOptions;
  /** Prefilled from a previous interview ("Try again"). */
  prefilled: boolean;
}

export const EMPTY_RESUME: ResumeDraft = { text: '', fileName: '', source: 'none', warnings: [], edited: false };

export function defaultOptions(lang: Lang, characterId: CharacterId = 'yuki'): SetupOptions {
  return {
    lang,
    targetRole: '',
    jobDescription: '',
    style: CHARACTERS[characterId].defaultStyle,
    styleTouched: false,
    difficulty: 'normal',
    mainQuestions: MAIN_QUESTIONS_RANGE.default,
    maxFollowUps: FOLLOW_UPS_RANGE.default,
    answerTimeLimitSec: 0,
  };
}

export function createDraft(lang: Lang, persisted?: PersistedSetup | null): SetupDraft {
  const characterId = persisted?.characterId ?? 'yuki';
  return {
    step: 0,
    characterId,
    resume: EMPTY_RESUME,
    options: persisted?.options ?? defaultOptions(lang, characterId),
    prefilled: false,
  };
}

// ───────────── sanitizing ─────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Coerce anything (e.g. JSON from localStorage) into valid options, field by field. */
export function sanitizeOptions(raw: unknown, fallback: SetupOptions): SetupOptions {
  if (!isObj(raw)) return fallback;
  return {
    lang: oneOf(raw.lang, LANGS, fallback.lang),
    targetRole: typeof raw.targetRole === 'string' ? str(raw.targetRole, MAX_ROLE_CHARS) : fallback.targetRole,
    jobDescription: typeof raw.jobDescription === 'string' ? str(raw.jobDescription, MAX_JD_CHARS) : fallback.jobDescription,
    style: oneOf(raw.style, STYLES, fallback.style),
    styleTouched: typeof raw.styleTouched === 'boolean' ? raw.styleTouched : fallback.styleTouched,
    difficulty: oneOf(raw.difficulty, DIFFICULTIES, fallback.difficulty),
    mainQuestions: intIn(raw.mainQuestions, MAIN_QUESTIONS_RANGE.min, MAIN_QUESTIONS_RANGE.max, fallback.mainQuestions),
    maxFollowUps: intIn(raw.maxFollowUps, FOLLOW_UPS_RANGE.min, FOLLOW_UPS_RANGE.max, fallback.maxFollowUps),
    answerTimeLimitSec: oneOf(raw.answerTimeLimitSec, TIME_LIMITS, fallback.answerTimeLimitSec),
  };
}

// ───────────── persistence (last used options, never the résumé) ─────────────

export interface PersistedSetup {
  characterId: CharacterId;
  options: SetupOptions;
}

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

export function parsePersistedSetup(raw: unknown, lang: Lang): PersistedSetup | null {
  if (!isObj(raw)) return null;
  const characterId = oneOf<CharacterId>(raw.characterId, CHARACTER_IDS, 'yuki');
  return { characterId, options: sanitizeOptions(raw.options, defaultOptions(lang, characterId)) };
}

export function loadPersistedSetup(lang: Lang, store: Storage | null = storage()): PersistedSetup | null {
  if (!store) return null;
  try {
    const text = store.getItem(SETUP_STORAGE_KEY);
    return text ? parsePersistedSetup(JSON.parse(text) as unknown, lang) : null;
  } catch {
    return null;
  }
}

export function savePersistedSetup(draft: Pick<SetupDraft, 'characterId' | 'options'>, store: Storage | null = storage()): void {
  if (!store) return;
  const value: PersistedSetup = { characterId: draft.characterId, options: draft.options };
  try {
    store.setItem(SETUP_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded / privacy mode: remembering options is a convenience only.
  }
}

/** Forget the remembered options, target role and job description (Config → Data). */
export function clearPersistedSetup(store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.removeItem(SETUP_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was saved there either.
  }
}

// ───────────── prefill ("Try again") ─────────────

/**
 * Whether `text` is a résumé that a saved record shortened (records keep the first
 * MAX_RECORD_RESUME_CHARS characters and end with "…"; config résumés are normalized, so at most a
 * few trailing spaces were trimmed before the marker).
 */
export function isTruncatedRecordResume(text: string): boolean {
  return text.endsWith('…') && text.length <= MAX_RECORD_RESUME_CHARS && text.length >= MAX_RECORD_RESUME_CHARS - 8;
}

/**
 * Rebuild a draft from a previous interview's config, landing on the options step — or on the
 * résumé step with a warning when the résumé comes from a saved record that shortened it (a record
 * reopened after a reload), so the player can re-upload the full one.
 */
export function draftFromConfig(config: InterviewConfig): SetupDraft {
  const characterId = oneOf<CharacterId>(config.characterId, CHARACTER_IDS, 'yuki');
  const lang = oneOf<Lang>(config.lang, LANGS, 'zh');
  const options = sanitizeOptions(
    { ...config, styleTouched: config.style !== CHARACTERS[characterId].defaultStyle },
    defaultOptions(lang, characterId),
  );
  const text = typeof config.resumeText === 'string' ? config.resumeText : '';
  const isSample = text !== '' && LANGS.some((l) => SAMPLE_RESUMES[l].text === text);
  const fileName = config.resumeFileName ?? '';
  const pasted = !fileName || fileName === PASTED_RESUME_FILE_NAME;
  const truncated = !isSample && isTruncatedRecordResume(text);
  const resume: ResumeDraft = text
    ? {
        text,
        fileName: pasted ? '' : fileName,
        source: isSample ? 'sample' : pasted ? 'paste' : 'file',
        warnings: truncated ? [`${SETUP_WARNING.recordTruncated}:${MAX_RECORD_RESUME_CHARS}`] : [],
        edited: false,
      }
    : EMPTY_RESUME;
  return { step: text && !truncated ? 2 : 1, characterId, resume, options, prefilled: true };
}

/** Résumé draft for the built-in sample in `lang`. */
export function sampleResume(lang: Lang): ResumeDraft {
  const sample = SAMPLE_RESUMES[lang];
  return { text: sample.text, fileName: sample.fileName, source: 'sample', warnings: [], edited: false };
}

// ───────────── validation ─────────────

export type SetupIssueCode = 'resumeEmpty' | 'resumeShort' | 'resumeLong' | 'roleTooLong' | 'jdTooLong';

export interface SetupIssue {
  step: SetupStep;
  code: SetupIssueCode;
  level: 'error' | 'warning';
}

/** Non-whitespace characters (what the parser counts as "content"). */
export function contentChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export function validateDraft(draft: Pick<SetupDraft, 'resume' | 'options'>): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const chars = contentChars(draft.resume.text);
  if (chars === 0) issues.push({ step: 1, code: 'resumeEmpty', level: 'error' });
  else if (chars < MIN_RESUME_CHARS) issues.push({ step: 1, code: 'resumeShort', level: 'warning' });
  if (draft.resume.text.length > MAX_RESUME_CHARS) issues.push({ step: 1, code: 'resumeLong', level: 'warning' });
  if (draft.options.targetRole.trim().length > MAX_ROLE_CHARS) issues.push({ step: 2, code: 'roleTooLong', level: 'error' });
  if (draft.options.jobDescription.length > MAX_JD_CHARS) issues.push({ step: 2, code: 'jdTooLong', level: 'error' });
  return issues;
}

export function stepErrors(issues: readonly SetupIssue[], step: SetupStep): SetupIssue[] {
  return issues.filter((i) => i.step === step && i.level === 'error');
}

/** Whether every step up to and including `step` is free of errors. */
export function canLeaveStep(issues: readonly SetupIssue[], step: SetupStep): boolean {
  return !issues.some((i) => i.level === 'error' && i.step <= step);
}

/** Highest step the stepper may jump to: the first step with an error (or the last step). */
export function maxReachableStep(issues: readonly SetupIssue[]): SetupStep {
  for (const s of SETUP_STEPS) if (stepErrors(issues, s).length > 0) return s;
  return 2;
}

// ───────────── config ─────────────

export function buildConfig(draft: SetupDraft): InterviewConfig {
  const { text } = prepareResumeText(draft.resume.text);
  const o = draft.options;
  return {
    characterId: draft.characterId,
    lang: o.lang,
    resumeText: text,
    resumeFileName: draft.resume.fileName || (draft.resume.source === 'paste' ? PASTED_RESUME_FILE_NAME : 'resume.txt'),
    targetRole: o.targetRole.trim().slice(0, MAX_ROLE_CHARS),
    jobDescription: o.jobDescription.trim().slice(0, MAX_JD_CHARS),
    style: o.style,
    difficulty: o.difficulty,
    mainQuestions: intIn(o.mainQuestions, MAIN_QUESTIONS_RANGE.min, MAIN_QUESTIONS_RANGE.max, MAIN_QUESTIONS_RANGE.default),
    maxFollowUps: intIn(o.maxFollowUps, FOLLOW_UPS_RANGE.min, FOLLOW_UPS_RANGE.max, FOLLOW_UPS_RANGE.default),
    answerTimeLimitSec: oneOf(o.answerTimeLimitSec, TIME_LIMITS, 0),
  };
}

/** Rough interview length in minutes for the options summary. */
export function estimateMinutes(o: Pick<SetupOptions, 'mainQuestions' | 'maxFollowUps'>): number {
  const perTopic = 1.4 + o.maxFollowUps * 0.9;
  const total = 2 /* intro */ + o.mainQuestions * perTopic + 3; /* reverse Q&A + closing */
  return Math.max(5, Math.round(total / 5) * 5);
}
