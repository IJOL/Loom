// Does any shipped preset diverge, or refuse to end?
//
// Written for a reported lock-up: "sigue respondiendo pero el sonido está
// lockeado en ruido" — the UI alive, the audio stuck as a wall of noise. That
// shape is not a dead worklet (a dead one is silent). It is either a renderer
// whose state runs away, or voices that never finish and pile up until every
// note is buried. Both are measurable here, sample by sample, with no browser.
//
// Every preset of every engine that ships DSP, held and then released. Three
// questions per preset: does it stay finite, does it stay bounded, and does the
// voice ever go away.
import { describe, it, expect, beforeAll, vi } from 'vitest';

// The plugins register their renderers at module scope through the ABI, so the
// global has to exist before their imports are evaluated — vi.hoisted is the
// only hook that runs that early. The factories are captured here and handed to
// the real registry in beforeAll, so the VoiceManager below reaches them exactly
// as the worklet does.
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

import tb303Manifest from '../plugins/tb303/plugin.json';
import subtractiveManifest from '../plugins/subtractive/plugin.json';
import fmManifest from '../plugins/fm/plugin.json';
import wavetableManifest from '../plugins/wavetable/plugin.json';
import karplusManifest from '../plugins/karplus/plugin.json';
import westcoastManifest from '../plugins/westcoast/plugin.json';

import tb303Presets from '../plugins/tb303/presets.json';
import subtractivePresets from '../plugins/subtractive/presets.json';
import fmPresets from '../plugins/fm/presets.json';
import wavetablePresets from '../plugins/wavetable/presets.json';
import karplusPresets from '../plugins/karplus/presets.json';
import westcoastPresets from '../plugins/westcoast/presets.json';

import { VoiceManager } from '../src/audio-dsp/voice-manager';
import { registerRenderer } from '../src/audio-dsp/renderer-registry';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;

interface Preset { name: string; params: Record<string, number> }
interface Manifest { components: { params: { id: string; default: number }[] }[] }

/** A preset FILE is `{ engineId, presets: [...] }` — the same shape the loader
 *  validates. Reaching for `.presets` here rather than assuming an array is
 *  what stops this sweep from silently covering nothing. */
const listOf = (file: unknown): Preset[] => {
  const presets = (file as { presets?: Preset[] }).presets;
  if (!Array.isArray(presets) || presets.length === 0) {
    throw new Error('preset file has no presets array — the sweep would cover nothing');
  }
  return presets;
};

const ENGINES: { id: string; manifest: Manifest; presets: Preset[] }[] = [
  { id: 'tb303', manifest: tb303Manifest as Manifest, presets: listOf(tb303Presets) },
  { id: 'subtractive', manifest: subtractiveManifest as Manifest, presets: listOf(subtractivePresets) },
  { id: 'fm', manifest: fmManifest as Manifest, presets: listOf(fmPresets) },
  { id: 'wavetable', manifest: wavetableManifest as Manifest, presets: listOf(wavetablePresets) },
  { id: 'karplus', manifest: karplusManifest as Manifest, presets: listOf(karplusPresets) },
  { id: 'westcoast', manifest: westcoastManifest as Manifest, presets: listOf(westcoastPresets) },
];

beforeAll(() => {
  for (const [id, make] of captured) {
    registerRenderer(id, make as Parameters<typeof registerRenderer>[1]);
  }
});

/** The bag a lane would hold on this preset: every param the engine DECLARES at
 *  its default, with the preset's own values over the top. Reading the manifest
 *  rather than hand-listing is the point — a param added tomorrow is covered. */
function bagFor(m: Manifest, preset: Preset): ParamBag {
  const bag: ParamBag = {};
  for (const c of m.components) for (const p of c.params) bag[p.id] = p.default;
  for (const [id, v] of Object.entries(preset.params)) {
    if (typeof v === 'number') bag[id] = v;
  }
  // Not declared by any engine, seeded by the host for every lane; fm and
  // karplus read it live, so a preset carrying it needs a slot to write into.
  bag['output.trim'] = typeof preset.params['output.trim'] === 'number'
    ? preset.params['output.trim'] : 1;
  return bag;
}

const note = (midi: number, durationSec: number, accent = false): NoteSpec => ({
  midi, beginSec: 0, durationSec, velocity: accent ? 1 : 0.9, accent, slide: false,
});

interface Run { peak: number; finite: boolean; tailPeak: number; endedBySec: number | null }

/** One held note, then silence. Returns the loudest sample overall, the loudest
 *  one in the last second (long after the note was released) and when the lane
 *  actually emptied. */
function hold(engineId: string, bag: ParamBag, seconds = 8): Run {
  const vm = new VoiceManager(SR, engineId, bag);
  vm.spawn(note(45, 2));
  let peak = 0, tailPeak = 0, finite = true, endedBySec: number | null = null;
  for (let i = 0; i < SR * seconds; i++) {
    const t = i / SR;
    const s = vm.renderSample(t);
    if (!Number.isFinite(s)) { finite = false; break; }
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (t > seconds - 1 && a > tailPeak) tailPeak = a;
    if (endedBySec === null && t > 2 && vm.activeCount === 0) endedBySec = t;
  }
  return { peak, finite, tailPeak, endedBySec };
}

