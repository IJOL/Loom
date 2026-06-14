# West Coast Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth melodic engine, `westcoast` (display "West"), implementing Buchla-style West Coast synthesis: a complex oscillator (FM + ring/AM + sub-harmonic divider) → wavefolder → low-pass gate, driven by a built-in AD contour.

**Architecture:** A single new `src/engines/westcoast.ts` cloning the `wavetable.ts` engine shape (polyhost, per-voice voice manager, shared modulation bus, ModulationHost with 2 ADSR + 2 LFO). The new generation technique lives in one extra helper (`westcoast-fold.ts`, the wavefolder transfer curve). Everything is real-time Web Audio nodes — no AudioWorklet, no offline render. Auto-discovered by the build-time `import.meta.glob` in `plugin-bootstrap.ts`; three explicit registries get one new entry each (BPM broadcast list, preset-sanity list, registry-boot test).

**Tech Stack:** TypeScript, Web Audio API, Vitest (+ `node-web-audio-api` for DSP renders), SCSS. No new dependencies.

**Reference spec:** [docs/superpowers/specs/2026-06-14-west-coast-engine-design.md](../specs/2026-06-14-west-coast-engine-design.md) — full param table, signal flow, risks. **Approved mockup:** [docs/superpowers/specs/2026-06-14-west-coast-engine-mockup.html](../specs/2026-06-14-west-coast-engine-mockup.html).

**Before starting:** This is implementation work — create an isolated git worktree first (per project convention) so the whole session (and any subagents) runs inside it.

**Test commands (colour-free, per project convention):**
- Single unit/DSP file: `NO_COLOR=1 npx vitest run path/to/file.test.ts`
- Fast suite (no DSP renders): `npm run test:fast`
- Typecheck: `npx tsc --noEmit`
- Full build: `npm run build`

---

## File structure

- **Create** `src/engines/westcoast-fold.ts` — the wavefolder transfer curve (pure, testable in isolation).
- **Create** `src/engines/westcoast-fold.test.ts` — unit test for the fold curve.
- **Create** `src/engines/westcoast.ts` — the engine: `WEST_PARAMS`, `WestVoice` (audio graph), `WestEngine` (voice manager + modulation + UI), plugin factory. Cloned from `wavetable.ts`.
- **Create** `src/engines/westcoast.test.ts` — pure tests: param get/set, discrete handling, `applyPreset`.
- **Create** `src/engines/westcoast.dsp.test.ts` — DSP battery + fold/FM/ring/LPG characterization renders.
- **Create** `src/engines/westcoast-shared-mods.test.ts` — shared/per-voice modulation wiring.
- **Create** `public/presets/westcoast.json` — ≥20 presets.
- **Modify** `src/app/bpm-broadcast.ts:34` — add `'westcoast'` to `LANE_HOST_ENGINE_IDS`.
- **Modify** `src/presets/preset-sanity.test.ts:7` — add `'westcoast'` to `ENGINES`.
- **Modify** `src/engines/registry-boot.test.ts` — add side-effect import + `'westcoast'` to both `it.each` lists.
- **Modify** `src/styles/_knob.scss` — per-section knob accent colours for West.

---

## Task 1: Wavefolder transfer curve

**Files:**
- Create: `src/engines/westcoast-fold.ts`
- Test: `src/engines/westcoast-fold.test.ts`

The wavefolder is a `WaveShaperNode` whose curve folds the signal. Over the curve's input domain `[-1, 1]` the function folds `FOLD_STAGES` times: a signal pushed toward `±1` (by `foldDrive`) traverses many folds → many added harmonics; a signal near `0` passes almost linearly.

- [ ] **Step 1: Write the failing test**

```ts
// src/engines/westcoast-fold.test.ts
import { describe, it, expect } from 'vitest';
import { makeFoldCurve, FOLD_STAGES } from './westcoast-fold';

describe('westcoast wavefolder curve', () => {
  it('returns a curve of the requested length', () => {
    const c = makeFoldCurve(FOLD_STAGES, 2048);
    expect(c).toBeInstanceOf(Float32Array);
    expect(c.length).toBe(2048);
  });

  it('passes through the origin (no DC at input 0)', () => {
    const c = makeFoldCurve();
    const mid = c[Math.floor(c.length / 2)];
    expect(Math.abs(mid)).toBeLessThan(0.05);
  });

  it('folds: the curve is non-monotonic with many sign changes', () => {
    const c = makeFoldCurve(4);
    let signChanges = 0;
    for (let i = 1; i < c.length; i++) {
      if (Math.sign(c[i]) !== Math.sign(c[i - 1]) && c[i] !== 0) signChanges++;
    }
    // sin(x·4·π) over [-1,1] crosses zero ~8 times → at least 7 sign changes.
    expect(signChanges).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast-fold.test.ts`
Expected: FAIL — `Cannot find module './westcoast-fold'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/engines/westcoast-fold.ts
// Wavefolder transfer curve for the West Coast engine.
// A multi-fold sine over the input domain [-1, 1]: foldDrive pushes the signal
// toward the edges where the curve folds repeatedly, adding harmonics, while a
// signal near 0 passes almost linearly. Built once and shared by all voices.

export const FOLD_STAGES = 4;

export function makeFoldCurve(stages: number = FOLD_STAGES, n: number = 4096): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1..1
    curve[i] = Math.sin(x * stages * Math.PI);
  }
  return curve;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast-fold.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/westcoast-fold.ts src/engines/westcoast-fold.test.ts
git commit -m "feat(westcoast): wavefolder transfer curve"
```

---

## Task 2: Engine param schema + state API (pure)

**Files:**
- Create: `src/engines/westcoast.ts`
- Test: `src/engines/westcoast.test.ts`

This task creates the full engine file. The pure test drives the param/state/preset API; the rest of the class (voice graph, modulation, UI) is implemented now too so the file compiles and later DSP tasks have a complete engine to characterize.

- [ ] **Step 1: Write the failing test**

```ts
// src/engines/westcoast.test.ts
import { describe, it, expect } from 'vitest';
import { WestEngine } from './westcoast';

describe('WestEngine — param state', () => {
  it('exposes engine identity', () => {
    const e = new WestEngine();
    expect(e.id).toBe('westcoast');
    expect(e.type).toBe('polyhost');
    expect(e.polyphony).toBe('poly');
    expect(e.editor).toBe('piano-roll');
  });

  it('round-trips continuous params via get/set', () => {
    const e = new WestEngine();
    e.setBaseValue('timbre.fold', 0.7);
    expect(e.getBaseValue('timbre.fold')).toBeCloseTo(0.7);
    e.setBaseValue('lpg.cutoff', 0.42);
    expect(e.getBaseValue('lpg.cutoff')).toBeCloseTo(0.42);
  });

  it('stores discrete params as numeric indices', () => {
    const e = new WestEngine();
    e.setBaseValue('osc.mainWave', 2); // sawtooth
    expect(e.getBaseValue('osc.mainWave')).toBe(2);
    e.setBaseValue('lpg.mode', 1); // gate
    expect(e.getBaseValue('lpg.mode')).toBe(1);
  });

  it('clamps poly.voices to 1..16 and updates maxVoices', () => {
    const e = new WestEngine();
    e.setBaseValue('poly.voices', 99);
    expect(e.getBaseValue('poly.voices')).toBe(16);
    e.setBaseValue('poly.voices', 0);
    expect(e.getBaseValue('poly.voices')).toBe(1);
  });

  it('falls back to spec defaults for unset params', () => {
    const e = new WestEngine();
    expect(e.getBaseValue('osc.ratio')).toBe(2);
    expect(e.getBaseValue('contour.amount')).toBe(0.9);
  });

  it('applyPreset writes param values', () => {
    const e = new WestEngine();
    // applyPreset reads from the cached preset list; with no presets loaded in a
    // unit context it is a no-op, so drive setBaseValue directly to prove the
    // path the preset uses. (Preset JSON is covered in the preset-sanity test.)
    e.setBaseValue('timbre.fold', 0.9);
    e.setBaseValue('osc.subDiv', 1);
    expect(e.getBaseValue('timbre.fold')).toBeCloseTo(0.9);
    expect(e.getBaseValue('osc.subDiv')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.test.ts`
