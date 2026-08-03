// src/audio-dsp/default-envelopes.dsp.test.ts
// The amp and filter envelopes of Subtractive and Westcoast ARE ADSR
// modulators (adsr-amp → 'amp', adsr-filter → 'filter.env'). This test pins
// that down BEFORE the modulator refactor touches anything, so a regression
// surfaces here instead of as "the synth went quiet".
//
// Shape assertions only, all relative: an envelope that attacks, decays to a
// sustain and releases towards silence. No absolute magnitudes — the point is
// the SHAPE, and absolute levels drift with unrelated gain work.
//
// Harness copied from modulation-pipeline.test.ts: the REAL path
// (ModulationRuntime → VoiceManager → renderer), no invented plumbing. The
// ModulatorState[] → ModLite[] conversion is the REAL converter (engines/
// mod-lite.ts's toModLite) — a pure data mapper with no Web Audio / DOM, so
// importing it here does not drag in worklet-lane-engine.ts's Web-Audio/
// lit-html dependency chain (LoomWorkletNode, lit-html…).
import { describe, it, expect } from 'vitest';
// Both engines ship as plugins, and a plugin's dsp.ts registers itself through
// the Loom global at module scope — `test/plugin-dsp` installs that global, so
// it stays above the plugin imports below.
import '../../test/plugin-dsp';
import { ModulationRuntime } from './modulation-runtime';
import { VoiceManager } from './voice-manager';
import type { NoteSpec, ParamBag } from './types';
import type { ModulatorState } from '../modulation/types';
import '../../plugins/subtractive/dsp';
import '../../plugins/westcoast/dsp';
// Side-effect only: registers the 'lfo'/'adsr' components. Nothing below reads
// the modulator registry directly any more, but toModLite still resolves the
// kinds it is handed, and vitest isolates modules per file.
import '../plugins/modulators/lfo';
import '../plugins/modulators/adsr';
import subtractiveManifest from '../../plugins/subtractive/plugin.json';
import westcoastManifest from '../../plugins/westcoast/plugin.json';
import { toModLite } from '../engines/mod-lite';

// Both engines' defaults used to be functions in src/engines/. They are now
// DATA in each plugin's manifest, which is the whole point of the move — so read
// them from there rather than re-typing them here. Each call returns a fresh
// deep copy because two tests below edit the states they are handed.
const WESTCOAST_DEFAULT_MODULATORS = (): ModulatorState[] =>
  JSON.parse(JSON.stringify(westcoastManifest.components[0].modulators)) as ModulatorState[];
const SUBTRACTIVE_DEFAULT_MODULATORS = (): ModulatorState[] =>
  JSON.parse(JSON.stringify(subtractiveManifest.components[0].modulators)) as ModulatorState[];

const SR = 44100;

const note = (durationSec: number): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec, velocity: 0.9, accent: false, slide: false });

// Subtractive's renderer reads the synthetic 'amp' / 'filterEnv' targets by
// these exact keys (subtractive-renderer.ts combineMods) — matches
// worklet-lane-engine.ts's fieldForParamId for the two connections this test
// exercises (SUBTRACTIVE_DEFAULT_MODULATORS only ever targets 'amp' and
// 'filter.env').
const subtractiveMapTarget = (paramId: string): string | null => {
  if (paramId === 'amp') return 'amp';
  if (paramId === 'filter.env') return 'filterEnv';
  return null;
};
// Westcoast's renderer (ModEnvHost) reads offsets by the connection's OWN
// dot-id, unmapped (westcoast-renderer.ts reads mo?.['timbre.fold'] /
// mo?.['lpg.cutoff'] directly) — identity is the correct mapper here.
const westcoastMapTarget = (paramId: string): string | null => paramId;

/** Render one voice for `totalSec`, through the REAL ModulationRuntime →
 *  VoiceManager → renderer path. `mods` (when given) seeds the runtime, and
 *  VoiceManager.spawn hands the enabled ADSRs to the renderer via
 *  setModEnvelopes — the exact live wiring, not a stand-in. */
