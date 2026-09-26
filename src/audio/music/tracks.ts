/**
 * The five BGM cues, written as data: a chord progression plus layers (pad, arpeggio, bass,
 * comping, melody). No drums — the music sits under the interviewer's voice.
 */
import type { BgmTrack } from '../types';

export type VoiceName = 'epiano' | 'bell' | 'pad' | 'pluck' | 'bass' | 'flute';

/** When a layer plays, by loop index (0 = first time through). */
export type LayerWhen = 'always' | 'afterFirst' | 'even' | 'odd';

interface LayerBase {
  voice: VoiceName;
  /** 0–1 note velocity. */
  velocity: number;
  when?: LayerWhen;
  pan?: number;
  /** Low-pass cutoff for the layer bus (Hz). */
  filterHz?: number;
  /** Share sent to the reverb (0–1). */
  reverb?: number;
}

export interface PadLayer extends LayerBase {
  kind: 'pad';
  /** Voicing centre, e.g. "F#4". */
  center: string;
}

export interface ArpLayer extends LayerBase {
  kind: 'arp';
  /** Lowest note of the chord-tone ladder. */
  base: string;
  /** One entry per step of a bar: ladder index, or null for silence. */
  pattern: readonly (number | null)[];
  /** Note length in steps. */
  noteSteps: number;
}

export interface BassLayer extends LayerBase {
  kind: 'bass';
  base: string;
  /** One char per step: R/F/O = root/fifth/octave (lower-case = softer), "." = hold/rest. */
  pattern: string;
  /** Longest note in steps. */
  maxSteps?: number;
}

export interface CompLayer extends LayerBase {
  kind: 'comp';
  center: string;
  /** One char per step: "x" = strike the chord, "." = hold. */
  rhythm: string;
}

export interface MelodyLayer extends LayerBase {
  kind: 'melody';
  /** "F#5:1.5 A5:0.5 | …" (see parseMelody); repeats if shorter than the progression. */
  notes: string;
}

export type LayerDef = PadLayer | ArpLayer | BassLayer | CompLayer | MelodyLayer;

export interface TrackDef {
  id: BgmTrack;
  bpm: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  /** 0 = straight 16ths; ~0.2 = lazy lo-fi swing. */
  swing: number;
  progression: string;
  /** Track output level (before the BGM volume). */
  gain: number;
  /** Humanisation seed. */
  seed: number;
  layers: readonly LayerDef[];
}

const _ = null;

