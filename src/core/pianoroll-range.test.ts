import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pianoRollRange, EDITOR_MIN_MIDI, EDITOR_MAX_MIDI } from './pianoroll-range';
import type { SessionState } from '../session/session';

// Real demo content drives the test: Cordillera's upright-bass lane plays E1
// (MIDI 28) and G1 (31), below the legacy editor floor (36 = C2) — so those
// notes were invisible and uneditable. The editor range must cover every note
// a clip already contains.
const demo = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'public/demos/cordillera.json'), 'utf8'),
) as SessionState;
const melodicLanes = demo.lanes.filter((l) => l.engineId !== 'drums-machine');

describe('pianoRollRange — every clip note must be visible in the editor', () => {
  it('the Cordillera demo contains notes below the legacy C2 editor floor (the bug)', () => {
    const notes = melodicLanes.flatMap((l) => l.clips.filter(Boolean).flatMap((c) => c!.notes));
    expect(notes.some((n) => n.midi < 36)).toBe(true);
  });

  it('every note of every Cordillera melodic clip falls within its editor range', () => {
    for (const lane of melodicLanes) {
      for (const clip of lane.clips) {
        if (!clip) continue;
        const { minMidi, maxMidi } = pianoRollRange(clip.notes);
        for (const n of clip.notes) {
          expect(n.midi, `${lane.id} midi ${n.midi} < min ${minMidi}`).toBeGreaterThanOrEqual(minMidi);
          expect(n.midi, `${lane.id} midi ${n.midi} > max ${maxMidi}`).toBeLessThanOrEqual(maxMidi);
        }
      }
    }
  });

  it('defaults to the full orchestral range from C0 (MIDI 12) to C8 (MIDI 108)', () => {
    expect(pianoRollRange([])).toEqual({ minMidi: EDITOR_MIN_MIDI, maxMidi: EDITOR_MAX_MIDI });
    expect(EDITOR_MIN_MIDI).toBe(12);
    expect(EDITOR_MAX_MIDI).toBe(108);
  });

  it('widens to include any clip note already outside the orchestral range', () => {
    const r = pianoRollRange([
      { start: 0, duration: 1, midi: 4, velocity: 80 },
      { start: 0, duration: 1, midi: 120, velocity: 80 },
    ]);
    expect(r.minMidi).toBeLessThanOrEqual(4);
    expect(r.maxMidi).toBeGreaterThanOrEqual(120);
  });
});