Expected: FAIL — `Cannot find module './westcoast'`.

- [ ] **Step 3: Write the implementation**

Create `src/engines/westcoast.ts` with the complete contents below.

```ts
// src/engines/westcoast.ts
// "West Coast" (Buchla-style) synthesis engine: a complex oscillator (two
// cross-modulating oscillators via linear FM + ring/AM, plus a sub-harmonic
// divider) → a wavefolder ("Timbre") → a low-pass gate (vactrol-style),
// driven by a built-in AD "contour". Generation by FOLDING + cross-modulation
// rather than subtractive filtering. All real-time nodes; every param is
// live-modulatable. Cloned from the wavetable.ts engine shape.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import {
  bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations,
} from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';
import { getCachedPresets } from '../presets/preset-loader';
import { velGain } from '../core/velocity-gain';
import { makeFoldCurve } from './westcoast-fold';

const MAIN_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sawtooth', label: 'Saw' },
];
const MOD_WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
];
const SUBDIV_OPTIONS = [
  { value: 'off', label: 'Off' }, { value: '2', label: '2' },
  { value: '3', label: '3' }, { value: '4', label: '4' },
];
const LPG_MODE_OPTIONS = [
  { value: 'lp', label: 'LP' }, { value: 'gate', label: 'Gate' }, { value: 'both', label: 'Both' },
];
const CONTOUR_MODE_OPTIONS = [
  { value: 'pluck', label: 'Pluck' }, { value: 'sustain', label: 'Sus' },
];
const ONOFF_OPTIONS = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
const POLY_MODE_OPTIONS = [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }];
const RETRIG_OPTIONS = [{ value: 'legato', label: 'Legato' }, { value: 'retrig', label: 'Retrig' }];

const MAIN_WAVE_VALUES = MAIN_WAVE_OPTIONS.map(o => o.value) as OscillatorType[];
const MOD_WAVE_VALUES = MOD_WAVE_OPTIONS.map(o => o.value) as OscillatorType[];
const SUBDIV_VALUES = [0, 2, 3, 4]; // index → divisor (0 = off)

const WEST_PARAMS: EngineParamSpec[] = [
  // Complex oscillator
  { id: 'osc.mainWave', label: 'Princ Wave', kind: 'discrete', min: 0, max: 2, default: 0, options: MAIN_WAVE_OPTIONS },
  { id: 'osc.modWave',  label: 'Mod Wave',   kind: 'discrete', min: 0, max: 1, default: 0, options: MOD_WAVE_OPTIONS },
  { id: 'osc.ratio',    label: 'Ratio',      kind: 'continuous', min: 0.25, max: 16, default: 2, unit: '×' },
  { id: 'osc.fmIndex',  label: 'FM Index',   kind: 'continuous', min: 0, max: 1, default: 0.2 },
  { id: 'osc.ring',     label: 'Ring/AM',    kind: 'continuous', min: 0, max: 1, default: 0 },
  { id: 'osc.subDiv',   label: 'Sub ÷',      kind: 'discrete', min: 0, max: 3, default: 0, options: SUBDIV_OPTIONS },
  { id: 'osc.subLevel', label: 'Sub Lvl',    kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'osc.detune',   label: 'Detune',     kind: 'continuous', min: -50, max: 50, default: 0, unit: '¢' },
  // Timbre (wavefolder)
  { id: 'timbre.fold',     label: 'Fold',     kind: 'continuous', min: 0, max: 1, default: 0.3 },
  { id: 'timbre.symmetry', label: 'Symmetry', kind: 'continuous', min: -1, max: 1, default: 0 },
  // Low-pass gate
  { id: 'lpg.mode',      label: 'Mode',      kind: 'discrete', min: 0, max: 2, default: 2, options: LPG_MODE_OPTIONS },
  { id: 'lpg.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0, max: 1, default: 0.6 },
  { id: 'lpg.resonance', label: 'Resonance', kind: 'continuous', min: 0, max: 1, default: 0.2 },
  // Contour
  { id: 'contour.mode',   label: 'Mode',    kind: 'discrete', min: 0, max: 1, default: 0, options: CONTOUR_MODE_OPTIONS },
  { id: 'contour.attack', label: 'Attack',  kind: 'continuous', min: 0.001, max: 2, default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'contour.decay',  label: 'Decay',   kind: 'continuous', min: 0.005, max: 4, default: 0.4, unit: 's', curve: 'exponential' },
  { id: 'contour.amount', label: 'Amount',  kind: 'continuous', min: 0, max: 1, default: 0.9 },
  { id: 'contour.cycle',  label: 'Cycle',   kind: 'discrete', min: 0, max: 1, default: 0, options: ONOFF_OPTIONS },
  // Amp / master
  { id: 'amp.level',   label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
  { id: 'master.tune', label: 'Tune',  kind: 'continuous', min: -12, max: 12, default: 0, unit: 'st' },
  // Poly
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16, default: 8 },
  { id: 'poly.mode',   label: 'Mode',   kind: 'discrete', min: 0, max: 1, default: 0, options: POLY_MODE_OPTIONS },
  { id: 'poly.retrig', label: 'Retrig', kind: 'discrete', min: 0, max: 1, default: 1, options: RETRIG_OPTIONS },
];

/** Operating ranges for the shared modBus AudioParams (native units). Must
 *  agree with WestVoice.getAudioParamRange so depth=1 swings equally whether
 *  the modulator is shared or per-voice. */
function sharedParamRange(shortId: string): { min: number; max: number } {
  switch (shortId) {
    case 'lpg.cutoff':    return { min: -4000, max: 4000 };
    case 'lpg.resonance': return { min: -10, max: 10 };
    case 'timbre.fold':   return { min: -1, max: 1 };
    case 'amp.gain':      return { min: 0, max: 1 };
    default:              return { min: 0, max: 1 };
  }
}

const FOLD_CURVE = makeFoldCurve();
// Holds the post-fold peak below 0 dBFS at accent + max fold (mirrors the
// OUTPUT_TRIM in wavetable.ts / fm.ts).
const OUTPUT_TRIM = 0.5;
// Hz the contour adds to the filter cutoff at amount=1 (LP / Both modes).
const CUTOFF_ENV_HZ = 6000;

function midiToHz(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }
function cutoffHz(norm: number): number { return Math.min(18000, 60 * Math.pow(220, norm)); }

class WestVoice implements Voice {
  readonly mainOsc: OscillatorNode;
  private modOsc: OscillatorNode;
  private subOsc: OscillatorNode;
  private fmDepth: GainNode;
  private ringMod: GainNode;
  private ringGain: GainNode;
  private mainGain: GainNode;
  private subGain: GainNode;
  private bias: ConstantSourceNode;
  private foldDrive: GainNode;
  private folder: WaveShaperNode;
  private lpgFilter: BiquadFilterNode;
  private lpgVCA: GainNode;
  private ampOut: GainNode;
  private contour: ConstantSourceNode;
  private cutoffBase: ConstantSourceNode;
  private cutoffEnvGain: GainNode;
  private vcaEnvGain: GainNode;
  private started = false;
  private stopScheduled = false;

  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getParam: (id: string) => number,
    private voiceMods: Map<string, ModulatorVoice>,
    modBus?: Record<string, ConstantSourceNode>,
  ) {
    this.mainOsc = ctx.createOscillator();
    this.modOsc = ctx.createOscillator();
    this.subOsc = ctx.createOscillator();
    this.fmDepth = ctx.createGain();
    this.ringMod = ctx.createGain(); this.ringMod.gain.value = 0;
    this.ringGain = ctx.createGain(); this.ringGain.gain.value = 0;
    this.mainGain = ctx.createGain(); this.mainGain.gain.value = 0;
    this.subGain = ctx.createGain(); this.subGain.gain.value = 0;
    this.bias = ctx.createConstantSource(); this.bias.offset.value = 0; this.bias.start();
    this.foldDrive = ctx.createGain(); this.foldDrive.gain.value = 0.1;
    this.folder = ctx.createWaveShaper();
    (this.folder as { curve: Float32Array | null }).curve = FOLD_CURVE;
    this.folder.oversample = '4x';
    this.lpgFilter = ctx.createBiquadFilter(); this.lpgFilter.type = 'lowpass';
    this.lpgVCA = ctx.createGain(); this.lpgVCA.gain.value = 0;
    this.ampOut = ctx.createGain(); this.ampOut.gain.value = 1;
    this.contour = ctx.createConstantSource(); this.contour.offset.value = 0; this.contour.start();
    this.cutoffBase = ctx.createConstantSource(); this.cutoffBase.offset.value = 0; this.cutoffBase.start();
    this.cutoffEnvGain = ctx.createGain(); this.cutoffEnvGain.gain.value = 0;
    this.vcaEnvGain = ctx.createGain(); this.vcaEnvGain.gain.value = 0;

    // Complex oscillator wiring.
    this.modOsc.connect(this.fmDepth).connect(this.mainOsc.frequency); // linear FM
    this.mainOsc.connect(this.ringMod);                                 // ring/AM
    this.modOsc.connect(this.ringMod.gain);
    this.ringMod.connect(this.ringGain);
    this.mainOsc.connect(this.mainGain);                                // dry
    this.subOsc.connect(this.subGain);                                  // sub
    // Sum osc paths + DC bias into the folder drive.
    this.mainGain.connect(this.foldDrive);
    this.ringGain.connect(this.foldDrive);
    this.subGain.connect(this.foldDrive);
    this.bias.connect(this.foldDrive);
    // Wavefolder → low-pass gate → output.
    this.foldDrive.connect(this.folder);
    this.folder.connect(this.lpgFilter).connect(this.lpgVCA).connect(this.ampOut).connect(output);
    // Cutoff: base + contour-driven env into filter frequency.
    this.lpgFilter.frequency.value = 0;
    this.cutoffBase.connect(this.lpgFilter.frequency);
    this.contour.connect(this.cutoffEnvGain).connect(this.lpgFilter.frequency);
    // VCA: contour-driven gate.
    this.contour.connect(this.vcaEnvGain).connect(this.lpgVCA.gain);

    // Shared modulation bus fan-in (one connection regardless of voice count).
    if (modBus) {
      modBus['lpg.cutoff'].connect(this.lpgFilter.frequency);
      modBus['lpg.resonance'].connect(this.lpgFilter.Q);
      modBus['amp.gain'].connect(this.ampOut.gain);
      modBus['timbre.fold'].connect(this.foldDrive.gain);
    }
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['amp.gain',         this.ampOut.gain],
      ['lpg.cutoff',       this.lpgFilter.frequency],
      ['lpg.resonance',    this.lpgFilter.Q],
      ['timbre.fold',      this.foldDrive.gain],
      ['timbre.symmetry',  this.bias.offset],
      ['osc.fmIndex',      this.fmDepth.gain],
      ['osc.ring',         this.ringGain.gain],
      ['osc.detune',       this.mainOsc.detune],
    ]);
  }

  getAudioParamRange(shortId: string): { min: number; max: number } | undefined {
    switch (shortId) {
      case 'lpg.cutoff':    return { min: -4000, max: 4000 };
      case 'lpg.resonance': return { min: -10, max: 10 };
      case 'timbre.fold':   return { min: -1, max: 1 };
      case 'timbre.symmetry': return { min: -1, max: 1 };
      case 'osc.fmIndex':   return { min: -2000, max: 2000 };
      case 'osc.detune':    return { min: -1200, max: 1200 };
      default: return undefined; // amp.gain, osc.ring fall back to 0..1
    }
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }
    const p = this.getParam;
    const note = midiToHz(midi);
    const tuneCents = p('master.tune') * 100;
    const detune = p('osc.detune');
    const ratio = p('osc.ratio');
    const fmIndex = p('osc.fmIndex');
    const ring = p('osc.ring');
    const subDiv = SUBDIV_VALUES[Math.round(p('osc.subDiv'))] ?? 0;
    const subLevel = p('osc.subLevel');
    const fold = p('timbre.fold');
    const symmetry = p('timbre.symmetry');
    const mode = Math.round(p('lpg.mode'));   // 0 lp, 1 gate, 2 both
    const filterMode = mode === 0 || mode === 2;
    const vcaMode = mode === 1 || mode === 2;
    const cutoff = p('lpg.cutoff');
    const res = p('lpg.resonance');
    const cmode = Math.round(p('contour.mode')); // 0 pluck, 1 sustain
    const atk = Math.max(0.001, p('contour.attack'));
    const dec = Math.max(0.005, p('contour.decay'));
    const amount = p('contour.amount');
    const cycle = Math.round(p('contour.cycle')) >= 1;
    const level = p('amp.level');
    const accentMul = options.accent ? 1.3 : 1.0;
    const vel = velGain(options.velocity, !!options.accent);

    // Oscillators.
    this.mainOsc.type = MAIN_WAVE_VALUES[Math.round(p('osc.mainWave'))] ?? 'sine';
    this.modOsc.type = MOD_WAVE_VALUES[Math.round(p('osc.modWave'))] ?? 'sine';
    this.subOsc.type = 'sine';
    this.mainOsc.frequency.setValueAtTime(note, time);
    this.mainOsc.detune.setValueAtTime(detune + tuneCents, time);
    this.modOsc.frequency.setValueAtTime(note * ratio, time);
    this.modOsc.detune.setValueAtTime(tuneCents, time);
    this.subOsc.frequency.setValueAtTime(subDiv > 0 ? note / subDiv : note, time);
    this.subOsc.detune.setValueAtTime(tuneCents, time);

    // Linear FM depth (Hz) ≈ index × modFreq × 2.
    this.fmDepth.gain.setValueAtTime(fmIndex * note * ratio * 2, time);

    // Oscillator mix.
    this.mainGain.gain.setValueAtTime(0.7, time);
    this.ringGain.gain.setValueAtTime(ring, time);
    this.subGain.gain.setValueAtTime(subDiv > 0 ? subLevel : 0, time);

    // Wavefolder: foldDrive sweeps the signal across the fold curve; bias = asymmetry.
    this.foldDrive.gain.setValueAtTime((0.1 + fold * 0.9) * accentMul, time);
    this.bias.offset.setValueAtTime(symmetry * 0.5, time);

    // Low-pass gate base + per-mode routing.
    this.lpgFilter.Q.setValueAtTime(0.5 + res * 20, time);
    this.cutoffBase.offset.setValueAtTime(cutoffHz(cutoff), time);
    this.cutoffEnvGain.gain.setValueAtTime(filterMode ? CUTOFF_ENV_HZ * accentMul : 0, time);
    this.vcaEnvGain.gain.setValueAtTime(vcaMode ? 1 : 0, time);
    this.lpgVCA.gain.setValueAtTime(vcaMode ? 0 : 1, time);

    // Output level (velocity + trim). amp.gain modBus sums on top.
    this.ampOut.gain.setValueAtTime(level * vel * OUTPUT_TRIM, time);

    // Contour AD (vactrol-style exponential decay via setTargetAtTime).
    const peak = amount;
    const gateEnd = time + options.gateDuration;
    this.contour.offset.cancelScheduledValues(time);
    this.contour.offset.setValueAtTime(0, time);
    this.contour.offset.linearRampToValueAtTime(peak, time + atk);
    let tailEnd: number;
    if (cmode === 1 && !cycle) {
      // Sustain: hold until gate end, then exponential release over decay.
      this.contour.offset.setValueAtTime(peak, gateEnd);
      this.contour.offset.setTargetAtTime(0, gateEnd, dec / 3);
      tailEnd = gateEnd + dec * 3;
    } else {
      // Pluck (and cycle base shape): exponential decay after attack, gate-independent.
      this.contour.offset.setTargetAtTime(0, time + atk, dec / 3);
      tailEnd = time + atk + dec * 3;
    }
    if (cycle) {
      // Re-trigger the AD shape on a loop → free-running LFO-like contour.
      const period = atk + dec;
      const until = Math.max(tailEnd, gateEnd);
      let t = time + period;
      while (t < until + period) {
        this.contour.offset.setValueAtTime(0, t);
        this.contour.offset.linearRampToValueAtTime(peak, t + atk);
        this.contour.offset.setTargetAtTime(0, t + atk, dec / 3);
        t += period;
      }
      tailEnd = t;
    }

    if (!this.started) {
      this.mainOsc.start(time); this.modOsc.start(time); this.subOsc.start(time);
      this.started = true;
    }
    const stopTime = Math.max(tailEnd, gateEnd) + 0.1;
    this.mainOsc.stop(stopTime); this.modOsc.stop(stopTime); this.subOsc.stop(stopTime);
    this.stopScheduled = true;
  }

  release(time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(time);
    // Fast gate-close on the contour (closes VCA in gate/both modes; closes the
    // filter env in lp/both). Mirrors the wavetable release-cut pattern.
    this.contour.offset.cancelScheduledValues(time);
    this.contour.offset.linearRampToValueAtTime(0, time + 0.02);
  }

  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    if (!this.stopScheduled && this.started) {
      try { this.mainOsc.stop(); } catch {}
      try { this.modOsc.stop(); } catch {}
      try { this.subOsc.stop(); } catch {}
      this.stopScheduled = true;
    }
    try { this.bias.stop(); } catch {}
    try { this.contour.stop(); } catch {}
    try { this.cutoffBase.stop(); } catch {}
    this.mainOsc.disconnect(); this.modOsc.disconnect(); this.subOsc.disconnect();
    this.fmDepth.disconnect(); this.ringMod.disconnect(); this.ringGain.disconnect();
    this.mainGain.disconnect(); this.subGain.disconnect(); this.bias.disconnect();
    this.foldDrive.disconnect(); this.folder.disconnect();
    this.lpgFilter.disconnect(); this.lpgVCA.disconnect(); this.ampOut.disconnect();
    this.contour.disconnect(); this.cutoffBase.disconnect();
    this.cutoffEnvGain.disconnect(); this.vcaEnvGain.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class WestSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

export class WestEngine implements SynthEngine {
  readonly id = 'westcoast';
  readonly name = 'West';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = WEST_PARAMS;
  get presets(): import('./engine-types').EnginePreset[] {
    return getCachedPresets('westcoast');
  }

  private paramValues: Record<string, number> = {};
  bpm = 120;
  maxVoices = 8;
  private activeVoices: WestVoice[] = [];
  private currentLaneId: string | null = null;

  readonly modBus?: Record<string, ConstantSourceNode>;
  private engineModVoices: Map<string, ModulatorVoice> | null = null;

  private modHost = new ModulationHostImpl([
    { ...makeDefaultADSR('adsr1'), connections: [{ id: 'c-fold', paramId: 'timbre.fold', depth: 0 }] },
    { ...makeDefaultADSR('adsr2'), connections: [{ id: 'c-cut', paramId: 'lpg.cutoff', depth: 0 }] },
    makeDefaultLFO('lfo1'),
    { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
  ]);
  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of WEST_PARAMS) this.paramValues[p.id] = p.default;
  }

  activeVoiceCount(): number { return this.activeVoices.length; }

  private stealOldest(n: number): void {
    const toSteal = this.activeVoices.splice(0, n);
    for (const v of toSteal) v.dispose();
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? WEST_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      const cap = Math.max(1, Math.min(16, Math.round(v)));
      this.maxVoices = cap;
      this.paramValues[id] = cap;
      if (this.activeVoices.length > cap) this.stealOldest(this.activeVoices.length - cap);
      return;
    }
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, val] of Object.entries(preset.params)) {
      if (typeof val === 'number') this.setBaseValue(k, val);
    }
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.modBus) {
      const mk = () => { const n = ctx.createConstantSource(); n.offset.value = 0; n.start(); return n; };
      (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
        'lpg.cutoff': mk(), 'lpg.resonance': mk(), 'amp.gain': mk(), 'timbre.fold': mk(),
      };
    }
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const sharedLaneId = getCurrentLaneForVoice();
      if (sharedLaneId) {
        bindEngineModulators({
          laneId: sharedLaneId, engine: this, voiceMods: this.engineModVoices, ctx,
          rangeLookup: (shortId) => sharedParamRange(shortId),
        });
      }
    }
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    const voice = new WestVoice(ctx, output, (id) => this.getBaseValue(id), voiceMods, this.modBus);
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      const engineMods = this.engineModVoices ?? new Map();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.binder = bindVoiceModulators({
        laneId, engine: this, voice, voiceMods: combinedMods, ctx, voicePool: this.maxVoices,
      });
      this.currentLaneId = laneId;
    }
    this.activeVoices.push(voice);
    if (this.activeVoices.length > this.maxVoices) {
      this.stealOldest(this.activeVoices.length - this.maxVoices);
    }
    voice.mainOsc.addEventListener('ended', () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    });
    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.modBus) return new Map();
    return new Map<string, AudioParam>([
      ['lpg.cutoff',    this.modBus['lpg.cutoff'].offset],
      ['lpg.resonance', this.modBus['lpg.resonance'].offset],
      ['amp.gain',      this.modBus['amp.gain'].offset],
      ['timbre.fold',   this.modBus['timbre.fold'].offset],
    ]);
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new WestSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmt = (id: string, v: number): string => {
      if (id === 'osc.ratio') return `${v.toFixed(2)}×`;
      if (id === 'osc.detune') return `${v.toFixed(0)}¢`;
      if (id === 'master.tune') return `${v.toFixed(0)}st`;
      if (id === 'poly.voices') return String(Math.round(v));
      if (id.endsWith('.attack') || id.endsWith('.decay')) {
        return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
      }
      return `${Math.round(v * 100)}%`;
    };

    const section = (labelText: string, accentClass: string, ids: string[]): void => {
      const row = document.createElement('div');
      row.className = 'row'; // same pattern as Subtractive's section rows
      const lab = document.createElement('div');
      lab.className = 'section-label'; // existing class used by subtractive.ts
      lab.textContent = labelText;
      row.appendChild(lab);
      const knobRow = document.createElement('div');
      knobRow.className = `knob-row ${accentClass}`;
      row.appendChild(knobRow);
      container.appendChild(row);
      wireEngineParams(this, ctx, knobRow, {
        filter: (id) => ids.includes(id),
        formatter: fmt,
      });
    };

    section('POLY', 'west-poly-knobs', ['poly.mode', 'poly.retrig', 'poly.voices']);
    section('COMPLEX OSCILLATOR', 'west-osc-knobs',
      ['osc.mainWave', 'osc.modWave', 'osc.ratio', 'osc.fmIndex', 'osc.ring', 'osc.subDiv', 'osc.subLevel', 'osc.detune']);
    section('TIMBRE', 'west-timbre-knobs', ['timbre.fold', 'timbre.symmetry']);
    section('LOW-PASS GATE', 'west-lpg-knobs', ['lpg.mode', 'lpg.cutoff', 'lpg.resonance']);
    section('CONTOUR', 'west-contour-knobs',
      ['contour.mode', 'contour.attack', 'contour.decay', 'contour.amount', 'contour.cycle']);
    section('AMP', 'west-amp-knobs', ['amp.level', 'master.tune']);

    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      historyDeps: ctx.historyDeps,
      laneInserts: ctx.laneInserts,
      masterInserts: ctx.masterInserts,
      fxBus: ctx.fxBus,
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  dispose(): void {
    for (const v of this.activeVoices) v.dispose();
    this.activeVoices = [];
  }
}

export const westEngine = new WestEngine();
registerEngine(westEngine);
registerEngineFactory('westcoast', () => new WestEngine());

export const westcoastPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'westcoast',
    name: 'West',
    kind: 'synth',
    version: '1.0.0',
    params: westEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new WestEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `curve: 'exponential'` is rejected on `EngineParamSpec`, check `engine-params.ts` for the exact optional field name and match it; the other engines use the same `curve` field.)

- [ ] **Step 6: Commit**

```bash
git add src/engines/westcoast.ts src/engines/westcoast.test.ts
git commit -m "feat(westcoast): engine, voice graph, param state, modulation, UI"
```

---

## Task 3: DSP battery (audible, no-clip, release, accent, cutoff)

**Files:**
- Create: `src/engines/westcoast.dsp.test.ts`

The shared battery is the gating test for the whole voice graph. If any assertion fails, fix `WestVoice` (do not weaken the assertion).

- [ ] **Step 1: Write the test**

```ts
// src/engines/westcoast.dsp.test.ts
// Layer-3: real DSP tests for the West Coast engine.
import { describe, it, expect } from 'vitest';
import { WestEngine } from './westcoast';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'westcoast',
  createEngine: () => new WestEngine(),
  cutoffParamId: 'lpg.cutoff',
  maxOutParams: {
    'timbre.fold': 1.0,
    'lpg.cutoff': 0.95,
    'lpg.resonance': 0.9,
    'osc.fmIndex': 1.0,
  },
  midi: 48,
});
```

- [ ] **Step 2: Run the battery**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.dsp.test.ts`
Expected: PASS — `produces audible sound`, `does not clip`, `opening filter cutoff raises spectral centroid`, `accent raises RMS`, `release cuts the gate`.

