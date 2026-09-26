/**
 * The audio engine: one shared AudioContext, the gain graph and the policies around it
 * (unlock on user gesture, volumes with short ramps, SFX rate limiting, pausing while hidden).
 *
 *   sfx voices ─► sfx ─────────────┐
 *            └──► sfxWet ─┐        ├─► master ─► limiter ─► destination
 *   bgm tracks ─► bgm ────┼────────┤
 *            └──► bgmWet ─┴► reverb┘
 *
 * BGM is only scheduled while it can be heard: not while the page is hidden, the context is not
 * running, audio is muted, or the master / BGM volume is 0. It picks up again (at the current song
 * position) as soon as it is audible.
 *
 * All public methods are total: they never throw and are silent no-ops when Web Audio is missing.
 */
import type { AudioSettings } from '../types';
import { BgmController, type Timers } from './music/player';
import { DEFAULT_MIN_INTERVAL, renderSfx, SFX_MIN_INTERVAL } from './sfx';
import type { BgmTrack, SfxName } from './types';
import { createImpulseResponse } from './voices';

/** Mirrors the defaults in the settings store, used until setAudioVolumes() is first called. */
export const DEFAULT_VOLUMES: AudioSettings = { master: 0.8, bgm: 0.35, sfx: 0.6, voice: 1, muted: false };

/** Headroom so full-scale sliders stay comfortable next to TTS speech. */
const BGM_LEVEL = 0.8;
const SFX_LEVEL = 1;
const REVERB_RETURN = 0.8;
const VOLUME_RAMP_SEC = 0.08;
/** Right after unlock the context may still be resuming; sounds scheduled then play on start. */
const RESUME_GRACE_MS = 1500;

interface Graph {
  master: GainNode;
  bgm: GainNode;
  bgmWet: GainNode;
  sfx: GainNode;
  sfxWet: GainNode;
}

export interface DocumentLike {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface EngineDeps {
  /** Creates the context, or returns null when Web Audio is unavailable. */
  createContext(): AudioContext | null;
  timers: Timers;
  /** Wall clock in ms (performance.now). */
  now(): number;
  document: DocumentLike | null;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private volumes: AudioSettings = DEFAULT_VOLUMES;
  private unsupported = false;
  private resumeRequestedAt = -Infinity;
  private readonly lastPlayed = new Map<SfxName, number>();
  private readonly bgm: BgmController;
  private readonly deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.bgm = new BgmController(deps.timers);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get currentBgm(): BgmTrack | null {
    return this.bgm.track;
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.unsupported) return;
    try {
      if (!this.ctx) {
        const ctx = this.deps.createContext();
        if (!ctx) {
          this.unsupported = true;
          return;
        }
        this.ctx = ctx;
        this.graph = this.buildGraph(ctx);
        this.applyVolumes(true);
        this.primeOutput(ctx);
        ctx.addEventListener('statechange', this.onStateChange);
        this.deps.document?.addEventListener('visibilitychange', this.onVisibilityChange);
        // Decide before attaching, so an inaudible (muted / hidden / suspended) start never schedules notes.
        this.updateBgmRunning();
        this.bgm.attach({ ctx, dry: this.graph.bgm, wet: this.graph.bgmWet });
      }
      this.resume();
    } catch {
      // A browser that refuses to create/resume audio simply stays silent.
      this.unsupported = this.ctx === null;
    }
  }

  setVolumes(volumes: AudioSettings): void {
    this.volumes = { ...volumes };
    try {
      this.applyVolumes(false);
      this.updateBgmRunning();
    } catch {
      // ignore
    }
  }

  /** True when the BGM bus can be heard at the current volumes. */
  get bgmAudible(): boolean {
    const v = this.volumes;
    return !v.muted && v.master > 0 && v.bgm > 0;
  }

  playSfx(name: SfxName): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph || !this.canPlayNow(ctx)) return;
    const v = this.volumes;
    if (v.muted || !(v.master > 0) || !(v.sfx > 0)) return; // inaudible: don't build nodes
    try {
      const now = ctx.currentTime;
      const minGap = SFX_MIN_INTERVAL[name] ?? DEFAULT_MIN_INTERVAL;
      const last = this.lastPlayed.get(name);
      if (last !== undefined && now - last < minGap && now >= last) return;
      this.lastPlayed.set(name, now);
      renderSfx(name, { ctx, dry: graph.sfx, wet: graph.sfxWet }, now + 0.005);
    } catch {
      // never let a sound effect break the UI
    }
  }

  playBgm(track: BgmTrack | null): void {
    try {
      this.bgm.play(track);
    } catch {
      // ignore
    }
  }

  private canPlayNow(ctx: AudioContext): boolean {
    if (ctx.state === 'running') return true;
    if (ctx.state === 'closed') return false;
    // Unlock gesture in progress: schedule now, it plays as soon as the context starts.
    return this.deps.now() - this.resumeRequestedAt < RESUME_GRACE_MS && !this.deps.document?.hidden;
  }

  private resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    if (this.deps.document?.hidden) return;
    this.resumeRequestedAt = this.deps.now();
    ctx.resume().catch(() => undefined);
  }

  private buildGraph(ctx: AudioContext): Graph {
    const gain = (value: number) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    const master = gain(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter).connect(ctx.destination);

    const bgm = gain(0);
    const bgmWet = gain(0);
    const sfx = gain(0);
    const sfxWet = gain(0);
    bgm.connect(master);
    sfx.connect(master);
    try {
      const reverb = ctx.createConvolver();
      reverb.buffer = createImpulseResponse(ctx);
      const ret = gain(REVERB_RETURN);
      bgmWet.connect(reverb);
      sfxWet.connect(reverb);
      reverb.connect(ret).connect(master);
    } catch {
      // No convolver: the wet sends simply go nowhere.
    }
    return { master, bgm, bgmWet, sfx, sfxWet };
  }

  /** iOS/old WebKit only start output after something plays inside the gesture. */
  private primeOutput(ctx: AudioContext): void {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const v = this.volumes;
    const now = ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(value, now);
        return;
      }
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + VOLUME_RAMP_SEC);
    };
    set(graph.master.gain, v.muted ? 0 : clamp01(v.master));
    set(graph.bgm.gain, clamp01(v.bgm) * BGM_LEVEL);
    set(graph.bgmWet.gain, clamp01(v.bgm) * BGM_LEVEL);
    set(graph.sfx.gain, clamp01(v.sfx) * SFX_LEVEL);
    set(graph.sfxWet.gain, clamp01(v.sfx) * SFX_LEVEL);
  }

  /**
   * Run the BGM scheduler only while the music is audible and the page is visible; otherwise pause
   * it (the song position is kept, nothing is synthesized meanwhile). While the context is still
   * starting the scheduler idles without scheduling notes (see BgmController), so a browser that
   * never reports `statechange` still starts the music once the context runs.
   */
  private updateBgmRunning(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const run = this.bgmAudible && !this.deps.document?.hidden && ctx.state !== 'closed';
    if (run) this.bgm.resume();
    else this.bgm.pause();
  }

  private readonly onVisibilityChange = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (this.deps.document?.hidden) {
        this.bgm.pause();
        if (ctx.state === 'running') ctx.suspend().catch(() => undefined);
      } else {
        this.resume();
        this.updateBgmRunning();
      }
    } catch {
      // ignore
    }
  };

  private readonly onStateChange = (): void => {
    try {
      this.updateBgmRunning();
    } catch {
      // ignore
    }
  };
}
