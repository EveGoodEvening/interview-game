/**
 * Per-question answer clocks (the HUD timer and the answer time limit).
 *
 * - A clock lives outside the interview scene (module-level, keyed by session + question), so a trip
 *   to Config — which unmounts the scene — neither resets nor skips the countdown.
 * - It pauses while the game is paused (pause menu, backlog, error dialog, Config) and resumes from
 *   the remaining time: paused time is added to `startedAt`, so `elapsed = now - startedAt` never
 *   counts it (that also keeps the recorded answer duration honest).
 * - It starts when the interviewer has finished voicing the question, or when the candidate starts
 *   answering (mic / first keystroke), whichever comes first; a safety cap starts it anyway if the
 *   voice never reports its end.
 *
 * The pure helpers are exported for tests; the scene uses {@link useAnswerClock}.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

export interface AnswerClock {
  /** When the answer stage was shown (ms epoch, shifted by paused time) — for the start cap. */
  shownAt: number;
  /** Countdown start (ms epoch, shifted by paused time); null while the question is still being voiced. */
  startedAt: number | null;
  /** Paused since (ms epoch); null while running. */
  pausedAt: number | null;
}

/** Start the clock at the latest this long after the answer stage appeared (voice never ended). */
export const CLOCK_START_CAP_MS = 15_000;

const clocks = new Map<string, AnswerClock>();
const SEP = '\u0000';

export function answerClockKey(sessionId: string, answerKey: string): string {
  return `${sessionId}${SEP}${answerKey}`;
}

export function peekClock(key: string): AnswerClock | null {
  return clocks.get(key) ?? null;
}

/** The clock for `key`, created (not started, not paused) on first sight. Clocks of other sessions are dropped. */
export function ensureClock(key: string, now: number): AnswerClock {
  const existing = clocks.get(key);
  if (existing) return existing;
  const session = key.split(SEP)[0];
  for (const k of [...clocks.keys()]) if (k.split(SEP)[0] !== session) clocks.delete(k);
  const clock: AnswerClock = { shownAt: now, startedAt: null, pausedAt: null };
  clocks.set(key, clock);
  return clock;
}

/** Start the countdown (no-op once started). While paused it starts with zero elapsed time. */
export function startClock(key: string, now: number): boolean {
  const c = ensureClock(key, now);
  if (c.startedAt !== null) return false;
  clocks.set(key, { ...c, startedAt: c.pausedAt ?? now });
  return true;
}

export function pauseClock(key: string, now: number): boolean {
  const c = clocks.get(key);
  if (!c || c.pausedAt !== null) return false;
  clocks.set(key, { ...c, pausedAt: now });
  return true;
}

export function resumeClock(key: string, now: number): boolean {
  const c = clocks.get(key);
  if (!c || c.pausedAt === null) return false;
  const pausedFor = Math.max(0, now - c.pausedAt);
  clocks.set(key, {
    shownAt: c.shownAt + pausedFor,
    startedAt: c.startedAt === null ? null : c.startedAt + pausedFor,
    pausedAt: null,
  });
  return true;
}

export function dropClock(key: string): void {
  clocks.delete(key);
}

/** For tests. */
export function resetAnswerClocks(): void {
  clocks.clear();
}

/** Answer time so far (ms), paused time excluded; 0 before the clock started. */
export function clockElapsedMs(c: AnswerClock, now: number): number {
  if (c.startedAt === null) return 0;
  return Math.max(0, (c.pausedAt ?? now) - c.startedAt);
}

/** Time left with a limit (ms); the full limit before the clock started. */
export function clockRemainingMs(c: AnswerClock, limitSec: number, now: number): number {
  return Math.max(0, limitSec * 1000 - clockElapsedMs(c, now));
}

export interface AnswerClockOptions {
  /** Pause menu / backlog / error dialog open. */
  paused: boolean;
  /** The interviewer is still voicing the question: hold the start. */
  voiceBusy: boolean;
  /** 0 = no limit (the clock only measures). */
  limitSec: number;
  /** The limit ran out for `key` (never while paused). */
  onTimeUp: (key: string) => void;
}

export interface AnswerClockHandle {
  clock: AnswerClock | null;
  /** The candidate started answering: start the clock now if it is still waiting for the voice. */
  start: () => void;
}

/**
 * Drives the clock of the current question (`key` = {@link answerClockKey}, null outside the
 * answer stage). A clock whose question was answered is dropped; unmounting the scene (Config)
 * pauses it, and the next mount resumes it.
 */
export function useAnswerClock(key: string | null, { paused, voiceBusy, limitSec, onTimeUp }: AnswerClockOptions): AnswerClockHandle {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  // Question answered (key changed while mounted): forget its clock. Unmount: pause it.
  const keyRef = useRef(key);
  useEffect(() => {
    const prev = keyRef.current;
    keyRef.current = key;
    if (prev && prev !== key) dropClock(prev);
  }, [key]);
  useEffect(
    () => () => {
      if (keyRef.current) pauseClock(keyRef.current, Date.now());
    },
    [],
  );

  // Pause / resume with the game.
  useEffect(() => {
    if (!key) return;
    const now = Date.now();
    ensureClock(key, now);
    if (paused ? pauseClock(key, now) : resumeClock(key, now)) bump();
  }, [key, paused]);

  // Start once the question's voice is over (or after the cap).
  useEffect(() => {
    if (!key || paused) return;
    const c = peekClock(key);
    if (!c || c.startedAt !== null || c.pausedAt !== null) return;
    if (!voiceBusy) {
      if (startClock(key, Date.now())) bump();
      return;
    }
    const id = setTimeout(
      () => {
        if (startClock(key, Date.now())) bump();
      },
      Math.max(0, c.shownAt + CLOCK_START_CAP_MS - Date.now()),
    );
    return () => clearTimeout(id);
  }, [key, paused, voiceBusy, version]);

  // Time limit: armed only while running, with the remaining time.
  useEffect(() => {
    if (!key || paused || limitSec <= 0) return;
    const c = peekClock(key);
    if (!c || c.startedAt === null || c.pausedAt !== null) return;
    const id = setTimeout(() => onTimeUpRef.current(key), clockRemainingMs(c, limitSec, Date.now()));
    return () => clearTimeout(id);
  }, [key, paused, limitSec, version]);

  const start = useCallback(() => {
    if (key && startClock(key, Date.now())) bump();
  }, [key]);

  return { clock: key ? (peekClock(key) ?? ensureClock(key, Date.now())) : null, start };
}