Notes if a check fails:
- *No sound:* the default `lpg.mode` is `both` (index 2), so the contour must open both the VCA (`vcaEnvGain.gain=1`, `lpgVCA.gain` base 0) and the filter env. Verify `contour` is `start()`ed and routed.
- *Clips:* lower `OUTPUT_TRIM` (currently 0.5).
- *Release tail not quiet:* default mode `both` closes the VCA on `release()`; confirm `release()` ramps `contour.offset` to 0.

- [ ] **Step 3: Commit**

```bash
git add src/engines/westcoast.dsp.test.ts
git commit -m "test(westcoast): standard DSP battery"
```

---

## Task 4: Wavefolder characterization

**Files:**
- Modify: `src/engines/westcoast.dsp.test.ts` (append)

Prove that raising `timbre.fold` adds harmonics (higher spectral centroid).

- [ ] **Step 1: Append the test**

```ts
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

describe('westcoast — wavefolder', () => {
  const SR = 44100;
  const render = (fold: number) => {
    const engine = new WestEngine();
    engine.setBaseValue('timbre.fold', fold);
    engine.setBaseValue('lpg.mode', 1); // gate: keep filter wide open so fold's
    engine.setBaseValue('lpg.cutoff', 1); // harmonics are not filtered away
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.3, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }] },
    );
  };

  it('more fold raises the spectral centroid', async () => {
    const low = await render(0.0);
    const hi = await render(1.0);
    writeWav(low, wavPath('westcoast__fold-low'), SR);
    writeWav(hi, wavPath('westcoast__fold-hi'), SR);
    expect(spectralCentroid(hi, SR)).toBeGreaterThan(spectralCentroid(low, SR) * 1.3);
  });
});
```

