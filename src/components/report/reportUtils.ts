/**
 * Pure helpers shared by the report view, the result screen and the exports.
 */
import { CHARACTERS } from '../../characters';
import { translate } from '../../i18n';
import { DIMENSION_SCORE_MAX } from '../../store/selectors';
import type { DimensionKey, EndingId, InterviewRecord, Lang, TranscriptEntry } from '../../types';
import { DIMENSION_KEYS } from '../../types';

/** Local "YYYY-MM-DD HH:mm". */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local "YYYYMMDD-HHmm" for file names. */
export function fileStamp(ts: number): string {
  return formatDateTime(ts).replace(/-/g, '').replace(' ', '-').replace(':', '');
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface DimensionView {
  key: DimensionKey;
  /** 0–DIMENSION_SCORE_MAX (100) */
  score: number;
  comment: string;
}

/**
 * The report's dimensions in canonical order, one per key. Scores are on the 0–100 scale
 * (`DIMENSION_SCORE_MAX`) — the evaluators (demo AI, LLM normalizer) already normalize them, so
 * the UI only clamps and rounds; low scores are genuinely low, never rescaled.
 */
export function dimensionViews(record: Pick<InterviewRecord, 'report'>): DimensionView[] {
  const dims = record.report.dimensions ?? [];
  return DIMENSION_KEYS.map((key) => {
    const d = dims.find((x) => x.key === key);
    const raw = d && Number.isFinite(d.score) ? d.score : 0;
    return { key, score: Math.round(clamp(raw, 0, DIMENSION_SCORE_MAX)), comment: d?.comment ?? '' };
  });
}

/** Final score split used by the UI: interview (report) score and affinity. */
export function scoreBreakdown(record: InterviewRecord): { final: number; interview: number; affinity: number } {
  return {
    final: Math.round(clamp(record.finalScore, 0, 100)),
    interview: Math.round(clamp(record.report.overallScore, 0, 100)),
    affinity: Math.round(clamp(record.affinity, 0, 100)),
  };
}

export function isGoodEnding(ending: EndingId): boolean {
  return ending === 'perfect' || ending === 'offer';
}

/** Candidate's display name for a record, in the given language. */
export function candidateName(record: InterviewRecord, lang: Lang): string {
  return record.plan?.candidateName?.trim() || translate(lang, 'result.you');
}

export function speakerName(entry: TranscriptEntry, record: InterviewRecord, lang: Lang): string {
  return entry.role === 'interviewer' ? CHARACTERS[record.characterId].name[lang] : candidateName(record, lang);
}

/**
 * A skipped answer with nothing to show: rendered as a localized "(skipped)" label. (The reverse
 * Q&A's "No more questions" is also recorded as skipped but carries its canned line as text.)
 */
export function isBlankSkip(entry: TranscriptEntry): boolean {
  return entry.answer?.skipped === true && !entry.text.trim();
}

/** Target role for display ('' → plan's inferred role → "—"). */
export function targetRole(record: InterviewRecord): string {
  return record.config.targetRole.trim() || record.plan?.targetRole?.trim() || '—';
}
