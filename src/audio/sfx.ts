/**
 * Synthesised UI / story sound effects. Each recipe renders into a per-play bus that feeds the
 * dry SFX channel and (optionally) the shared reverb, starting at time `t`.
 */
import type { SfxName } from './types';
import { bell, noise, playVoice, tone, type Out } from './voices';

export interface SfxOut {
  ctx: BaseAudioContext;
  /** Dry SFX input (after the SFX volume). */
  dry: AudioNode;
  /** Reverb send input (after the SFX volume). */
  wet: AudioNode;
}

interface Recipe {
  /** Reverb send amount 0–1. */
  wet: number;
  play(out: Out, t: number): void;
}

/** Minimum spacing between two plays of the same effect (s). */
export const SFX_MIN_INTERVAL: Readonly<Partial<Record<SfxName, number>>> = {
  blip: 0.035,
  hover: 0.03,
  click: 0.02,
};
export const DEFAULT_MIN_INTERVAL = 0.015;

const hz = {
  G4: 392,
  A4: 440,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  D6: 1174.66,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
  A6: 1760,
  B6: 1975.53,
  C7: 2093,
  G7: 3135.96,
  C8: 4186.01,
} as const;

/** Brass-ish tone for the fanfare: detuned saws through an opening low-pass. */
function brass(out: Out, t: number, freq: number, dur: number, peak: number): void {
  const { ctx } = out;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.linearRampToValueAtTime(3200, t + 0.04);
  filter.frequency.setTargetAtTime(1500, t + 0.04, 0.12);
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.03);
  amp.gain.setValueAtTime(peak * 0.85, t + dur);
  amp.gain.setTargetAtTime(0, t + dur, 0.1);
  const end = t + dur + 0.6;
  const oscs = [-6, 6].map((detune) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(t);
    osc.stop(end);
    return osc;
  });
  filter.connect(amp).connect(out.dest);
  oscs[0].onended = () => {
    for (const node of [...oscs, filter, amp]) node.disconnect();
  };
}