function render(
  engineId: string, params: ParamBag, mods: ModulatorState[] | null,
  mapTarget: (paramId: string) => string | null, holdSec: number, totalSec: number,
): number[] {
  // The lane must DECLARE what the modulators target: offsets are addressed by
  // the ParamIndex, so an id with no slot is inert — the contract production
  // follows, where the seed and the numbering come from the same object.
  const wire = mods ? toModLite(mods, 120, mapTarget) : [];
  const targets = wire.flatMap((m) => Object.keys(m.depthByParam));
  const vm = new VoiceManager(SR, engineId, params, 1, [...Object.keys(params), ...targets]);
  if (mods) {
    const runtime = new ModulationRuntime(SR);
    runtime.setMods(wire);
    vm.setModulation(runtime);
  }
  vm.spawn(note(holdSec));
  const out: number[] = [];
  for (let i = 0; i < Math.floor(SR * totalSec); i++) out.push(vm.renderSample(i / SR));
  return out;
}

/** Per-window (10 ms) RMS envelope — coarse enough to see attack/sustain/
 *  release shape, fine enough to resolve a 10 ms default attack. */
const WINDOW_SEC = 0.01;
function rmsEnvelope(buf: number[]): number[] {
  const w = Math.floor(SR * WINDOW_SEC);
  const env: number[] = [];
  for (let i = 0; i + w <= buf.length; i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += buf[j] * buf[j];
    env.push(Math.sqrt(s / w));
  }
  return env;
}

/** Mean absolute difference between two RMS envelopes, normalised by the
 *  first envelope's energy — a relative measure (same shape as
 *  modulation-pipeline.test.ts's envDiff). When BOTH envelopes are silent
 *  (nothing to normalise by) they count as identical, not "maximally
 *  different" — the honest reading for the Westcoast depth-0 case below. */
function envDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let d = 0, e = 0;
  for (let i = 0; i < n; i++) { d += Math.abs(a[i] - b[i]); e += a[i]; }
  return e > 1e-9 ? d / e : 0;
}

