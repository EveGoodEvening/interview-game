/**
 * Real-time BGM: a TrackPlayer schedules one compiled track with the look-ahead clock; the
 * BgmController owns the current player, crossfades between tracks and drives the timer.
 */
import type { BgmTrack } from '../types';
import { playVoice } from '../voices';
import { collectDueSteps, createRng, TICK_MS, type ClockState } from './clock';
import { compileTrack, isLayerActive, type CompiledTrack } from './compile';
import { TRACKS } from './tracks';

export const CROSSFADE_SEC = 1.5;
/** Time kept after a fade-out for releases and reverb tails before nodes are disconnected. */
const TAIL_SEC = 3;
/** Pads get a default low-pass so raw saw waves never reach the mix. */
const DEFAULT_PAD_FILTER_HZ = 1200;

export interface MusicOutput {
  ctx: BaseAudioContext;
  /** Dry BGM input (after the BGM volume). */
  dry: AudioNode;
  /** Reverb send input (after the BGM volume). */
  wet: AudioNode;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const compiledCache = new Map<BgmTrack, CompiledTrack>();

export function getCompiledTrack(track: BgmTrack): CompiledTrack {
  let compiled = compiledCache.get(track);
  if (!compiled) {
    compiled = compileTrack(TRACKS[track]);
    compiledCache.set(track, compiled);
  }
  return compiled;
}

function rampTo(param: AudioParam, value: number, from: number, to: number): void {
  param.cancelScheduledValues(from);
  param.setValueAtTime(param.value, from);
  param.linearRampToValueAtTime(value, to);
}

export class TrackPlayer {
  readonly track: BgmTrack;
  private readonly compiled: CompiledTrack;
  private readonly out: MusicOutput;
  private readonly bus: GainNode;
  private readonly wetBus: GainNode;
  private readonly layerInputs: GainNode[];
  private readonly nodes: AudioNode[] = [];
  private readonly rng: () => number;
  private clock: ClockState;
  private stopAt = Infinity;
  private disposed = false;

  constructor(out: MusicOutput, track: BgmTrack, compiled: CompiledTrack, startAt: number, fadeIn: number) {
    this.out = out;
    this.track = track;
    this.compiled = compiled;
    this.rng = createRng(compiled.def.seed);
    const { ctx } = out;
    const level = compiled.def.gain;

    this.bus = ctx.createGain();
    this.wetBus = ctx.createGain();
    for (const g of [this.bus, this.wetBus]) {
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(level, startAt + Math.max(fadeIn, 0.01));
    }
    this.bus.connect(out.dry);
    this.wetBus.connect(out.wet);
    this.nodes.push(this.bus, this.wetBus);

    this.layerInputs = compiled.layers.map((layer) => {
      const input = ctx.createGain();
      let tail: AudioNode = input;
      const cutoff = layer.filterHz ?? (layer.voice === 'pad' ? DEFAULT_PAD_FILTER_HZ : null);
      if (cutoff !== null) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        filter.Q.value = 0.5;
        tail = tail.connect(filter);
        this.nodes.push(filter);
      }
      if (layer.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = layer.pan;
        tail = tail.connect(panner);
        this.nodes.push(panner);
      }
      tail.connect(this.bus);
      if (layer.reverb > 0) {
        const send = ctx.createGain();
        send.gain.value = layer.reverb;
        tail.connect(send).connect(this.wetBus);
        this.nodes.push(send);
      }
      this.nodes.push(input);
      return input;
    });

    this.clock = { step: 0, time: startAt + 0.05 };
  }

  /** Schedule every note due before now + look-ahead. */
  tick(now: number): void {
    if (this.disposed) return;
    const { stepDur, def, loopSteps, events, layers } = this.compiled;
    const { due, next } = collectDueSteps(this.clock, now, stepDur, def.swing);
    this.clock = next;
    for (const { step, time } of due) {
      if (time >= this.stopAt) continue;
      const loopIndex = Math.floor(step / loopSteps);
      for (const ev of events[step % loopSteps]) {
        const layer = layers[ev.layer];
        if (!isLayerActive(layer.when, loopIndex)) continue;
        // Gentle humanisation: ±8 % velocity, ±4 ms timing (never earlier than now).
        const velocity = ev.velocity * (0.92 + this.rng() * 0.16);
        const t = Math.max(now + 0.005, time + (this.rng() - 0.5) * 0.008);
        playVoice(ev.voice, { ctx: this.out.ctx, dest: this.layerInputs[ev.layer] }, t, ev.midi, ev.steps * stepDur * 0.96, velocity);
      }
    }
  }

  fadeOut(now: number, duration: number): void {
    if (this.stopAt !== Infinity) return;
    this.stopAt = now + duration;
    rampTo(this.bus.gain, 0, now, this.stopAt);
    rampTo(this.wetBus.gain, 0, now, this.stopAt);
  }

  get fadingOut(): boolean {
    return this.stopAt !== Infinity;
  }

  isFinished(now: number): boolean {
    return now > this.stopAt + TAIL_SEC;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}

export class BgmController {
  private desired: BgmTrack | null = null;
  private current: TrackPlayer | null = null;
  private fading: TrackPlayer[] = [];
  private out: MusicOutput | null = null;
  private timer: unknown = null;
  private paused = false;
  private readonly timers: Timers;

  constructor(timers: Timers) {
    this.timers = timers;
  }

  /** The requested track (even before audio is unlocked). */
  get track(): BgmTrack | null {
    return this.desired;
  }

  /** Number of players still producing sound (current + fading). For diagnostics/tests. */
  get activePlayers(): number {
    return (this.current ? 1 : 0) + this.fading.length;
  }

  /** Connect to the audio graph (called once audio is unlocked); starts the requested track. */
  attach(out: MusicOutput): void {
    this.out = out;
    this.sync();
  }

  play(track: BgmTrack | null): void {
    if (track === this.desired) return;
    this.desired = track;
    this.sync();
  }

  /** Stop scheduling (page hidden, music inaudible). Already-scheduled notes finish; the song position is kept. */
  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.loop();
  }

  private sync(): void {
    const out = this.out;
    if (!out) return;
    const now = out.ctx.currentTime;
    if (this.current && this.current.track === this.desired) return;
    if (this.current) {
      this.current.fadeOut(now, CROSSFADE_SEC);
      this.fading.push(this.current);
      this.current = null;
    }
    if (this.desired) {
      this.current = new TrackPlayer(out, this.desired, getCompiledTrack(this.desired), now, CROSSFADE_SEC);
    }
    // While paused (muted / hidden) the loop does not run: drop players whose fade-out is over here.
    this.pruneFinished(now);
    this.clearTimer();
    this.loop();
  }

  private pruneFinished(now: number): void {
    this.fading = this.fading.filter((player) => {
      if (!player.isFinished(now)) return true;
      player.dispose();
      return false;
    });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private readonly loop = (): void => {
    this.timer = null;
    const out = this.out;
    if (this.paused || !out) return;
    const now = out.ctx.currentTime;
    const running = !('state' in out.ctx) || out.ctx.state === 'running';
    if (running) {
      this.current?.tick(now);
      for (const player of this.fading) player.tick(now);
    }
    this.pruneFinished(now);
    if (this.current || this.fading.length) this.timer = this.timers.setTimeout(this.loop, TICK_MS);
  };
}
