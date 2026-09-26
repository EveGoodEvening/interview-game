import { useCallback, useEffect, useRef, useState } from 'react';
import { playSfx } from '../../audio';
import { translate } from '../../i18n';
import type { GameEvent } from '../../store/game';
import type { Lang } from '../../types';
import { toast } from '../ui/Toast';
import { CHAPTER_CARD_MS } from './ChapterCard';
import type { AffinityFloat } from './Hud';
import { markEventSeen, unseenEvents } from './seenEvents';

type ChapterEvent = Extract<GameEvent, { type: 'chapter' }>;

/**
 * Queue of chapter title cards. `blocking` is true from the very render in which an unseen
 * chapter event appears (so the next line never starts typing a frame early) until its card ends.
 * `scope` is the session id (see seenEvents).
 */
export function useChapterCards(
  events: readonly GameEvent[],
  scope: string,
  reduceMotion: boolean,
): { card: ChapterEvent | null; blocking: boolean; dismiss: () => void } {
  const [card, setCard] = useState<ChapterEvent | null>(null);
  const announcedRef = useRef<number | null>(null);
  const pending = card ? null : (unseenEvents(events, 'chapter', scope)[0] ?? null);

  useEffect(() => {
    if (card || !pending || announcedRef.current === pending.id) return;
    announcedRef.current = pending.id;
    markEventSeen(pending, scope);
    setCard(pending);
    playSfx('chapter');
  }, [card, pending, scope]);

  useEffect(() => {
    if (!card) return;
    const id = setTimeout(() => setCard(null), reduceMotion ? 900 : CHAPTER_CARD_MS);
    return () => clearTimeout(id);
  }, [card, reduceMotion]);

  const dismiss = useCallback(() => setCard(null), []);
  return { card, blocking: card !== null || pending !== null, dismiss };
}

const FLOAT_MS = 1700;

interface TimedFloat extends AffinityFloat {
  born: number;
}

/** Floating "♥ +N" markers for unseen affinity events of the session `scope` (with SFX). */
export function useAffinityFloats(events: readonly GameEvent[], scope: string): AffinityFloat[] {
  const [floats, setFloats] = useState<TimedFloat[]>([]);
  const keyRef = useRef(0);

  useEffect(() => {
    const fresh = unseenEvents(events, 'affinity', scope);
    if (fresh.length === 0) return;
    const born = Date.now();
    const added: TimedFloat[] = [];
    for (const ev of fresh) {
      markEventSeen(ev, scope);
      if (ev.delta) added.push({ key: ++keyRef.current, delta: Math.round(ev.delta), born });
    }
    if (added.length === 0) return;
    playSfx(added.reduce((sum, f) => sum + f.delta, 0) >= 0 ? 'affinityUp' : 'affinityDown');
    setFloats((prev) => [...prev, ...added]);
  }, [events, scope]);

  // Prune finished floats (a single timer keyed on the list — StrictMode-safe).
  useEffect(() => {
    if (floats.length === 0) return;
    const oldest = Math.min(...floats.map((f) => f.born));
    const id = setTimeout(
      () => {
        const cutoff = Date.now() - FLOAT_MS;
        setFloats((prev) => prev.filter((f) => f.born > cutoff));
      },
      Math.max(0, oldest + FLOAT_MS - Date.now()) + 20,
    );
    return () => clearTimeout(id);
  }, [floats]);

  return floats;
}

/** How long the "progress not saved" notice stays up (ms). */
export const STORAGE_WARNING_MS = 9000;

/**
 * Show a notice for unseen `storage_warning` events of the session `scope` (an autosave write
 * failed: the progress lives only in this tab). The store emits one per failure streak; several
 * unseen ones still make a single toast. Returns whether a toast was shown.
 */
export function showStorageWarnings(events: readonly GameEvent[], scope: string, uiLang: Lang): boolean {
  const fresh = unseenEvents(events, 'storage_warning', scope);
  if (fresh.length === 0) return false;
  for (const ev of fresh) markEventSeen(ev, scope);
  toast(translate(uiLang, 'interview.storage.body'), {
    kind: 'warning',
    title: translate(uiLang, 'interview.storage.title'),
    durationMs: STORAGE_WARNING_MS,
    sfx: 'notify',
  });
  return true;
}

/** Keep showing storage warnings while the interview scene is mounted. */
export function useStorageWarnings(events: readonly GameEvent[], scope: string, uiLang: Lang): void {
  useEffect(() => {
    showStorageWarnings(events, scope, uiLang);
  }, [events, scope, uiLang]);
}
