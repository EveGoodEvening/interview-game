import { beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '../../store/game';
import { isEventSeen, markEventSeen, resetSeenEvents, unseenEvents } from './seenEvents';

const chapter = (id: number): GameEvent => ({ id, type: 'chapter', phase: 'questioning', topicIndex: 0, topicTitle: 'T' });
const affinity = (id: number): GameEvent => ({ id, type: 'affinity', delta: 3, value: 53 });

describe('seenEvents (id high-water mark per scope + type)', () => {
  beforeEach(() => resetSeenEvents());

  it('shows each event once, even when the store hands back new objects with the same ids', () => {
    const events = [chapter(1), affinity(2), chapter(3)];
    expect(unseenEvents(events, 'chapter', 's1').map((e) => e.id)).toEqual([1, 3]);
    markEventSeen(events[0], 's1');
    // A remount (or a store that rebuilt its event objects) must not replay event 1.
    const rebuilt = events.map((e) => ({ ...e }));
    expect(unseenEvents(rebuilt, 'chapter', 's1').map((e) => e.id)).toEqual([3]);
    expect(isEventSeen(rebuilt[0], 's1')).toBe(true);
  });

  it('tracks types independently, so consuming one kind never hides another', () => {
    const events = [chapter(1), affinity(2), chapter(3)];
    markEventSeen(events[2], 's1');
    expect(unseenEvents(events, 'chapter', 's1')).toEqual([]);
    expect(unseenEvents(events, 'affinity', 's1').map((e) => e.id)).toEqual([2]);
  });

  it('never loses events added while the consumer was away', () => {
    const before = [chapter(1)];
    markEventSeen(before[0], 's1');
    const after = [...before, affinity(2), chapter(3)];
    expect(unseenEvents(after, 'chapter', 's1').map((e) => e.id)).toEqual([3]);
    expect(unseenEvents(after, 'affinity', 's1').map((e) => e.id)).toEqual([2]);
  });

  it('scopes marks per session / record', () => {
    markEventSeen(chapter(5), 'old-session');
    // A new session whose events restart at low ids still shows them.
    expect(unseenEvents([chapter(1)], 'chapter', 'new-session')).toHaveLength(1);
  });

  it('marking an older event never lowers the mark', () => {
    markEventSeen(chapter(4), 's1');
    markEventSeen(chapter(2), 's1');
    expect(isEventSeen(chapter(3), 's1')).toBe(true);
    expect(isEventSeen(chapter(5), 's1')).toBe(false);
  });
});
