// How many voices does a lane actually hold, and how loud does that get?
//
// Written to answer one report: a Wavetable PAD "se ha ido de madre" while a
// track was being layered and woven. A pad is the shape that provokes it — long
// release, high sustain — and nothing in the tree measures what a stream of
// notes into one does.
//
// Not a browser question. `VoiceManager` owns spawn and retire, and a renderer
// is reached through the registry, so the whole thing runs sample by sample with
// no AudioContext.
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { VoiceManager } from './voice-manager';
import { registerRenderer } from './renderer-registry';
import './layers/register';
import { WavetableRenderer } from '../../plugins/wavetable/dsp';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;
const ENGINE = 'wavetable-pad-fixture';

registerRenderer(ENGINE, (n, p, sr) => new WavetableRenderer(n, p, sr));
// Under its real id too, so a LAYERS slot naming `wavetable` finds it — the
// registry lookup is exactly how the rack builds its sub-renderers.
registerRenderer('wavetable', (n, p, sr) => new WavetableRenderer(n, p, sr));

/** PAD Sweep Wide, from the plugin's own presets.json — the longest release it
 *  ships (3 s) and a sustain of 0.78. Copied rather than imported so the
 *  measurement does not silently change when the preset is retuned. */
const PAD: ParamBag = {
  'osc.waveA': 2, 'osc.waveB': 3, 'osc.morph': 0.5, 'osc.detune': 18,
  'filter.cutoff': 0.58, 'filter.resonance': 0.25,
  'amp.builtinEnv': 1,
  'amp.attack': 1.4, 'amp.decay': 1.6, 'amp.sustain': 0.78, 'amp.release': 3,
};

const note = (beginSec: number, midi: number, durationSec: number): NoteSpec => ({
  midi, beginSec, durationSec, velocity: 0.8, accent: false, slide: false,
});

/** Play 16ths at 130 BPM for `seconds`, and report the worst voice count and the
 *  loudest sample seen. Notes are SHORT (one step) — the tail is the preset's
 *  release, not the note's length. */
function run(seconds: number): { peakVoices: number; peak: number } {
  const vm = new VoiceManager(SR, ENGINE, PAD);
  const step = 60 / 130 / 4;
  const scale = [57, 60, 64, 67, 69, 72];
  let peakVoices = 0, peak = 0, next = 0, n = 0;

  for (let i = 0; i < SR * seconds; i++) {
    const t = i / SR;
    if (t >= next) {
      vm.spawn(note(t, scale[n % scale.length], step));
      next += step; n++;
    }
    const s = vm.renderSample(t);
    if (Math.abs(s) > peak) peak = Math.abs(s);
    if (vm.activeCount > peakVoices) peakVoices = vm.activeCount;
  }
  return { peakVoices, peak };
}

describe('a lane holding a long-release pad', () => {
  it('reaches a STEADY voice count rather than climbing for ever', () => {
    // The claim being tested is the one written in VoiceManager.spawn: "voices
    // self-terminate on release, so they don't grow unbounded". Per voice that
    // is true. The question is the steady state — notes per second times how
    // long each one rings — which is what a pad makes large.
    const short = run(4);
    const long = run(8);
    // Doubling the time must not keep adding voices: a lane that is still
    // growing at 8 s is a lane whose cost grows with how long you leave it
    // playing.
    expect(long.peakVoices).toBeLessThanOrEqual(short.peakVoices + 2);
  });

  it('does not go on getting louder as the voices pile up', () => {
    // Correlated voices sum by amplitude, so a pile of sustained ones is a lane
    // whose level climbs with nothing on screen moving. Relative, per the
    // project's rule: twice the time must not mean a materially louder lane.
    const short = run(4);
    const long = run(8);
    expect(long.peak).toBeLessThan(short.peak * 1.3);
  });

  it('stays finite — a NaN here poisons every native node downstream', () => {
    const { peak } = run(8);
    expect(Number.isFinite(peak)).toBe(true);
  });
});
