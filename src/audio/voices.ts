/**
 * Web Audio synthesis primitives and the instrument voices used by the SFX and the BGM.
 * Every function takes an explicit start time and destination, creates short-lived nodes and
 * schedules their own stop + disconnect, so callers never have to track them.
 */
import { createRng } from './music/clock';
import { midiToFreq } from './music/theory';
import type { VoiceName } from './music/tracks';

export interface Out {
  ctx: BaseAudioContext;
  dest: AudioNode;
}

/** Time constants after which a decaying voice is treated as silent (e^-5.5 ≈ −48 dB). */
const TAIL_TAUS = 5.5;

/** Disconnect a voice's nodes once its last source has ended (lets the browser free them promptly). */
function cleanupOnEnd(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
  };
}

function gainNode(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/**
 * Percussive envelope: linear attack to `peak`, optional hold, exponential-style decay
 * (setTargetAtTime). Returns the time at which the sound is inaudible.
 */
export function percussiveEnvelope(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  tau: number,
  hold = 0,
): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
  param.setTargetAtTime(0, t + attack + hold, tau);
  return t + attack + hold + tau * TAIL_TAUS;
}

export interface ToneOptions {
  freq: number;
  type?: OscillatorType;
  peak: number;
  attack?: number;
  hold?: number;
  /** Decay time constant (s). */
  tau: number;
  /** Exponential pitch glide to this frequency. */
  glideTo?: number;
  glideTime?: number;
  detune?: number;
}

/** A single enveloped oscillator. Returns its end time. */
export function tone(out: Out, t: number, o: ToneOptions): number {
  const { ctx } = out;
  const osc = ctx.createOscillator();
  const amp = gainNode(ctx);
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(o.glideTo, 1), t + (o.glideTime ?? 0.1));
  if (o.detune) osc.detune.value = o.detune;
  const end = percussiveEnvelope(amp.gain, t, o.peak, o.attack ?? 0.004, o.tau, o.hold);
  osc.connect(amp).connect(out.dest);
  osc.start(t);
  osc.stop(end);
  cleanupOnEnd(osc, [osc, amp]);
  return end;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 1 s of (deterministic) white noise, shared per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = createRng(7);
    for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

export interface NoiseOptions {
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  /** Sweep the filter to this frequency over the sound. */
  sweepTo?: number;
  sweepTime?: number;
  peak: number;
  attack?: number;
  hold?: number;
  tau: number;
}

/** Filtered noise burst (clicks, swishes, stamps). Returns its end time. */
export function noise(out: Out, t: number, o: NoiseOptions): number {
  const { ctx } = out;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.Q.value = o.q ?? 0.7;
  filter.frequency.setValueAtTime(o.freq, t);
  if (o.sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.sweepTime ?? 0.1));
  const amp = gainNode(ctx);
  const end = percussiveEnvelope(amp.gain, t, o.peak, o.attack ?? 0.002, o.tau, o.hold);
  src.connect(filter).connect(amp).connect(out.dest);
  // Random offset so consecutive bursts don't sound identical.
  src.start(t, Math.random() * 0.5);
  src.stop(end);
  cleanupOnEnd(src, [src, filter, amp]);
  return end;
}

/** Struck-bar bell / music box: inharmonic partials with individual decays. */
export function bell(out: Out, t: number, freq: number, peak: number, ring = 1): number {
  const partials: readonly [ratio: number, gain: number, tau: number][] = [
    [1, 1, 0.55 * ring],
    [2, 0.28, 0.25 * ring],
    [2.76, 0.16, 0.14 * ring],
    [5.4, 0.06, 0.05 * ring],
  ];
  let end = t;
  for (const [ratio, gain, tau] of partials) {
    const f = freq * ratio;
    if (f > 16000) continue;
    end = Math.max(end, tone(out, t, { freq: f, peak: peak * gain, attack: 0.002, tau }));
  }
  return end;
}

// ───────────────────────────── Instruments (BGM) ─────────────────────────────

/** Electric piano: 1:1 FM with a decaying index (bright attack, mellow body) + a faint tine. */
function epiano(out: Out, t: number, f: number, dur: number, vel: number): void {
  const { ctx } = out;
  const carrier = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = gainNode(ctx);
  const amp = gainNode(ctx);
  carrier.frequency.value = f;
  mod.frequency.value = f;
  modGain.gain.setValueAtTime(f * (0.9 + 0.8 * vel), t);
  modGain.gain.setTargetAtTime(f * 0.18, t, 0.16);
  const bodyTau = Math.min(1.3, Math.max(0.35, 0.45 + (0.9 * 262) / f));
  const peak = 0.3 * vel;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.006);
  amp.gain.setTargetAtTime(0, t + 0.006, bodyTau);
  amp.gain.setTargetAtTime(0, t + dur, 0.09);
  const end = Math.min(t + 0.006 + bodyTau * TAIL_TAUS, t + dur + 0.09 * TAIL_TAUS);
  mod.connect(modGain).connect(carrier.frequency);
  carrier.connect(amp).connect(out.dest);
  mod.start(t);
  carrier.start(t);
  mod.stop(end);
  carrier.stop(end);
  cleanupOnEnd(carrier, [carrier, mod, modGain, amp]);
  if (f * 4 < 12000) tone(out, t, { freq: f * 4, peak: 0.035 * vel, attack: 0.002, tau: 0.05 });
}