describe('default envelopes — characterisation net, not TDD (must be green against today\'s code)', () => {
  describe('subtractive: the default amp/filter ADSRs shape the note', () => {
    // amp.builtinEnv/filter.builtinEnv OFF: this is the SAME switch
    // applyPreset flips (deriveSubtractiveEnvMods, subtractive.ts) whenever a
    // patch has no modulators of its own — i.e. the real condition under which
    // SUBTRACTIVE_DEFAULT_MODULATORS' two ADSRs actually drive amp/filter,
    // rather than sitting behind the built-in envelope fallback.
    const P: ParamBag = {
      'amp.builtinEnv': 0, 'filter.builtinEnv': 0,
      'filter.cutoff': 0.5, 'filter.resonance': 0.3, 'filter.envAmount': 0.6,
    };
    const HOLD = 0.6, TOTAL = 1.5;

    it('subtractive: the default amp ADSR shapes the note (attack → sustain → release)', () => {
      const env = rmsEnvelope(render('subtractive', P, SUBTRACTIVE_DEFAULT_MODULATORS(), subtractiveMapTarget, HOLD, TOTAL));
      const peak = Math.max(...env);
      // 1. Attack: the very first window (still ramping from 0) sits below the peak.
      expect(env[0]).toBeLessThan(peak);
      // 2. Sustain plateau: shortly before note-off, the level has settled below
      // the peak but is still clearly sounding — decay finished, not silence.
      const plateauIdx = Math.floor(HOLD / WINDOW_SEC) - 2;
      const plateau = env[plateauIdx];
      expect(plateau).toBeLessThan(peak);
      expect(plateau).toBeGreaterThan(peak * 0.05);
      // 3. Release: well after note-off, the level has fallen far below the
      // sustain plateau (towards silence).
      const tail = env[env.length - 2];
      expect(tail).toBeLessThan(plateau * 0.2);
    });

    it('control: disabling the amp ADSR (enabled: false) changes the measured envelope', () => {
      const withoutAmpAdsr = SUBTRACTIVE_DEFAULT_MODULATORS().map((m) =>
        m.id === 'adsr-amp' ? { ...m, enabled: false } : m);
      const normal = rmsEnvelope(render('subtractive', P, SUBTRACTIVE_DEFAULT_MODULATORS(), subtractiveMapTarget, HOLD, TOTAL));
      const disabled = rmsEnvelope(render('subtractive', P, withoutAmpAdsr, subtractiveMapTarget, HOLD, TOTAL));
      // Disabled: 'amp' has no envelope routed to it, and with the built-in amp
      // env off too, SubtractiveVoiceRenderer falls back to a flat gain of 1 —
      // no attack/decay/release shape at all. That is a large, measurable
      // difference from the shaped envelope above.
      expect(envDiff(disabled, normal)).toBeGreaterThan(0.2);
    });
  });

  describe('westcoast: honest baseline — WESTCOAST_DEFAULT_MODULATORS are wired at ZERO depth', () => {
    // lpg.mode default 2 ('both') + contour.mode default 0 ('pluck'): the
    // renderer's OWN built-in AD contour (not a ModulatorState) drives both
    // the LPG cutoff sweep and the VCA, gate-independently. That is what
    // actually shapes a default Westcoast note.
    const P: ParamBag = {};
    const HOLD = 1.5, TOTAL = 1.5; // pluck mode ignores hold length; render long enough to see the whole decay

    it('westcoast: the built-in AD contour shapes the note (attack → decay towards silence)', () => {
      const env = rmsEnvelope(render('westcoast', P, null, westcoastMapTarget, HOLD, TOTAL));
      const peakIdx = env.indexOf(Math.max(...env));
      const peak = env[peakIdx];
      // 1. Attack: the very first window sits below the peak.
      expect(env[0]).toBeLessThan(peak);
      // 2. Decay: well after the peak, the level has fallen far towards silence
      // (pluck mode's AD contour has no sustain to hold at).
      const tail = env[env.length - 2];
      expect(tail).toBeLessThan(peak * 0.2);
    });

    it('honest control: at the default ZERO depth, attaching WESTCOAST_DEFAULT_MODULATORS ' +
       'to the runtime changes NOTHING measurable — the ADSRs are wired to timbre.fold/' +
       'lpg.cutoff but contribute env × 0 (worklet-lane-engine.ts toModLite/ModEnvHost both ' +
       'skip a falsy depth), so the note\'s shape comes entirely from the built-in AD contour ' +
       'above, not from these modulators', () => {
      const withMods = rmsEnvelope(render('westcoast', P, WESTCOAST_DEFAULT_MODULATORS(), westcoastMapTarget, HOLD, TOTAL));
      const withoutMods = rmsEnvelope(render('westcoast', P, null, westcoastMapTarget, HOLD, TOTAL));
      expect(envDiff(withMods, withoutMods)).toBeLessThan(0.01);
    });

    it('the ADSR → timbre.fold/lpg.cutoff WIRING is live: a nonzero depth measurably ' +
       'changes the sound (so a later regression in the connection path, not just a ' +
       'depth default, still surfaces here)', () => {
      const wired = WESTCOAST_DEFAULT_MODULATORS().map((m) => ({
        ...m,
        connections: m.connections.map((c) => ({ ...c, depth: c.depth === 0 ? 1 : c.depth })),
      }));
      const zeroDepth = rmsEnvelope(render('westcoast', P, WESTCOAST_DEFAULT_MODULATORS(), westcoastMapTarget, HOLD, TOTAL));
      const nonZeroDepth = rmsEnvelope(render('westcoast', P, wired, westcoastMapTarget, HOLD, TOTAL));
      expect(envDiff(nonZeroDepth, zeroDepth)).toBeGreaterThan(0.05);
    });
  });
});
