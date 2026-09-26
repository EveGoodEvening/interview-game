/**
 * Report exports: Markdown (localized) and JSON. The builders are pure; `downloadText` is the only
 * DOM-touching function.
 */
import { CHARACTERS } from '../../characters';
import { translate } from '../../i18n';
import type { InterviewRecord, Lang } from '../../types';
import { candidateName, dimensionViews, fileStamp, formatDateTime, isBlankSkip, scoreBreakdown, speakerName, targetRole } from './reportUtils';

/** Escape a value for a Markdown table cell (pipes, line breaks). */
export function mdCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n+/g, '<br>').trim() || '—';
}

/** Collapse line breaks for single-line Markdown contexts (headings, list items). */
function mdLine(text: string): string {
  return text.replace(/\s*\r?\n+\s*/g, ' ').trim();
}

function mdQuote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

/** Build the Markdown report. Headings use `lang` (default: the interview language). */
export function buildReportMarkdown(record: InterviewRecord, lang: Lang = record.lang): string {
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const character = CHARACTERS[record.characterId];
  const { report } = record;
  const scores = scoreBreakdown(record);
  const colon = lang === 'zh' ? '：' : ': ';
  const paren = (a: string, b: string) => (lang === 'zh' ? `${a}（${b}）` : `${a} (${b})`);
  const out: string[] = [];

  out.push(`# ${t('result.md.title', { company: character.company[lang], name: character.name[lang] })}`);
  out.push('');
  out.push(`> ${t('result.md.generatedBy', { date: formatDateTime(record.finishedAt) })}`);
  out.push('');
  out.push(`| ${t('result.md.field')} | ${t('result.md.value')} |`);
  out.push('| --- | --- |');
  const rows: [string, string][] = [
    [t('result.md.candidate'), candidateName(record, lang)],
    [t('result.md.role'), targetRole(record)],
    [t('result.md.interviewer'), `${character.name[lang]} · ${character.title[lang]} @ ${character.company[lang]}`],
    [t('result.md.date'), formatDateTime(record.finishedAt)],
    [t('result.md.language'), t(`result.lang.${record.lang}`)],
    [t('result.md.styleDifficulty'), `${t(`result.style.${record.config.style}`)} / ${t(`result.difficulty.${record.config.difficulty}`)}`],
    [t('result.md.ending'), paren(t(`result.ending.${record.ending}.name`), t(`result.ending.${record.ending}.stamp`))],
    [t('result.md.finalScore'), t('result.md.finalScoreValue', { final: scores.final, interview: scores.interview, affinity: scores.affinity })],
  ];
  for (const [k, v] of rows) out.push(`| ${mdCell(k)} | ${mdCell(v)} |`);
  out.push('');

  if (report.summary.trim()) {
    out.push(`## ${t('result.md.summary')}`, '', report.summary.trim(), '');
  }

  out.push(`## ${t('result.md.dimensions')}`, '');
  out.push(`| ${t('result.md.dimension')} | ${t('result.md.score')} | ${t('result.md.comment')} |`);
  out.push('| --- | ---: | --- |');
  for (const d of dimensionViews(record)) {
    out.push(`| ${mdCell(t(`result.dim.${d.key}`))} | ${d.score} | ${mdCell(d.comment)} |`);
  }
  out.push('');

  const list = (title: string, items: readonly string[]) => {
    const clean = items.map(mdLine).filter(Boolean);
    if (clean.length === 0) return;
    out.push(`## ${title}`, '', ...clean.map((s) => `- ${s}`), '');
  };
  list(t('result.md.strengths'), report.strengths);
  list(t('result.md.improvements'), report.improvements);

  if (report.questionReviews.length) {
    out.push(`## ${t('result.md.questions')}`, '');
    report.questionReviews.forEach((q, i) => {
      out.push(`### Q${i + 1} · ${mdLine(q.question) || '—'}`, '');
      out.push(`- **${t('result.md.score')}**${colon}${Math.round(q.score)} / 10`);
      if (q.answerSummary.trim()) out.push(`- **${t('result.md.answerSummary')}**${colon}${mdLine(q.answerSummary)}`);
      if (q.feedback.trim()) out.push(`- **${t('result.md.feedback')}**${colon}${mdLine(q.feedback)}`);
      if (q.betterAnswer.trim()) out.push(`- **${t('result.md.betterAnswer')}**${colon}${mdLine(q.betterAnswer)}`);
      out.push('');
    });
  }

  if (record.transcript.length) {
    out.push(`## ${t('result.md.transcript')}`, '');
    for (const e of record.transcript) {
      const text = isBlankSkip(e) ? `*${t('result.transcript.skipped')}*` : e.answer?.skipped ? `*${e.text.trim()}*` : e.text.trim();
      if (!text) continue;
      out.push(`**${speakerName(e, record, lang)}**${colon}${text.replace(/\r?\n+/g, '  \n')}`, '');
    }
  }

  if (report.finalMessage.trim()) {
    out.push(`## ${t('result.md.finalMessage')}`, '', mdQuote(report.finalMessage), '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

export interface RecordExport {
  app: 'interview-story';
  format: 1;
  exportedAt: string;
  record: InterviewRecord;
}

/** Pretty JSON export of the full record, wrapped with metadata. */
export function buildReportJson(record: InterviewRecord, exportedAt: number = Date.now()): string {
  const payload: RecordExport = { app: 'interview-story', format: 1, exportedAt: new Date(exportedAt).toISOString(), record };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** e.g. "interview-story_yuki_20260926-1502.md" (ASCII only — safe on every OS). */
export function reportFileName(record: InterviewRecord, ext: 'md' | 'json'): string {
  return `interview-story_${record.characterId}_${fileStamp(record.finishedAt)}.${ext}`;
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
