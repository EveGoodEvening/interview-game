/**
 * Pure, localized label builders for the interview scene (chapter cards, progress chip, errors).
 * They take a `TFunction` so they can be unit-tested with `translate` and used in components with `useT()`.
 */
import type { TFunction } from '../../i18n';
import type { ProgressInfo } from '../../store/selectors';
import type { Lang, SessionPhase } from '../../types';

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1 → 一, 10 → 十, 12 → 十二, 21 → 二十一 (1–99; larger numbers fall back to digits). */
export function zhNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return ZH_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : ZH_DIGITS[tens]}十${ones ? ZH_DIGITS[ones] : ''}`;
}

export interface ChapterInput {
  phase: SessionPhase;
  topicIndex: number | null;
  topicTitle: string | null;
}

export interface ChapterLabel {
  /** Small decorative line above the title ("ACT 2", "The Beginning"). */
  kicker: string;
  /** "序章" / "第二幕" / "Act 2" / "Finale". */
  head: string;
  /** "初次见面" / topic title / "Your Questions"; '' when there is none. */
  title: string;
  /** head · title — for aria-labels, logs and tests. */
  full: string;
}

/** Localized chapter title card text for a chapter event. */
export function chapterLabel(ev: ChapterInput, t: TFunction, lang: Lang): ChapterLabel {
  let kicker: string;
  let head: string;
  let title: string;
  switch (ev.phase) {
    case 'preparing':
    case 'intro':
      kicker = t('interview.chapter.kickerPrologue');
      head = t('interview.chapter.prologue');
      title = t('interview.chapter.prologueTitle');
      break;
    case 'questioning': {
      const n = (ev.topicIndex ?? 0) + 1;
      kicker = t('interview.chapter.kickerAct', { n });
      head = t('interview.chapter.act', { n: lang === 'zh' ? zhNumeral(n) : n });
      title = ev.topicTitle?.trim() ?? '';
      break;
    }
    case 'reverse':
      kicker = t('interview.chapter.kickerFinale');
      head = t('interview.chapter.finale');
      title = t('interview.chapter.finaleTitle');
      break;
    default:
      kicker = t('interview.chapter.kickerEpilogue');
      head = t('interview.chapter.epilogue');
      title = '';
  }
  return { kicker, head, title, full: title ? `${head} · ${title}` : head };
}

export interface ProgressLabel {
  /** Main chip text: "序章" / "Q2/5" / "反问" / "尾声". */
  main: string;
  /** Extra badge, e.g. "追问" / "Follow-up"; null when none. */
  badge: string | null;
  /** Topic title of the current main question, if any. */
  topic: string | null;
}

/** HUD progress chip text. */
export function progressLabel(p: ProgressInfo, t: TFunction): ProgressLabel {
  switch (p.phase) {
    case 'preparing':
    case 'intro':
      return { main: t('interview.progress.prologue'), badge: null, topic: null };
    case 'questioning':
      return {
        main: t('interview.progress.question', { n: Math.max(1, p.mainIndex), total: p.mainTotal }),
        badge: p.isFollowUp ? t('interview.progress.followUp') : null,
        topic: p.topicTitle,
      };
    case 'reverse':
      return { main: t('interview.progress.reverse'), badge: null, topic: null };
    default:
      return { main: t('interview.progress.epilogue'), badge: null, topic: null };
  }
}

/** Error codes with dedicated friendly copy. Anything else maps to 'unknown'. */
export const ERROR_CODES = [
  'config',
  'auth',
  'not_found',
  'rate_limit',
  'bad_request',
  'server',
  'network',
  'timeout',
  'aborted',
  'refusal',
  'truncated',
  'parse',
  'unknown',
] as const;
export type FriendlyErrorCode = (typeof ERROR_CODES)[number];

export function friendlyErrorCode(code: string): FriendlyErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as FriendlyErrorCode) : 'unknown';
}

export interface ErrorCopy {
  title: string;
  message: string;
  /** What the player can do about it. */
  hint: string;
}

/**
 * The Config labels the error hints point at ("Config → AI Model", “Use local relay”…), read from
 * the settings namespace so a hint can never name a tab or switch that doesn't exist.
 */
export function settingsLabelVars(t: TFunction): Record<string, string> {
  return {
    llmTab: t('settings.tab.llm'),
    voiceTab: t('settings.tab.voice'),
    relay: t('settings.llm.proxy'),
    test: t('settings.llm.test'),
    fetchModels: t('settings.llm.fetchModels'),
    jsonMode: t('settings.llm.jsonMode'),
    effort: t('settings.llm.effort'),
  };
}

export function errorCopy(code: string, t: TFunction): ErrorCopy {
  const c = friendlyErrorCode(code);
  const vars = settingsLabelVars(t);
  return {
    title: t(`interview.error.${c}.title`),
    message: t(`interview.error.${c}.message`),
    hint: t(`interview.error.${c}.hint`, vars),
  };
}

/** mm:ss for timers. Negative values clamp to 0. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