/** Warm pad: saw + triangle, slow attack, held for the chord, soft release (layer bus filters it). */
function pad(out: Out, t: number, f: number, dur: number, vel: number): void {
  const { ctx } = out;
  const amp = gainNode(ctx);
  const attack = Math.min(0.8, dur * 0.4);
  const peak = 0.075 * vel;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + attack);
  amp.gain.setValueAtTime(peak, t + dur);
  amp.gain.setTargetAtTime(0, t + dur, 0.35);
  const end = t + dur + 0.35 * TAIL_TAUS;
  const oscs = (['sawtooth', 'triangle'] as const).map((type, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = i === 0 ? -7 : 6;
    osc.connect(amp);
    osc.start(t);
    osc.stop(end);
    return osc;
  });
  amp.connect(out.dest);
  cleanupOnEnd(oscs[0], [...oscs, amp]);
}

/** Harp-like pluck: triangle body + a quick octave partial; decays faster for high notes. */
function pluck(out: Out, t: number, f: number, _dur: number, vel: number): void {
  const tau = Math.min(0.45, Math.max(0.1, (0.28 * 330) / f));
  tone(out, t, { freq: f, type: 'triangle', peak: 0.26 * vel, attack: 0.003, tau });
  tone(out, t, { freq: f * 2, peak: 0.06 * vel, attack: 0.002, tau: tau * 0.5 });
}

/** Round sub bass: sine + a little triangle for definition. */
function bass(out: Out, t: number, f: number, dur: number, vel: number): void {
  const { ctx } = out;
  const amp = gainNode(ctx);
  const peak = 0.25 * vel;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.012);
  amp.gain.setTargetAtTime(peak * 0.55, t + 0.012, 0.22);
  amp.gain.setTargetAtTime(0, t + dur, 0.06);
  const end = t + dur + 0.06 * TAIL_TAUS;
  const oscs = (['sine', 'triangle'] as const).map((type) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = type === 'sine' ? amp : gainNode(ctx, 0.3);
    if (g !== amp) g.connect(amp);
    osc.connect(g);
    osc.start(t);
    osc.stop(end);
    return { osc, g };
  });
  amp.connect(out.dest);
  cleanupOnEnd(oscs[0].osc, [oscs[0].osc, oscs[1].osc, oscs[1].g, amp]);
}

/** Soft flute: sine + triangle with delayed vibrato. */
function flute(out: Out, t: number, f: number, dur: number, vel: number): void {
  const { ctx } = out;
  const amp = gainNode(ctx);
  const peak = 0.2 * vel;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.07);
  amp.gain.setTargetAtTime(peak * 0.8, t + 0.07, 0.3);
  amp.gain.setTargetAtTime(0, t + dur, 0.1);
  const end = t + dur + 0.1 * TAIL_TAUS;
  const lfo = ctx.createOscillator();
  const lfoGain = gainNode(ctx);
  lfo.frequency.value = 5.2;
  lfoGain.gain.setValueAtTime(0, t);
  lfoGain.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(0.35, dur));
  lfo.connect(lfoGain);
  const oscs = (['sine', 'triangle'] as const).map((type) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    lfoGain.connect(osc.frequency);
    const g = type === 'sine' ? amp : gainNode(ctx, 0.25);
    if (g !== amp) g.connect(amp);
    osc.connect(g);
    osc.start(t);
    osc.stop(end);
    return { osc, g };
  });
  lfo.start(t);
  lfo.stop(end);
  amp.connect(out.dest);
  cleanupOnEnd(lfo, [lfo, lfoGain, oscs[0].osc, oscs[1].osc, oscs[1].g, amp]);
}

function bellVoice(out: Out, t: number, f: number, dur: number, vel: number): void {
  bell(out, t, f, 0.2 * vel, Math.min(2, 0.8 + dur));
}

const VOICES: Readonly<Record<VoiceName, (out: Out, t: number, f: number, dur: number, vel: number) => void>> = {
  epiano,
  bell: bellVoice,
  pad,
  pluck,
  bass,
  flute,
};

/** Play one note of a BGM instrument. `dur` is the written note length in seconds. */
export function playVoice(voice: VoiceName, out: Out, t: number, midi: number, dur: number, velocity: number): void {
  VOICES[voice](out, t, midiToFreq(midi), Math.max(dur, 0.05), Math.min(Math.max(velocity, 0), 1));
}

/** Generated stereo room impulse response (no asset files): darkening, exponentially decaying noise. */
export function createImpulseResponse(ctx: BaseAudioContext, seconds = 1.8, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rng = createRng(101 + ch);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const x = i / length;
      const brightness = 0.85 - 0.7 * x; // high frequencies die first
      lp += (rng() * 2 - 1 - lp) * brightness;
      data[i] = lp * (1 - x) ** decay;
    }
  }
  return buffer;
}