- [ ] **Step 2: Run**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.dsp.test.ts -t wavefolder`
Expected: PASS. If centroid doesn't rise enough, increase the fold-curve `FOLD_STAGES` or the `foldDrive` range `(0.1 + fold*0.9)` toward `(0.1 + fold*1.4)` in `WestVoice.trigger` — keep the no-clip battery green after.

- [ ] **Step 3: Commit**

```bash
git add src/engines/westcoast.dsp.test.ts
git commit -m "test(westcoast): wavefolder adds harmonics"
```

---

## Task 5: Complex-oscillator characterization (FM + ring)

**Files:**
- Modify: `src/engines/westcoast.dsp.test.ts` (append)

Prove FM and ring/AM add inharmonic content (the rendered spectrum changes materially vs. the clean carrier).

- [ ] **Step 1: Append the test**

```ts
import { rms } from '../../test/dsp-asserts';

describe('westcoast — complex oscillator', () => {
  const SR = 44100;
  const renderWith = (setup: (e: WestEngine) => void) => {
    const engine = new WestEngine();
    engine.setBaseValue('timbre.fold', 0); // isolate osc interaction from folding
    engine.setBaseValue('lpg.mode', 1);
    engine.setBaseValue('lpg.cutoff', 1);
    setup(engine);
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.3, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }] },
    );
  };

  it('FM index raises the spectral centroid (sidebands)', async () => {
    const clean = await renderWith((e) => e.setBaseValue('osc.fmIndex', 0));
    const fm = await renderWith((e) => { e.setBaseValue('osc.fmIndex', 1); e.setBaseValue('osc.ratio', 3); });
    writeWav(clean, wavPath('westcoast__fm-off'), SR);
    writeWav(fm, wavPath('westcoast__fm-on'), SR);
    expect(spectralCentroid(fm, SR)).toBeGreaterThan(spectralCentroid(clean, SR) * 1.2);
  });

  it('ring/AM produces audible output', async () => {
    const ring = await renderWith((e) => { e.setBaseValue('osc.ring', 1); e.setBaseValue('osc.ratio', 1.5); });
    writeWav(ring, wavPath('westcoast__ring'), SR);
    expect(rms(ring)).toBeGreaterThan(0.001);
  });
});
```

- [ ] **Step 2: Run**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.dsp.test.ts -t "complex oscillator"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/westcoast.dsp.test.ts
git commit -m "test(westcoast): FM + ring add inharmonic content"
```

