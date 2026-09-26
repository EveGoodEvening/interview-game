/**
 * Remembers which one-shot game events (chapter cards, affinity floats, ending toasts) the UI has
 * already shown, so each shows exactly once — also across screen remounts (e.g. Interview →
 * Settings → Interview) — and none is lost (events added while the screen was unmounted are
 * still unseen when it mounts again).
 *
 * Store contract (src/store/game.ts): event ids increase monotonically for the app's lifetime and
 * the event list is cleared when an interview starts or resumes. We keep an id high-water mark per
 * scope + event type, where the scope is the session id (interview scene) or the record id (result
 * screen). Scoping per session means that even a counter restarting for a new session could never
 * hide that session's events, and marks never depend on object identity (a store that rebuilds or
 * rehydrates its event objects cannot make them replay).
 */
import type { GameEvent } from '../../store/game';

type EventType = GameEvent['type'];

const marks = new Map<string, number>();
const markKey = (scope: string, type: EventType) => `${scope}\u0000${type}`;

function highWater(scope: string, type: EventType): number {
  return marks.get(markKey(scope, type)) ?? 0;
}

export function isEventSeen(ev: GameEvent, scope: string): boolean {
  return ev.id <= highWater(scope, ev.type);
}

/** Mark `ev` (and every older event of its type in this scope) as shown. */
export function markEventSeen(ev: GameEvent, scope: string): void {
  if (ev.id > highWater(scope, ev.type)) marks.set(markKey(scope, ev.type), ev.id);
}

/** Unseen events of one type in a scope, oldest first. */
export function unseenEvents<T extends EventType>(events: readonly GameEvent[], type: T, scope: string): Extract<GameEvent, { type: T }>[] {
  const hw = highWater(scope, type);
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type && e.id > hw);
}

/** Forget everything (tests). */
export function resetSeenEvents(): void {
  marks.clear();
}
