import { describe, expect, it } from 'vitest';
import { BGM_TRACKS } from '../types';
import { compileTrack, isLayerActive } from './compile';
import { TRACKS, type TrackDef } from './tracks';

describe('compileTrack', () => {
  it.each(BGM_TRACKS)('compiles "%s" into a sane, gentle loop', (id) => {
    const def = TRACKS[id];
    const compiled = compileTrack(def);
    expect(def.id).toBe(id);
    expect(compiled.stepsPerBar).toBe(def.beatsPerBar * def.stepsPerBeat);
    expect(compiled.loopSteps % compiled.stepsPerBar).toBe(0);
    expect(compiled.loopSteps / compiled.stepsPerBar).toBeGreaterThanOrEqual(4);
    // Loops of 15–40 s: long enough not to nag, short enough to feel like a theme.
    const seconds = compiled.loopSteps * compiled.stepDur;
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(40);
    expect(def.gain).toBeLessThanOrEqual(0.6);

    const all = compiled.events.flat();
    expect(all.length).toBeGreaterThan(20);
    for (const ev of all) {
      expect(ev.midi).toBeGreaterThanOrEqual(28);
      expect(ev.midi).toBeLessThanOrEqual(100);
      expect(ev.steps).toBeGreaterThanOrEqual(1);
      expect(ev.velocity).toBeGreaterThan(0);
      expect(ev.velocity).toBeLessThanOrEqual(1);
    }
    // Every layer contributes notes.
    def.layers.forEach((_, i) => expect(all.some((ev) => ev.layer === i), `layer ${i}`).toBe(true));
    // No drums: only pitched voices.
    expect(new Set(all.map((e) => e.voice))).not.toContain('noise');
    // Polyphony stays modest (keeps CPU low on phones).
    expect(Math.max(...compiled.events.map((list) => list.length))).toBeLessThanOrEqual(12);
  });

  it('gives each track its own character', () => {
    const tempos = BGM_TRACKS.map((id) => TRACKS[id].bpm);
    expect(TRACKS.tense.bpm).toBeLessThan(TRACKS.title.bpm);
    expect(TRACKS.ending_bad.bpm).toBeLessThan(TRACKS.ending_good.bpm);
    expect(TRACKS.interview.swing).toBeGreaterThan(0);
    expect(new Set(BGM_TRACKS.map((id) => TRACKS[id].progression)).size).toBe(BGM_TRACKS.length);
    expect(Math.min(...tempos)).toBeGreaterThanOrEqual(60);
  });

  it('splits bars with two chords evenly and sustains pads across the chord', () => {
    const def: TrackDef = {
      id: 'title',
      bpm: 60,
      beatsPerBar: 4,
      stepsPerBeat: 4,
      swing: 0,
      progression: 'C | Dm G',
      gain: 0.5,
      seed: 1,
      layers: [{ kind: 'pad', voice: 'pad', center: 'E4', velocity: 0.5 }],
    };
    const compiled = compileTrack(def);
    expect(compiled.events[0].map((e) => e.steps)).toEqual([16, 16, 16]);
    expect(compiled.events[16]).toHaveLength(3);
    expect(compiled.events[24].map((e) => e.steps)).toEqual([8, 8, 8]);
    expect(compiled.events[24].map((e) => e.midi % 12).sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });

  it('rejects malformed tracks', () => {
    const base = TRACKS.title;
    expect(() => compileTrack({ ...base, layers: [{ kind: 'bass', voice: 'bass', base: 'C2', pattern: 'R...', velocity: 1 }] })).toThrow(
      /pattern has 4 steps/,
    );
    expect(() => compileTrack({ ...base, progression: 'C D E | F' })).toThrow(/split evenly/);
    expect(() =>
      compileTrack({ ...base, layers: [{ kind: 'melody', voice: 'bell', notes: 'C5:4 | D5:4 | E5:4', velocity: 1 }] }),
    ).toThrow(/melody has 3 bars/);
  });

  it('evaluates layer schedules per loop', () => {
    expect([0, 1, 2, 3].map((i) => isLayerActive('always', i))).toEqual([true, true, true, true]);
    expect([0, 1, 2, 3].map((i) => isLayerActive('afterFirst', i))).toEqual([false, true, true, true]);
    expect([0, 1, 2, 3].map((i) => isLayerActive('even', i))).toEqual([true, false, true, false]);
    expect([0, 1, 2, 3].map((i) => isLayerActive('odd', i))).toEqual([false, true, false, true]);
  });
});