---

## Task 6: Low-pass gate + contour characterization

**Files:**
- Modify: `src/engines/westcoast.dsp.test.ts` (append)

Prove the contour shapes the LPG: a short pluck contour decays to near-silence well before a long one.

- [ ] **Step 1: Append the test**

```ts
describe('westcoast — low-pass gate contour', () => {
  const SR = 44100;
  const renderDecay = (decay: number) => {
    const engine = new WestEngine();
    engine.setBaseValue('contour.mode', 0); // pluck
    engine.setBaseValue('contour.decay', decay);
    engine.setBaseValue('lpg.mode', 2); // both
    return renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      { durationSec: 0.6, sampleRate: SR,
        events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.5 }] },
    );
  };

  it('a short pluck decays faster than a long one', async () => {
    const shortP = await renderDecay(0.05);
    const longP = await renderDecay(0.5);
    writeWav(shortP, wavPath('westcoast__pluck-short'), SR);
    writeWav(longP, wavPath('westcoast__pluck-long'), SR);
    // Measure RMS over the window 0.2s..0.4s: the long contour still rings there,
    // the short one is essentially gone.
    const win = (b: Float32Array) => b.subarray(Math.round(0.2 * SR), Math.round(0.4 * SR));
    expect(rms(win(longP))).toBeGreaterThan(rms(win(shortP)) * 3);
  });
});
```

