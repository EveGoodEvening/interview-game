/**
 * The interview scene — the heart of the game.
 * Layers: background → sprite → HUD → question card → dialogue box → quick menu → overlays.
 *
 * Pausing: while the pause menu, the backlog, the title confirmation or the error dialog is open
 * the scene is paused — typing, the interviewer's voice and the question hand-over stop, a mic
 * recording stops (what was heard stays as an editable draft), the answer clock freezes and nothing
 * is auto-submitted or skipped. A trip to Config pauses the clock too (it lives outside the scene,
 * see answerClock.ts), so coming back resumes the countdown instead of restarting it.
 * OWNER: ui-scene.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type WheelEvent } from 'react';
import { CharacterSprite, OfficeBackground } from '../art';
import { playBgm, playSfx } from '../audio';
import { CHARACTERS } from '../characters';
import { answerClockKey, useAnswerClock } from '../components/game/answerClock';
import { AnswerPanel } from '../components/game/AnswerPanel';
import { Backlog, type BacklogLine } from '../components/game/Backlog';
import { ChapterCard } from '../components/game/ChapterCard';
import { DialogueBox, DialogueLoading, DialogueText, type Speaker } from '../components/game/DialogueBox';
import { ErrorDialog } from '../components/game/ErrorDialog';
import { AffinityMeter, AnswerTimer, ProgressChip } from '../components/game/Hud';
import { progressLabel } from '../components/game/labels';
import { PauseMenu } from '../components/game/PauseMenu';
import { QuestionCard } from '../components/game/QuestionCard';
import { QuickMenu, type QuickAction } from '../components/game/QuickMenu';
import { useInterviewerVoice } from '../components/game/useInterviewerVoice';
import { useLinePlayer } from '../components/game/useLinePlayer';
import { showStorageWarnings, useAffinityFloats, useChapterCards, useStorageWarnings } from '../components/game/useSceneEvents';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { translate, useT, useUiLang } from '../i18n';
import { createStt, retryTranscription } from '../speech';
import { setSettingsTab } from './settings/tabState';
import { useGameStore } from '../store/game';
import { currentInterviewerEntry, progressInfo } from '../store/selectors';
import { getSettings, useSettingsStore } from '../store/settings';
import type { Expression, InterviewSession, Stage, TranscriptEntry, TurnKind } from '../types';
import './InterviewScreen.css';

type Overlay = 'none' | 'backlog' | 'menu' | 'title';

const SPRITE_HEIGHT = 620;

function spriteExpression(stage: Stage, entry: TranscriptEntry | null): Expression {
  switch (stage.kind) {
    case 'loading':
      return 'thinking';
    case 'error':
      return 'troubled';
    case 'interviewer':
      return entry?.turn?.expression ?? 'neutral';
    case 'answer': {
      // Listening face: momentary reactions settle into a friendly smile.
      const e = entry?.turn?.expression ?? 'neutral';
      return e === 'happy' || e === 'surprised' ? 'smile' : e === 'thinking' || e === 'troubled' ? 'neutral' : e;
    }
    default:
      return 'neutral';
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
}

function logAsync(label: string, p: Promise<unknown>): void {
  p.catch((err: unknown) => console.error(`[interview] ${label} failed`, err));
}

const TAG_KEYS: Partial<Record<TurnKind, string>> = {
  opening: 'interview.backlog.tagOpening',
  followup: 'interview.backlog.tagFollowup',
  reverse_prompt: 'interview.backlog.tagReverse',
  reverse_answer: 'interview.backlog.tagReverse',
  closing: 'interview.backlog.tagClosing',
};

export function InterviewScreen() {
  const session = useGameStore((s) => s.session);
  const stage = useGameStore((s) => s.stage);
  if (!session) return <InterviewFallback />;
  return <InterviewScene session={session} stage={stage} />;
}

/** No session (e.g. the page was reloaded on this screen): offer a way back. */
function InterviewFallback() {
  const t = useT();
  return (
    <div className="iv-screen iv-screen--empty" data-testid="screen-InterviewScreen">
      <div className="iv-empty gg-panel">
        <p>{t('interview.empty')}</p>
        <Button variant="primary" onClick={() => useGameStore.getState().navigate('title')}>
          {t('interview.backToTitle')}
        </Button>
      </div>
    </div>
  );
}

