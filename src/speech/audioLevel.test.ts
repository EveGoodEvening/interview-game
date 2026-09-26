import { describe, expect, it } from 'vitest';
import { LevelSmoother, MIC_LEVEL_OPTIONS, rmsOfByteSamples, TTS_LEVEL_OPTIONS } from './audioLevel';
import { syntheticMouthTarget } from './tts/lipSync';

describe('rmsOfByteSamples', () => {
  it('is 0 for silence and ~0.707 for a full-scale square-ish wave', () => {
    expect(rmsOfByteSamples(new Uint8Array(64).fill(128))).toBe(0);
    const wave = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255));
    expect(rmsOfByteSamples(wave)).toBeGreaterThan(0.95);
    expect(rmsOfByteSamples(new Uint8Array(0))).toBe(0);
  });
});

describe('LevelSmoother', () => {
  it('maps silence to 0 and speech to a high level, with attack/release smoothing', () => {
    const s = new LevelSmoother(TTS_LEVEL_OPTIONS);
    expect(s.next(0)).toBe(0);
    let level = 0;
    for (let i = 0; i < 10; i++) level = s.next(0.25);
    expect(level).toBeGreaterThan(0.9);
    const afterOneQuietFrame = s.next(0);
    expect(afterOneQuietFrame).toBeLessThan(level);
    expect(afterOneQuietFrame).toBeGreaterThan(0.5);
    for (let i = 0; i < 60; i++) level = s.next(0);
    expect(level).toBe(0);
  });

  it('normalises against the recent peak so quiet voices still move the meter', () => {
    const s = new LevelSmoother(MIC_LEVEL_OPTIONS);
    let level = 0;
    for (let i = 0; i < 20; i++) level = s.next(0.05);
    expect(level).toBeGreaterThan(0.6);
    expect(level).toBeLessThanOrEqual(1);
  });

  it('ignores NaN input', () => {
    const s = new LevelSmoother();
    expect(s.next(Number.NaN)).toBe(0);
  });
});

describe('syntheticMouthTarget', () => {
  it('stays within 0–1 and varies over time', () => {
    const values = Array.from({ length: 200 }, (_, i) => syntheticMouthTarget(i / 60, 0));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.4);
    expect(syntheticMouthTarget(0.3, 1)).toBeGreaterThan(syntheticMouthTarget(0.3, 0));
  });
});
