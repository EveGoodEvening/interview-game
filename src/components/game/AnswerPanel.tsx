import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { playSfx } from '../../audio';
import { useT } from '../../i18n';
import { SttError, type ListenSession, type SttEngine, type SttErrorCode } from '../../speech';
import type { AnswerVia, Lang } from '../../types';
import { Button } from '../ui/Button';
import { formatClock, settingsLabelVars } from './labels';
import { LevelMeter } from './LevelMeter';
import { sttErrorCopy } from './sttErrors';
import './AnswerPanel.css';

export type AnswerMode = 'voice' | 'keyboard';
type MicPhase = 'idle' | 'starting' | 'listening' | 'transcribing' | 'review' | 'error';
/** Why the mic is still 'starting' after a while: a pending permission prompt, or it just didn't start yet. */
type StartHint = 'permission' | 'slow' | null;

export interface AnswerPanelProps {
  stt: SttEngine;
  /** Interview language (recognition language). */
  lang: Lang;
  /** Submit right after recognition (settings.stt.autoSubmit). */
  autoSubmit: boolean;
  /** Reverse Q&A: offer "No more questions" instead of "Skip". */
  reverse: boolean;
  /** The time limit ran out: stop recording and submit what we have (or skip when empty). */
  timeUp: boolean;
  /** Global hotkeys (M, Ctrl+Enter) — false while a menu / the backlog is open. */
  hotkeysEnabled: boolean;
  /**
   * The game is paused (pause menu, backlog, error dialog): a recording stops and what was heard
   * becomes an editable draft; nothing is auto-submitted and the time limit is not applied.
   */
  paused?: boolean;
  /** When the question was put to the candidate (ms epoch, paused time excluded) — for durationSec. */
  startedAt: number;
  /** Keeps a typed draft across remounts (e.g. a trip to Settings). Usually the question's entry id. */
  draftKey: string;
  onSubmit: (text: string, meta: { via: AnswerVia; durationSec: number }) => void;
  onSkip: () => void;
  onEndReverse: () => void;
  /** Re-speak the question. */
  onRepeatQuestion: () => void;
  /** The mic is about to open — stop the interviewer's voice. */
  onMicStart?: () => void;
  /** The candidate started answering (mic or first keystroke), e.g. to start the answer clock. */
  onAnswerStart?: () => void;
  /** Mic busy (opening, recording or finishing a take), e.g. to disable voice replays. */
  onListeningChange?: (listening: boolean) => void;
  /** Incremented by the quick-menu Skip: opens the inline skip confirmation. */
  skipRequest?: number;
  /**
   * Send a kept recording to the transcription API again (API engine, after a failed
   * transcription). Resolves with the transcript; rejects with SttError.
   */
  onRetryTranscription?: (recording: Blob, signal: AbortSignal) => Promise<string>;
}

/** A recording whose transcription failed, kept for "Retry transcription". */
interface KeptRecording {
  recording: Blob;
  error: SttError;
}

const drafts = new Map<string, string>();
const keptRecordings = new Map<string, KeptRecording>();
/** The answer mode the player picked for a question ("Type instead"), kept across remounts. */
const chosenModes = new Map<string, AnswerMode>();

/** After this long in 'starting', explain the wait (permission prompt / mic not starting) and allow cancelling (ms). */
export const MIC_START_TIMEOUT_MS = 10_000;

/** For tests. */
export function clearAnswerDrafts(): void {
  drafts.clear();
  keptRecordings.clear();
  chosenModes.clear();
}

function forgetQuestion(key: string): void {
  drafts.delete(key);
  keptRecordings.delete(key);
  chosenModes.delete(key);
}

/**
 * Add a new voice take to the answer so far. The take goes on a new line, so the join is
 * visible and easy to edit; either side may be empty.
 */
