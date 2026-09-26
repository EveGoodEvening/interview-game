import { describe, expect, it } from 'vitest';
import { bassNote, chordLadder, midiToFreq, noteToMidi, parseChord, parseMelody, parseProgression, voiceChord } from './theory';

describe('notes', () => {
  it('converts names to MIDI and frequency', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('C-1')).toBe(0);
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 3);
    expect(() => noteToMidi('H2')).toThrow();
  });
});

describe('chords', () => {
  it('parses qualities and slash chords', () => {
    expect(parseChord('Fmaj7')).toMatchObject({ root: 5, intervals: [0, 4, 7, 11], bass: 5 });
    expect(parseChord('F#m7b5')).toMatchObject({ root: 6, intervals: [0, 3, 6, 10] });
    expect(parseChord('Am/G')).toMatchObject({ root: 9, bass: 7 });
    expect(parseChord('D7sus4').intervals).toEqual([0, 5, 7, 10]);
    expect(() => parseChord('Cfoo')).toThrow(/quality/);
  });

  it('parses progressions with several chords per bar', () => {
    const bars = parseProgression('C | Em7 A7 |  G ');
    expect(bars.map((b) => b.map((c) => c.symbol))).toEqual([['C'], ['Em7', 'A7'], ['G']]);
  });

  it('voices chords near the centre with smooth voice leading', () => {
    const c = voiceChord(parseChord('C'), 64);
    expect(c.map((n) => n % 12).sort((a, b) => a - b)).toEqual([0, 4, 7]);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThan(12);
    const f = voiceChord(parseChord('F'), 64, c);
    // C major → F major keeps the common tone C and moves the others by a step.
    const movement = f.reduce((s, n, i) => s + Math.abs(n - c[i]), 0);
    expect(movement).toBeLessThanOrEqual(3);
  });

  it('builds arpeggio ladders and bass notes', () => {
    expect(chordLadder(parseChord('C'), 60, 5)).toEqual([60, 64, 67, 72, 76]);
    expect(chordLadder(parseChord('Am'), 60, 3)).toEqual([60, 64, 69]);
    expect(bassNote(parseChord('Am/G'), 36)).toBe(43);
    expect(bassNote(parseChord('D'), 36)).toBe(38);
  });
});

describe('parseMelody', () => {
  it('reads notes and rests with beat positions', () => {
    const [bar] = parseMelody('E5:1.5 r:0.5 G5:2', 4);
    expect(bar).toEqual([
      { beat: 0, beats: 1.5, midi: 76 },
      { beat: 1.5, beats: 0.5, midi: null },
      { beat: 2, beats: 2, midi: 79 },
    ]);
  });

  it('rejects bars with the wrong length and bad tokens', () => {
    expect(() => parseMelody('C5:1 D5:1', 4)).toThrow(/2 beats/);
    expect(() => parseMelody('C5-1', 4)).toThrow(/token/);
  });
});
