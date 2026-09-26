import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CharacterPortrait } from '../art';
import { playBgm, playSfx } from '../audio';
import { CHARACTERS } from '../characters';
import { Button } from '../components/ui/Button';
import { Chip, type ChipTone } from '../components/ui/Chip';
import { Icon } from '../components/ui/Icon';
import { MenuFrame } from '../components/ui/MenuFrame';
import { toast } from '../components/ui/Toast';
import { useT, useUiLang } from '../i18n';
import { useGameStore } from '../store/game';
import type { EndingId, InterviewRecord } from '../types';
import { formatDateTime } from './shared/format';
import { MiniCg } from './shared/MiniCg';
import './RecordsScreen.css';

const ENDING_TONE: Record<EndingId, ChipTone> = { perfect: 'gold', offer: 'sakura', pending: 'sky', rejected: 'neutral' };

export interface RecordStats {
  count: number;
  best: number;
  average: number;
}

export function recordStats(records: readonly InterviewRecord[]): RecordStats {
  if (records.length === 0) return { count: 0, best: 0, average: 0 };
  const scores = records.map((r) => (Number.isFinite(r.finalScore) ? r.finalScore : 0));
  return {
    count: records.length,
    best: Math.max(...scores),
    average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  };
}

/** Role shown on a record card: plan's inferred role, else the configured target role. */
export function recordRole(r: Pick<InterviewRecord, 'plan' | 'config'>): string {
  return (r.plan?.targetRole || r.config.targetRole || '').trim();
}

function RecordCard({ record, index }: { record: InterviewRecord; index: number }) {
  const t = useT();
  const lang = useUiLang();
  const [confirming, setConfirming] = useState(false);
  const c = CHARACTERS[record.characterId];
  const role = recordRole(record);
  const open = () => {
    playSfx('confirm');
    useGameStore.getState().viewRecord(record.id);
  };

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  return (
    <div
      className="rec-card"
      role="button"
      tabIndex={0}
      aria-label={t('gallery.records.open', { name: c.name[lang] })}
      onClick={open}
      onKeyDown={onKey}
      onMouseEnter={() => playSfx('hover')}
      style={{ '--rec-c': c.themeColor, animationDelay: `${Math.min(index, 10) * 50}ms` } as CSSProperties}
      data-testid={`record-${record.id}`}
    >
      <MiniCg characterId={record.characterId} ending={record.ending} portraitSize={112} showStamp={false} className="rec-card__cg" />
      <div className="rec-card__info">
        <div className="rec-card__date">
          <Icon name="clock" size={12} />
          {formatDateTime(record.finishedAt, lang)}
          <Chip size="sm" tone="lavender" variant="outline">
            {t(`common.lang.${record.lang}`)}
          </Chip>
        </div>
        <div className="rec-card__who">
          <CharacterPortrait characterId={record.characterId} expression="smile" size={26} still />
          <span className="rec-card__name">{c.name[lang]}</span>
          <span className="rec-card__company">{c.company[lang]}</span>
        </div>
        <div className={`rec-card__role${role ? '' : ' rec-card__role--auto'}`} title={role || undefined}>
          {role || t('gallery.records.roleAuto')}
        </div>
        <div className="rec-card__meta">
          <Chip size="sm" tone="neutral">
            {t(`common.style.${record.config.style}`)}
          </Chip>
          <Chip size="sm" tone="neutral">
            {t(`common.difficulty.${record.config.difficulty}`)}
          </Chip>
          <Chip size="sm" tone="neutral">
            {t('gallery.records.questions', { n: record.config.mainQuestions })}
          </Chip>
        </div>
      </div>
      <div className="rec-card__score">
        <Chip tone={ENDING_TONE[record.ending]} variant="solid" className="rec-card__badge">
          {t(`common.ending.${record.ending}`)}
        </Chip>
        <div className="rec-card__num">
          {Math.round(record.finalScore)}
          <small>{t('gallery.records.score')}</small>
        </div>
        <div className="rec-card__aff">
          <Icon name="heart" size={12} />
          {t('gallery.records.affinity', { n: Math.round(record.affinity) })}
        </div>
      </div>
      <div className="rec-card__del" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {confirming ? (
          <span className="rec-card__confirm">
            <span>{t('gallery.records.deleteQ')}</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirming(false);
                useGameStore.getState().deleteRecord(record.id);
                toast(t('gallery.records.deleted'));
              }}
              autoFocus
              data-testid={`record-${record.id}-delete-yes`}
            >
              {t('common.yes')}
            </Button>
            <Button size="sm" sfx="cancel" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            className="rec-card__trash"
            aria-label={t('gallery.records.delete')}
            title={t('gallery.records.delete')}
            onClick={() => {
              playSfx('click');
              setConfirming(true);
            }}
            data-testid={`record-${record.id}-delete`}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Past interviews (newest first); click one to open its report on the Result screen. */
export function RecordsScreen() {
  const t = useT();
  const records = useGameStore((s) => s.records);
  const stats = useMemo(() => recordStats(records), [records]);

  useEffect(() => {
    playBgm('title');
  }, []);

  return (
    <MenuFrame
      kicker={t('gallery.records.kicker')}
      title={t('gallery.records.title')}
      backLabel={t('common.backToTitle')}
      onBack={() => useGameStore.getState().navigate('title')}
      className="rec-screen"
      extra={
        stats.count > 0 && (
          <div className="rec-stats" data-testid="records-stats">
            <Chip tone="lavender" icon="book">
              {t('gallery.records.count', { n: stats.count })}
            </Chip>
            <Chip tone="gold" icon="trophy">
              {t('gallery.records.best', { n: stats.best })}
            </Chip>
            <Chip tone="sky" icon="sliders">
              {t('gallery.records.avg', { n: stats.average })}
            </Chip>
          </div>
        )
      }
      data-testid="screen-RecordsScreen"
    >
      {records.length === 0 ? (
        <div className="rec-empty" data-testid="records-empty">
          <CharacterPortrait characterId="yuki" expression="thinking" size={132} />
          <h2 className="rec-empty__title">{t('gallery.records.emptyTitle')}</h2>
          <p className="rec-empty__body">{t('gallery.records.emptyBody')}</p>
          <Button variant="primary" size="lg" icon="sakura" onClick={() => useGameStore.getState().navigate('setup')}>
            {t('gallery.records.start')}
          </Button>
        </div>
      ) : (
        <div className="rec-list gg-scroll" data-testid="records-list">
          {records.map((r, i) => (
            <RecordCard key={r.id} record={r} index={i} />
          ))}
        </div>
      )}
    </MenuFrame>
  );
}
