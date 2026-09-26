/**
 * Result: ending "CG" (background, sprite, stamp, score count-up, parting words, unlock toast),
 * then the full report. A past record opened from Records or the Endings gallery ("review") skips
 * the CG sequence and opens straight on the report; the CG stays one click away ("Back to ending")
 * and Back / Esc return to where the player came from.
 * The parting words are paged like the interviewer's lines (the dialogue box holds three lines):
 * click / Space / Enter finishes a page, then turns to the next one, then opens the report.
 * OWNER: ui-scene.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CharacterSprite, EndingBackground } from '../art';
import { playBgm, playSfx } from '../audio';
import { CHARACTERS } from '../characters';
import { DialogueBox, DialogueText } from '../components/game/DialogueBox';
import { paginate } from '../components/game/pagination';
import { markEventSeen, unseenEvents } from '../components/game/seenEvents';
import { useInterviewerVoice } from '../components/game/useInterviewerVoice';
import { useTypewriter } from '../components/game/useTypewriter';
import { ReportView } from '../components/report/ReportView';
import { isGoodEnding, scoreBreakdown } from '../components/report/reportUtils';
import { useCountUp } from '../components/report/useCountUp';
import { Button } from '../components/ui/Button';
import { useT } from '../i18n';
import { fullConfigFor, useGameStore, type GameEvent } from '../store/game';
import { useSettingsStore } from '../store/settings';
import type { EndingId, Expression, InterviewRecord, ScreenId } from '../types';
// The same function SetupScreen re-exports; imported from its module so the Result chunk doesn't pull in the whole wizard.
import { requestSetupPrefill } from './setup/draft';
import './ResultScreen.css';

const ENDING_EXPRESSION: Record<EndingId, Expression> = {
  perfect: 'happy',
  offer: 'happy',
  pending: 'thinking',
  rejected: 'troubled',
};

/** CG timeline (ms from mount). */
const T_STAMP = 900;
const T_SCORE = 1500;
const T_TOAST = 1900;
const T_DIALOGUE = 2300;
const TOAST_MS = 4200;

type Step = 0 | 1 | 2 | 3;
// 0: background + sprite · 1: stamp · 2: score · 3: dialogue

type UnlockEvent = Extract<GameEvent, { type: 'ending_unlocked' }>;

export interface ResultScreenProps {
  /** Screen shown before Result: 'records' / 'gallery' open a past record in review mode (report first, no CG sequence). */
  from?: ScreenId | null;
}

type ReviewFrom = 'records' | 'gallery';

export function ResultScreen({ from = null }: ResultScreenProps) {
  const record = useGameStore((s) => s.lastRecord);
  if (!record) return <ResultFallback />;
  const reviewFrom: ReviewFrom | null = from === 'records' || from === 'gallery' ? from : null;
  return <ResultScene key={record.id} record={record} reviewFrom={reviewFrom} />;
}

function ResultFallback() {
  const t = useT();
  return (
    <div className="res-screen res-screen--empty" data-testid="screen-ResultScreen">
      <div className="res-empty gg-panel">
        <p>{t('result.empty')}</p>
        <Button variant="primary" onClick={() => useGameStore.getState().navigate('title')}>
          {t('result.backToTitle')}
        </Button>
      </div>
    </div>
  );
}

