import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CharacterPortrait, CharacterSprite, EndingBackground } from '../art';
import { playBgm, playSfx } from '../audio';
import { CHARACTERS } from '../characters';
import { Button } from '../components/ui/Button';
import { MenuFrame } from '../components/ui/MenuFrame';
import { Modal } from '../components/ui/Modal';
import { useT, useUiLang } from '../i18n';
import { useGameStore } from '../store/game';
import { CHARACTER_IDS, ENDING_IDS, type CharacterId, type EndingId, type InterviewRecord } from '../types';
import { endingKey, formatDate } from './shared/format';
import { ENDING_EXPRESSION, MiniCg } from './shared/MiniCg';
import './GalleryScreen.css';

interface Selected {
  characterId: CharacterId;
  ending: EndingId;
}

/** Share of the 12 endings unlocked, 0–100. */
export function completionPercent(endings: Readonly<Record<string, number>>): number {
  const total = CHARACTER_IDS.length * ENDING_IDS.length;
  const unlocked = CHARACTER_IDS.reduce((n, c) => n + ENDING_IDS.filter((e) => endings[endingKey(c, e)] !== undefined).length, 0);
  return Math.round((unlocked / total) * 100);
}

function latestRecord(records: readonly InterviewRecord[], sel: Selected): InterviewRecord | undefined {
  return records.find((r) => r.characterId === sel.characterId && r.ending === sel.ending);
}

function EndingModal({ sel, onClose }: { sel: Selected | null; onClose: () => void }) {
  const t = useT();
  const lang = useUiLang();
  const endings = useGameStore((s) => s.endings);
  const records = useGameStore((s) => s.records);
  if (!sel) return null;
  const c = CHARACTERS[sel.characterId];
  const at = endings[endingKey(sel.characterId, sel.ending)];
  const record = latestRecord(records, sel);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${c.name[lang]} · ${t(`common.ending.${sel.ending}`)}`}
      width={760}
      className="gal-modal"
      footer={
        record ? (
          <Button variant="primary" icon="book" onClick={() => useGameStore.getState().viewRecord(record.id)} data-testid="gal-view-report">
            {t('gallery.viewReport')}
          </Button>
        ) : undefined
      }
    >
      <div className="gal-cg" style={{ '--cg-c': c.themeColor } as CSSProperties}>
        <EndingBackground ending={sel.ending} />
        <div className="gal-cg__sprite">
          <CharacterSprite characterId={sel.characterId} expression={ENDING_EXPRESSION[sel.ending]} height={470} />
        </div>
        <span className={`gal-cg__stamp gal-cg__stamp--${sel.ending}`}>{t(`common.ending.${sel.ending}.stamp`)}</span>
        <div className="gal-cg__caption">
          <p>{t(`gallery.desc.${sel.ending}`)}</p>
          {at !== undefined && <span className="gal-cg__date">{t('gallery.unlockedAt', { date: formatDate(at, lang) })}</span>}
        </div>
      </div>
    </Modal>
  );
}

/** Endings gallery: 3 interviewers × 4 endings. */
export function GalleryScreen() {
  const t = useT();
  const lang = useUiLang();
  const endings = useGameStore((s) => s.endings);
  const [selected, setSelected] = useState<Selected | null>(null);

  useEffect(() => {
    playBgm('title');
  }, []);

  const unlockedCount = useMemo(
    () => CHARACTER_IDS.reduce((n, c) => n + ENDING_IDS.filter((e) => endings[endingKey(c, e)] !== undefined).length, 0),
    [endings],
  );
  const total = CHARACTER_IDS.length * ENDING_IDS.length;
  const pct = completionPercent(endings);

  return (
    <>
      <MenuFrame
        kicker={t('gallery.kicker')}
        title={t('gallery.title')}
        backLabel={t('common.backToTitle')}
        onBack={() => useGameStore.getState().navigate('title')}
        className="gal-screen"
        extra={
          <div className="gal-progress" data-testid="gal-progress">
            <span className="gal-progress__label">{t('gallery.completion')}</span>
            <span className="gal-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span className="gal-progress__fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="gal-progress__pct">{pct}%</span>
            <span className="gal-progress__count">{t('gallery.completionValue', { n: unlockedCount, total })}</span>
          </div>
        }
        data-testid="screen-GalleryScreen"
      >
        <div className="gal">
          <div className="gal__corner" aria-hidden="true" />
          {ENDING_IDS.map((e) => (
            <div key={e} className={`gal__colhead gal__colhead--${e}`}>
              {t(`common.ending.${e}`)}
            </div>
          ))}
          {CHARACTER_IDS.map((cid, row) => {
            const c = CHARACTERS[cid];
            return (
              <div
                key={cid}
                className="gal__row"
                role="group"
                aria-label={t('gallery.rowLabel', { name: c.name[lang] })}
                style={{ '--row-c': c.themeColor, '--row-i': row } as CSSProperties}
              >
                <div className="gal__rowhead">
                  <CharacterPortrait characterId={cid} expression="smile" size={72} />
                  <span className="gal__rowname">{c.name[lang]}</span>
                  <span className="gal__rowco">{c.company[lang]}</span>
                </div>
                {ENDING_IDS.map((e) => {
                  const at = endings[endingKey(cid, e)];
                  const unlocked = at !== undefined;
                  return unlocked ? (
                    <button
                      key={e}
                      type="button"
                      className="gal__cell gal__cell--open"
                      onClick={() => {
                        playSfx('confirm');
                        setSelected({ characterId: cid, ending: e });
                      }}
                      onMouseEnter={() => playSfx('hover')}
                      aria-label={`${c.name[lang]} · ${t(`common.ending.${e}`)}`}
                      data-testid={`gal-cell-${cid}-${e}`}
                    >
                      <MiniCg characterId={cid} ending={e} portraitSize={118} className="gal__cg" />
                      <span className="gal__date">{t('gallery.unlockedAt', { date: formatDate(at, lang) })}</span>
                    </button>
                  ) : (
                    <div
                      key={e}
                      className="gal__cell gal__cell--locked"
                      data-testid={`gal-cell-${cid}-${e}`}
                      title={t('gallery.howTo', { hint: t(`gallery.hint.${e}`) })}
                    >
                      <MiniCg characterId={cid} ending={e} locked portraitSize={118} className="gal__cg" />
                      <span className="gal__hint">{t(`gallery.hint.${e}`)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </MenuFrame>
      {/* Rendered beside the frame so the backdrop covers the whole stage, header included. */}
      <EndingModal sel={selected} onClose={() => setSelected(null)} />
    </>
  );
}
