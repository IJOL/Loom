// src/core/velocity-lane-editing.ts
// Pure logic for the Ableton-style velocity lane: y↔velocity, bar geometry,
// chord-fanned hit-testing, and the three edit ops (set / group-delta / paint).
// The canvas editors own only pointer wiring, drawing and undo gestures.
import type { NoteEvent } from './notes';

export const FAN_PX = 4; // horizontal offset between stacked bars of a chord

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

/** Lane y (0 = top) → velocity 1..127, given the lane's pixel height. */
export function yToVelocity(y: number, laneHeight: number): number {
  const t = 1 - Math.max(0, Math.min(laneHeight, y)) / laneHeight;
  return clampVel(1 + t * 126);
}

/** Velocity → bar height in px (proportional to laneHeight). */
export function velocityToBarHeight(velocity: number, laneHeight: number): number {
  return (Math.max(0, Math.min(127, velocity)) / 127) * laneHeight;
}

/** Notes sharing a start tick are fanned by FAN_PX so each bar is grabbable.
 *  Returns the note whose (possibly fanned) bar x is nearest the pointer x.
 *  `maxDist` bounds the grab radius (px): a pointer farther than that from every
 *  bar returns null, so clicking empty lane space does not grab a distant note.
 *  Default Infinity preserves the unbounded "nearest" behaviour. */
export function barHitTest(
  notes: NoteEvent[], pointerX: number, xForTick: (t: number) => number,
  maxDist = Infinity,
): NoteEvent | null {
  const byTick = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const arr = byTick.get(note.start) ?? [];
    arr.push(note); byTick.set(note.start, arr);
  }
  let best: NoteEvent | null = null, bestDist = Infinity;
  for (const [tick, group] of byTick) {
    const baseX = xForTick(tick);
    group.forEach((note, i) => {
      const d = Math.abs(pointerX - (baseX + i * FAN_PX));
      if (d < bestDist) { bestDist = d; best = note; }
    });
  }
  return bestDist <= maxDist ? best : null;
}

export function setVelocity(note: NoteEvent, velocity: number): void {
  note.velocity = clampVel(velocity);
}

export function applyGroupDelta(notes: NoteEvent[], delta: number): void {
  for (const note of notes) note.velocity = clampVel(note.velocity + delta);
}

/** Paint a single velocity onto every note whose start falls in [t0, t1]. */
export function paintVelocity(notes: NoteEvent[], t0: number, t1: number, velocity: number): void {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  for (const note of notes) if (note.start >= lo && note.start <= hi) note.velocity = clampVel(velocity);
}
