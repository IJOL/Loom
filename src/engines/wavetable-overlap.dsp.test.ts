// src/engines/wavetable-overlap.dsp.test.ts
// Layer-3 real-DSP repro of the "mono duro" choppiness reported on the
// Wavetable engine: overlapping notes cut each other off as if the engine
// were monophonic.
//
// Root cause this pins down: in BOUND mode (a lane is active) the Wavetable
// voice leaves its internal envAmp at 0 and delegates its ENTIRE amp envelope
// to the per-voice modulator ADSR (default modHost routes adsr1 -> amp.gain).
// That envelope reaches the voice through a ConnectionBinder, but the lane
// keeps only ONE per-voice binding: bindVoiceModulators() disposes the
// previous voice's binder on every createVoice. So starting note N+1 severs
// note N's amp drive and note N drops to silence — overlapping notes behave
// monophonically.
//
// FM / Karplus don't show this because they carry their amp in an internal
// per-voice envelope (op envelopes / envAmp); the modulator ADSR only sums on
// top. This test asserts the behaviour we WANT (genuine polyphony) and fails
// until the Wavetable voice owns its own amp envelope too.

import { describe, it, expect, afterEach } from 'vitest';
import '../../test/setup';
import { WavetableEngine } from './wavetable';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { _resetLaneBindingsForTesting } from '../modulation/voice-mod-binding';
import { rms } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

const SR = 44100;
const DUR = 1.1;

interface NoteSpec { midi: number; start: number; gate: number }

/** Render the given notes through a fresh Wavetable engine in BOUND mode
 *  (a lane is active, so the per-voice modulator binding path runs — the path
 *  that exhibits the bug). One voice is allocated per note, mirroring the live
 *  trigger-dispatch flow. */
async function renderBound(notes: NoteSpec[], laneId: string): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(DUR * SR), SR);
  const engine = new WavetableEngine();
  const out = (ctx as unknown as { createGain(): GainNode }).createGain();
  out.connect(ctx.destination);
  setCurrentLaneForVoice(laneId);
  for (const n of notes) {
    const voice = engine.createVoice(ctx as unknown as AudioContext, out);
    voice.trigger(n.midi, n.start, { gateDuration: n.gate });
  }
  setCurrentLaneForVoice(null);
  const buf = await ctx.startRendering();
  _resetLaneBindingsForTesting();
  return new Float32Array(buf.getChannelData(0));
}

function rmsWindow(buf: Float32Array, t0: number, t1: number): number {
  return rms(buf.subarray(Math.round(t0 * SR), Math.round(t1 * SR)));
}

describe('wavetable — overlapping notes stay polyphonic (no mono-cut)', () => {
  afterEach(() => {
    _resetLaneBindingsForTesting();
    setCurrentLaneForVoice(null);
  });

  it('two overlapping notes carry more energy than either note alone in the overlap window', async () => {
    // Low, sustained notes (the "bajos" the report points at). Both reach their
    // sustain plateau and overlap across [0.65, 0.95]s.
    const A: NoteSpec = { midi: 43, start: 0.0, gate: 1.0 }; // G2
    const B: NoteSpec = { midi: 50, start: 0.3, gate: 1.0 }; // D3

    const both  = await renderBound([A, B], 'wt-overlap-both');
    const onlyA = await renderBound([A],    'wt-overlap-a');
    const onlyB = await renderBound([B],    'wt-overlap-b');

    writeWav(both,  wavPath('wavetable__overlap-both'), SR);
    writeWav(onlyA, wavPath('wavetable__overlap-a'),    SR);
    writeWav(onlyB, wavPath('wavetable__overlap-b'),    SR);

    const W0 = 0.65, W1 = 0.95;
    const rBoth = rmsWindow(both,  W0, W1);
    const rA    = rmsWindow(onlyA, W0, W1);
    const rB    = rmsWindow(onlyB, W0, W1);

    // Genuine polyphony: two distinct pitches sum incoherently, so the overlap
    // carries clearly more energy than the louder single note (~1.4x for equal
    // levels). Under the mono-cut bug the first note is silenced when the second
    // starts, so rBoth collapses to ~rB (only the latest voice survives).
    expect(rBoth).toBeGreaterThan(Math.max(rA, rB) * 1.25);
  });
});