export function appendTake(previous: string, take: string): string {
  const a = previous.trim();
  const b = take.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n${b}`;
}

function toSttError(err: unknown): SttError {
  if (err instanceof SttError) return err;
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return new SttError((err as { code: SttErrorCode }).code, String((err as { message?: unknown }).message ?? ''));
  }
  return new SttError('api', err instanceof Error ? err.message : String(err));
}

function engineUsable(stt: SttEngine): boolean {
  if (stt.kind === 'keyboard') return false;
  try {
    return stt.isAvailable();
  } catch {
    return false;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** The browser's microphone permission, when it can tell ('unknown' otherwise). */
async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!permissions?.query) return 'unknown';
    const status = await permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Error codes whose technical message helps the player (endpoint / relay / status details). */
const DETAILED_CODES: readonly SttErrorCode[] = ['api', 'network', 'config'];

/**
 * The candidate's side of the dialogue box: voice answer (mic button, live transcript, editable
 * result; the mic adds to the answer, "Re-record" replaces it) or keyboard answer, plus
 * Repeat / Skip / No-more-questions.
 */
export function AnswerPanel(props: AnswerPanelProps) {
  const { stt, lang, reverse, timeUp, hotkeysEnabled, draftKey, paused = false } = props;
  const t = useT();
  const voiceCapable = engineUsable(stt);
  const fellBack = stt.kind !== 'keyboard' && !voiceCapable;

  const [mode, setModeState] = useState<AnswerMode>(() => (voiceCapable ? (chosenModes.get(draftKey) ?? 'voice') : 'keyboard'));
  const [kept, setKeptState] = useState<KeptRecording | null>(() => (voiceCapable ? (keptRecordings.get(draftKey) ?? null) : null));
  // A voice answer restored after a remount (e.g. back from Config) opens in review, editable.
  const [phase, setPhaseState] = useState<MicPhase>(() => {
    if (!voiceCapable) return 'idle';
    if (drafts.get(draftKey)?.trim() || chosenModes.get(draftKey) === 'keyboard') return 'review';
    return keptRecordings.has(draftKey) ? 'error' : 'idle';
  });
  const [text, setTextState] = useState(() => drafts.get(draftKey) ?? '');
  const [partial, setPartialState] = useState('');
  const [error, setError] = useState<SttError | null>(() => (voiceCapable ? (keptRecordings.get(draftKey)?.error ?? null) : null));
  const [startHint, setStartHintState] = useState<StartHint>(null);
  /** The pause stopped the recording: say so in the review hint. */
  const [stoppedByPause, setStoppedByPause] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recStart, setRecStart] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Latest values for async flows.
  const phaseRef = useRef(phase);
  const textRef = useRef(text);
  const partialRef = useRef(partial);
  const keptRef = useRef(kept);
  const startHintRef = useRef<StartHint>(null);
  const sessionRef = useRef<ListenSession | null>(null);
  const tokenRef = useRef(0);
  /** False once unmounted: a take finishing later still lands in the draft; a mic opening later is closed. */
  const mountedRef = useRef(true);
  const retryCtlRef = useRef<AbortController | null>(null);
  const submittedRef = useRef(false);
  const submitAfterStopRef = useRef(false);
  /** Time ran out while a failed recording was kept: a successful retry submits right away. */
  const submitAfterRetryRef = useRef(false);
  const answerStartedRef = useRef(false);
  const levelRef = useRef(0);
  const micRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const setPhase = useCallback((p: MicPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const setText = useCallback(
    (v: string) => {
      textRef.current = v;
      setTextState(v);
      if (v) drafts.set(draftKey, v);
      else drafts.delete(draftKey);
    },
    [draftKey],
  );
  const setPartial = useCallback((v: string) => {
    partialRef.current = v;
    setPartialState(v);
  }, []);
  const setStartHint = useCallback((h: StartHint) => {
    startHintRef.current = h;
    setStartHintState(h);
  }, []);
  const setKept = useCallback(
    (k: KeptRecording | null) => {
      keptRef.current = k;
      setKeptState(k);
      if (k) keptRecordings.set(draftKey, k);
      else keptRecordings.delete(draftKey);
    },
    [draftKey],
  );

  const markAnswerStart = useCallback(() => {
    if (answerStartedRef.current) return;
    answerStartedRef.current = true;
    propsRef.current.onAnswerStart?.();
  }, []);

  const micBusy = phase === 'starting' || phase === 'listening' || phase === 'transcribing';
  const listening = phase === 'starting' || phase === 'listening';

  useEffect(() => {
    propsRef.current.onListeningChange?.(micBusy);
  }, [micBusy]);

  // Release the microphone on unmount (an in-flight take still lands in the draft). A recording cut
  // off by the unmount (e.g. the quick menu's Config) keeps its live transcript as the draft; nothing
  // is uploaded for an API engine after the player left.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const live = sessionRef.current;
      sessionRef.current = null;
      if (live) {
        live.cancel();
        const heard = partialRef.current.trim();
        const key = propsRef.current.draftKey;
        if (heard && !submittedRef.current) drafts.set(key, appendTake(textRef.current, heard));
      }
      retryCtlRef.current?.abort();
      retryCtlRef.current = null;
      propsRef.current.onListeningChange?.(false);
    };
  }, []);

  // A mic that takes long to start: never call it "unsupported". Explain the wait (a pending
  // permission prompt, or a mic that didn't start) and let the player cancel; a session that
  // arrives later is still used.
  useEffect(() => {
    if (phase !== 'starting') return;
    const token = tokenRef.current;
    const id = setTimeout(() => {
      void micPermissionState().then((state) => {
        if (token !== tokenRef.current || phaseRef.current !== 'starting') return;
        setStartHint(state === 'prompt' ? 'permission' : 'slow');
      });
    }, MIC_START_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase, setStartHint]);

  // Recording clock for engines without live transcripts.
  useEffect(() => {
    if (phase !== 'listening') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);

  // Keep the newest words of a long live transcript in view.
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [partial, phase]);

  const submit = useCallback(
    (value: string, how: AnswerVia) => {
      const answer = value.trim();
      if (!answer || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitted(true);
      forgetQuestion(draftKey);
      const durationSec = Math.max(1, Math.round((Date.now() - propsRef.current.startedAt) / 1000));
      propsRef.current.onSubmit(answer, { via: how, durationSec });
    },
    [draftKey],
  );

  /** Submit, or skip / end the reverse Q&A when there is nothing to submit (time up). */
  const submitOrPass = useCallback(
    (value: string, how: AnswerVia) => {
      if (submittedRef.current) return;
      if (value.trim()) {
        submit(value, how);
        return;
      }
      submittedRef.current = true;
      setSubmitted(true);
      forgetQuestion(draftKey);
      if (propsRef.current.reverse) propsRef.current.onEndReverse();
      else propsRef.current.onSkip();
    },
    [submit, draftKey],
  );

  /**
   * A take (or a transcription retry) ended with `heard` ('' = nothing) and maybe a failure.
   * The take is appended to the answer so far; a failed transcription keeps its recording.
   */
  const finishTake = useCallback(
    (heard: string, failure: SttError | null, allowAutoSubmit: boolean) => {
      const joined = appendTake(textRef.current, heard);
      const recording = failure?.recording ?? null;
      if (heard) setKept(null);
      else if (recording && failure) setKept({ recording, error: failure });
      else if (!failure) setKept(null); // the service answered: nothing to retry

      const timeIsUp = submitAfterStopRef.current;
      submitAfterStopRef.current = false;
      if (timeIsUp && !(recording && !heard)) {
        submitOrPass(joined, 'voice');
        return;
      }
      if (timeIsUp) submitAfterRetryRef.current = true; // the answer was given in time; its transcription failed

      if (!heard) {
        setError(failure ?? new SttError('no-speech', 'nothing recognised'));
        setPhase('error');
        return;
      }
      if (submitAfterRetryRef.current) {
        submitAfterRetryRef.current = false;
        submitOrPass(joined, 'voice');
        return;
      }
      setError(failure);
      setText(joined);
      setPhase('review');
      if (allowAutoSubmit && propsRef.current.autoSubmit && !failure && !propsRef.current.paused) submit(joined, 'voice');
    },
    [setKept, setPhase, setText, submit, submitOrPass],
  );

  const startListening = useCallback(async () => {
    if (submittedRef.current || propsRef.current.paused) return;
    const p = phaseRef.current;
    if (p === 'starting' || p === 'listening' || p === 'transcribing') return;
    propsRef.current.onMicStart?.();
    markAnswerStart();
    playSfx('micOn');
    const token = ++tokenRef.current;
    // A new take replaces a failed recording that was kept for retrying.
    setKept(null);
    submitAfterRetryRef.current = false;
    setError(null);
    setPartial('');
    setConfirmSkip(false);
    setStoppedByPause(false);
    setStartHint(null);
    setPhase('starting');
    // First use: say that the browser is asking for permission (instead of a bare spinner).
    void micPermissionState().then((state) => {
      if (state === 'prompt' && token === tokenRef.current && phaseRef.current === 'starting') setStartHint('permission');
    });
    try {
      const session = await stt.start({
        lang,
        onPartial: (s) => {
          if (token === tokenRef.current) setPartial(s);
        },
        onLevel: (l) => {
          levelRef.current = l;
        },
        onError: (err) => {
          if (token !== tokenRef.current || !mountedRef.current) return;
          tokenRef.current++;
          sessionRef.current?.cancel();
          sessionRef.current = null;
          levelRef.current = 0;
          setError(toSttError(err));
          const heard = partialRef.current.trim();
          if (heard) {
            setText(appendTake(textRef.current, heard));
            setPhase('review');
          } else setPhase('error');
        },
      });
      if (token !== tokenRef.current || !mountedRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setStartHint(null);
      setRecStart(Date.now());
      setNow(Date.now());
      setPhase('listening');
    } catch (err) {
      if (token !== tokenRef.current || !mountedRef.current) return;
      setStartHint(null);
      setError(toSttError(err));
      setPhase('error');
    }
  }, [lang, markAnswerStart, setKept, setPartial, setPhase, setStartHint, setText, stt]);

  /** Give up on a mic that is still starting (the session is cancelled if it arrives later). */
  const cancelStart = useCallback(() => {
    if (phaseRef.current !== 'starting') return;
    tokenRef.current++;
    levelRef.current = 0;
    setStartHint(null);
    setPhase(textRef.current.trim() ? 'review' : 'idle');
  }, [setPhase, setStartHint]);

  const stopListening = useCallback(
    async (opts: { submit?: boolean; autoSubmit?: boolean; byPause?: boolean } = {}) => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      if (opts.submit) submitAfterStopRef.current = true;
      playSfx('micOff');
      const token = tokenRef.current;
      setPhase('transcribing');
      let heard = '';
      let failure: SttError | null = null;
      try {
        heard = (await session.stop()).trim();
      } catch (err) {
        failure = toSttError(err);
      }
      levelRef.current = 0;
      heard ||= partialRef.current.trim();
      if (!mountedRef.current) {
        // Unmounted meanwhile (e.g. Config from the pause menu): keep what was said as the draft,
        // or the recording whose transcription failed (offered for a retry on return).
        if (token === tokenRef.current) {
          if (heard) drafts.set(draftKey, appendTake(drafts.get(draftKey) ?? textRef.current, heard));
          else if (failure?.recording) keptRecordings.set(draftKey, { recording: failure.recording, error: failure });
        }
        return;
      }
      if (token !== tokenRef.current) return;
      if (opts.byPause) setStoppedByPause(true);
      finishTake(heard, failure, opts.autoSubmit !== false);
    },
    [draftKey, finishTake, setPhase],
  );

  /** Send the kept recording to the transcription API again. */
  const retryTranscription = useCallback(async () => {
    const held = keptRef.current;
    const retry = propsRef.current.onRetryTranscription;
    if (!held || !retry || submittedRef.current || propsRef.current.paused) return;
    const p = phaseRef.current;
    if (p === 'starting' || p === 'listening' || p === 'transcribing') return;
    const token = ++tokenRef.current;
    retryCtlRef.current?.abort();
    const ctl = new AbortController();
    retryCtlRef.current = ctl;
    playSfx('click');
    setError(null);
    setStoppedByPause(false);
    setPhase('transcribing');
    let heard = '';
    let failure: SttError | null = null;
    try {
      heard = (await retry(held.recording, ctl.signal)).trim();
    } catch (err) {
      failure = toSttError(err);
    }
    if (retryCtlRef.current === ctl) retryCtlRef.current = null;
    if (token !== tokenRef.current || !mountedRef.current) return;
    // Failed again: keep the recording (with the new reason) for another try.
    if (failure && !heard && !failure.recording) setKept({ recording: held.recording, error: failure });
    finishTake(heard, failure, true);
  }, [finishTake, setKept, setPhase]);

  const toggleMic = useCallback(() => {
    if (submittedRef.current) return;
    const p = phaseRef.current;
    if (p === 'listening') void stopListening();
    else if (p === 'starting') {
      if (startHintRef.current) cancelStart();
    } else if (p === 'idle' || p === 'review' || p === 'error') void startListening();
  }, [cancelStart, startListening, stopListening]);

  /** The explicit replace: clear the answer, then record a new one. */
  const rerecord = useCallback(() => {
    if (submittedRef.current || propsRef.current.paused) return;
    setText('');
    void startListening();
  }, [setText, startListening]);

  const trySubmit = useCallback(() => {
    const p = phaseRef.current;
    if (mode === 'keyboard' || p === 'review' || p === 'error') submit(textRef.current, mode === 'keyboard' ? 'text' : 'voice');
  }, [mode, submit]);

  const switchMode = useCallback(
    (next: AnswerMode) => {
      tokenRef.current++;
      sessionRef.current?.cancel();
      sessionRef.current = null;
      retryCtlRef.current?.abort();
      retryCtlRef.current = null;
      levelRef.current = 0;
      setError(null);
      setPartial('');
      setStartHint(null);
      setStoppedByPause(false);
      setPhase(next === 'voice' && !textRef.current ? 'idle' : 'review');
      setModeState(next);
      chosenModes.set(draftKey, next);
      if (next === 'keyboard') requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [draftKey, setPartial, setPhase, setStartHint],
  );

  // Paused (menu / backlog / error dialog): stop recording — what was heard becomes an editable
  // draft, never auto-submitted — and give up on a mic that is still starting.
  useEffect(() => {
    if (!paused) return;
    const p = phaseRef.current;
    if (p === 'listening') void stopListening({ autoSubmit: false, byPause: true });
    else if (p === 'starting') cancelStart();
  }, [paused, stopListening, cancelStart]);

  // Back from a pause while typing: the answer box gets the focus again (unless something else has it).
  const wasPausedRef = useRef(paused);
  useEffect(() => {
    const was = wasPausedRef.current;
    wasPausedRef.current = paused;
    if (!was || paused || mode !== 'keyboard' || submittedRef.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) textareaRef.current?.focus({ preventScroll: true });
  }, [paused, mode]);

  // Quick-menu Skip → inline confirmation.
  const skipRequest = props.skipRequest ?? 0;
  const skipSeenRef = useRef(skipRequest);
  useEffect(() => {
    if (skipRequest === skipSeenRef.current) return;
    skipSeenRef.current = skipRequest;
    if (!submittedRef.current && !reverse) setConfirmSkip(true);
  }, [skipRequest, reverse]);

  // Time limit reached (never acted on while paused).
  const timeUpHandled = useRef(false);
  useEffect(() => {
    if (!timeUp || paused || timeUpHandled.current) return;
    timeUpHandled.current = true;
    const p = phaseRef.current;
    if (p === 'listening') void stopListening({ submit: true });
    else if (p === 'transcribing') submitAfterStopRef.current = true;
    else if (p !== 'starting' && mode === 'voice' && keptRef.current && propsRef.current.onRetryTranscription) {
      // The spoken answer only failed to transcribe: keep it; a successful retry submits it.
      submitAfterRetryRef.current = true;
    } else {
      if (p === 'starting') tokenRef.current++;
      submitOrPass(textRef.current, mode === 'keyboard' ? 'text' : 'voice');
    }
  }, [timeUp, paused, mode, stopListening, submitOrPass]);

  // Hotkeys: M toggles the mic, Ctrl/Cmd+Enter submits.
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        trySubmit();
        return;
      }
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        if (mode !== 'voice') return;
        e.preventDefault();
        toggleMic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeysEnabled, mode, toggleMic, trySubmit]);

  // Ctrl/Cmd+Enter inside the textarea (the window-level shortcuts ignore typing targets, and
  // Esc still reaches the screen so the pause menu opens while typing).
  const onTextareaKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      trySubmit();
    }
  };

  const showTextarea = mode === 'keyboard' || phase === 'review' || (phase === 'error' && !!text);
  const canSubmit = !submitted && showTextarea && text.trim().length > 0;
  const recSeconds = phase === 'listening' && recStart ? (now - recStart) / 1000 : 0;
  const appending = text.trim().length > 0;
  const canRetry = mode === 'voice' && !!kept && !!props.onRetryTranscription && !micBusy && !submitted;
  const tabVars = { ...settingsLabelVars(t), relay: t('settings.stt.proxy') };

  let errorText = '';
  if (error) {
    const copy = sttErrorCopy(error, stt.kind);
    errorText = t(copy.key, { ...tabVars, ...copy.vars });
  }

  let status: string;
  if (mode === 'keyboard') status = fellBack ? t('interview.answer.fallbackHint', tabVars) : t('interview.answer.keyboardHint');
  else if (phase === 'idle') status = t('interview.answer.idleHint');
  else if (phase === 'starting')
    status = startHint === 'permission' ? t('interview.answer.permissionPrompt') : startHint === 'slow' ? t('interview.answer.startSlow') : t('interview.answer.starting');
  else if (phase === 'listening') {
    const time = formatClock(recSeconds);
    if (stt.kind === 'api') status = t(appending ? 'interview.answer.recordingAppend' : 'interview.answer.recording', { time });
    else status = t(appending ? 'interview.answer.listeningAppend' : 'interview.answer.listening');
  } else if (phase === 'transcribing') status = t('interview.answer.transcribing');
  else if (phase === 'review') status = error ? errorText : stoppedByPause ? t('interview.answer.pausedHint') : t('interview.answer.reviewHint');
  else status = error ? errorText : t('interview.stt.api');

  const statusIsError = !!error && (phase === 'error' || phase === 'review');
  const statusWraps = statusIsError || startHint !== null || stoppedByPause;
  const micLabel =
    phase === 'listening'
      ? t('interview.answer.micStop')
      : phase === 'starting'
        ? startHint
          ? t('interview.answer.micCancel')
          : t('interview.answer.micStop')
        : appending && mode === 'voice'
          ? t('interview.answer.micAppend')
          : t('interview.answer.micStart');

  // The live area: the answer so far (when adding to it) + the new take, or why the take failed.
  const showFailure = phase === 'error' && !!error && !text;
  const failureDetail = error && DETAILED_CODES.includes(error.code) && error.message ? error.message : '';
  const livePlaceholder = listening ? (stt.kind === 'api' ? t('interview.answer.apiLive') : t('interview.answer.speakNow')) : phase === 'transcribing' ? '' : t('interview.answer.liveEmpty');
  const addingTo = appending && (listening || phase === 'transcribing');
  const liveEmpty = !partial && !addingTo && !(showFailure && (kept || failureDetail));

  return (
    <div className={`ans ans--${mode} ans--${phase}`} data-testid="answer-panel" data-mode={mode} data-phase={phase} data-start-hint={startHint ?? undefined} onClick={(e) => e.stopPropagation()}>
      <div className="ans__left">
        {mode === 'voice' ? (
          <>
            <button
              type="button"
              ref={micRef}
              className={`ans__mic${listening ? ' is-live' : ''}`}
              onClick={toggleMic}
              onMouseDown={(e) => e.preventDefault()}
              disabled={submitted || paused || (phase === 'starting' && !startHint) || phase === 'transcribing'}
              aria-pressed={listening}
              aria-label={micLabel}
              data-testid="mic-button"
            >
              <span className="ans__ring" aria-hidden="true" />
              <span className="ans__ring ans__ring--2" aria-hidden="true" />
              {phase === 'listening' ? (
                <svg viewBox="0 0 24 24" className="ans__mic-icon" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2.5" />
                </svg>
              ) : phase === 'transcribing' || phase === 'starting' ? (
                <span className="ans__spinner" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" className="ans__mic-icon" aria-hidden="true">
                  <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <span className="ans__mic-label">
              {micLabel} <kbd>M</kbd>
            </span>
          </>
        ) : (
          <div className="ans__kbd" aria-hidden="true">
            <svg viewBox="0 0 32 24">
              <rect x="1.5" y="1.5" width="29" height="21" rx="4" />
              <path d="M6 7h2M11 7h2M16 7h2M21 7h2M26 7h0M6 12h2M11 12h2M16 12h2M21 12h5M9 17h14" />
            </svg>
          </div>
        )}
      </div>

      <div className="ans__center">
        <div className={`ans__status${statusIsError ? ' is-error' : ''}${statusWraps ? ' is-wrap' : ''}`}>
          {phase === 'listening' && <span className="ans__rec-dot" aria-hidden="true" />}
          <span className="ans__status-text" role="status" title={failureDetail ? `${status}\n${failureDetail}` : status}>
            {status}
          </span>
          {canRetry && (
            <button type="button" className="ans__status-btn" onClick={() => void retryTranscription()} data-testid="answer-retry-transcription">
              {t('interview.answer.retryTranscription')}
            </button>
          )}
          {mode === 'voice' && <LevelMeter levelRef={levelRef} active={phase === 'listening'} className="ans__meter" mirrorRef={micRef} />}
        </div>
        {showTextarea ? (
          <textarea
            ref={textareaRef}
            className="ans__textarea gg-scroll"
            value={text}
            onChange={(e) => {
              markAnswerStart();
              setText(e.target.value);
            }}
            onKeyDown={onTextareaKey}
            placeholder={t('interview.answer.placeholder')}
            aria-label={t('interview.answer.textareaAria')}
            disabled={submitted}
            autoFocus={mode === 'keyboard'}
            data-testid="answer-textarea"
            maxLength={4000}
          />
        ) : (
          <div ref={liveRef} className={`ans__live gg-scroll${liveEmpty ? ' is-empty' : ''}`} data-testid="answer-live">
            {showFailure && (kept || failureDetail) ? (
              <span className="ans__failure">
                {kept && <span className="ans__failure-kept">{t('interview.answer.keptRecording')}</span>}
                {failureDetail && <span className="ans__failure-detail">{t('interview.answer.details', { msg: failureDetail })}</span>}
              </span>
            ) : (
              <>
                {addingTo && (
                  <>
                    <span className="ans__live-prev">{text.trim()}</span>
                    <span className="ans__live-sep" aria-hidden="true">
                      {t('interview.answer.appendMark')}
                    </span>
                  </>
                )}
                {partial || livePlaceholder}
              </>
            )}
          </div>
        )}
      </div>

      <div className="ans__right">
        <Button variant="primary" className="ans__submit" disabled={!canSubmit} onClick={trySubmit} data-testid="answer-submit">
          {t('interview.answer.submit')} ▶
        </Button>
        <span className="ans__submit-key">Ctrl + Enter</span>
        {mode === 'voice' && (phase === 'review' || phase === 'error') && (
          <Button size="sm" onClick={rerecord} disabled={submitted} data-testid="answer-rerecord">
            {t('interview.answer.rerecord')}
          </Button>
        )}
        {confirmSkip ? (
          <div className="ans__confirm" role="alert">
            <span>{t('interview.answer.skipConfirm')}</span>
            <button type="button" className="ans__link ans__link--danger" onClick={() => submitOrPass('', 'text')} data-testid="answer-skip-yes">
              {t('interview.answer.skipYes')}
            </button>
            <button type="button" className="ans__link" onClick={() => setConfirmSkip(false)}>
              {t('interview.answer.skipNo')}
            </button>
          </div>
        ) : (
          <div className="ans__links">
            <button type="button" className="ans__link" onClick={() => propsRef.current.onRepeatQuestion()} disabled={micBusy} data-testid="answer-repeat">
              {t('interview.answer.repeat')}
            </button>
            {reverse ? (
              <button
                type="button"
                className="ans__link ans__link--accent"
                disabled={submitted}
                onClick={() => {
                  submittedRef.current = true;
                  setSubmitted(true);
                  forgetQuestion(draftKey);
                  propsRef.current.onEndReverse();
                }}
                data-testid="answer-end-reverse"
              >
                {t('interview.answer.noMore')}
              </button>
            ) : (
              <button type="button" className="ans__link" disabled={submitted} onClick={() => setConfirmSkip(true)} data-testid="answer-skip">
                {t('interview.answer.skip')}
              </button>
            )}
            {mode === 'voice' ? (
              <button type="button" className="ans__link" onClick={() => switchMode('keyboard')} disabled={submitted} data-testid="answer-use-keyboard">
                {t('interview.answer.useKeyboard')}
              </button>
            ) : (
              voiceCapable && (
                <button type="button" className="ans__link" onClick={() => switchMode('voice')} disabled={submitted} data-testid="answer-use-voice">
                  {t('interview.answer.useVoice')}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
