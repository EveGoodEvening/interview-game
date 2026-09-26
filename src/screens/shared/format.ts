import type { Lang } from '../../types';

const LOCALE: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' };

function safeFormat(ts: number, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  if (!Number.isFinite(ts)) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALE[lang], opts).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** "2026年9月26日" / "Sep 26, 2026" */
export function formatDate(ts: number, lang: Lang): string {
  return safeFormat(ts, lang, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "2026/9/26 14:05" / "Sep 26, 2026, 2:05 PM" */
export function formatDateTime(ts: number, lang: Lang): string {
  return safeFormat(ts, lang, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Ending unlock map key (matches the game store / engine convention). */
export function endingKey(characterId: string, ending: string): string {
  return `${characterId}:${ending}`;
}
