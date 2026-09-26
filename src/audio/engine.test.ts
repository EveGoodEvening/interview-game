import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine, DEFAULT_VOLUMES, type DocumentLike } from './engine';
import { CROSSFADE_SEC } from './music/player';
import { FakeAudioContext, FakeGainNode, FakeOscillatorNode, FakeTimers } from './testing/fakeAudioContext';

class FakeDocument implements DocumentLike {
  hidden = false;
  private listeners: (() => void)[] = [];
  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.push(listener);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of this.listeners) l();
  }
}

function setup(options: { supported?: boolean } = {}) {
  const ctx = new FakeAudioContext();
  const timers = new FakeTimers();
  const doc = new FakeDocument();
  let created = 0;
  const engine = new AudioEngine({
    createContext: () => {
      created++;
      return options.supported === false ? null : ctx.asAudioContext();
    },
    timers,
    now: () => timers.now,
    document: doc,
  });
  const flush = () => Promise.resolve();
  return { ctx, timers, doc, engine, created: () => created, flush };
}

/** The master gain is the node feeding the limiter. */
function masterGain(ctx: FakeAudioContext): FakeGainNode {
  const limiter = ctx.nodes('compressor')[0];
  return ctx.created.find((n): n is FakeGainNode => n instanceof FakeGainNode && n.outputs.includes(limiter))!;
}

function lastValue(g: FakeGainNode): number {
  const events = g.gain.events.filter((e) => e.type !== 'cancel');
  return events.length ? events[events.length - 1].value : g.gain.value;
}

let env: ReturnType<typeof setup>;
beforeEach(() => {
  env = setup();
});

describe('AudioEngine — unlock & volumes', () => {
  it('does nothing before unlock', () => {
    env.engine.playSfx('click');
    env.engine.setVolumes(DEFAULT_VOLUMES);
    expect(env.created()).toBe(0);
    expect(env.engine.context).toBeNull();
  });

  it('creates exactly one context and graph, and resumes it', () => {
    env.engine.unlock();
    env.engine.unlock();
    expect(env.created()).toBe(1);
    expect(env.ctx.state).toBe('running');
    expect(env.ctx.nodes('compressor')).toHaveLength(1);
    expect(env.ctx.nodes('convolver')).toHaveLength(1);
    expect(env.engine.isUnlocked).toBe(true);
  });

  it('stays silent forever when Web Audio is unavailable', () => {
    const e = setup({ supported: false });
    e.engine.unlock();
    e.engine.unlock();
    e.engine.playSfx('click');
    e.engine.playBgm('title');
    expect(e.created()).toBe(1);
    expect(e.engine.context).toBeNull();
  });

  it('applies volumes (and mute) to the master bus with a short ramp', () => {
    env.engine.unlock();
    const master = masterGain(env.ctx);
    expect(lastValue(master)).toBeCloseTo(DEFAULT_VOLUMES.master);
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    const ramp = master.gain.events[master.gain.events.length - 1];
    expect(ramp).toMatchObject({ type: 'linear', value: 0 });
    expect(ramp.time).toBeGreaterThan(env.ctx.currentTime);
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, master: 5 });
    expect(lastValue(master)).toBe(1);
  });

  it('remembers volumes set before unlock', () => {
    env.engine.setVolumes({ master: 0.3, bgm: 0.2, sfx: 0.1, voice: 1, muted: false });
    env.engine.unlock();
    expect(lastValue(masterGain(env.ctx))).toBeCloseTo(0.3);
  });
});

