import { describe, expect, it } from 'vitest';
import { initialOpticsState, isOpticsSolved, mirrorEndpoints, opticsBoard, opticsReducer, reflectRay, sanitizeOpticsState, traceOptics } from '../src/features/world/optics-model';
import type { OpticsState } from '../src/features/world/optics-model';

describe('light reflection geometry', () => {
  it('reflects horizontal light vertically from a diagonal mirror', () => {
    const reflected = reflectRay({ x: 1, y: 0 }, -45);
    expect(reflected.x).toBeCloseTo(0, 8);
    expect(reflected.y).toBeCloseTo(-1, 8);
    const next = reflectRay(reflected, -45);
    expect(next.x).toBeCloseTo(1, 8);
    expect(next.y).toBeCloseTo(0, 8);
  });

  it('preserves unit ray length, obeys reflection symmetry, and doubles mirror rotation', () => {
    for (const degrees of [-80, -45, -22.5, 0, 17.5, 45, 80]) {
      const first = reflectRay({ x: 1, y: 0 }, degrees);
      expect(Math.hypot(first.x, first.y)).toBeCloseTo(1, 8);
      const reverse = reflectRay(first, degrees);
      expect(reverse.x).toBeCloseTo(1, 8);
      expect(reverse.y).toBeCloseTo(0, 8);
    }
    const before = reflectRay({ x: 1, y: 0 }, -45);
    const after = reflectRay({ x: 1, y: 0 }, -35);
    const turn = Math.atan2(after.y, after.x) - Math.atan2(before.y, before.x);
    expect(turn * 180 / Math.PI).toBeCloseTo(20, 8);
    expect(reflectRay({ x: 0, y: 0 }, 45)).toEqual({ x: 0, y: 0 });
  });

  it('traces actual finite mirror intersections and misses the target when misaligned', () => {
    expect(isOpticsSolved({ ...initialOpticsState })).toBe(false);
    const correct = traceOptics({ ...initialOpticsState, mirrorA: -45 });
    expect(correct.reachedReceiver).toBe(true);
    expect(correct.segments).toHaveLength(2);
    expect(correct.reflections[0].point.x).toBeCloseTo(opticsBoard.mirrorA.x, 8);
    expect(correct.reflections[0].incidence).toBeCloseTo(45, 8);
    expect(correct.reflections[0].reflection).toBeCloseTo(45, 8);
    const wrongSecond: OpticsState = { ...initialOpticsState, stage: 2, mirrorA: -45, mirrorB: 15 };
    expect(traceOptics(wrongSecond).reflections).toHaveLength(2);
    expect(isOpticsSolved(wrongSecond)).toBe(false);
    const correctSecond = traceOptics({ ...wrongSecond, mirrorB: -45 });
    expect(correctSecond.reachedReceiver).toBe(true);
    expect(correctSecond.segments).toHaveLength(3);
    expect(correctSecond.reflections.map((item) => item.mirrorId)).toEqual(['A', 'B']);
    expect(traceOptics({ ...wrongSecond, mirrorA: -25, mirrorB: -45 }).reflections).toHaveLength(1);
    const endpoints = mirrorEndpoints(opticsBoard.mirrorA, -45);
    expect(Math.hypot(endpoints[1].x - endpoints[0].x, endpoints[1].y - endpoints[0].y)).toBeCloseTo(78, 8);
  });
});

describe('shared lesson progress', () => {
  it('requires the ray to reach the receiver before advancing and rejects skipped stages', () => {
    expect(opticsReducer(initialOpticsState, { stage: 1 }).stage).toBe(0);
    expect(opticsReducer(initialOpticsState, { stage: 3, mirrorA: -45 }).stage).toBe(0);
    const first = opticsReducer(initialOpticsState, { mirrorA: -45, stage: 1 });
    expect(first.stage).toBe(1);
    expect(opticsReducer(first, { stage: 2 }).stage).toBe(1);
    expect(opticsReducer(first, { prediction: 'double', stage: 2 }).stage).toBe(1);
    expect(opticsReducer(first, { prediction: 'equal', mirrorA: -10, stage: 2 }).stage).toBe(1);
    const second = opticsReducer(first, { prediction: 'equal', stage: 2 });
    expect(second).toEqual({ stage: 2, mirrorA: -25, mirrorB: 15, prediction: 'equal' });
    expect(opticsReducer(second, { stage: 3 }).stage).toBe(2);
    const completed = opticsReducer(second, { mirrorA: -45, mirrorB: -45, stage: 3 });
    expect(completed.stage).toBe(3);
    expect(isOpticsSolved(completed)).toBe(true);
  });

  it('preserves simultaneous participant patches and only restarts a completed lesson', () => {
    const second: OpticsState = { ...initialOpticsState, stage: 2, prediction: 'equal' };
    const alice = opticsReducer(second, { mirrorA: -45 });
    const bob = opticsReducer(alice, { mirrorB: -45 });
    expect(isOpticsSolved(bob)).toBe(true);
    expect(opticsReducer(bob, { stage: 0 }).stage).toBe(2);
    const completed = opticsReducer(bob, { stage: 3 });
    expect(opticsReducer(completed, { mirrorA: 0 })).toEqual(completed);
    expect(opticsReducer(completed, { stage: 0 })).toEqual(initialOpticsState);
    expect(initialOpticsState.mirrorA).toBe(-15);
  });

  it('constrains malformed values, bounds, increments and unknown prediction choices', () => {
    expect(sanitizeOpticsState(null)).toEqual(initialOpticsState);
    expect(sanitizeOpticsState({ stage: -1, mirrorA: NaN, mirrorB: Infinity, prediction: 'made-up' })).toEqual(initialOpticsState);
    expect(sanitizeOpticsState({ stage: 2.5, mirrorA: -200, mirrorB: 180, prediction: 'equal' })).toEqual({ stage: 0, mirrorA: -80, mirrorB: 80, prediction: 'equal' });
    expect(opticsReducer(initialOpticsState, { mirrorA: -44.8, mirrorB: 10.26 })).toMatchObject({ mirrorA: -45, mirrorB: 10.5 });
    expect(opticsReducer(initialOpticsState, { mirrorA: '-45', prediction: 'invalid', stage: '1' })).toEqual(initialOpticsState);
    expect(opticsReducer(initialOpticsState, null)).toEqual(initialOpticsState);
    expect(opticsReducer(initialOpticsState, [])).toEqual(initialOpticsState);
    expect(traceOptics(sanitizeOpticsState({ mirrorA: Infinity })).segments.length).toBeGreaterThan(0);
  });
});
