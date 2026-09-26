/**
 * Minimal music theory for the procedural BGM: note names, chord symbols, voicings, melodies.
 * Pure functions (unit-tested).
 */

const NOTE_INDEX: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Semitone intervals above the root for each supported chord quality. */
const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
};

export interface Chord {
  symbol: string;
  /** Pitch class of the root, 0 = C. */
  root: number;
  intervals: readonly number[];
  /** Pitch class of the bass note (slash chords), defaults to the root. */
  bass: number;
}

function pitchClass(letter: string, accidental: string): number {
  const base = NOTE_INDEX[letter.toUpperCase()];
  if (base === undefined) throw new Error(`bad note letter: ${letter}`);
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (base + shift + 12) % 12;
}

/** "C4" → 60, "F#5" → 78, "Bb3" → 58. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note name: ${name}`);
  return pitchClass(m[1], m[2]) + (Number(m[3]) + 1) * 12;
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** "Fmaj7", "F#m7b5", "Am/G", "D7sus4". */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(symbol.trim());
  if (!m) throw new Error(`bad chord symbol: ${symbol}`);
  const intervals = QUALITIES[m[3]];
  if (!intervals) throw new Error(`unknown chord quality "${m[3]}" in ${symbol}`);
  const root = pitchClass(m[1], m[2]);
  return { symbol, root, intervals, bass: m[4] ? pitchClass(m[4], m[5]) : root };
}

/** Parse "Gmaj7 | A6 | Em7 A7 | ..." — bars separated by "|", optionally several chords per bar. */
export function parseProgression(text: string): Chord[][] {
  return text
    .split('|')
    .map((bar) => bar.trim())
    .filter(Boolean)
    .map((bar) => bar.split(/\s+/).map(parseChord));
}

function pitchClasses(chord: Chord): number[] {
  return [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];
}

/** Lowest MIDI note ≥ `from` with the given pitch class. */
export function nextWithPitchClass(pc: number, from: number): number {
  return from + ((pc - (from % 12) + 12) % 12);
}

/**
 * Close voicing of the chord near `center`, choosing the inversion that moves least from the
 * previous voicing (smooth voice leading) or, without one, that sits closest to `center`.
 */
export function voiceChord(chord: Chord, center: number, previous?: readonly number[]): number[] {
  const pcs = pitchClasses(chord);
  let best: number[] = [];
  let bestScore = Infinity;
  for (let low = center - 7; low <= center + 4; low++) {
    const notes = pcs.map((pc) => nextWithPitchClass(pc, low)).sort((a, b) => a - b);
    const mean = notes.reduce((s, n) => s + n, 0) / notes.length;
    let score = Math.abs(mean - center) * 0.5;
    if (previous && previous.length) {
      const prev = [...previous].sort((a, b) => a - b);
      score += notes.reduce((s, n, i) => s + Math.abs(n - prev[Math.min(i, prev.length - 1)]), 0);
    }
    if (score < bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}

/** Chord tones ascending from the first chord tone ≥ `base`, `count` notes long (for arpeggios). */
export function chordLadder(chord: Chord, base: number, count = 12): number[] {
  const pcs = pitchClasses(chord);
  const out: number[] = [];
  for (let midi = base; out.length < count && midi < base + 60; midi++) {
    if (pcs.includes(midi % 12)) out.push(midi);
  }
  return out;
}

/** Bass note for the chord at or above `base` (respects slash chords). */
export function bassNote(chord: Chord, base: number): number {
  return nextWithPitchClass(chord.bass, base);
}

export interface MelodyNote {
  /** Beat offset inside the bar. */
  beat: number;
  beats: number;
  /** null = rest */
  midi: number | null;
}

/**
 * Parse melody notation: bars separated by "|", tokens "F#5:1.5" (note:beats) or "r:2" (rest).
 * Throws when a bar does not add up to `beatsPerBar`.
 */
export function parseMelody(text: string, beatsPerBar: number): MelodyNote[][] {
  return text
    .split('|')
    .map((bar) => bar.trim())
    .filter(Boolean)
    .map((bar, index) => {
      let beat = 0;
      const notes = bar.split(/\s+/).map((token) => {
        const m = /^([^:]+):(\d+(?:\.\d+)?)$/.exec(token);
        if (!m) throw new Error(`bad melody token "${token}" in bar ${index + 1}`);
        const beats = Number(m[2]);
        const note: MelodyNote = { beat, beats, midi: m[1] === 'r' ? null : noteToMidi(m[1]) };
        beat += beats;
        return note;
      });
      if (Math.abs(beat - beatsPerBar) > 1e-6) {
        throw new Error(`melody bar ${index + 1} has ${beat} beats, expected ${beatsPerBar}`);
      }
      return notes;
    });
}