- [ ] **Step 2: Run**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast.dsp.test.ts -t "low-pass gate"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/westcoast.dsp.test.ts
git commit -m "test(westcoast): contour shapes the low-pass gate"
```

---

## Task 7: Shared + per-voice modulation wiring

**Files:**
- Create: `src/engines/westcoast-shared-mods.test.ts`

Mirror `subtractive-shared-mods.test.ts`: shared modulator voices are reused across `createVoice` calls and `getSharedAudioParams` returns the modBus offsets.

- [ ] **Step 1: Write the test**

```ts
// src/engines/westcoast-shared-mods.test.ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { WestEngine } from './westcoast';
import { setCurrentLaneForVoice } from '../modulation/active-mods';

describe('WestEngine — shared modulators + modBus', () => {
  it('createVoice reuses the same engineModVoices across calls', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    setCurrentLaneForVoice('westcoast-1');
    engine.createVoice(ctx, ctx.destination);
    const first = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    engine.createVoice(ctx, ctx.destination);
    const second = (engine as unknown as { engineModVoices: unknown }).engineModVoices;
    setCurrentLaneForVoice(null);
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });

  it('getSharedAudioParams returns the modBus offsets after first createVoice', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    engine.createVoice(ctx, ctx.destination);
    const shared = engine.getSharedAudioParams?.(ctx) ?? new Map();
    expect(shared.get('lpg.cutoff')).toBeDefined();
    expect(shared.get('lpg.resonance')).toBeDefined();
    expect(shared.get('amp.gain')).toBeDefined();
    expect(shared.get('timbre.fold')).toBeDefined();
  });

  it('a voice exposes the modulatable AudioParams', () => {
    const engine = new WestEngine();
    const ctx = new AudioContext();
    const voice = engine.createVoice(ctx, ctx.destination);
    const params = voice.getAudioParams();
    for (const id of ['amp.gain', 'lpg.cutoff', 'lpg.resonance', 'timbre.fold', 'osc.fmIndex']) {
      expect(params.get(id), `missing ${id}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run**

Run: `NO_COLOR=1 npx vitest run src/engines/westcoast-shared-mods.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/engines/westcoast-shared-mods.test.ts
git commit -m "test(westcoast): shared/per-voice modulation wiring"
```

---

## Task 8: Presets JSON (≥20)

**Files:**
- Create: `public/presets/westcoast.json`
- Modify: `src/presets/preset-sanity.test.ts:7`

`preset-sanity.test.ts` requires ≥20 presets, unique names, gm integers in `[0,128)`, and a params object. Add `westcoast` to its `ENGINES` list and ship the JSON.

- [ ] **Step 1: Add `westcoast` to the sanity list**

In `src/presets/preset-sanity.test.ts`, change line 7:

```ts
const ENGINES = ['tb303', 'fm', 'wavetable', 'karplus', 'subtractive', 'drums-machine', 'westcoast'];
```

- [ ] **Step 2: Run to verify it FAILS (no JSON yet)**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-sanity.test.ts`
Expected: FAIL for `westcoast` — `file exists and parses` / `has at least the minimum count`.

- [ ] **Step 3: Create the presets file**

Create `public/presets/westcoast.json` (24 presets — exercises bass/pluck/bell/perc/drone/lead/FX; params use the `WEST_PARAMS` ids; discrete params are indices):

```json
{
  "engineId": "westcoast",
  "presets": [
    { "name": "BASS Fold Sub",        "gm": [38, 39], "params": { "osc.mainWave": 0, "osc.ratio": 2, "osc.fmIndex": 0.15, "osc.subDiv": 1, "osc.subLevel": 0.6, "timbre.fold": 0.35, "timbre.symmetry": 0.0, "lpg.mode": 2, "lpg.cutoff": 0.45, "lpg.resonance": 0.2, "contour.mode": 0, "contour.attack": 0.003, "contour.decay": 0.25, "contour.amount": 0.95, "amp.level": 0.85 } },
    { "name": "BASS Growl FM",        "gm": [38, 87], "params": { "osc.mainWave": 1, "osc.ratio": 1.5, "osc.fmIndex": 0.45, "osc.subDiv": 1, "osc.subLevel": 0.4, "timbre.fold": 0.5, "lpg.mode": 2, "lpg.cutoff": 0.5, "lpg.resonance": 0.3, "contour.mode": 0, "contour.attack": 0.004, "contour.decay": 0.3, "contour.amount": 0.9, "amp.level": 0.8 } },
    { "name": "BASS Round Wood",      "gm": [33, 35], "params": { "osc.mainWave": 0, "osc.ratio": 2, "osc.fmIndex": 0.1, "osc.subDiv": 1, "osc.subLevel": 0.5, "timbre.fold": 0.2, "lpg.mode": 2, "lpg.cutoff": 0.4, "lpg.resonance": 0.15, "contour.mode": 0, "contour.attack": 0.005, "contour.decay": 0.35, "contour.amount": 0.9, "amp.level": 0.85 } },
    { "name": "PLUCK Buchla Bongo",   "gm": [12, 13], "params": { "osc.mainWave": 0, "osc.ratio": 3.5, "osc.fmIndex": 0.3, "timbre.fold": 0.4, "timbre.symmetry": 0.2, "lpg.mode": 2, "lpg.cutoff": 0.7, "lpg.resonance": 0.25, "contour.mode": 0, "contour.attack": 0.002, "contour.decay": 0.12, "contour.amount": 0.95, "amp.level": 0.8 } },
    { "name": "PLUCK Wood Tine",      "gm": [12, 11], "params": { "osc.mainWave": 1, "osc.ratio": 2, "osc.fmIndex": 0.2, "timbre.fold": 0.3, "lpg.mode": 2, "lpg.cutoff": 0.65, "lpg.resonance": 0.2, "contour.mode": 0, "contour.attack": 0.002, "contour.decay": 0.18, "contour.amount": 0.9, "amp.level": 0.8 } },
    { "name": "PLUCK Glass Drop",     "gm": [9, 10],  "params": { "osc.mainWave": 0, "osc.ratio": 4, "osc.fmIndex": 0.25, "timbre.fold": 0.5, "lpg.mode": 2, "lpg.cutoff": 0.8, "lpg.resonance": 0.35, "contour.mode": 0, "contour.attack": 0.001, "contour.decay": 0.2, "contour.amount": 0.95, "amp.level": 0.78 } },
    { "name": "BELL Metallic",        "gm": [14, 98], "params": { "osc.mainWave": 0, "osc.ratio": 3.17, "osc.fmIndex": 0.6, "osc.ring": 0.4, "timbre.fold": 0.45, "lpg.mode": 2, "lpg.cutoff": 0.85, "lpg.resonance": 0.4, "contour.mode": 0, "contour.attack": 0.002, "contour.decay": 0.6, "contour.amount": 0.95, "amp.level": 0.75 } },
    { "name": "BELL Gong",            "gm": [14, 9],  "params": { "osc.mainWave": 0, "osc.ratio": 2.76, "osc.fmIndex": 0.55, "osc.ring": 0.5, "timbre.fold": 0.5, "lpg.mode": 2, "lpg.cutoff": 0.7, "lpg.resonance": 0.3, "contour.mode": 0, "contour.attack": 0.003, "contour.decay": 1.2, "contour.amount": 0.95, "amp.level": 0.72 } },
    { "name": "BELL Crystal Ring",    "gm": [98, 99], "params": { "osc.mainWave": 0, "osc.ratio": 5, "osc.fmIndex": 0.35, "osc.ring": 0.6, "timbre.fold": 0.4, "lpg.mode": 2, "lpg.cutoff": 0.9, "lpg.resonance": 0.45, "contour.mode": 0, "contour.attack": 0.001, "contour.decay": 0.7, "contour.amount": 0.95, "amp.level": 0.72 } },
    { "name": "PERC Click Tone",      "gm": [115],    "params": { "osc.mainWave": 0, "osc.ratio": 6, "osc.fmIndex": 0.5, "timbre.fold": 0.6, "lpg.mode": 2, "lpg.cutoff": 0.85, "lpg.resonance": 0.3, "contour.mode": 0, "contour.attack": 0.001, "contour.decay": 0.08, "contour.amount": 0.95, "amp.level": 0.8 } },
    { "name": "PERC Metal Hit",       "gm": [115, 119], "params": { "osc.mainWave": 0, "osc.ratio": 7.3, "osc.fmIndex": 0.7, "osc.ring": 0.5, "timbre.fold": 0.7, "lpg.mode": 2, "lpg.cutoff": 0.9, "lpg.resonance": 0.35, "contour.mode": 0, "contour.attack": 0.001, "contour.decay": 0.15, "contour.amount": 0.95, "amp.level": 0.75 } },
    { "name": "LEAD Fold Solo",       "gm": [81, 82], "params": { "osc.mainWave": 2, "osc.ratio": 1, "osc.fmIndex": 0.15, "timbre.fold": 0.45, "lpg.mode": 0, "lpg.cutoff": 0.7, "lpg.resonance": 0.25, "contour.mode": 1, "contour.attack": 0.01, "contour.decay": 0.3, "contour.amount": 0.85, "amp.level": 0.78 } },
    { "name": "LEAD Ring Mod",        "gm": [81, 84], "params": { "osc.mainWave": 0, "osc.ratio": 1.5, "osc.fmIndex": 0.2, "osc.ring": 0.7, "timbre.fold": 0.4, "lpg.mode": 0, "lpg.cutoff": 0.75, "lpg.resonance": 0.3, "contour.mode": 1, "contour.attack": 0.01, "contour.decay": 0.3, "contour.amount": 0.85, "amp.level": 0.75 } },
    { "name": "LEAD Bright Buzz",     "gm": [80, 81], "params": { "osc.mainWave": 2, "osc.ratio": 2, "osc.fmIndex": 0.3, "timbre.fold": 0.55, "lpg.mode": 0, "lpg.cutoff": 0.8, "lpg.resonance": 0.2, "contour.mode": 1, "contour.attack": 0.008, "contour.decay": 0.25, "contour.amount": 0.88, "amp.level": 0.76 } },
    { "name": "PAD Fold Drone",       "gm": [89, 90], "params": { "osc.mainWave": 0, "osc.ratio": 2, "osc.fmIndex": 0.1, "timbre.fold": 0.3, "lpg.mode": 0, "lpg.cutoff": 0.55, "lpg.resonance": 0.15, "contour.mode": 1, "contour.attack": 0.8, "contour.decay": 1.5, "contour.amount": 0.8, "amp.level": 0.7 } },
    { "name": "PAD Harmonic Swell",   "gm": [89, 95], "params": { "osc.mainWave": 0, "osc.ratio": 3, "osc.fmIndex": 0.2, "timbre.fold": 0.4, "timbre.symmetry": 0.3, "lpg.mode": 0, "lpg.cutoff": 0.6, "lpg.resonance": 0.2, "contour.mode": 1, "contour.attack": 1.2, "contour.decay": 2.0, "contour.amount": 0.82, "amp.level": 0.68 } },
    { "name": "PAD Glass Air",        "gm": [88, 92], "params": { "osc.mainWave": 0, "osc.ratio": 4, "osc.fmIndex": 0.15, "osc.ring": 0.3, "timbre.fold": 0.35, "lpg.mode": 0, "lpg.cutoff": 0.62, "lpg.resonance": 0.25, "contour.mode": 1, "contour.attack": 1.0, "contour.decay": 1.8, "contour.amount": 0.8, "amp.level": 0.66 } },
    { "name": "DRONE Sub Fold",       "gm": [96],     "params": { "osc.mainWave": 0, "osc.ratio": 2, "osc.fmIndex": 0.25, "osc.subDiv": 2, "osc.subLevel": 0.5, "timbre.fold": 0.5, "lpg.mode": 0, "lpg.cutoff": 0.5, "lpg.resonance": 0.3, "contour.mode": 1, "contour.attack": 1.5, "contour.decay": 2.5, "contour.amount": 0.78, "amp.level": 0.7 } },
    { "name": "FX Cycle Burst",       "gm": [100, 102], "params": { "osc.mainWave": 0, "osc.ratio": 3, "osc.fmIndex": 0.4, "timbre.fold": 0.5, "lpg.mode": 2, "lpg.cutoff": 0.7, "lpg.resonance": 0.4, "contour.mode": 0, "contour.attack": 0.02, "contour.decay": 0.08, "contour.amount": 0.9, "contour.cycle": 1, "amp.level": 0.72 } },
    { "name": "FX Ring Sweep",        "gm": [100, 103], "params": { "osc.mainWave": 0, "osc.ratio": 5.5, "osc.fmIndex": 0.5, "osc.ring": 0.8, "timbre.fold": 0.6, "lpg.mode": 2, "lpg.cutoff": 0.6, "lpg.resonance": 0.5, "contour.mode": 0, "contour.attack": 0.05, "contour.decay": 0.5, "contour.amount": 0.9, "amp.level": 0.68 } },
    { "name": "FX Inharmonic Pad",    "gm": [101, 103], "params": { "osc.mainWave": 0, "osc.ratio": 2.41, "osc.fmIndex": 0.6, "osc.ring": 0.5, "timbre.fold": 0.45, "lpg.mode": 0, "lpg.cutoff": 0.58, "lpg.resonance": 0.35, "contour.mode": 1, "contour.attack": 1.4, "contour.decay": 2.2, "contour.amount": 0.78, "amp.level": 0.66 } },
    { "name": "FX Sci-Fi Cycle",      "gm": [97, 102], "params": { "osc.mainWave": 1, "osc.ratio": 4.7, "osc.fmIndex": 0.55, "timbre.fold": 0.65, "lpg.mode": 2, "lpg.cutoff": 0.7, "lpg.resonance": 0.45, "contour.mode": 0, "contour.attack": 0.03, "contour.decay": 0.12, "contour.amount": 0.88, "contour.cycle": 1, "amp.level": 0.7 } },
    { "name": "KEYS Fold E-Piano",    "gm": [4, 5],   "params": { "osc.mainWave": 0, "osc.ratio": 2, "osc.fmIndex": 0.3, "timbre.fold": 0.3, "lpg.mode": 2, "lpg.cutoff": 0.7, "lpg.resonance": 0.2, "contour.mode": 0, "contour.attack": 0.003, "contour.decay": 0.4, "contour.amount": 0.9, "amp.level": 0.78 } },
    { "name": "KEYS Marimba Fold",    "gm": [12],     "params": { "osc.mainWave": 0, "osc.ratio": 4, "osc.fmIndex": 0.2, "timbre.fold": 0.25, "lpg.mode": 2, "lpg.cutoff": 0.75, "lpg.resonance": 0.2, "contour.mode": 0, "contour.attack": 0.002, "contour.decay": 0.22, "contour.amount": 0.92, "amp.level": 0.8 } }
  ]
}
```

- [ ] **Step 4: Run to verify it PASSES**

Run: `NO_COLOR=1 npx vitest run src/presets/preset-sanity.test.ts`
Expected: PASS for `westcoast` (24 ≥ 20, unique names, gm in range).

- [ ] **Step 5: Commit**

```bash
git add public/presets/westcoast.json src/presets/preset-sanity.test.ts
git commit -m "feat(westcoast): 24 presets + preset-sanity coverage"
```

---

## Task 9: Boot wiring (registry + BPM broadcast)

**Files:**
- Modify: `src/engines/registry-boot.test.ts`
- Modify: `src/app/bpm-broadcast.ts:34`

- [ ] **Step 1: Update the registry-boot test**

In `src/engines/registry-boot.test.ts`, add the side-effect import after the other engine imports:

```ts
import '../engines/westcoast';
```

Add `['westcoast'],` to BOTH `it.each` arrays (the `getEngine` list and the `createEngineInstance` list).

- [ ] **Step 2: Add West to the BPM broadcast list**

In `src/app/bpm-broadcast.ts`, change line 34:

```ts
const LANE_HOST_ENGINE_IDS = ['fm', 'karplus', 'subtractive', 'wavetable', 'drums-machine', 'westcoast'];
```

- [ ] **Step 3: Run**

Run: `NO_COLOR=1 npx vitest run src/engines/registry-boot.test.ts`
Expected: PASS — `getEngine('westcoast')` and `createEngineInstance('westcoast')` both resolve.

- [ ] **Step 4: Commit**

```bash
git add src/engines/registry-boot.test.ts src/app/bpm-broadcast.ts
git commit -m "feat(westcoast): register engine + BPM broadcast wiring"
```

---

## Task 10: Per-section knob accent colours (SCSS)

**Files:**
- Modify: `src/styles/_knob.scss`

`buildParamUI` tags each section's `knob-row` with a `west-*-knobs` class. Add accent colours reusing the existing palette (the `knob-accent` mixin already exists in `_knob.scss`).

- [ ] **Step 1: Append the accent rules**

After the existing `#poly-*-knobs` accent block in `src/styles/_knob.scss`, add:

```scss
/* West Coast engine — per-section knob accents (classes, not ids, because
 * the engine renders per-lane and ids must stay unique). */
.west-osc-knobs     { @include knob-accent(var(--knob-cyan));   }
.west-timbre-knobs  { @include knob-accent(var(--knob-orange)); }
.west-lpg-knobs     { @include knob-accent(var(--knob-purple)); }
.west-contour-knobs { @include knob-accent(var(--knob-red));    }
.west-amp-knobs     { @include knob-accent(var(--knob-green));  }
```

- [ ] **Step 2: Verify it compiles in the build**

Run: `npm run build`
Expected: typecheck + SCSS compile + bundle succeed, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/_knob.scss
git commit -m "feat(westcoast): per-section knob accent colours"
```

---

## Task 11: Full verification + visual parity

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Fast suite**

Run: `npm run test:fast`
Expected: green (note the known flaky `ERR_IPC_CHANNEL_CLOSED` teardown — re-run if only that fires).

- [ ] **Step 3: DSP suite**

Run: `npm run test:dsp`
Expected: green; `test/output/westcoast__*.wav` written for audible inspection.

- [ ] **Step 4: Build for the e2e bundle**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Visual parity check (manual — required for UI work)**

Run `npm run dev`, add a lane, select the **West** engine, and confirm the panel matches the approved mockup [docs/superpowers/specs/2026-06-14-west-coast-engine-mockup.html](../specs/2026-06-14-west-coast-engine-mockup.html): POLY header, then Complex Oscillator (cyan) / Timbre (orange) / Low-Pass Gate (purple) / Contour (red) / Amp sections, wave selectors as radio-strips, then the modulators panel. Trigger notes and confirm audible West Coast character (fold, ring, pluck). Screenshot and compare side-by-side.

- [ ] **Step 6: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(westcoast): final verification tweaks"
```

---

## Finish

When all tasks are green: rebase onto `main`, `git merge --ff-only`, then exit the worktree (per project convention). The engine is auto-discovered — no `main.ts` edit is required.

---

## Self-review notes (author)

- **Spec coverage:** complex osc (Task 2/5), wavefolder (Task 1/2/4), low-pass gate + modes (Task 2/6), contour pluck/sustain/cycle (Task 2/6), modulation 2 ADSR + 2 LFO + shared bus (Task 2/7), velocity/accent (Task 2/3), params table (Task 2), presets ≥20 (Task 8), persistence/automation (free via `wireEngineParams` + `mirrorParamChange`, exercised by buildParamUI in Task 2/10), registration/auto-discovery (Task 9), UI parity (Task 10/11), tests in all four layers (Tasks 1,3–7). No spec requirement left unassigned.
- **Risk reminders carried into tasks:** no-clip guarded by `OUTPUT_TRIM` + the battery max-out test (Task 3); fold aliasing handled by `oversample='4x'` (Task 2); FM is native-linear (sine default carrier) — documented in the engine header.
- **Type consistency:** `WestEngine`/`WestVoice` names, `paramValues` record, modBus keys (`lpg.cutoff`/`lpg.resonance`/`amp.gain`/`timbre.fold`), and `getAudioParams` keys are identical across Tasks 2, 7. Discrete params stored as numeric indices everywhere (Task 2 set/get, Task 8 JSON).
- **Open implementation detail (acceptable):** if `EngineParamSpec` does not accept the `curve: 'exponential'` field, drop it (it is cosmetic on the knob) — flagged in Task 2 Step 5.