describe('AudioEngine — sfx', () => {
  it('plays effects once unlocked', () => {
    env.engine.unlock();
    const before = env.ctx.created.length;
    env.engine.playSfx('confirm');
    expect(env.ctx.created.length).toBeGreaterThan(before);
  });

  it('rate-limits the typewriter blip to one per 35 ms', () => {
    env.engine.unlock();
    const count = () => env.ctx.nodes<FakeOscillatorNode>('oscillator').length;
    env.engine.playSfx('blip');
    const one = count();
    env.engine.playSfx('blip');
    env.ctx.currentTime += 0.02;
    env.engine.playSfx('blip');
    expect(count()).toBe(one);
    env.ctx.currentTime += 0.02;
    env.engine.playSfx('blip');
    expect(count()).toBe(one * 2);
  });

  it('skips effects entirely when muted or at zero volume', () => {
    env.engine.unlock();
    const before = env.ctx.created.length;
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    env.engine.playSfx('confirm');
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, sfx: 0 });
    env.engine.playSfx('confirm');
    expect(env.ctx.created.length).toBe(before);
  });

  it('does not queue sounds while the page is hidden', () => {
    env.engine.unlock();
    env.doc.setHidden(true);
    expect(env.ctx.state).toBe('suspended');
    const before = env.ctx.created.length;
    env.engine.playSfx('notify');
    expect(env.ctx.created.length).toBe(before);
  });

  it('lets the unlocking gesture play its click while the context is still starting', () => {
    env.ctx.allowResume = false;
    env.engine.unlock();
    expect(env.ctx.state).toBe('suspended');
    const before = env.ctx.created.length;
    env.engine.playSfx('click');
    expect(env.ctx.created.length).toBeGreaterThan(before);
    env.timers.advance(5000);
    const later = env.ctx.created.length;
    env.engine.playSfx('click');
    expect(env.ctx.created.length).toBe(later);
  });
});