describe('a note whose times are not numbers', () => {
  // `holdEnd = beginSec + durationSec`. If either is not a number the sum is
  // NaN, and EVERY comparison against NaN is false — so `t >= holdEnd` never
  // fires the gate-off and `t < holdEnd` never lets noteOff through either. A
  // renderer that ends on its gate then never ends at all: an immortal voice,
  // at full level, deaf to the transport and audible until the lane is muted.
  const growl = (): ParamBag => {
    const m = ENGINES.find((e) => e.id === 'westcoast')!;
    return bagFor(m.manifest, m.presets.find((p) => p.name === 'BASS Growl FM')!);
  };

  it('a NaN duration does not make an immortal voice', () => {
    const vm = new VoiceManager(SR, 'westcoast', growl());
    vm.spawn({ midi: 45, beginSec: 0, durationSec: NaN, velocity: 0.9, accent: false, slide: false });
    let peak = 0;
    for (let i = 0; i < SR * 10; i++) peak = Math.max(peak, Math.abs(vm.renderSample(i / SR)));
    // Ten seconds later, on a preset whose own decay is 0.3 s.
    expect(vm.activeCount).toBe(0);
    expect(peak).toBeLessThan(8);
  });

  it('a stop reaches a voice whose gate has already passed', () => {
    // What the transport does: noteOff on everything still sounding. On this
    // renderer that call is a no-op once the note's own gate is behind it —
    // which is fine only as long as something else ends the voice.
    const vm = new VoiceManager(SR, 'westcoast', growl());
    vm.spawn({ midi: 45, beginSec: 0, durationSec: 0.2, velocity: 0.9, accent: false, slide: false });
    for (let i = 0; i < SR * 1; i++) vm.renderSample(i / SR);
    vm.steal(1);                       // the stop path
    for (let i = SR; i < SR * 6; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBe(0);
  });
});

describe('MEASUREMENT (temporary)', () => {
  it('an ACCENTED note, and a note-off that arrives late', () => {
    // Two axes the sweep above never touched, and both are ordinary in a real
    // session. An accent multiplies this engine's fold drive AND its cutoff
    // envelope; and a transport stop arrives whenever it arrives, which for a
    // note whose gate has already passed means westcoast's `noteOff` returns
    // without telling its contour anything.
    for (const { id, manifest, presets } of ENGINES) {
      for (const preset of presets) {
        const bag = bagFor(manifest, preset);
        for (const [label, accent, dur] of [
          ['accent', true, 2], ['long-gate', false, 30],
        ] as [string, boolean, number][]) {
          const vm = new VoiceManager(SR, id, bag);
          vm.spawn(note(45, dur, accent));
          let peak = 0, alive = true;
          for (let i = 0; i < SR * 12; i++) {
            const s = vm.renderSample(i / SR);
            if (!Number.isFinite(s)) { peak = Infinity; break; }
            peak = Math.max(peak, Math.abs(s));
          }
          alive = vm.activeCount > 0;
          if (!Number.isFinite(peak) || peak > 8 || alive) {
            console.log(`  ${id} · ${preset.name} [${label}]: peak=${peak.toFixed ? peak.toFixed(2) : peak} stillAliveAt12s=${alive}`);
          }
        }
      }
    }
    expect(true).toBe(true);
  });

  it('prints the ones that fail, over a long window', () => {
    const watch: Record<string, string[]> = {
      subtractive: ['LEAD Supersaw 7', 'LEAD Hoover Rave', 'BASS Hoover'],
      westcoast: ['PAD Harmonic Swell', 'PAD Glass Air', 'DRONE Sub Fold', 'FX Inharmonic Pad',
        'BASS Growl FM'],
    };
    for (const { id, manifest, presets } of ENGINES) {
      for (const name of watch[id] ?? []) {
        const preset = presets.find((p) => p.name === name);
        if (!preset) { console.log(`  ${id} · ${name}: NOT FOUND`); continue; }
        const r = hold(id, bagFor(manifest, preset), 20);
        // Onset vs body: 14 oscillators starting in phase is a one-sample spike
        // and a different defect from a voice that is simply too loud all the
        // way through. The fix is not the same one.
        const vm = new VoiceManager(SR, id, bagFor(manifest, preset));
        vm.spawn(note(45, 2));
        let onset = 0, body = 0;
        for (let i = 0; i < SR * 1.5; i++) {
          const a = Math.abs(vm.renderSample(i / SR));
          if (i < SR * 0.02) onset = Math.max(onset, a);
          else if (i > SR * 0.1) body = Math.max(body, a);
        }
        console.log(`  ${id} · ${name}: peak=${r.peak.toFixed(2)} onset20ms=${onset.toFixed(2)} body=${body.toFixed(2)} ended=${r.endedBySec === null ? 'NEVER within 20s' : r.endedBySec.toFixed(1) + 's'}`);
      }
    }
    expect(true).toBe(true);
  });
});

describe('every shipped preset is stable', () => {
  for (const { id, manifest, presets } of ENGINES) {
    for (const preset of presets) {
      it(`${id} · ${preset.name}`, () => {
        const r = hold(id, bagFor(manifest, preset));
        // A non-finite sample is the worst case: it does not merely sound wrong,
        // it poisons every native node downstream of the worklet for the life of
        // the page.
        expect(r.finite).toBe(true);
        // Bounded. A voice is one instrument at one level; anything past a few
        // is a state running away rather than a loud patch. Absolute on purpose
        // — this is a divergence detector, not a loudness judgement, and the
        // scale it guards (1.0 = full scale) is fixed by the format.
        expect(r.peak).toBeLessThan(8);
        // And it ENDS. A voice that never reports done is a voice the lane keeps
        // rendering for ever; enough of them and every new note arrives on top
        // of a wall that never decays.
        expect(r.endedBySec).not.toBeNull();
        // Nothing left ringing at the end of the window.
        expect(r.tailPeak).toBeLessThan(r.peak * 0.01);
      });
    }
  }
});
