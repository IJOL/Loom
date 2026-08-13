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

/** The same engine on a SINE, held. Smooth material, so a one-sample step
 *  stands out instead of hiding among a sawtooth's own edges — see the steal
 *  test for why that distinction decides whether it measures anything. */
const SINE: ParamBag = {
  ...PAD,
  'osc.waveA': 0, 'osc.waveB': 0, 'osc.morph': 0, 'osc.detune': 0,
  'filter.cutoff': 0.5, 'filter.resonance': 0.1,
  'amp.attack': 0.01, 'amp.decay': 0.2, 'amp.sustain': 0.9, 'amp.release': 1,
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

/** The same stream, with the lane's cap set. Returns what it held and the
 *  largest jump between consecutive samples — the shape a click has. */
function capped(seconds: number, maxVoices: number): {
  peakVoices: number; maxJump: number;
} {
  const vm = new VoiceManager(SR, ENGINE, PAD);
  vm.setMaxVoices(maxVoices);
  const step = 60 / 130 / 4;
  const scale = [57, 60, 64, 67, 69, 72];
  let peakVoices = 0, maxJump = 0, prev = 0, next = 0, n = 0;

  for (let i = 0; i < SR * seconds; i++) {
    const t = i / SR;
    if (t >= next) {
      vm.spawn(note(t, scale[n % scale.length], step));
      next += step; n++;
    }
    const s = vm.renderSample(t);
    const jump = Math.abs(s - prev);
    if (i > 0 && jump > maxJump) maxJump = jump;
    prev = s;
    if (vm.activeCount > peakVoices) peakVoices = vm.activeCount;
  }
  return { peakVoices, maxJump };
}

describe('poly.voices actually caps a polyphonic lane', () => {
  it('holds no more voices than it was asked to', () => {
    // It held 28 with the cap at 8, because `maxVoices` was only ever compared
    // against 1: the field was a mono FLAG wearing a number's clothes, so every
    // value from 2 upward meant the same thing — no limit at all.
    //
    // The slack is the voices on their way out: a stolen voice keeps rendering
    // for the length of its ramp, which at this note rate is at most one or two
    // at a time.
    const { peakVoices } = capped(8, 8);
    expect(peakVoices).toBeLessThanOrEqual(10);
  });

  it('follows the number it is given, not one number for everybody', () => {
    expect(capped(8, 4).peakVoices).toBeLessThan(capped(8, 16).peakVoices);
  });

  it('steals WITHOUT a step — the reason the old cap was removed', () => {
    // The one assertion that matters, and it is measured on a SINE rather than
    // on the pad above. That is not decoration: a sawtooth pad's own
    // sample-to-sample jumps are larger than the step a dropped voice makes, so
    // the same comparison on that material passes whatever the cap does —
    // checked, by setting the ramp to zero and watching it stay green. A smooth
    // wave has jumps of about 0.03 per sample, so a voice dropped at full
    // sustain stands out by more than an order of magnitude.
    //
    // Three long notes into a lane that may hold two: the third steals the
    // first while it is sustaining, which is the worst moment there is.
    //
    // Measured AT the event and not over the whole render, because a maximum
    // taken over everything is not a test: the material's own largest jump is
    // 0.12 and an instant steal only pushed it to 0.17, which passes a ratio
    // check while being exactly the defect. And measured across twenty steal
    // PHASES, because where in its cycle a voice is when it is taken decides how
    // big the step is — one phase catches it near the top, and that is the one
    // that clicks.
    const worstStealJump = (maxVoices: number): { atSteal: number; before: number } => {
      let atSteal = 0, before = 0;
      for (let k = 0; k < 20; k++) {
        const third = 0.6 + k * 0.00037;
        const vm = new VoiceManager(SR, ENGINE, SINE);
        vm.setMaxVoices(maxVoices);
        const at = [0, 0.3, third];
        let prev = 0, n = 0;
        for (let i = 0; i < SR * 0.65; i++) {
          const t = i / SR;
          if (n < at.length && t >= at[n]) { vm.spawn(note(at[n], 57 + n * 4, 5)); n++; }
          const s = vm.renderSample(t);
          const d = i > 0 ? Math.abs(s - prev) : 0;
          // The 3 ms after the third note lands — where a dropped voice's step
          // would be — against the 50 ms before it, which is the same material
          // with nothing being taken.
          if (t >= third && t < third + 0.003) atSteal = Math.max(atSteal, d);
          else if (t > third - 0.05 && t < third) before = Math.max(before, d);
          prev = s;
        }
      }
      return { atSteal, before };
    };
    const r = worstStealJump(2);
    // Nothing special happens where the steal is: the voice leaves on a ramp, so
    // the signal there is the same shape it was a moment earlier.
    expect(r.atSteal).toBeLessThan(r.before * 1.5);
  });
});

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
