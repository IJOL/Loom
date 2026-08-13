// A voice that cannot be killed.
//
// Reported twice as "el sonido está lockeado en ruido": one channel sounding at
// full level for MINUTES with the transport stopped and nothing scheduled,
// deaf to ⏹, silenced only by that lane's own mute, and gone the moment the
// lane's instrument was swapped (which rebuilds the worklet node).
//
// Every one of those symptoms is one mechanism. `holdEnd = beginSec +
// durationSec`, and if either is not a number the sum is NaN — after which
// EVERY comparison against it is false:
//
//   • the renderer's own gate-off, `t >= holdEnd`, never fires; and
//   • a `noteOff` guarded by `t < holdEnd` returns having done nothing, so the
//     transport's stop cannot reach the voice either.
//
// A contour in SUSTAIN mode then holds at its peak for the life of the page. It
// only takes ONE such note: the lane sings a constant tone at full scale and
// nothing in the app can stop it.
//
// Two layers are fixed and both are covered here: a note whose times are not
// numbers never becomes a voice (VoiceManager.spawn, which covers every
// engine), and a noteOff always reaches the contour (westcoast's renderer,
// where the guard was).
import { describe, it, expect, beforeAll, vi } from 'vitest';

const { captured } = vi.hoisted(() => {
  const captured = new Map<string, unknown>();
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1,
    registerRenderer: (id: string, make: unknown) => { captured.set(id, make); },
    registerModulatorKernel: () => {},
  };
  return { captured };
});

import '../plugins/tb303/dsp';
import '../plugins/subtractive/dsp';
import '../plugins/fm/dsp';
import '../plugins/wavetable/dsp';
import '../plugins/karplus/dsp';
import '../plugins/westcoast/dsp';
import westcoastManifest from '../plugins/westcoast/plugin.json';

import { VoiceManager } from '../src/audio-dsp/voice-manager';
import { registerRenderer, createRenderer } from '../src/audio-dsp/renderer-registry';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;
const ENGINE_IDS = ['tb303', 'subtractive', 'fm', 'wavetable', 'karplus', 'westcoast'];

beforeAll(() => {
  for (const [id, make] of captured) {
    registerRenderer(id, make as Parameters<typeof registerRenderer>[1]);
  }
});

/** The params the broken lane was actually on, read off its own controls while
 *  it was stuck. The discrete ones could not be read (they are selects, not
 *  knobs), so the sweep below walks all of them. */
const LIVE_CONTINUOUS = {
  'osc.ratio': 1.5, 'osc.fmIndex': 0.45, 'osc.ring': 0, 'osc.subLevel': 0.4,
  'osc.detune': 0, 'timbre.fold': 0.5, 'timbre.symmetry': 0,
  'lpg.cutoff': 0.5, 'lpg.resonance': 0.3,
  'contour.attack': 0, 'contour.decay': 0.3, 'contour.amount': 0.9,
  'amp.level': 0.8, 'master.tune': 0, 'poly.voices': 32,
};

function westBag(extra: Record<string, number> = {}): ParamBag {
  const bag: ParamBag = {};
  for (const c of (westcoastManifest as { components: { params: { id: string; default: number }[] }[] }).components) {
    for (const p of c.params) bag[p.id] = p.default;
  }
  Object.assign(bag, LIVE_CONTINUOUS, extra, { 'output.trim': 1 });
  return bag;
}

const nanNote = (field: 'beginSec' | 'durationSec' | 'midi'): NoteSpec => ({
  midi: 45, beginSec: 0, durationSec: 0.5, velocity: 0.9, accent: false, slide: false,
  [field]: NaN,
});

describe('a note whose times are not numbers', () => {
  for (const id of ENGINE_IDS) {
    it(`${id}: never becomes a voice`, () => {
      // Every engine, because the refusal is at the shared boundary — a fix in
      // one renderer would leave the same trap set in the other five.
      for (const field of ['beginSec', 'durationSec', 'midi'] as const) {
        const vm = new VoiceManager(SR, id, id === 'westcoast' ? westBag() : { 'output.trim': 1 });
        vm.spawn(nanNote(field));
        expect(vm.activeCount, `${id} spawned on NaN ${field}`).toBe(0);
        let peak = 0;
        for (let i = 0; i < SR; i++) peak = Math.max(peak, Math.abs(vm.renderSample(i / SR)));
        expect(peak, `${id} sounded on NaN ${field}`).toBe(0);
      }
    });
  }
});

describe('westcoast: a stop always reaches the contour', () => {
  // Below the boundary above: even handed a note it should never have received,
  // the renderer must still release when told to. This is the guard that made
  // the lock-up unrecoverable, so it gets a test of its own rather than resting
  // on the layer in front of it.
  for (const cMode of [0, 1]) {
    it(`contour.mode=${cMode}, gate NaN: released and finished`, () => {
      const bag = westBag({ 'lpg.mode': 0, 'contour.mode': cMode });
      const v = createRenderer('westcoast', {
        midi: 45, beginSec: 0, durationSec: NaN, velocity: 0.9, accent: false, slide: false,
      }, bag, SR, undefined);

      for (let i = 0; i < SR; i++) v.renderSample(i / SR);
      v.noteOff(1);                                   // ⏹

      // `done` is the whole contract: it is what makes the lane drop the voice.
      // Measuring the renderer's own output past that point measures nothing —
      // in the app nobody is calling it any more.
      let doneAt: number | null = null;
      for (let i = 0; i < SR * 20 && doneAt === null; i++) {
        v.renderSample(1 + i / SR);
        if (v.done) doneAt = i / SR;
      }
      expect(doneAt, 'still not done 20s after the stop').not.toBeNull();
    });
  }
});

describe('westcoast: no state of this engine sounds for ever', () => {
  it('sweeps every discrete combination', () => {
    // The discrete params could not be read off the broken lane, so instead of
    // guessing which one it was on, every combination has to be safe.
    const immortal: string[] = [];
    for (const lpgMode of [0, 1, 2]) {
      for (const cMode of [0, 1]) {
        for (const cycle of [0, 1]) {
          const vm = new VoiceManager(SR, 'westcoast',
            westBag({ 'lpg.mode': lpgMode, 'contour.mode': cMode, 'contour.cycle': cycle }));
          vm.spawn({ midi: 45, beginSec: 0, durationSec: 0.5, velocity: 0.9, accent: false, slide: false });
          let stopped = false;
          for (let i = 0; i < SR * 30; i++) {
            const t = i / SR;
            if (!stopped && t >= 1) { vm.steal(0); stopped = true; }   // ⏹
            vm.renderSample(t);
          }
          if (vm.activeCount > 0) immortal.push(`lpg=${lpgMode} contour=${cMode} cycle=${cycle}`);
        }
      }
    }
    expect(immortal, 'states that outlive a stop by 30s').toEqual([]);
  });
});
