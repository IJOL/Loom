// Objective audio test for the LFO TRIG (free/note) setting, end to end:
// ModulatorState  →  toModLite (the UI→wire serialisation)  →  VoiceManager
// →  tb303 renderer  →  rendered samples.
//
// The runtime is already unit-tested in isolation (modulation-trigger-scope);
// what was never covered is whether the WHOLE live path actually makes TRIG
// audible. This renders real audio and asks one question: does flipping TRIG
// from 'free' to 'note' change the sound of a note that lands mid-cycle?
//
// Setup: a square LFO on filter.cutoff at 3 Hz (period 1/3 s). A second note is
// placed at t = 0.25 s, i.e. phase 0.75 of a free-running LFO — the negative
// half of the square, so the cutoff there is LOW. With TRIG=note the LFO
// restarts at that note-on (phase 0 → positive half → cutoff HIGH). So the two
// renders MUST differ across the second note. If they are identical, TRIG is
// inert on the live path — the bug.

import { describe, it, expect } from 'vitest';
import { renderKernelLane, type KernelLaneSpec } from '../export/kernel-lane-render';
import { toModLite } from '../engines/worklet-lane-engine';
import { makeDefaultLFO } from '../modulation/types';
import type { NoteSpec } from './types';

const SR = 44100;

function note(beginSec: number, durationSec: number, midi: number): NoteSpec {
  return { midi, beginSec, durationSec, velocity: 0.8, accent: false, slide: false };
}

/** L2 distance between two buffers over the frame window [a, b). */
function l2(x: Float32Array, y: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) { const d = x[i] - y[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Render the TB-303 lane with a square LFO on cutoff using the given TRIG. The
 *  ModulatorState goes through the real toModLite, so the test exercises the
 *  same serialisation the worklet uses live. */
function renderWithTrig(trig: 'free' | 'note', frames: number): Float32Array {
  const mod = makeDefaultLFO('l1');
  mod.waveform = 'square';
  mod.rateHz = 3;
  mod.trigger = trig;
  mod.scope = 'shared';
  mod.connections = [{ id: 'c1', paramId: 'bass.filter.cutoff', depth: 0.5 }];

  // TB-303 reads mo['filter.cutoff']; map the connection paramId straight to it
  // so the depth reaches the renderer regardless of the dot-id mapper's details.
  const mods = toModLite([mod], 120, () => 'filter.cutoff');

  const spec: KernelLaneSpec = {
    engineId: 'tb303',
    params: { 'filter.cutoff': 0.3, 'filter.resonance': 0.5, 'env.amount': 0.5, 'env.decay': 0.4 },
    maxVoices: 1,
    mods,
    notes: [
      { note: note(0, 0.2, 40) },
      { note: note(0.25, 0.2, 40) },   // lands at free-phase 0.75 (square = low)
    ],
  };
  return renderKernelLane(spec, frames, SR);
}

describe('LFO TRIG is audible end to end (toModLite → VoiceManager → tb303)', () => {
  const frames = Math.ceil(0.5 * SR);
  const note2 = [Math.floor(0.25 * SR), Math.floor(0.45 * SR)] as const;

  it('is deterministic: two identical renders are bit-identical (control)', () => {
    const a = renderWithTrig('free', frames);
    const b = renderWithTrig('free', frames);
    expect(l2(a, b, note2[0], note2[1])).toBe(0);
  });

  it('flipping TRIG free→note changes the second note (the LFO actually retriggers)', () => {
    const free = renderWithTrig('free', frames);
    const noteT = renderWithTrig('note', frames);

    const diff = l2(free, noteT, note2[0], note2[1]);
    const freeEnergy = l2(free, new Float32Array(frames), note2[0], note2[1]);

    // The retriggered render must differ audibly from the free one — not a
    // rounding wobble. Require the difference to be a real fraction of the
    // signal's own magnitude in that window.
    expect(diff).toBeGreaterThan(freeEnergy * 0.1);
  });
});