describe('AudioEngine — bgm', () => {
  const oscillators = () => env.ctx.nodes<FakeOscillatorNode>('oscillator').length;

  it('starts a track requested before unlock once audio is unlocked', () => {
    env.engine.playBgm('title');
    expect(env.engine.currentBgm).toBe('title');
    env.engine.unlock();
    env.timers.advance(2000, env.ctx);
    expect(oscillators()).toBeGreaterThan(10);
  });

  it('keeps scheduling steadily without duplicates or gaps', () => {
    env.engine.unlock();
    env.engine.playBgm('ending_good');
    env.timers.advance(20_000, env.ctx);
    const starts = env.ctx
      .nodes<FakeOscillatorNode>('oscillator')
      .map((o) => o.startTime!)
      .filter((t) => t > 0);
    // Rolling harp (16ths at 96 bpm) → a note at least every ~0.16 s once the loop is going.
    const sorted = [...new Set(starts.map((t) => Math.round(t * 100)))].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
    expect(Math.max(...gaps.slice(5))).toBeLessThan(40);
    for (const t of starts) expect(t).toBeGreaterThanOrEqual(0);
  });

  it('crossfades between tracks and cleans up the old one', () => {
    env.engine.unlock();
    env.engine.playBgm('title');
    env.timers.advance(3000, env.ctx);
    const busesBefore = env.ctx.nodes<FakeGainNode>('gain').filter((g) => !g.disconnected).length;
    env.engine.playBgm('interview');
    env.timers.advance(500, env.ctx);
    // Both players alive during the fade.
    const liveDuringFade = env.ctx.nodes<FakeGainNode>('gain').filter((g) => !g.disconnected).length;
    expect(liveDuringFade).toBeGreaterThan(busesBefore);
    env.timers.advance((CROSSFADE_SEC + 4) * 1000, env.ctx);
    // The title bus is disconnected after its fade + tail.
    const disconnected = env.ctx.nodes<FakeGainNode>('gain').filter((g) => g.disconnected);
    expect(disconnected.length).toBeGreaterThan(0);
  });

  it('treats the same track as a no-op and null as stop', () => {
    env.engine.unlock();
    env.engine.playBgm('tense');
    env.timers.advance(1000, env.ctx);
    const n = env.ctx.created.length;
    env.engine.playBgm('tense');
    expect(env.ctx.created.length).toBe(n);
    env.engine.playBgm(null);
    expect(env.engine.currentBgm).toBeNull();
    env.timers.advance((CROSSFADE_SEC + 5) * 1000, env.ctx);
    const after = oscillators();
    env.timers.advance(5000, env.ctx);
    expect(oscillators()).toBe(after);
    expect(env.timers.pending).toBe(0);
  });

  it('stops synthesizing music while muted and resumes when unmuted', () => {
    env.engine.unlock();
    env.engine.playBgm('interview');
    env.timers.advance(2000, env.ctx);
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    const n = oscillators();
    env.timers.advance(10_000, env.ctx);
    expect(oscillators()).toBe(n);
    expect(env.timers.pending).toBe(0);
    expect(env.engine.currentBgm).toBe('interview');
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: false });
    env.timers.advance(2000, env.ctx);
    expect(oscillators()).toBeGreaterThan(n);
    // It continues at the current song position: every new note starts in the future, no burst of stale ones.
    const late = env.ctx.nodes<FakeOscillatorNode>('oscillator').slice(n);
    for (const o of late) expect(o.startTime!).toBeGreaterThanOrEqual(12 - 0.01);
  });

  it('does not schedule music at zero BGM or master volume', () => {
    env.engine.unlock();
    env.engine.playBgm('title');
    env.timers.advance(1000, env.ctx);
    for (const volumes of [{ ...DEFAULT_VOLUMES, bgm: 0 }, { ...DEFAULT_VOLUMES, master: 0 }]) {
      env.engine.setVolumes(volumes);
      const n = oscillators();
      env.timers.advance(5000, env.ctx);
      expect(oscillators()).toBe(n);
      expect(env.timers.pending).toBe(0);
      env.engine.setVolumes(DEFAULT_VOLUMES);
      env.timers.advance(1000, env.ctx);
      expect(oscillators()).toBeGreaterThan(n);
    }
  });

  it('never starts music that is unlocked, re-shown or re-started while muted', async () => {
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    env.engine.playBgm('title');
    env.engine.unlock();
    env.timers.advance(3000, env.ctx);
    expect(oscillators()).toBe(0);
    env.doc.setHidden(true);
    env.doc.setHidden(false);
    await env.flush();
    env.timers.advance(3000, env.ctx);
    expect(oscillators()).toBe(0);
    env.engine.playBgm('tense');
    env.timers.advance(3000, env.ctx);
    expect(oscillators()).toBe(0);
    expect(env.timers.pending).toBe(0);
    env.engine.setVolumes(DEFAULT_VOLUMES);
    env.timers.advance(2000, env.ctx);
    expect(oscillators()).toBeGreaterThan(10);
    expect(env.engine.currentBgm).toBe('tense');
  });

  it('cleans up faded-out tracks while muted (no players pile up when tracks change)', () => {
    env.engine.unlock();
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    env.engine.playBgm('title');
    env.timers.advance(1000, env.ctx);
    env.engine.playBgm('interview');
    env.timers.advance((CROSSFADE_SEC + 5) * 1000, env.ctx);
    expect(env.ctx.nodes<FakeGainNode>('gain').filter((g) => g.disconnected)).toHaveLength(0);
    env.engine.playBgm('tense'); // the title player's fade-out is long over: disposed now
    expect(env.ctx.nodes<FakeGainNode>('gain').filter((g) => g.disconnected).length).toBeGreaterThan(0);
    expect(env.timers.pending).toBe(0);
    expect(oscillators()).toBe(0);
  });

  it('stays paused when unmuted while the page is hidden, and resumes when shown', async () => {
    env.engine.unlock();
    env.engine.playBgm('interview');
    env.timers.advance(1000, env.ctx);
    env.engine.setVolumes({ ...DEFAULT_VOLUMES, muted: true });
    env.doc.setHidden(true);
    env.engine.setVolumes(DEFAULT_VOLUMES);
    const n = oscillators();
    env.timers.advance(5000, env.ctx);
    expect(oscillators()).toBe(n);
    env.doc.setHidden(false);
    await env.flush();
    env.timers.advance(2000, env.ctx);
    expect(oscillators()).toBeGreaterThan(n);
  });

  it('pauses scheduling while hidden and resumes afterwards', async () => {
    env.engine.unlock();
    env.engine.playBgm('interview');
    env.timers.advance(2000, env.ctx);
    env.doc.setHidden(true);
    expect(env.ctx.suspendCalls).toBe(1);
    const n = oscillators();
    env.timers.advance(10_000, env.ctx);
    expect(oscillators()).toBe(n);
    expect(env.timers.pending).toBe(0);
    env.doc.setHidden(false);
    await env.flush();
    env.timers.advance(3000, env.ctx);
    expect(oscillators()).toBeGreaterThan(n);
  });
});