function ResultScene({ record, reviewFrom }: { record: InterviewRecord; reviewFrom: ReviewFrom | null }) {
  const review = reviewFrom !== null;
  const t = useT();
  const display = useSettingsStore((s) => s.settings.display);
  const events = useGameStore((s) => s.events);
  const character = CHARACTERS[record.characterId];
  const scores = scoreBreakdown(record);
  const good = isGoodEnding(record.ending);
  const reduceMotion = display.reduceMotion;

  const [step, setStep] = useState<Step>(reduceMotion || review ? 3 : 0);
  const [view, setView] = useState<'cg' | 'report'>(review ? 'report' : 'cg');
  const [toast, setToast] = useState<UnlockEvent | null>(null);
  const voice = useInterviewerVoice(character, record.lang);

  // ── Timeline ──
  useEffect(() => {
    if (reduceMotion || review) return;
    // Monotonic: a click may already have skipped ahead.
    const reach = (n: Step) => setStep((s) => (s >= n ? s : n));
    const timers = [setTimeout(() => reach(1), T_STAMP), setTimeout(() => reach(2), T_SCORE), setTimeout(() => reach(3), T_DIALOGUE)];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, review]);

  // ── Sound: BGM + stamp thud + fanfare/sad sting ──
  useEffect(() => {
    playBgm(good ? 'ending_good' : 'ending_bad');
  }, [good]);
  const stamped = step >= 1;
  useEffect(() => {
    // A reviewed record is already decided: no stamp thud / fanfare on opening it.
    if (!stamped || review) return;
    playSfx('stamp');
    const id = setTimeout(() => playSfx(good ? 'fanfare' : 'sad'), 450);
    return () => clearTimeout(id);
  }, [stamped, good, review]);

  // ── "Ending unlocked" toast: once, only for the interview that just finished (never in review) ──
  const unlock =
    toast || review ? null : (unseenEvents(events, 'ending_unlocked', record.id).find((e) => e.recordId === record.id) ?? null);
  useEffect(() => {
    // Keyed on `stamped` (not `step`), so later timeline steps don't restart the toast's delay.
    if (!unlock || !stamped) return;
    const id = setTimeout(
      () => {
        markEventSeen(unlock, record.id);
        setToast(unlock);
        playSfx('notify');
      },
      reduceMotion ? 0 : Math.max(0, T_TOAST - T_STAMP),
    );
    return () => clearTimeout(id);
  }, [unlock, stamped, reduceMotion, record.id]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Score + parting words (paged) ──
  const shownScore = useCountUp(scores.final, { durationMs: 1300, start: step >= 2, instant: reduceMotion });
  const message = record.report.finalMessage.trim();
  const pages = useMemo(() => paginate(message), [message]);
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? '';
  const lastPage = pageIndex >= pages.length - 1;
  const typer = useTypewriter(page, {
    cps: display.textSpeed,
    paused: step < 3 || view !== 'cg',
    instant: reduceMotion,
    onBlip: () => playSfx('blip'),
  });
  // Each page is voiced while the CG dialogue is on screen (not behind the report); the next one is prefetched.
  const talking = step >= 3 && view === 'cg';
  const { speak, prefetch } = voice;
  const nextPage = pages[pageIndex + 1] ?? '';
  useEffect(() => {
    if (!talking || !page) return;
    void speak(page);
    if (nextPage) prefetch(nextPage);
  }, [talking, page, pageIndex, nextPage, speak, prefetch]);

  const toReport = useCallback(() => {
    voice.stop();
    playSfx('page');
    setView('report');
  }, [voice]);

  /** "Back to ending": the parting words start again from their first page. */
  const backToEnding = () => {
    setPageIndex(0);
    setView('cg');
  };

  /** Click on the CG: skip the timeline, then finish typing, then the next page, then open the report. */
  const advance = useCallback(() => {
    if (view !== 'cg') return;
    if (step < 3) {
      setStep(3);
      return;
    }
    if (!typer.done) {
      typer.complete();
      return;
    }
    if (!lastPage) {
      voice.stop();
      playSfx('page');
      setPageIndex((i) => i + 1);
      return;
    }
    toReport();
  }, [view, step, typer, lastPage, voice, toReport]);

  // Keyboard: Space / Enter advance, Esc returns from the report to the CG.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    if ((e.key === ' ' || e.key === 'Enter') && view === 'cg' && !e.repeat) {
      e.preventDefault();
      advance();
    } else if (e.key === 'Escape' && view === 'report') {
      e.preventDefault();
      if (review) backToSource();
      else backToEnding();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Same interview again: Setup opens prefilled (on the options step) with this record's config —
   * the full résumé while it is still in memory (records store only its first 4000 characters).
   */
  const tryAgain = () => {
    voice.stop();
    requestSetupPrefill(fullConfigFor(record.id) ?? record.config);
    useGameStore.getState().navigate('setup');
  };
  const backToTitle = () => {
    voice.stop();
    useGameStore.getState().navigate('title');
  };
  function backToSource() {
    voice.stop();
    useGameStore.getState().navigate(reviewFrom ?? 'title');
  }

  const stampMain = t(`result.ending.${record.ending}.stampMain`);
  const stampSub = t(`result.ending.${record.ending}.stampSub`);

  return (
    <div
      className={`res-screen res-screen--${record.ending} res-screen--${view}`}
      style={{ '--res-accent': character.themeColor } as CSSProperties}
      data-testid="screen-ResultScreen"
      data-view={view}
      onClick={advance}
    >
      <div className="res-bg">
        <EndingBackground ending={record.ending} />
      </div>

      <div className="res-sprite">
        <CharacterSprite
          characterId={record.characterId}
          expression={ENDING_EXPRESSION[record.ending]}
          speaking={voice.speaking || (voice.silent && step >= 3 && !typer.done && view === 'cg')}
          mouthLevelRef={voice.mouthLevelRef}
          height={640}
        />
      </div>

      <div className="res-cg">
        <div className="res-banner">
          <span className="res-banner__kicker">ENDING</span>
          <span className="res-banner__name">{t(`result.ending.${record.ending}.name`)}</span>
        </div>

        {step >= 1 && (
          <div
            className={`res-stamp res-stamp--${record.ending}${Array.from(stampMain).length > 4 ? ' res-stamp--long' : ''}`}
            data-testid="result-stamp" aria-label={`${stampMain} ${stampSub}`}>
            <svg className="res-stamp__defs" aria-hidden="true" width="0" height="0">
              <filter id="res-ink">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="7" />
                <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.75" />
                <feComposite in="SourceGraphic" operator="in" />
              </filter>
            </svg>
            <div className="res-stamp__ink">
              <span className="res-stamp__main">{stampMain}</span>
              <span className="res-stamp__sub">{stampSub}</span>
            </div>
          </div>
        )}

        {step >= 2 && (
          <div className="res-score" data-testid="result-score">
            <span className="res-score__label">{t('result.finalScore')}</span>
            <span className="res-score__value">
              <b>{shownScore}</b>
              <small>/100</small>
            </span>
            <span className="res-score__detail">{t('result.breakdown', { interview: scores.interview, affinity: scores.affinity })}</span>
          </div>
        )}

        {step >= 3 && view === 'cg' && (
          <>
            <DialogueBox
              speaker={{ name: character.name[record.lang], color: character.themeColor, sub: `${character.title[record.lang]} · ${character.company[record.lang]}` }}
              opacity={display.boxOpacity}
              className="res-dialogue"
              live
            >
              {page ? (
                <DialogueText visible={typer.visible} hidden={typer.hidden} done={typer.done} />
              ) : (
                <p className="dlg-text">……</p>
              )}
              {pages.length > 1 && (
                <span className="res-dialogue__page" aria-hidden="true" data-testid="result-page">
                  {pageIndex + 1}/{pages.length}
                </span>
              )}
            </DialogueBox>
            <div className="res-actions" onClick={(e) => e.stopPropagation()}>
              <Button variant="primary" sfx={null} onClick={toReport} data-testid="result-to-report">
                {t('result.toReport')} ▶
              </Button>
            </div>
          </>
        )}

        {step < 3 && <span className="res-hint">{t('result.clickHint')}</span>}
      </div>

      {toast && (
        <div className={`res-toast${toast.firstTime ? ' res-toast--new' : ''}`} role="status" data-testid="result-toast">
          {toast.firstTime && <span className="res-toast__new">NEW</span>}
          <span className="res-toast__text">{t(toast.firstTime ? 'result.unlocked' : 'result.reached', { name: t(`result.ending.${toast.ending}.name`) })}</span>
          {toast.firstTime && (
            <span className="res-toast__sparkles" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}

      {view === 'report' && (
        <div className="res-report" onClick={(e) => e.stopPropagation()}>
          <div className="res-report__panel gg-panel">
            <ReportView
              record={record}
              actions={
                <>
                  <Button size="sm" variant="ghost" className="res-report__back" onClick={backToEnding}>
                    {t('result.backToEnding')}
                  </Button>
                  {review ? (
                    <Button size="sm" onClick={backToSource} data-testid="result-back-source">
                      {t(reviewFrom === 'gallery' ? 'result.backToGallery' : 'result.backToRecords')}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={backToTitle} data-testid="result-title">
                      {t('result.backToTitle')}
                    </Button>
                  )}
                  <Button size="sm" variant="primary" onClick={tryAgain} data-testid="result-try-again">
                    {t('result.tryAgain')}
                  </Button>
                </>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
