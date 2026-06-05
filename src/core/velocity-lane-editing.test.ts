// src/core/velocity-lane-editing.test.ts
import { describe, it, expect } from 'vitest';
import type { NoteEvent } from './notes';
import { yToVelocity, velocityToBarHeight, barHitTest, setVelocity, applyGroupDelta, paintVelocity, FAN_PX } from './velocity-lane-editing';

const n = (start: number, velocity: number, midi = 60): NoteEvent => ({ start, duration: 24, midi, velocity });

describe('velocity-lane-editing', () => {
  it('yToVelocity: top of lane = 127, bottom = 1', () => {
    expect(yToVelocity(0, 100)).toBe(127);
    expect(yToVelocity(100, 100)).toBe(1);
    expect(yToVelocity(50, 100)).toBe(64); // mid ≈ 64
  });

  it('velocityToBarHeight is proportional', () => {
    expect(velocityToBarHeight(127, 100)).toBe(100);
    expect(velocityToBarHeight(64, 100)).toBeCloseTo(50, 0);
  });

  it('barHitTest finds the bar whose x is nearest the pointer', () => {
    const notes = [n(0, 80), n(96, 100)];
    const xForTick = (t: number) => t * 2; // 2px/tick
    const hit = barHitTest(notes, 96 * 2 + 1, xForTick);
    expect(hit).toBe(notes[1]);
  });

  it('barHitTest fans a chord so each note is individually grabbable', () => {
    const a = n(0, 80, 60), b = n(0, 100, 64); // same start (chord)
    const xForTick = (t: number) => t * 2;
    expect(barHitTest([a, b], 0, xForTick)).toBe(a);
    expect(barHitTest([a, b], FAN_PX, xForTick)).toBe(b);
  });

  it('setVelocity clamps to 1..127', () => {
    const note = n(0, 80);
    setVelocity(note, 200); expect(note.velocity).toBe(127);
    setVelocity(note, -5);  expect(note.velocity).toBe(1);
  });

  it('applyGroupDelta shifts all selected, each clamped', () => {
    const a = n(0, 80), b = n(24, 120);
    applyGroupDelta([a, b], 20);
    expect(a.velocity).toBe(100);
    expect(b.velocity).toBe(127); // clamped
  });

  it('paintVelocity sets every note whose start is in [t0,t1]', () => {
    const a = n(0, 80), b = n(48, 80), c = n(200, 80);
    paintVelocity([a, b, c], 0, 60, 30);
    expect(a.velocity).toBe(30);
    expect(b.velocity).toBe(30);
    expect(c.velocity).toBe(80); // outside range, untouched
  });
});
