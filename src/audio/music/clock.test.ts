import { describe, expect, it } from 'vitest';
import { collectDueSteps, createRng, LOOKAHEAD_SEC, MAX_STEPS_PER_TICK, stepDuration, swingOffset } from './clock';

describe('clock math', () => {
  it('computes step durations and swing', () => {
    expect(stepDuration(120, 4)).toBeCloseTo(0.125);
    expect(stepDuration(60, 2)).toBeCloseTo(0.5);
    expect(swingOffset(0, 0.1, 0.25)).toBe(0);
    expect(swingOffset(1, 0.1, 0.25)).toBeCloseTo(0.025);
  });

  it('collects exactly the steps inside the look-ahead window', () => {
    const dur = 0.1;
    const { due, next } = collectDueSteps({ step: 0, time: 1 }, 1, dur, 0, 0.25);
    expect(due.map((d) => d.step)).toEqual([0, 1, 2]);
    expect(due.map((d) => d.time)).toEqual([1, 1.1, expect.closeTo(1.2, 9)]);
    expect(next.step).toBe(3);
    expect(next.time).toBeCloseTo(1.3);
    // Next tick continues where the last one stopped, with no duplicates.
    const second = collectDueSteps(next, 1.06, dur, 0, 0.25);
    expect(second.due.map((d) => d.step)).toEqual([3]);
  });

  it('applies swing to odd steps only', () => {
    const { due } = collectDueSteps({ step: 0, time: 0 }, 0, 0.1, 0.2, 0.35);
    expect(due.map((d) => Number(d.time.toFixed(3)))).toEqual([0, 0.12, 0.2, 0.32]);
  });

  it('skips ahead on the grid after a stall instead of bursting late notes', () => {
    const { due, next } = collectDueSteps({ step: 10, time: 1 }, 5, 0.1, 0, 0.25);
    expect(due[0].time).toBeGreaterThanOrEqual(5);
    expect(due[0].step).toBe(10 + Math.round((due[0].time - 1) / 0.1));
    expect(due.length).toBeLessThanOrEqual(3);
    expect(next.time).toBeGreaterThanOrEqual(5.25);
  });

  it('caps the number of steps per tick', () => {
    const { due } = collectDueSteps({ step: 0, time: 0 }, 0, 0.001, 0, LOOKAHEAD_SEC);
    expect(due).toHaveLength(MAX_STEPS_PER_TICK);
  });

  it('has a deterministic PRNG in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(values.reduce((s, v) => s + v, 0) / values.length).toBeCloseTo(0.5, 1);
  });
});
