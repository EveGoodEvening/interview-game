/**
 * Full interview report (scores, radar, per-question review, transcript).
 * OWNER: ui-scene agent. Used by ResultScreen and RecordsScreen.
 *
 * Fills its parent (height: 100%); give the parent a definite height.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CharacterPortrait } from '../../art';
import { playSfx } from '../../audio';
import { CHARACTERS } from '../../characters';
import { useT, useUiLang, type TFunction } from '../../i18n';
import { useSettingsStore } from '../../store/settings';
import type { InterviewRecord, Lang } from '../../types';
import { Button } from '../ui/Button';
import { buildReportJson, buildReportMarkdown, downloadText, reportFileName } from './exportReport';
import { RadarChart } from './RadarChart';
import { dimensionViews, formatDateTime, isBlankSkip, scoreBreakdown, speakerName, targetRole } from './reportUtils';
import { ScoreRing } from './ScoreRing';
import './ReportView.css';

export type ReportTab = 'overview' | 'questions' | 'transcript';
const TABS: ReportTab[] = ['overview', 'questions', 'transcript'];

export interface ReportViewProps {
  record: InterviewRecord;
  /** Extra buttons at the right end of the footer (e.g. Try again / Title). */
  actions?: ReactNode;
  initialTab?: ReportTab;
}

export function ReportView({ record, actions, initialTab = 'overview' }: ReportViewProps) {
  const t = useT();
  const uiLang = useUiLang();
  const reduceMotion = useSettingsStore((s) => s.settings.display.reduceMotion);
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const [exported, setExported] = useState<'md' | 'json' | null>(null);
  const character = CHARACTERS[record.characterId];
  const scores = scoreBreakdown(record);

  const exportAs = (kind: 'md' | 'json') => {
    try {
      if (kind === 'md') downloadText(reportFileName(record, 'md'), buildReportMarkdown(record, record.lang), 'text/markdown');
      else downloadText(reportFileName(record, 'json'), buildReportJson(record), 'application/json');
      setExported(kind);
      playSfx('notify');
      setTimeout(() => setExported((k) => (k === kind ? null : k)), 2200);
    } catch (err) {
      console.error('[report] export failed', err);
    }
  };

  return (
    <section className="rpt" style={{ '--rpt-accent': character.themeColor } as CSSProperties} data-testid="report-view">
      <header className="rpt__head">
        <CharacterPortrait characterId={record.characterId} expression="smile" size={64} className="rpt__portrait" />
        <div className="rpt__head-main">
          <span className="rpt__kicker">INTERVIEW REPORT</span>
          <h2 className="rpt__title">{t('result.report.title')}</h2>
          <p className="rpt__meta">
            {t('result.report.meta', {
              name: character.name[uiLang],
              company: character.company[uiLang],
              date: formatDateTime(record.finishedAt),
              role: targetRole(record),
            })}
          </p>
        </div>
        <div className={`rpt__ending rpt__ending--${record.ending}`}>
          <span className="rpt__ending-name">{t(`result.ending.${record.ending}.name`)}</span>
          <span className="rpt__ending-score">
            <b>{scores.final}</b>/100
          </span>
        </div>
      </header>

      <nav className="rpt__tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rpt__tab${tab === id ? ' is-active' : ''}`}
            onClick={() => {
              if (tab !== id) playSfx('click');
              setTab(id);
            }}
            data-testid={`report-tab-${id}`}
          >
            {t(`result.report.tab.${id}`)}
            {id === 'questions' && <em>{record.report.questionReviews.length}</em>}
          </button>
        ))}
      </nav>

      {/* One scroll container per tab (keyed), so every tab opens at its top. */}
      <div key={tab} className="rpt__body gg-scroll" role="tabpanel" data-testid={`report-panel-${tab}`}>
        {tab === 'overview' && <Overview record={record} t={t} reduceMotion={reduceMotion} />}
        {tab === 'questions' && <Questions record={record} t={t} />}
        {tab === 'transcript' && <Transcript record={record} t={t} lang={record.lang} />}
      </div>

      <footer className="rpt__foot">
        <Button size="sm" sfx={null} onClick={() => exportAs('md')} data-testid="report-export-md">
          {t('result.report.exportMd')}
        </Button>
        <Button size="sm" sfx={null} onClick={() => exportAs('json')} data-testid="report-export-json">
          {t('result.report.exportJson')}
        </Button>
        {exported && (
          <span className="rpt__exported" role="status">
            {t('result.report.exported')}
          </span>
        )}
        <span className="rpt__spacer" />
        {actions}
      </footer>
    </section>
  );
}