export const TRACKS: Readonly<Record<BgmTrack, TrackDef>> = {
  // Bright, gentle title theme: royal-road progression in D, e-piano arpeggio + music-box melody.
  title: {
    id: 'title',
    bpm: 88,
    beatsPerBar: 4,
    stepsPerBeat: 4,
    swing: 0,
    progression: 'Gmaj7 | A6 | F#m7 | Bm7 | Em7 | A7sus4 A7 | Dmaj7 | Dmaj7',
    gain: 0.55,
    seed: 11,
    layers: [
      { kind: 'pad', voice: 'pad', center: 'F#4', velocity: 0.42, filterHz: 1500, reverb: 0.5 },
      {
        kind: 'arp',
        voice: 'epiano',
        base: 'D4',
        pattern: [0, _, 1, _, 2, _, 3, _, 4, _, 3, _, 2, _, 1, _],
        noteSteps: 3,
        velocity: 0.42,
        pan: -0.25,
        reverb: 0.35,
      },
      {
        kind: 'arp',
        voice: 'bell',
        base: 'D6',
        pattern: [_, _, _, _, _, _, 0, _, _, _, _, _, _, _, 2, _],
        noteSteps: 2,
        velocity: 0.22,
        pan: 0.35,
        when: 'odd',
        reverb: 0.6,
      },
      { kind: 'bass', voice: 'bass', base: 'D2', pattern: 'R.......r...f...', velocity: 0.5, filterHz: 700 },
      {
        kind: 'melody',
        voice: 'bell',
        notes:
          'F#5:1.5 A5:0.5 B5:1 A5:1 | E5:1.5 F#5:0.5 A5:2 | C#6:1.5 B5:0.5 A5:1 F#5:1 | A5:1.5 F#5:0.5 D5:2 | ' +
          'G5:1 B5:1 D6:1.5 C#6:0.5 | D6:1 B5:1 A5:1 G5:1 | F#5:1.5 E5:0.5 F#5:1 A5:1 | D5:3 r:1',
        velocity: 0.68,
        pan: 0.15,
        when: 'afterFirst',
        reverb: 0.45,
      },
    ],
  },

  // Calm lo-fi under the questions: jazzy 9th chords, lazy swing, very sparse melody.
  interview: {
    id: 'interview',
    bpm: 74,
    beatsPerBar: 4,
    stepsPerBeat: 4,
    swing: 0.22,
    progression: 'Fmaj9 | Em7 A7 | Dm9 | Cm7 F7 | Bbmaj7 | Am7 | Gm7 | C7sus4',
    gain: 0.5,
    seed: 23,
    layers: [
      { kind: 'pad', voice: 'pad', center: 'A4', velocity: 0.22, filterHz: 900, reverb: 0.4 },
      { kind: 'comp', voice: 'epiano', center: 'F4', rhythm: 'x.....x.........', velocity: 0.42, pan: -0.15, filterHz: 2600, reverb: 0.3 },
      { kind: 'bass', voice: 'bass', base: 'F2', pattern: 'R.......r.....f.', velocity: 0.48, filterHz: 600 },
      {
        kind: 'arp',
        voice: 'pluck',
        base: 'F4',
        pattern: [_, _, _, _, _, _, _, _, 4, _, _, 3, _, _, 2, _],
        noteSteps: 2,
        velocity: 0.34,
        pan: 0.3,
        when: 'odd',
        reverb: 0.35,
      },
      {
        kind: 'melody',
        voice: 'bell',
        notes:
          'r:2 A5:1 C6:1 | E6:1.5 D6:0.5 r:2 | r:1 F5:1 A5:1 E6:1 | D6:2 r:2 | ' +
          'r:2 D6:1 C6:1 | E5:2 r:2 | r:1 F5:1 Bb5:1 D6:1 | C6:3 r:1',
        velocity: 0.36,
        pan: 0.2,
        when: 'afterFirst',
        reverb: 0.55,
      },
    ],
  },

  // Tension (pressure questions, time running out): A minor, slow heartbeat pulse, dark pad.
  tense: {
    id: 'tense',
    bpm: 66,
    beatsPerBar: 4,
    stepsPerBeat: 4,
    swing: 0,
    progression: 'Am | Am/G | Fmaj7 | E7sus4 E7 | Dm7 | Am/C | Bm7b5 | E7',
    gain: 0.5,
    seed: 37,
    layers: [
      { kind: 'pad', voice: 'pad', center: 'E4', velocity: 0.36, filterHz: 750, reverb: 0.45 },
      { kind: 'bass', voice: 'bass', base: 'A1', pattern: 'R.r.R.r.R.r.R.r.', maxSteps: 1, velocity: 0.55, filterHz: 420 },
      {
        kind: 'arp',
        voice: 'bell',
        base: 'A5',
        pattern: [_, _, _, _, _, _, _, _, _, _, _, _, 4, _, _, _],
        noteSteps: 3,
        velocity: 0.24,
        pan: 0.4,
        when: 'afterFirst',
        reverb: 0.7,
      },
      {
        kind: 'melody',
        voice: 'flute',
        notes: 'E5:2 r:2 | D5:1 C5:1 B4:2 | C5:3 r:1 | B4:2 G#4:2 | A4:2 F5:2 | E5:3 r:1 | D5:1 C5:1 B4:2 | G#4:3 r:1',
        velocity: 0.32,
        pan: -0.2,
        when: 'odd',
        reverb: 0.5,
      },
    ],
  },

  // Offer / perfect ending: warm, uplifting G major with rolling harp and a bright melody.
  ending_good: {
    id: 'ending_good',
    bpm: 96,
    beatsPerBar: 4,
    stepsPerBeat: 4,
    swing: 0,
    progression: 'Cmaj7 | D6 | Bm7 | Em7 | Am7 | D7sus4 D7 | G | Gsus4 G',
    gain: 0.55,
    seed: 41,
    layers: [
      { kind: 'pad', voice: 'pad', center: 'G4', velocity: 0.42, filterHz: 1700, reverb: 0.5 },
      {
        kind: 'arp',
        voice: 'pluck',
        base: 'G3',
        pattern: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3],
        noteSteps: 3,
        velocity: 0.34,
        pan: -0.3,
        filterHz: 3200,
        reverb: 0.35,
      },
      { kind: 'bass', voice: 'bass', base: 'G2', pattern: 'R.......r...f...', velocity: 0.5, filterHz: 700 },
      {
        kind: 'melody',
        voice: 'bell',
        notes:
          'E5:1 G5:1 B5:1.5 A5:0.5 | B5:1.5 A5:0.5 F#5:2 | D6:1 B5:1 A5:1 F#5:1 | G5:3 r:1 | ' +
          'C6:1 B5:1 A5:1 E5:1 | D6:1.5 C6:0.5 A5:1 F#5:1 | G5:1 B5:1 D6:2 | C6:2 B5:2',
        velocity: 0.5,
        pan: 0.2,
        reverb: 0.45,
      },
    ],
  },

  // Rejected / pending ending: a slow, sparse E-minor waltz.
  ending_bad: {
    id: 'ending_bad',
    bpm: 66,
    beatsPerBar: 3,
    stepsPerBeat: 4,
    swing: 0,
    progression: 'Emadd9 | Cmaj7 | Am7 | B7sus4 B7 | Em | Cmaj7 | Am6 | B7',
    gain: 0.5,
    seed: 53,
    layers: [
      { kind: 'pad', voice: 'pad', center: 'G4', velocity: 0.28, filterHz: 800, reverb: 0.55 },
      {
        kind: 'arp',
        voice: 'epiano',
        base: 'E3',
        pattern: [0, _, _, _, 2, _, _, _, 3, _, _, _],
        noteSteps: 4,
        velocity: 0.34,
        pan: -0.2,
        reverb: 0.45,
      },
      { kind: 'bass', voice: 'bass', base: 'E2', pattern: 'R...........', velocity: 0.36, filterHz: 500 },
      {
        kind: 'melody',
        voice: 'epiano',
        notes: 'B4:1 E5:1 F#5:1 | G5:2 E5:1 | E5:1.5 D5:0.5 C5:1 | B4:3 | r:1 G5:1 F#5:1 | E5:2 D5:1 | C5:1 B4:1 A4:1 | D#5:2 r:1',
        velocity: 0.34,
        pan: 0.15,
        when: 'afterFirst',
        reverb: 0.6,
      },
    ],
  },
};