const RECIPES: Readonly<Record<SfxName, Recipe>> = {
  // Soft wooden tick.
  click: {
    wet: 0.04,
    play(o, t) {
      tone(o, t, { freq: 1400, glideTo: 700, glideTime: 0.03, peak: 0.26, attack: 0.001, tau: 0.014 });
      tone(o, t, { freq: 520, type: 'triangle', peak: 0.1, attack: 0.001, tau: 0.02 });
      noise(o, t, { filter: 'bandpass', freq: 2600, q: 1.5, peak: 0.1, tau: 0.006 });
    },
  },
  // Faint high tick.
  hover: {
    wet: 0.05,
    play(o, t) {
      tone(o, t, { freq: 2900, glideTo: 2500, glideTime: 0.02, peak: 0.05, attack: 0.001, tau: 0.01 });
    },
  },
  // Rising two-note chime (E6 → B6).
  confirm: {
    wet: 0.25,
    play(o, t) {
      bell(o, t, hz.E6, 0.2, 0.5);
      bell(o, t + 0.075, hz.B6, 0.17, 0.6);
    },
  },
  // Falling, softer.
  cancel: {
    wet: 0.1,
    play(o, t) {
      tone(o, t, { freq: hz.A5, type: 'triangle', peak: 0.16, attack: 0.003, tau: 0.07 });
      tone(o, t + 0.07, { freq: hz.D5, type: 'triangle', peak: 0.15, attack: 0.003, tau: 0.1 });
    },
  },
  // Typewriter: tiny, very quiet sine tick with a little pitch variation.
  blip: {
    wet: 0,
    play(o, t) {
      tone(o, t, { freq: 1450 + Math.random() * 180, peak: 0.035, attack: 0.001, tau: 0.008 });
    },
  },
  // Soft paper swish.
  page: {
    wet: 0.05,
    play(o, t) {
      noise(o, t, { filter: 'bandpass', freq: 700, sweepTo: 3200, sweepTime: 0.12, q: 0.9, peak: 0.16, attack: 0.03, tau: 0.045 });
    },
  },
  // Sparkly rising arpeggio.
  affinityUp: {
    wet: 0.35,
    play(o, t) {
      [hz.C6, hz.E6, hz.G6, hz.C7].forEach((f, i) => bell(o, t + i * 0.055, f, 0.12, 0.5));
      tone(o, t + 0.24, { freq: hz.G7, peak: 0.028, tau: 0.08 });
      tone(o, t + 0.29, { freq: hz.C8, peak: 0.022, tau: 0.07 });
    },
  },
  // Low descending sigh.
  affinityDown: {
    wet: 0.15,
    play(o, t) {
      tone(o, t, { freq: 392, glideTo: 261.63, glideTime: 0.32, type: 'triangle', peak: 0.15, attack: 0.012, hold: 0.18, tau: 0.12 });
      tone(o, t, { freq: 329.63, glideTo: 220, glideTime: 0.32, type: 'triangle', peak: 0.07, attack: 0.012, hold: 0.18, tau: 0.12 });
    },
  },
  // Temple-bell-like chime for chapter cards.
  chapter: {
    wet: 0.5,
    play(o, t) {
      const partials: readonly [ratio: number, gain: number, tau: number][] = [
        [0.5, 0.1, 0.6],
        [1, 0.18, 0.55],
        [2, 0.07, 0.4],
        [2.4, 0.045, 0.3],
        [3, 0.045, 0.25],
        [4.2, 0.025, 0.15],
        [5.4, 0.015, 0.1],
      ];
      for (const [ratio, gain, tau] of partials) {
        tone(o, t, { freq: hz.G4 * ratio, peak: gain, attack: ratio < 1 ? 0.02 : 0.002, tau });
      }
      bell(o, t + 0.14, hz.D5, 0.08, 1.2);
    },
  },
  micOn: {
    wet: 0.08,
    play(o, t) {
      tone(o, t, { freq: hz.G5, peak: 0.12, attack: 0.003, hold: 0.04, tau: 0.02 });
      tone(o, t + 0.075, { freq: hz.D6, peak: 0.12, attack: 0.003, hold: 0.05, tau: 0.03 });
    },
  },
  micOff: {
    wet: 0.08,
    play(o, t) {
      tone(o, t, { freq: hz.D6, peak: 0.11, attack: 0.003, hold: 0.04, tau: 0.02 });
      tone(o, t + 0.075, { freq: hz.G5, peak: 0.11, attack: 0.003, hold: 0.05, tau: 0.03 });
    },
  },
  // Marimba-like "pop pop".
  notify: {
    wet: 0.2,
    play(o, t) {
      for (const [dt, f] of [
        [0, hz.D6],
        [0.1, hz.A6],
      ] as const) {
        tone(o, t + dt, { freq: f, peak: 0.18, attack: 0.002, tau: 0.07 });
        tone(o, t + dt, { freq: f * 4, peak: 0.025, attack: 0.001, tau: 0.015 });
      }
    },
  },
  // Rubber stamp: body thump + paper slap + click.
  stamp: {
    wet: 0.12,
    play(o, t) {
      tone(o, t, { freq: 150, glideTo: 48, glideTime: 0.13, peak: 0.6, attack: 0.002, tau: 0.08 });
      noise(o, t, { filter: 'lowpass', freq: 1400, peak: 0.3, attack: 0.001, tau: 0.035 });
      noise(o, t, { filter: 'highpass', freq: 3500, peak: 0.1, attack: 0.001, tau: 0.006 });
    },
  },
  // Short triumphant major arpeggio.
  fanfare: {
    wet: 0.3,
    play(o, t) {
      brass(o, t, hz.G4, 0.09, 0.07);
      brass(o, t + 0.11, hz.C5, 0.09, 0.07);
      brass(o, t + 0.22, hz.E5, 0.09, 0.07);
      brass(o, t + 0.33, hz.G5, 0.75, 0.08);
      brass(o, t + 0.33, hz.E5, 0.75, 0.045);
      brass(o, t + 0.33, hz.C5, 0.75, 0.045);
      brass(o, t + 0.33, 261.63, 0.75, 0.04);
      bell(o, t + 0.36, hz.C7, 0.06, 0.8);
      bell(o, t + 0.44, hz.G7 / 2, 0.04, 0.8);
    },
  },
  // Minor descending phrase (E5 → C5 → A4).
  sad: {
    wet: 0.35,
    play(o, t) {
      playVoice('flute', o, t, 76, 0.24, 0.6);
      playVoice('flute', o, t + 0.3, 72, 0.24, 0.6);
      playVoice('flute', o, t + 0.6, 69, 0.95, 0.6);
      playVoice('epiano', o, t + 0.6, 57, 1, 0.35);
    },
  },
};

/** Render effect `name` at time `t`. */
export function renderSfx(name: SfxName, out: SfxOut, t: number): void {
  const recipe = RECIPES[name];
  const { ctx } = out;
  const bus = ctx.createGain();
  bus.connect(out.dry);
  if (recipe.wet > 0) {
    const send = ctx.createGain();
    send.gain.value = recipe.wet;
    bus.connect(send).connect(out.wet);
  }
  recipe.play({ ctx, dest: bus }, t);
}