function Overview({ record, t, reduceMotion }: { record: InterviewRecord; t: TFunction; reduceMotion: boolean }) {
  const character = CHARACTERS[record.characterId];
  const scores = scoreBreakdown(record);
  const dims = dimensionViews(record);
  const { report } = record;
  return (
    <div className="rpt-ov">
      <div className="rpt-ov__score rpt-card">
        <ScoreRing score={scores.interview} label={t('result.report.interviewScore')} accent={character.themeColor} reduceMotion={reduceMotion} />
        <dl className="rpt-ov__stats">
          <div>
            <dt>{t('result.report.finalScore')}</dt>
            <dd>{scores.final}</dd>
          </div>
          <div>
            <dt>{t('result.report.affinity')}</dt>
            <dd>{scores.affinity}</dd>
          </div>
        </dl>
        <p className="rpt-ov__formula">{t('result.report.formula')}</p>
      </div>

      <div className="rpt-ov__radar rpt-card">
        <h3 className="rpt-h">{t('result.report.dimensions')}</h3>
        <RadarChart
          title={t('result.report.dimensions')}
          accent={character.themeColor}
          axes={dims.map((d) => ({ key: d.key, label: t(`result.dim.${d.key}`), value: d.score, detail: d.comment }))}
          width={340}
          height={290}
        />
      </div>

      <div className="rpt-ov__summary rpt-card">
        <h3 className="rpt-h">{t('result.report.summary')}</h3>
        <p className="rpt-ov__summary-text">{report.summary || '—'}</p>
        <ul className="rpt-dims">
          {dims.map((d) => (
            <li key={d.key}>
              <span className="rpt-dims__name">{t(`result.dim.${d.key}`)}</span>
              <span className="rpt-dims__bar" aria-hidden="true">
                <i style={{ width: `${d.score}%` }} />
              </span>
              <b className="rpt-dims__value">{d.score}</b>
              {d.comment && <span className="rpt-dims__comment">{d.comment}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="rpt-ov__list rpt-card rpt-card--good">
        <h3 className="rpt-h">{t('result.report.strengths')}</h3>
        <ul className="rpt-points">
          {report.strengths.length ? report.strengths.map((s, i) => <li key={i}>{s}</li>) : <li className="is-empty">—</li>}
        </ul>
      </div>
      <div className="rpt-ov__list rpt-card rpt-card--improve">
        <h3 className="rpt-h">{t('result.report.improvements')}</h3>
        <ul className="rpt-points">
          {report.improvements.length ? report.improvements.map((s, i) => <li key={i}>{s}</li>) : <li className="is-empty">—</li>}
        </ul>
      </div>
    </div>
  );
}

function Questions({ record, t }: { record: InterviewRecord; t: TFunction }) {
  const reviews = record.report.questionReviews;
  if (reviews.length === 0) return <p className="rpt-empty">{t('result.report.noQuestions')}</p>;
  return (
    <ol className="rpt-qs">
      {reviews.map((q, i) => {
        const score = Math.max(0, Math.min(10, Math.round(q.score)));
        return (
          <li key={i} className="rpt-q rpt-card">
            <div className="rpt-q__head">
              <span className="rpt-q__no">Q{i + 1}</span>
              <p className="rpt-q__question">{q.question}</p>
              <div className="rpt-q__score" aria-label={t('result.report.scoreAria', { n: score })}>
                <b>{score}</b>
                <span>/10</span>
                <span className="rpt-q__bar" aria-hidden="true">
                  <i style={{ width: `${score * 10}%` }} />
                </span>
              </div>
            </div>
            <div className="rpt-q__grid">
              <div>
                <h4>{t('result.report.answerSummary')}</h4>
                <p>{q.answerSummary || '—'}</p>
              </div>
              <div>
                <h4>{t('result.report.feedback')}</h4>
                <p>{q.feedback || '—'}</p>
              </div>
            </div>
            {q.betterAnswer && (
              <div className="rpt-q__better">
                <h4>{t('result.report.betterAnswer')}</h4>
                <p>{q.betterAnswer}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Transcript({ record, t, lang }: { record: InterviewRecord; t: TFunction; lang: Lang }) {
  const lines = record.transcript.filter((e) => e.text.trim() || e.answer?.skipped);
  if (lines.length === 0) return <p className="rpt-empty">{t('result.report.noTranscript')}</p>;
  return (
    <ol className="rpt-tx">
      {lines.map((e) => {
        const mine = e.role === 'candidate';
        return (
          <li key={e.id} className={`rpt-tx__line${mine ? ' rpt-tx__line--me' : ''}`}>
            <div className="rpt-tx__who">
              <b>{speakerName(e, record, lang)}</b>
              {mine && e.answer && !e.answer.skipped && (
                <span>
                  {t(`result.report.via.${e.answer.via}`)} · {t('result.report.seconds', { n: Math.round(e.answer.durationSec) })}
                </span>
              )}
            </div>
            <p className={`rpt-tx__text${e.answer?.skipped ? ' is-skipped' : ''}`}>{isBlankSkip(e) ? t('result.transcript.skipped') : e.text}</p>
          </li>
        );
      })}
      <li className="rpt-tx__end">{t('result.report.transcriptEnd')}</li>
    </ol>
  );
}