function InterviewScene({ session, stage }: { session: InterviewSession; stage: Stage }) {
  const t = useT();
  const uiLang = useUiLang();
  const events = useGameStore((s) => s.events);
  const display = useSettingsStore((s) => s.settings.display);
  const sttSettings = useSettingsStore((s) => s.settings.stt);
  const playerSetting = useSettingsStore((s) => s.settings.playerName);

  const { config } = session;
  const lang = config.lang;
  const character = CHARACTERS[config.characterId];
  const voice = useInterviewerVoice(character, lang);
  const stt = useMemo(() => createStt({ ...getSettings(), stt: sttSettings }), [sttSettings]);

  const [auto, setAuto] = useState(display.autoAdvance);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [uiHidden, setUiHidden] = useState(false);
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [skipRequest, setSkipRequest] = useState(0);

  const currentEntry = currentInterviewerEntry(session);
  const presenting = stage.kind === 'interviewer' ? (session.transcript.find((e) => e.id === stage.entryId) ?? currentEntry) : null;
  /** Pause menu, backlog, title confirmation or error dialog: the scene holds still. */
  const paused = overlay !== 'none' || stage.kind === 'error';

  const { card, blocking, dismiss: dismissCard } = useChapterCards(events, session.id, display.reduceMotion);
  const floats = useAffinityFloats(events, session.id);
  useStorageWarnings(events, session.id, uiLang);

  const line = useLinePlayer({
    entry: presenting,
    active: stage.kind === 'interviewer',
    blocked: blocking || paused,
    auto,
    holdAuto: paused || uiHidden,
    textSpeed: display.textSpeed,
    autoDelayMs: display.autoDelayMs,
    reduceMotion: display.reduceMotion,
    voice,
    onFinished: () => useGameStore.getState().interviewerDone(),
  });

  // Paused: the interviewer stops talking (the line player re-voices an unfinished page on resume;
  // in the answer stage the question's voice just stops).
  const stopVoice = voice.stop;
  useEffect(() => {
    if (paused) stopVoice();
  }, [paused, stopVoice]);

  // ── Answer clock (per question; see answerClock.ts) ──
  // It starts once the interviewer has finished voicing the question (or when the player starts
  // answering), freezes while paused / the UI is hidden / Config is open, and survives remounts.
  const answerKey = stage.kind === 'answer' ? (currentEntry?.id ?? 'answer') : null;
  const clockKey = answerKey ? answerClockKey(session.id, answerKey) : null;
  const timed = session.phase === 'intro' || session.phase === 'questioning';
  const limitSec = timed ? Math.max(0, config.answerTimeLimitSec) : 0;
  const [timeUpKey, setTimeUpKey] = useState<string | null>(null);
  const answerClock = useAnswerClock(clockKey, { paused: paused || uiHidden, voiceBusy: voice.speaking, limitSec, onTimeUp: setTimeUpKey });
  const clock = answerClock.clock;

  // A fresh question: re-open the question card, play a soft cue.
  useEffect(() => {
    if (!answerKey) return;
    setQuestionCollapsed(false);
    playSfx('notify');
  }, [answerKey]);

  // ── BGM ──
  const tense = config.difficulty === 'hard' || session.affinity < 30;
  useEffect(() => {
    playBgm(tense ? 'tense' : 'interview');
  }, [tense]);

  // ── Actions ──
  const questionText = currentEntry?.turn?.question || currentEntry?.text || '';
  const replay = useCallback(() => {
    if (stage.kind === 'interviewer') line.replay();
    else if (stage.kind === 'answer' && !listening && questionText) void voice.speak(questionText);
  }, [stage.kind, line, listening, questionText, voice]);

  /** Save & quit to the title. A failed autosave write is announced there (the scene unmounts). */
  const saveAndQuit = () => {
    voice.stop();
    useGameStore.getState().suspendInterview();
    showStorageWarnings(useGameStore.getState().events, session.id, uiLang);
  };

  const retry = useCallback(() => {
    setRetrying(true);
    useGameStore
      .getState()
      .retry()
      .catch((err: unknown) => console.error('[interview] retry failed', err))
      .finally(() => setRetrying(false));
  }, []);

  const onQuick = (action: QuickAction) => {
    switch (action) {
      case 'auto':
        setAuto((a) => !a);
        break;
      case 'log':
        setOverlay('backlog');
        break;
      case 'replay':
        replay();
        break;
      case 'skip':
        if (stage.kind === 'interviewer') {
          // Skipping the line also skips its chapter card (it would otherwise veil the answer panel).
          if (card) dismissCard();
          line.skip();
        } else if (stage.kind === 'answer') setSkipRequest((n) => n + 1);
        break;
      case 'config':
        voice.stop();
        useGameStore.getState().openSettings();
        break;
      case 'title':
        setOverlay('title');
        break;
    }
  };

  // ── Keyboard ──
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      if (stage.kind === 'error') return;
      e.preventDefault();
      if (uiHidden) setUiHidden(false);
      else setOverlay((o) => (o === 'none' ? 'menu' : 'none'));
      return;
    }
    if (paused || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'enter') {
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      if (stage.kind !== 'interviewer') return;
      e.preventDefault();
      if (uiHidden) setUiHidden(false);
      else if (card) dismissCard();
      else if (!e.repeat) line.advance();
    } else if (key === 'l' && !e.repeat) {
      setOverlay('backlog');
    } else if (key === 'a' && !e.repeat) {
      setAuto((a) => !a);
      playSfx('click');
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Mouse: click advances, right-click hides the UI, wheel-up opens the backlog ──
  const onStageClick = () => {
    if (uiHidden) {
      setUiHidden(false);
      return;
    }
    if (overlay !== 'none') return;
    if (card) dismissCard();
    else if (stage.kind === 'interviewer') line.advance();
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    if (paused || stage.kind === 'answer') return;
    setUiHidden((h) => !h);
  };
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0 || paused || uiHidden) return;
    if ((e.target as HTMLElement).closest('textarea, .gg-scroll')) return;
    setOverlay('backlog');
  };

  // ── Derived view data ──
  const expression = spriteExpression(stage, stage.kind === 'interviewer' ? presenting : currentEntry);
  const typing = line.running && !line.typer.done;
  const speaking = voice.speaking || (voice.silent && typing);
  const evening = session.phase === 'closing' || session.phase === 'evaluating' || session.phase === 'finished';
  const progress = progressInfo(session);
  const interviewerSpeaker: Speaker = {
    name: character.name[lang],
    color: character.themeColor,
    sub: `${character.title[lang]} · ${character.company[lang]}`,
  };
  const playerName = playerSetting.trim() || session.plan?.candidateName?.trim() || translate(lang, 'interview.player.you');
  const playerSpeaker: Speaker = { name: playerName, color: '#6aa8ff', sub: translate(lang, 'interview.player.candidate') };
  const characterName = character.name[uiLang];

  const backlogLines: BacklogLine[] = useMemo(() => {
    const lines: BacklogLine[] = [];
    for (const e of session.transcript) {
      const isPresenting = stage.kind === 'interviewer' && presenting?.id === e.id;
      const text = isPresenting ? line.revealed : e.text;
      if (!text && !e.answer?.skipped) continue;
      const tagKey = e.turn ? TAG_KEYS[e.turn.kind] : undefined;
      lines.push({ id: e.id, role: e.role, text, skipped: e.answer?.skipped === true && !text.trim(), tag: tagKey ? t(tagKey) : null });
      if (isPresenting) break;
    }
    return lines;
  }, [session.transcript, stage.kind, presenting?.id, line.revealed, t]);

  let dialogue;
  switch (stage.kind) {
    case 'interviewer':
      dialogue = (
        <DialogueBox speaker={interviewerSpeaker} opacity={display.boxOpacity} onClick={(e) => {
            e.stopPropagation();
            onStageClick();
          }}
          live
        >
          <DialogueText visible={line.typer.visible} hidden={line.typer.hidden} done={line.typer.done} showNext={line.waiting} />
        </DialogueBox>
      );
      break;
    case 'answer':
      dialogue = (
        <DialogueBox speaker={playerSpeaker} opacity={display.boxOpacity} variant="player">
          <AnswerPanel
            key={answerKey ?? 'answer'}
            stt={stt}
            lang={lang}
            autoSubmit={sttSettings.autoSubmit}
            reverse={session.phase === 'reverse'}
            timeUp={timeUpKey !== null && timeUpKey === clockKey}
            hotkeysEnabled={!paused}
            paused={paused}
            startedAt={clock?.startedAt ?? Date.now()}
            draftKey={clockKey ?? 'answer'}
            skipRequest={skipRequest}
            onSubmit={(text, meta) => logAsync('submitAnswer', useGameStore.getState().submitAnswer(text, meta))}
            onSkip={() => logAsync('skipQuestion', useGameStore.getState().skipQuestion())}
            onEndReverse={() => logAsync('endReverseQA', useGameStore.getState().endReverseQA())}
            onRepeatQuestion={() => questionText && void voice.speak(questionText)}
            onMicStart={voice.stop}
            onAnswerStart={answerClock.start}
            onListeningChange={setListening}
            onRetryTranscription={(recording, signal) => retryTranscription({ ...getSettings(), stt: sttSettings }, recording, lang, signal)}
          />
        </DialogueBox>
      );
      break;
    case 'loading':
      dialogue = (
        <DialogueBox speaker={interviewerSpeaker} opacity={display.boxOpacity}>
          <DialogueLoading text={t(`interview.loading.${stage.reason}`, { name: characterName })} />
        </DialogueBox>
      );
      break;
    case 'error':
      dialogue = (
        <DialogueBox speaker={interviewerSpeaker} opacity={display.boxOpacity}>
          <DialogueLoading text={t('interview.loading.error', { name: characterName })} />
        </DialogueBox>
      );
      break;
    case 'ended':
      dialogue = (
        <DialogueBox speaker={interviewerSpeaker} opacity={display.boxOpacity}>
          <div className="iv-ended">
            <p className="dlg-text">{t('interview.ended')}</p>
            <Button variant="primary" onClick={() => useGameStore.getState().navigate('result')}>
              {t('interview.toResult')}
            </Button>
          </div>
        </DialogueBox>
      );
      break;
    default:
      dialogue = (
        <DialogueBox speaker={interviewerSpeaker} opacity={display.boxOpacity}>
          <DialogueLoading text={t('interview.loading.idle', { name: characterName })} />
        </DialogueBox>
      );
  }

  const progressText = progress ? progressLabel(progress, t) : null;
  const questionCaption = progressText ? [progressText.main, progressText.badge].filter(Boolean).join(' · ') : undefined;

  return (
    <div
      className={`iv-screen iv-screen--${stage.kind}${uiHidden ? ' iv-screen--hidden' : ''}`}
      style={{ '--iv-accent': character.themeColor } as CSSProperties}
      data-testid="screen-InterviewScreen"
      data-stage={stage.kind}
      onClick={onStageClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      <div className="iv-bg">
        <OfficeBackground characterId={character.id} variant={evening ? 'evening' : 'day'} />
      </div>

      <div className={`iv-sprite${stage.kind === 'answer' ? ' iv-sprite--aside' : ''}`}>
        <div className="iv-sprite__in">
          <CharacterSprite characterId={character.id} expression={expression} speaking={speaking} mouthLevelRef={voice.mouthLevelRef} height={SPRITE_HEIGHT} />
        </div>
      </div>
      <div className="iv-vignette" aria-hidden="true" />

      {!uiHidden && (
        <div className="iv-ui">
          {progress && <ProgressChip progress={progress} accent={character.themeColor} />}
          <AffinityMeter value={session.affinity} floats={floats} />
          {stage.kind === 'answer' && clock && <AnswerTimer startedAt={clock.startedAt} pausedAt={clock.pausedAt} limitSec={limitSec} />}
          {stage.kind === 'answer' && questionText && (
            <QuestionCard question={questionText} accent={character.themeColor} collapsed={questionCollapsed} onToggle={() => setQuestionCollapsed((c) => !c)} caption={questionCaption} />
          )}
          {dialogue}
          <QuickMenu
            auto={auto}
            onAction={onQuick}
            disabled={{
              replay: !(stage.kind === 'interviewer' || (stage.kind === 'answer' && !listening)),
              skip: !(stage.kind === 'interviewer' || (stage.kind === 'answer' && session.phase !== 'reverse')),
            }}
          />
        </div>
      )}

      {card && <ChapterCard chapter={card} />}

      {overlay === 'backlog' && (
        <Backlog
          lines={backlogLines}
          interviewer={{ name: character.name[lang], color: character.themeColor }}
          playerName={playerName}
          // Never voice the interviewer while the mic is (still) recording: it would end up in the answer.
          replayDisabled={listening}
          onReplay={(text) => {
            if (!listening) void voice.speak(text);
          }}
          onClose={() => setOverlay('none')}
        />
      )}

      {overlay === 'menu' && (
        <PauseMenu
          onResume={() => setOverlay('none')}
          onConfig={() => {
            voice.stop();
            useGameStore.getState().openSettings();
          }}
          onSaveQuit={saveAndQuit}
          onAbandon={() => {
            voice.stop();
            useGameStore.getState().abandonInterview();
          }}
        />
      )}

      <Modal
        open={overlay === 'title'}
        title={t('interview.titleConfirm.title')}
        onClose={() => setOverlay('none')}
        width={480}
        footer={
          <>
            <Button onClick={() => setOverlay('none')}>{t('interview.titleConfirm.cancel')}</Button>
            <Button variant="primary" onClick={saveAndQuit}>
              {t('interview.titleConfirm.ok')}
            </Button>
          </>
        }
      >
        <p className="iv-modal-text">{t('interview.titleConfirm.body')}</p>
      </Modal>

      {stage.kind === 'error' && (
        <ErrorDialog
          code={stage.code}
          message={stage.message}
          retrying={retrying}
          onRetry={retry}
          onSettings={() => {
            voice.stop();
            setSettingsTab('llm');
            useGameStore.getState().openSettings();
          }}
          onSaveQuit={saveAndQuit}
          onAbandon={() => useGameStore.getState().abandonInterview()}
        />
      )}

      {uiHidden && <div className="iv-hidden-hint">{t('interview.uiHidden')}</div>}
    </div>
  );
}
