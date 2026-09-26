import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSfx } from '../../audio';
import type { TranscriptEntry } from '../../types';
import { joinPages, paginateTurn, type DialoguePage } from './pagination';
import type { InterviewerVoice } from './useInterviewerVoice';
import { useTypewriter, type TypewriterState } from './useTypewriter';

/** Pause on the fully typed question before the answer panel takes over (ms). */
export const QUESTION_BEAT_MS = 450;

export interface LinePlayerOptions {
  /** Interviewer entry being presented (stage 'interviewer'); null otherwise. */
  entry: TranscriptEntry | null;
  /** stage.kind === 'interviewer'. */
  active: boolean;
  /**
   * Hold typing, voice and the question hand-over: a chapter card is on screen, or the game is
   * paused (pause menu, backlog, error dialog). The page's voice stops and starts again on resume
   * (unless it had already finished).
   */
  blocked: boolean;
  auto: boolean;
  /** Menus / backlog open: no auto-advance. */
  holdAuto: boolean;
  textSpeed: number;
  autoDelayMs: number;
  reduceMotion: boolean;
  voice: Pick<InterviewerVoice, 'speak' | 'prefetch' | 'stop'>;
  /** All pages presented → interviewerDone(). Called once per entry. */
  onFinished: () => void;
}

export interface LinePlayer {
  pages: DialoguePage[];
  pageIndex: number;
  page: DialoguePage | null;
  typer: TypewriterState;
  /** Presenting and not blocked. */
  running: boolean;
  /** The page is complete and waits for a click (▼). */
  waiting: boolean;
  /** Click / Space / Enter: complete the page, else next page (or finish). */
  advance: () => void;
  /** Quick-menu Skip: stop talking and go straight to the answer. */
  skip: () => void;
  /** Re-speak the current page. */
  replay: () => void;
  /** Interviewer text revealed so far on this entry (for the backlog). */
  revealed: string;
}

export function pagesForEntry(entry: TranscriptEntry | null): DialoguePage[] {
  if (!entry) return [];
  const turn = entry.turn;
  let pages = turn ? paginateTurn(turn) : [];
  if (pages.length === 0) pages = paginateTurn({ reaction: '', question: entry.text });
  // A goodbye never hands over to the answer panel, whatever field the AI used.
  if (turn?.kind === 'closing') pages = pages.map((p) => ({ ...p, isQuestion: false }));
  return pages;
}

/** Drives the interviewer stage: pages → typewriter + voice → auto/click advance → interviewerDone(). */
export function useLinePlayer(o: LinePlayerOptions): LinePlayer {
  const { entry, active, blocked, auto, holdAuto, textSpeed, autoDelayMs, reduceMotion } = o;
  const { speak, prefetch, stop } = o.voice;
  const pages = useMemo(() => pagesForEntry(entry), [entry]);
  const entryId = entry?.id ?? null;

  const [cursor, setCursor] = useState<{ entryId: string | null; index: number }>({ entryId, index: 0 });
  const pageIndex = cursor.entryId === entryId ? Math.min(cursor.index, Math.max(0, pages.length - 1)) : 0;
  const page = pages[pageIndex] ?? null;
  const running = active && !blocked && page !== null;
  const pageKey = `${entryId ?? ''}#${pageIndex}`;

  const typer = useTypewriter(page?.text ?? '', {
    cps: textSpeed,
    paused: !running,
    instant: reduceMotion,
    onBlip: () => playSfx('blip'),
  });

  const onFinishedRef = useRef(o.onFinished);
  onFinishedRef.current = o.onFinished;
  const finishedRef = useRef<string | null>(null);
  const finish = useCallback(() => {
    if (!entryId || finishedRef.current === entryId) return;
    finishedRef.current = entryId;
    onFinishedRef.current();
  }, [entryId]);

  useEffect(() => {
    if (!active) finishedRef.current = null;
  }, [active]);

  // Nothing to present (empty entry): hand over immediately.
  useEffect(() => {
    if (active && !blocked && entryId && pages.length === 0) finish();
  }, [active, blocked, entryId, pages.length, finish]);

  // Voice: speak each page as it starts; prefetch the next one.
  const [voiceDoneKey, setVoiceDoneKey] = useState<string | null>(null);
  const voiceDoneKeyRef = useRef<string | null>(null);
  const speakTokenRef = useRef(0);
  const speakPage = useCallback(
    (text: string, key: string) => {
      const token = ++speakTokenRef.current;
      void speak(text).then(() => {
        if (speakTokenRef.current !== token) return;
        voiceDoneKeyRef.current = key;
        setVoiceDoneKey(key);
      });
    },
    [speak],
  );

  // Keyed on primitives so a store update that re-creates the entry object never restarts the line.
  const pageText = page?.text ?? '';
  const nextText = pages[pageIndex + 1]?.text ?? '';
  const isQuestion = page?.isQuestion ?? false;
  useEffect(() => {
    if (!running || !pageText) return;
    // Back from a pause after this page was fully voiced: don't say it again.
    if (voiceDoneKeyRef.current === pageKey) return;
    speakPage(pageText, pageKey);
    if (nextText) prefetch(nextText);
  }, [running, pageText, pageKey, nextText, speakPage, prefetch]);

  // A chapter card or a pause mid-line silences the voice (it restarts when the scene resumes).
  useEffect(() => {
    if (active && blocked) {
      speakTokenRef.current++;
      stop();
    }
  }, [active, blocked, stop]);

  // Question fully typed → short beat → answer stage (the voice keeps going).
  useEffect(() => {
    if (!running || !isQuestion || !typer.done) return;
    const id = setTimeout(finish, reduceMotion ? 120 : QUESTION_BEAT_MS);
    return () => clearTimeout(id);
  }, [running, isQuestion, typer.done, finish, reduceMotion]);

  const advance = useCallback(() => {
    if (!running || !page) return;
    if (!typer.done) {
      typer.complete();
      return;
    }
    if (page.isQuestion) {
      finish();
      return;
    }
    speakTokenRef.current++;
    stop();
    if (pageIndex < pages.length - 1) {
      playSfx('page');
      setCursor({ entryId, index: pageIndex + 1 });
    } else finish();
  }, [running, page, typer, finish, stop, pageIndex, pages.length, entryId]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Auto mode: after the voice ends (and the page is typed) + autoDelayMs.
  const voiceDone = voiceDoneKey === pageKey;
  useEffect(() => {
    if (!auto || holdAuto || !running || isQuestion || !typer.done || !voiceDone) return;
    const id = setTimeout(() => advanceRef.current(), Math.max(0, autoDelayMs));
    return () => clearTimeout(id);
  }, [auto, holdAuto, running, isQuestion, typer.done, voiceDone, autoDelayMs]);

  const skip = useCallback(() => {
    if (!active || !entryId) return;
    speakTokenRef.current++;
    stop();
    typer.complete();
    finish();
  }, [active, entryId, stop, typer, finish]);

  const replay = useCallback(() => {
    if (pageText) speakPage(pageText, pageKey);
  }, [pageText, pageKey, speakPage]);

  const revealed = active ? joinPages(pages.slice(0, pageIndex + 1).map((p) => p.text)) : (entry?.text ?? '');

  return {
    pages,
    pageIndex,
    page,
    typer,
    running,
    waiting: running && typer.done && !!page && !page.isQuestion,
    advance,
    skip,
    replay,
    revealed,
  };
}
