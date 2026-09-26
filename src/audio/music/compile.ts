/**
 * Compile a TrackDef into a flat per-step event table so the real-time scheduler only has to
 * look up `events[step % loopSteps]`. Pure (unit-tested for every track).
 */
import { bassNote, chordLadder, noteToMidi, parseMelody, parseProgression, voiceChord, type Chord } from './theory';
import { stepDuration } from './clock';
import type { LayerDef, LayerWhen, TrackDef, VoiceName } from './tracks';

export interface NoteEvent {
  layer: number;
  voice: VoiceName;
  midi: number;
  /** Duration in steps. */
  steps: number;
  /** 0–1 */
  velocity: number;
}

export interface CompiledLayer {
  voice: VoiceName;
  when: LayerWhen;
  pan: number;
  filterHz: number | null;
  reverb: number;
}

export interface CompiledTrack {
  def: TrackDef;
  stepDur: number;
  stepsPerBar: number;
  loopSteps: number;
  layers: CompiledLayer[];
  /** events[stepInLoop] */
  events: NoteEvent[][];
}

interface ChordSpan {
  chord: Chord;
  start: number;
  length: number;
}

/** Chord changes across the loop; several chords in one bar split the bar evenly. */
function chordSpans(def: TrackDef, stepsPerBar: number): ChordSpan[] {
  const spans: ChordSpan[] = [];
  parseProgression(def.progression).forEach((bar, barIndex) => {
    const each = stepsPerBar / bar.length;
    if (!Number.isInteger(each)) throw new Error(`${def.id}: bar ${barIndex + 1} cannot be split evenly`);
    bar.forEach((chord, i) => spans.push({ chord, start: barIndex * stepsPerBar + i * each, length: each }));
  });
  return spans;
}

function chordAt(spans: readonly ChordSpan[], step: number): Chord {
  for (let i = spans.length - 1; i >= 0; i--) if (spans[i].start <= step) return spans[i].chord;
  return spans[0].chord;
}

function checkPatternLength(def: TrackDef, layer: LayerDef, length: number, stepsPerBar: number): void {
  if (length !== stepsPerBar) throw new Error(`${def.id}: ${layer.kind} pattern has ${length} steps, expected ${stepsPerBar}`);
}

export function isLayerActive(when: LayerWhen, loopIndex: number): boolean {
  switch (when) {
    case 'always':
      return true;
    case 'afterFirst':
      return loopIndex > 0;
    case 'even':
      return loopIndex % 2 === 0;
    case 'odd':
      return loopIndex % 2 === 1;
  }
}

export function compileTrack(def: TrackDef): CompiledTrack {
  const stepsPerBar = def.beatsPerBar * def.stepsPerBeat;
  const spans = chordSpans(def, stepsPerBar);
  const bars = spans.length ? (spans[spans.length - 1].start + spans[spans.length - 1].length) / stepsPerBar : 0;
  const loopSteps = bars * stepsPerBar;
  if (loopSteps === 0) throw new Error(`${def.id}: empty progression`);
  const events: NoteEvent[][] = Array.from({ length: loopSteps }, () => []);
  const add = (step: number, event: NoteEvent) => events[step % loopSteps].push(event);

  def.layers.forEach((layer, index) => {
    const base = { layer: index, voice: layer.voice };
    switch (layer.kind) {
      case 'pad': {
        let previous: number[] | undefined;
        for (const span of spans) {
          const notes = voiceChord(span.chord, noteToMidi(layer.center), previous);
          previous = notes;
          for (const midi of notes) add(span.start, { ...base, midi, steps: span.length, velocity: layer.velocity });
        }
        break;
      }
      case 'arp': {
        checkPatternLength(def, layer, layer.pattern.length, stepsPerBar);
        const root = noteToMidi(layer.base);
        for (let bar = 0; bar < bars; bar++) {
          layer.pattern.forEach((rung, s) => {
            if (rung === null) return;
            const step = bar * stepsPerBar + s;
            const ladder = chordLadder(chordAt(spans, step), root, rung + 1);
            add(step, { ...base, midi: ladder[rung], steps: layer.noteSteps, velocity: layer.velocity });
          });
        }
        break;
      }
      case 'bass': {
        checkPatternLength(def, layer, layer.pattern.length, stepsPerBar);
        const low = noteToMidi(layer.base);
        const hits = [...layer.pattern].flatMap((c, s) => (c === '.' ? [] : [{ c, s }]));
        for (let bar = 0; bar < bars; bar++) {
          hits.forEach(({ c, s }, i) => {
            const step = bar * stepsPerBar + s;
            const chord = chordAt(spans, step);
            const root = bassNote(chord, low);
            const kind = c.toUpperCase();
            const midi = kind === 'F' ? bassNote({ ...chord, bass: (chord.root + 7) % 12 }, low) : kind === 'O' ? root + 12 : root;
            const until = i + 1 < hits.length ? hits[i + 1].s : stepsPerBar;
            const steps = Math.min(until - s, layer.maxSteps ?? stepsPerBar);
            const velocity = layer.velocity * (c === kind ? 1 : 0.7);
            add(step, { ...base, midi, steps, velocity });
          });
        }
        break;
      }
      case 'comp': {
        checkPatternLength(def, layer, layer.rhythm.length, stepsPerBar);
        const hits = [...layer.rhythm].flatMap((c, s) => (c === 'x' ? [s] : []));
        let previous: number[] | undefined;
        for (let bar = 0; bar < bars; bar++) {
          hits.forEach((s, i) => {
            const step = bar * stepsPerBar + s;
            const notes = voiceChord(chordAt(spans, step), noteToMidi(layer.center), previous);
            previous = notes;
            const steps = (i + 1 < hits.length ? hits[i + 1] : stepsPerBar) - s;
            notes.forEach((midi, n) => add(step, { ...base, midi, steps, velocity: layer.velocity * (n === 0 ? 1 : 0.85) }));
          });
        }
        break;
      }
      case 'melody': {
        const melody = parseMelody(layer.notes, def.beatsPerBar);
        if (bars % melody.length !== 0) throw new Error(`${def.id}: melody has ${melody.length} bars, loop has ${bars}`);
        for (let bar = 0; bar < bars; bar++) {
          for (const note of melody[bar % melody.length]) {
            if (note.midi === null) continue;
            const step = bar * stepsPerBar + Math.round(note.beat * def.stepsPerBeat);
            add(step, { ...base, midi: note.midi, steps: Math.max(1, Math.round(note.beats * def.stepsPerBeat)), velocity: layer.velocity });
          }
        }
        break;
      }
    }
  });

  return {
    def,
    stepDur: stepDuration(def.bpm, def.stepsPerBeat),
    stepsPerBar,
    loopSteps,
    layers: def.layers.map((l) => ({
      voice: l.voice,
      when: l.when ?? 'always',
      pan: l.pan ?? 0,
      filterHz: l.filterHz ?? null,
      reverb: l.reverb ?? 0.3,
    })),
    events,
  };
}
