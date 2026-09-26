import { describe, expect, it } from 'vitest';
import { renderSfx } from './sfx';
import { FakeAudioContext, FakeAudioParam, FakeGainNode, FakeScheduledSource } from './testing/fakeAudioContext';
import { SFX_NAMES } from './types';

function render(name: (typeof SFX_NAMES)[number]) {
  const ctx = new FakeAudioContext();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const t = 1;
  const base = ctx as unknown as BaseAudioContext;
  renderSfx(name, { ctx: base, dry: dry as unknown as AudioNode, wet: wet as unknown as AudioNode }, t);
  return { ctx, dry, wet, t };
}

describe('renderSfx', () => {
  it.each(SFX_NAMES)('"%s" builds a valid, short, bounded voice graph', (name) => {
    const { ctx, dry, t } = render(name);
    const sources = ctx.created.filter((n): n is FakeScheduledSource => n instanceof FakeScheduledSource);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src.startTime).not.toBeNull();
      expect(src.startTime!).toBeGreaterThanOrEqual(t);
      expect(src.stopTime).not.toBeNull();
      expect(src.stopTime!).toBeGreaterThan(src.startTime!);
      // Every effect is over within 4 s (the chapter bell is the longest).
      expect(src.stopTime! - t).toBeLessThan(4);
    }
    // Each voice frees its nodes when it ends.
    expect(sources.some((src) => typeof src.onended === 'function')).toBe(true);
    // Something reaches the dry bus.
    expect(ctx.created.some((n) => n.outputs.includes(dry))).toBe(true);
    // No single amplitude envelope asks for more than 0.7 of full scale (static unity buses and
    // modulation depths — gains feeding an AudioParam — excluded).
    const envelopes = ctx.created.filter(
      (n): n is FakeGainNode =>
        n instanceof FakeGainNode && n.gain.events.length > 0 && !n.outputs.some((o) => o instanceof FakeAudioParam),
    );
    expect(envelopes.length).toBeGreaterThan(0);
    for (const g of envelopes) expect(g.gain.maxScheduled).toBeLessThanOrEqual(0.7);
  });

  it('keeps UI ticks quiet and short', () => {
    for (const name of ['blip', 'hover'] as const) {
      const { ctx } = render(name);
      const peaks = ctx.created
        .filter((n): n is FakeGainNode => n instanceof FakeGainNode && n.gain.events.length > 0)
        .map((g) => g.gain.maxScheduled);
      expect(Math.max(...peaks)).toBeLessThanOrEqual(0.06);
      const src = ctx.created.find((n): n is FakeScheduledSource => n instanceof FakeScheduledSource)!;
      expect(src.stopTime! - src.startTime!).toBeLessThan(0.15);
    }
  });

  it('sends reverb only for effects that want it', () => {
    expect(render('blip').ctx.created.some((n) => n.outputs.includes(render('blip').wet))).toBe(false);
    const chapter = render('chapter');
    expect(chapter.ctx.created.some((n) => n.outputs.includes(chapter.wet))).toBe(true);
  });

  it('frees nodes when the voice ends', () => {
    const { ctx } = render('confirm');
    const osc = ctx.created.find((n): n is FakeScheduledSource => n instanceof FakeScheduledSource)!;
    osc.onended?.();
    expect(osc.disconnected).toBe(true);
  });

  it('uses distinct sounds for each effect', () => {
    const fingerprints = SFX_NAMES.map((name) => {
      const { ctx } = render(name);
      const freqs = ctx.created
        .map((n) => (n as unknown as { frequency?: FakeAudioParam }).frequency)
        .filter((p): p is FakeAudioParam => p instanceof FakeAudioParam)
        .map((p) => Math.round(p.events[0]?.value ?? p.value));
      return `${ctx.created.length}:${freqs.join(',')}`;
    });
    expect(new Set(fingerprints).size).toBe(SFX_NAMES.length);
  });
});
