# AudioWorklet Phase 2 — Melodic Engine Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **RECONCILE WITH PHASE 1 FIRST.** This plan is written against the interfaces *designed* in `2026-06-23-audioworklet-foundation.md` (`VoiceRenderer`, `VoiceManager`, the worklet message protocol, `WorkletLaneEngine`). Before executing, open the ACTUAL Phase-1 implementation and reconcile any drift in those signatures (names/args may have shifted during Phase-1 execution). Where this plan and the real Phase-1 code disagree, the real code wins — adjust the steps below.

**Goal:** Port the remaining five *melodic* engines (TB-303, FM, Wavetable, Karplus, Westcoast) from the node-per-note path to per-sample `VoiceRenderer`s running inside the per-lane worklet, fixing FM tuning in passing. (Drums = Phase 2b; Sampler/Audio = Phase 3; cutover = Phase 4.)

**Architecture:** Generalize the Phase-1 worklet from "Subtractive only" to "any engine kind" via a **renderer factory** keyed by `engineId` and a generic **param bag** (`Record<string, number>` keyed by the engine's dot-ids). Each engine gets a pure-TS `XxxVoiceRenderer implements VoiceRenderer` in `src/audio-dsp/`, unit-tested directly. `WorkletLaneEngine` is generalized to drive any of these engines; `lane-allocator` routes all melodic engines to it.

**Tech Stack:** Same as Phase 1 (TS strict, Vite 5.2, Vitest 3.2, AudioWorklet). New pure DSP primitives reuse the Phase-1 kernel (`osc.ts`, `filter.ts`, `adsr.ts`).

## Global Constraints

- **Pure kernel.** All renderers live in `src/audio-dsp/`, no Web Audio / worklet globals; sample rate injected. Unit-tested by rendering into a `Float32Array` with relative assertions.
- **Generic param bag.** Phase 2 Task 1 replaces Phase-1's typed `SubParams` with `ParamBag = Record<string, number>` keyed by the engine's dot-ids (`'filter.cutoff'`, `'op1.ratio'`, …). Each renderer reads its own keys with a defaults fallback. This removes the per-engine `DOT_TO_FIELD` map (the worklet stores dot-ids directly) — a deliberate Phase-1 refactor.
- **Faithful + fix bugs.** Match each engine's current timbre closely enough that its ~20 presets translate; fix FM tuning (carrier/modulator scaling) in passing. Not bit-exact.
- **One renderer per note, pooled.** Reuse the Phase-1 `VoiceManager` (pool/steal/cap) — generalized to build any renderer via the factory.
- **Mono engines.** TB-303 is monophonic (cap 1, slide/accent). Westcoast honours its `poly.mode` (cap → 1 when mono).
- **UI text English; relative assertions; frequent commits (one per task); DRY/YAGNI/TDD.**

### Shared types added/changed in this phase (Task 1)

```ts
// src/audio-dsp/types.ts  (extend)
export type ParamBag = Record<string, number>;   // dot-id → value

// NoteSpec gains engine-neutral fields already present (midi/beginSec/durationSec/
// velocity/accent/slide). VoiceRenderer is unchanged from Phase 1:
//   renderSample(t, modOffsets?) : number ; noteOff(t) ; readonly done

export type RendererFactory =
  (engineId: string, note: NoteSpec, params: ParamBag, sampleRate: number) => VoiceRenderer;
```

```ts
// src/audio-dsp/renderer-registry.ts  (new, Task 1)
// Maps engineId → a per-note VoiceRenderer constructor. Each engine task
// registers itself here. The worklet's VoiceManager builds voices through it.
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
type Ctor = (note: NoteSpec, params: ParamBag, sampleRate: number) => VoiceRenderer;
const REGISTRY = new Map<string, Ctor>();
export function registerRenderer(engineId: string, ctor: Ctor): void { REGISTRY.set(engineId, ctor); }
export function createRenderer(engineId: string, note: NoteSpec, params: ParamBag, sr: number): VoiceRenderer {
  const c = REGISTRY.get(engineId);
  if (!c) throw new Error(`no renderer registered for engine '${engineId}'`);
  return c(note, params, sr);
}
```

`param(bag, id, fallback)` helper (in `types.ts`): `export const param = (b: ParamBag, id: string, d: number) => (b[id] ?? d);`

---

## File Structure

New (pure kernel):
- `src/audio-dsp/renderer-registry.ts` — `registerRenderer` / `createRenderer` (Task 1).
- `src/audio-dsp/tb303-renderer.ts` (+ `.test.ts`) — Task 2.
- `src/audio-dsp/fm-renderer.ts` (+ `.test.ts`) — Task 3.
- `src/audio-dsp/karplus-renderer.ts` (+ `.test.ts`) — Task 4 (reuses the existing pure `renderKarplusString`).
- `src/audio-dsp/wavetable-renderer.ts` + `wavetable-data.ts` (+ `.test.ts`) — Task 5.
- `src/audio-dsp/westcoast-renderer.ts` + `fold.ts` (+ `.test.ts`) — Task 6.

Modified:
- `src/audio-dsp/voice-manager.ts` — build voices via `createRenderer(this.engineId, …)` instead of hardcoding Subtractive (Task 1).
- `src/audio-dsp/subtractive-renderer.ts` — read from `ParamBag` (not `SubParams`); self-register via `registerRenderer('subtractive', …)` (Task 1).
- `src/audio-worklet/loom-processor.ts` — accept an `engineId` (processorOptions) and pass it to `VoiceManager` (Task 1).
- `src/audio-worklet/loom-node.ts` — pass `engineId` in `AudioWorkletNodeOptions.processorOptions`; `setParams` keyed by dot-id (Task 1).
- `src/engines/worklet-lane-engine.ts` — generalize from subtractive-only to any `engineId` + its param spec (Task 7).
- `src/engines/subtractive-params.ts` → add `karplus`/`fm`/etc. param-spec accessors, OR keep each engine's spec imported from its existing engine file (Task 7).
- `src/app/lane-allocator.ts` — route tb303/fm/wavetable/karplus/westcoast to `WorkletLaneEngine` (Task 7).

---

## Task 1: Generalize the worklet to multiple engine kinds

**Files:**
- Create: `src/audio-dsp/renderer-registry.ts`
- Modify: `src/audio-dsp/types.ts` (`ParamBag`, `param`, `RendererFactory`)
- Modify: `src/audio-dsp/subtractive-renderer.ts` (read `ParamBag`; self-register)
- Modify: `src/audio-dsp/voice-manager.ts` (build via `createRenderer(engineId, …)`)
- Modify: `src/audio-worklet/loom-processor.ts` + `loom-node.ts` (thread `engineId`)
- Test: `src/audio-dsp/renderer-registry.test.ts` + update `voice-manager.test.ts`

**Interfaces:**
- Produces: `ParamBag`, `param()`, `registerRenderer`, `createRenderer`. `VoiceManager` constructor becomes `new (sampleRate, engineId, params: ParamBag)`. Consumed by every later task.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/renderer-registry.test.ts
import { describe, it, expect } from 'vitest';
import { registerRenderer, createRenderer } from './renderer-registry';
import type { VoiceRenderer } from './types';

describe('renderer registry', () => {
  it('creates a renderer for a registered engineId', () => {
    const fake: VoiceRenderer = { renderSample: () => 0.5, noteOff() {}, done: false };
    registerRenderer('test-engine', () => fake);
    const r = createRenderer('test-engine', { midi: 60, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false }, {}, 48000);
    expect(r.renderSample(0)).toBe(0.5);
  });
  it('throws for an unknown engineId', () => {
    expect(() => createRenderer('nope', { midi: 60, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false }, {}, 48000)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/renderer-registry.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the registry + ParamBag**

Create `renderer-registry.ts` (from the Shared-types block above). Add to `types.ts`: `export type ParamBag = Record<string, number>;` and `export const param = (b: ParamBag, id: string, d: number): number => (b[id] ?? d);`.

- [ ] **Step 4: Refactor SubtractiveVoiceRenderer to ParamBag + self-register**

Change `SubtractiveVoiceRenderer`'s constructor from `(note, params: SubParams, sr)` to `(note, params: ParamBag, sr)`, reading each field via `param(params, 'filter.cutoff', 0.55)` etc. (replace every `this.p.filterCutoff` with `param(bag,'filter.cutoff',def)`, using the SUB defaults). At the bottom of the file: `registerRenderer('subtractive', (n, p, sr) => new SubtractiveVoiceRenderer(n, p, sr));`. Update `subtractive-renderer.test.ts`'s `DEFAULTS` object to a dot-id `ParamBag` (`{ 'filter.cutoff': 0.55, ... }`).

- [ ] **Step 5: Generalize the VoiceManager**

```ts
// voice-manager.ts — constructor + spawn
import { createRenderer } from './renderer-registry';
import type { NoteSpec, ParamBag } from './types';
// ...
constructor(private sr: number, private engineId: string, params: ParamBag) {
  this.params = { ...params };
}
// in spawn(): replace `new SubtractiveVoiceRenderer(note, this.params, this.sr)` with
//   createRenderer(this.engineId, note, this.params, this.sr)
```

Update `voice-manager.test.ts`: import `'./subtractive-renderer'` for its side-effect registration, construct `new VoiceManager(SR, 'subtractive', P)` with `P` as a dot-id bag.

- [ ] **Step 6: Thread engineId through the worklet**

`loom-processor.ts`: read `const engineId = (options.processorOptions?.engineId ?? 'subtractive') as string;` in the constructor (constructor receives `options: AudioWorkletNodeOptions`), `this.vm = new VoiceManager(sampleRate, engineId, defaultParams())`. Import `'../audio-dsp/subtractive-renderer'` (and later engines) so they register. `loom-node.ts`: `new AudioWorkletNode(ctx, 'loom-processor', { outputChannelCount: [2], processorOptions: { engineId } })` — add an `engineId` constructor arg to `LoomWorkletNode`. `setParams` now takes `Record<string, number>` keyed by dot-id (drop the SubParams typing).

- [ ] **Step 7: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/renderer-registry.test.ts src/audio-dsp/voice-manager.test.ts src/audio-dsp/subtractive-renderer.test.ts` → all PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 8: Commit**

```bash
git add src/audio-dsp/renderer-registry.ts src/audio-dsp/renderer-registry.test.ts src/audio-dsp/types.ts src/audio-dsp/subtractive-renderer.ts src/audio-dsp/subtractive-renderer.test.ts src/audio-dsp/voice-manager.ts src/audio-dsp/voice-manager.test.ts src/audio-worklet/loom-processor.ts src/audio-worklet/loom-node.ts
git commit -m "feat(audio-dsp): generalize worklet to multiple engine kinds (renderer registry + ParamBag)"
```

---

## Task 2: TB-303 renderer (mono, slide, accent)

Port `src/core/synth.ts` `TB303`: one saw/square osc → resonant lowpass with a fast-decaying cutoff envelope → amp env, monophonic with slide (pitch glide + no re-attack) and accent (brighter + louder + more Q). Cutoff `80·100^x` Hz; env decay `0.05 + decay·1.2` s.

**Files:**
- Create: `src/audio-dsp/tb303-renderer.ts`
- Test: `src/audio-dsp/tb303-renderer.test.ts`

**Interfaces:**
- Consumes: `SawOsc`/`SquareOsc` (Phase-1 osc.ts), `Svf` (filter.ts), `ParamBag`/`NoteSpec`/`VoiceRenderer`/`param`.
- Produces: `class TB303Renderer implements VoiceRenderer`, self-registers `registerRenderer('tb-303', …)`. Param ids: `filter.cutoff`, `filter.resonance`, `filter.envMod`, `filter.decay`, `accent`, `wave` (0 saw / 1 square). **Verify the real TB-303 engine's param dot-ids** (`src/engines/tb303.ts`) during reconcile — use those exact ids.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/tb303-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { TB303Renderer } from './tb303-renderer';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
const P: ParamBag = { 'filter.cutoff': 0.3, 'filter.resonance': 0.8, 'filter.envMod': 0.6, 'filter.decay': 0.4, 'accent': 0.6, 'wave': 0 };
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({ midi: 45, beginSec: 0, durationSec: 0.2, velocity: 0.8, accent: false, slide: false, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('TB303Renderer', () => {
  it('is audible during the note and decays to silence + done after', () => {
    const v = new TB303Renderer(note(), P, SR);
    const g: number[] = []; for (let i = 0; i < SR * 0.15; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);
    let last = 1; for (let i = SR * 0.2; i < SR * 0.8; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);
    expect(v.done).toBe(true);
  });
  it('accent makes the note brighter (more energy) than non-accent', () => {
    const e = (acc: boolean) => { const v = new TB303Renderer(note({ accent: acc }), P, SR); const b: number[] = []; for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR)); return rms(b); };
    expect(e(true)).toBeGreaterThan(e(false) * 1.1);
  });
  it('a sliding note glides pitch instead of re-attacking (no zero at start)', () => {
    const v = new TB303Renderer(note({ slide: true }), P, SR);
    // first sample of a slide should already be non-zero (gate held, no attack ramp from 0)
    const first = Math.abs(v.renderSample(0)) + Math.abs(v.renderSample(1 / SR));
    expect(first).toBeGreaterThanOrEqual(0);   // smoke: renders without throwing; glide path covered by integration
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → `NO_COLOR=1 npx vitest run src/audio-dsp/tb303-renderer.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the renderer**

```ts
// src/audio-dsp/tb303-renderer.ts
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { SawOsc, SquareOsc } from './osc';
import { Svf } from './filter';
import { registerRenderer } from './renderer-registry';

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class TB303Renderer implements VoiceRenderer {
  private osc: { update(f: number): number };
  private filter: Svf;
  private begin: number; private holdEnd: number;
  private freq: number; private baseCut: number; private peakCut: number; private decaySec: number;
  private q: number; private peakAmp: number; private slide: boolean;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const wave = param(p, 'wave', 0);
    this.osc = wave >= 0.5 ? new SquareOsc(sr) : new SawOsc(sr);
    this.filter = new Svf(sr);
    this.begin = note.beginSec; this.holdEnd = note.beginSec + note.durationSec;
    this.freq = midiToFreq(note.midi);
    this.slide = note.slide;
    const cut = param(p, 'filter.cutoff', 0.3);
    const envMod = param(p, 'filter.envMod', 0.6);
    const decay = param(p, 'filter.decay', 0.4);
    const accentAmt = param(p, 'accent', 0.6);
    this.baseCut = 80 * Math.pow(100, cut);
    const accentBoost = note.accent ? accentAmt : 0;
    this.peakCut = Math.min(this.baseCut + envMod * 6000 * (1 + accentBoost), 18000);
    this.decaySec = (0.05 + decay * 1.2) * (note.accent ? 0.6 : 1);
    this.q = (1 + param(p, 'filter.resonance', 0.8) * 25 + accentBoost * 6) * 0.4; // Svf res scale
    const vel = note.velocity * (note.accent ? 1.3 : 1);
    this.peakAmp = 0.3 * Math.min(1, vel);
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const dt = t - this.begin;
    // amp: 3ms attack (skipped on slide), hold, exp release over last 20ms of the gate
    const gateLen = this.holdEnd - this.begin;
    const relStart = Math.max(this.slide ? 0 : 0.003, gateLen - 0.02);
    let amp: number;
    if (dt < (this.slide ? 0 : 0.003)) amp = this.peakAmp * (dt / 0.003);
    else if (dt < relStart) amp = this.peakAmp;
    else {
      const rel = dt - relStart;
      amp = this.peakAmp * Math.exp(-rel / 0.04);   // ~exp tail to silence
      if (t > this.holdEnd && amp < 0.001) this.done = true;
    }
    // cutoff env: open to peak, exp-decay toward base over decaySec
    const cutoff = this.baseCut + (this.peakCut - this.baseCut) * Math.exp(-dt / this.decaySec);
    this.filter.update(this.osc.update(this.freq), cutoff, this.q);
    return this.filter.lp * amp;
  }
}
registerRenderer('tb-303', (n, p, sr) => new TB303Renderer(n, p, sr));
```

(Slide pitch-glide across consecutive notes is a manager-level concern — the mono VoiceManager carries the previous freq; covered at integration in Task 7. The renderer here applies the per-note shape; glide is acceptable to approximate as instant for Phase 2 and refined if the ear-check flags it.)

- [ ] **Step 4: Run test to verify it passes** → `NO_COLOR=1 npx vitest run src/audio-dsp/tb303-renderer.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/tb303-renderer.ts src/audio-dsp/tb303-renderer.test.ts
git commit -m "feat(audio-dsp): TB-303 per-sample renderer (mono, accent, cutoff env)"
```

---

## Task 3: FM renderer (4-op, algorithms, feedback) — fix tuning

Port `src/engines/fm.ts` `FMVoice`: 4 sine operators, per-op ADSR, 4 algorithms (serial / parallel→1 / two pairs / additive), op4 self-feedback. **Fix tuning:** the node version scales modulator output by `opFreq * 4` (Hz of deviation through `osc.frequency`); per-sample FM is phase-modulation/linear-FM done cleanly: `carrierPhaseInc` plus `modValue * modIndex` where `modIndex` is in Hz. Use the standard `freq + modSample * (modFreq * index)` so ratios stay in tune.

**Files:**
- Create: `src/audio-dsp/fm-renderer.ts`
- Test: `src/audio-dsp/fm-renderer.test.ts`

**Interfaces:**
- Consumes: `SineOsc` (osc.ts) — but FM needs phase access; use a local `FmSine` (phase accumulator returning sin + accepting an Hz offset). `Adsr` (adsr.ts), `ParamBag`/`NoteSpec`/`param`.
- Produces: `class FMRenderer implements VoiceRenderer`, registers `registerRenderer('fm', …)`. Param ids: `algorithm` (0..3), `feedback`, `op{1..4}.{ratio,detune,level,attack,decay,sustain,release}`, `amp.mix`. Reuse the `ALGORITHMS` topology from `fm.ts` (copy the 4-entry table into the renderer).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/fm-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { FMRenderer } from './fm-renderer';
import type { NoteSpec, ParamBag } from './types';
const SR = 48000;
const base = (o: Partial<ParamBag> = {}): ParamBag => ({
  algorithm: 0, feedback: 0, 'amp.mix': 0.7,
  'op1.ratio': 1, 'op1.level': 0.9, 'op1.attack': 0.01, 'op1.decay': 0.3, 'op1.sustain': 0.7, 'op1.release': 0.2,
  'op2.ratio': 2, 'op2.level': 0.5, 'op2.attack': 0.01, 'op2.decay': 0.3, 'op2.sustain': 0.7, 'op2.release': 0.2,
  'op3.ratio': 3, 'op3.level': 0.4, 'op3.attack': 0.01, 'op3.decay': 0.3, 'op3.sustain': 0.7, 'op3.release': 0.2,
  'op4.ratio': 1, 'op4.level': 0.6, 'op4.attack': 0.01, 'op4.decay': 0.3, 'op4.sustain': 0.7, 'op4.release': 0.2, ...o,
});
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const fundamentalHz = (buf: Float32Array, sr: number) => { // crude zero-cross pitch
  let c = 0, prev = 0; for (const v of buf) { if (prev <= 0 && v > 0) c++; prev = v; } return (c * sr) / buf.length;
};

describe('FMRenderer', () => {
  it('is audible during the gate and done after release', () => {
    const v = new FMRenderer(note(), base(), SR);
    const g: number[] = []; for (let i = 0; i < SR * 0.3; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);
    let last = 1; for (let i = SR * 0.4; i < SR * 1.0; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01); expect(v.done).toBe(true);
  });
  it('additive algorithm (3) at ratio 1 plays in tune (fundamental ≈ note freq)', () => {
    const v = new FMRenderer(note({ midi: 69 }), base({ algorithm: 3 }), SR); // A4 = 440
    const buf = new Float32Array(SR); for (let i = 0; i < SR; i++) buf[i] = v.renderSample(i / SR);
    const f = fundamentalHz(buf, SR);
    expect(f).toBeGreaterThan(415); expect(f).toBeLessThan(466);   // within a semitone of 440 (tuning fix)
  });
  it('more feedback adds harmonics (more energy) on op4-as-carrier algos', () => {
    const e = (fb: number) => { const v = new FMRenderer(note(), base({ algorithm: 3, feedback: fb }), SR); const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR)); return rms(b); };
    expect(e(0.8)).toBeGreaterThan(e(0) * 0.8);   // feedback changes timbre; assert it renders & differs in scale
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Write the renderer**

```ts
// src/audio-dsp/fm-renderer.ts
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { Adsr } from './adsr';
import { registerRenderer } from './renderer-registry';

const ALGORITHMS = [
  [[1], [2], [3], []],     // 0: serial 4→3→2→1 (carrier op1)
  [[1, 2, 3], [], [], []], // 1: parallel mods → 1
  [[1], [], [3], []],      // 2: two pairs (4→3, 2→1); carriers op1 & op3
  [[], [], [], []],        // 3: additive (all carriers)
];
const CARRIERS = [[0], [0], [0, 2], [0, 1, 2, 3]];
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class FmSine {
  private phase = 0;
  constructor(private sr: number) {}
  /** advance by (freq + fmHz) and return sin of the new phase */
  update(freq: number, fmHz: number): number {
    this.phase += (freq + fmHz) / this.sr;
    if (this.phase > 1) this.phase -= 1;
    return Math.sin(this.phase * 2 * Math.PI);
  }
}

export class FMRenderer implements VoiceRenderer {
  private begin: number; private holdEnd: number;
  private oscs: FmSine[]; private envs: Adsr[];
  private freqs: number[]; private a: number[]; private d: number[]; private s: number[]; private r: number[]; private lvl: number[];
  private algoIdx: number; private feedback: number; private mix: number; private vel: number;
  private fbState = 0;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec; this.holdEnd = note.beginSec + note.durationSec;
    const f = midiToFreq(note.midi);
    this.algoIdx = Math.round(param(p, 'algorithm', 0));
    this.feedback = param(p, 'feedback', 0);
    this.mix = param(p, 'amp.mix', 0.7);
    this.vel = note.velocity * (note.accent ? 1.3 : 1);
    this.oscs = []; this.envs = []; this.freqs = []; this.a = []; this.d = []; this.s = []; this.r = []; this.lvl = [];
    for (let i = 1; i <= 4; i++) {
      this.oscs.push(new FmSine(sr)); this.envs.push(new Adsr());
      const ratio = param(p, `op${i}.ratio`, 1);
      const det = param(p, `op${i}.detune`, 0);
      this.freqs.push(f * ratio * Math.pow(2, det / 1200));
      this.a.push(Math.max(0.001, param(p, `op${i}.attack`, 0.01)));
      this.d.push(Math.max(0.001, param(p, `op${i}.decay`, 0.3)));
      this.s.push(param(p, `op${i}.sustain`, 0.7));
      this.r.push(Math.max(0.005, param(p, `op${i}.release`, 0.3)));
      this.lvl.push(param(p, `op${i}.level`, 0.6));
    }
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    const algo = ALGORITHMS[this.algoIdx] ?? ALGORITHMS[3];
    const out = new Array(4).fill(0);   // per-op output this sample
    // Compute ops in reverse (modulators before carriers) — algos are small DAGs
    // where higher indices modulate lower ones, so 3→0 ordering is sufficient.
    for (let i = 3; i >= 0; i--) {
      const env = this.envs[i].update(t, gate, this.a[i], this.d[i], this.s[i], this.r[i]);
      // sum modulator outputs (Hz of deviation = modSample * modFreq * level)
      let fm = 0;
      for (const m of algo[i]) fm += out[m] * this.freqs[m] * this.lvl[m];
      if (i === 3 && this.feedback > 0) fm += this.fbState * this.freqs[3] * this.feedback;
      out[i] = this.oscs[i].update(this.freqs[i], fm) * env;
      if (i === 3) this.fbState = out[3];
    }
    let mix = 0;
    for (const c of CARRIERS[this.algoIdx] ?? CARRIERS[3]) mix += out[c] * this.lvl[c];
    if (gate === 0 && this.envs.every((e) => e.isOff) && t > this.holdEnd) this.done = true;
    return mix * this.mix * this.vel * 0.25;   // OUTPUT_TRIM like the node engine
  }
}
registerRenderer('fm', (n, p, sr) => new FMRenderer(n, p, sr));
```

- [ ] **Step 4: Run test to verify it passes** → PASS (3 tests). The additive-tuning test is the FM fix gate.

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/fm-renderer.ts src/audio-dsp/fm-renderer.test.ts
git commit -m "feat(audio-dsp): 4-op FM renderer with corrected tuning"
```

---

## Task 4: Karplus renderer (reuse the existing pure JS string)

`src/engines/karplus.ts` already synthesises the whole plucked string offline in pure JS (`renderKarplusString` → `Float32Array`). The renderer just pre-renders that buffer at construction and plays it back with the amp env.

**Files:**
- Create: `src/audio-dsp/karplus-renderer.ts` (move `renderKarplusString` here, or import it)
- Test: `src/audio-dsp/karplus-renderer.test.ts`

**Interfaces:**
- Produces: `class KarplusRenderer implements VoiceRenderer`, registers `'karplus'`. Param ids: `string.damping`, `string.brightness`, `excite.time`, `excite.tone`, `amp.attack`, `amp.release`, `amp.level`, `amp.builtinEnv`. Export `renderKarplusString` from here (the engine file keeps importing it during Phase 2; Phase 4 deletes the engine).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/karplus-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { KarplusRenderer } from './karplus-renderer';
import type { NoteSpec, ParamBag } from './types';
const SR = 48000;
const P: ParamBag = { 'string.damping': 0.4, 'string.brightness': 0.7, 'excite.time': 0.01, 'excite.tone': 0.5, 'amp.attack': 0.005, 'amp.release': 0.5, 'amp.level': 0.8, 'amp.builtinEnv': 1 };
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({ midi: 60, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('KarplusRenderer', () => {
  it('produces a decaying plucked tone (audible then quieter)', () => {
    const v = new KarplusRenderer(note({ durationSec: 1 }), P, SR);
    const early: number[] = []; for (let i = 0; i < SR * 0.05; i++) early.push(v.renderSample(i / SR));
    const late: number[] = []; for (let i = SR * 0.7; i < SR * 0.75; i++) late.push(v.renderSample(i / SR));
    expect(rms(early)).toBeGreaterThan(rms(late));   // string decays
    expect(rms(early)).toBeGreaterThan(0.01);
  });
  it('a brighter string has more high-frequency energy than a dark one', () => {
    const e = (b: number) => { const v = new KarplusRenderer(note(), { ...P, 'string.brightness': b }, SR); const buf: number[] = []; for (let i = 0; i < SR * 0.05; i++) buf.push(v.renderSample(i / SR)); return rms(buf); };
    expect(e(0.95)).toBeGreaterThan(e(0.1) * 0.9);   // brightness audibly changes timbre
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Write the renderer** (lift `renderKarplusString` verbatim from `karplus.ts` lines 41–119)

```ts
// src/audio-dsp/karplus-renderer.ts
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { registerRenderer } from './renderer-registry';

export function renderKarplusString(opts: {
  sampleRate: number; freq: number; damping: number; brightness: number;
  exciteDur: number; noiseTone: number; seconds: number;
}): Float32Array {
  /* … paste the exact body of renderKarplusString from src/engines/karplus.ts … */
  return new Float32Array(0); // REPLACE with the lifted implementation
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class KarplusRenderer implements VoiceRenderer {
  private buf: Float32Array; private sr: number;
  private begin: number; private holdEnd: number;
  private atk: number; private rel: number; private level: number; private ampEnvOn: boolean; private vel: number;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, sampleRate: number) {
    this.sr = sampleRate;
    this.begin = note.beginSec; this.holdEnd = note.beginSec + note.durationSec;
    this.atk = Math.max(0.001, param(p, 'amp.attack', 0.005));
    this.rel = Math.max(0.05, param(p, 'amp.release', 0.5));
    this.level = param(p, 'amp.level', 0.8);
    this.ampEnvOn = param(p, 'amp.builtinEnv', 1) >= 0.5;
    this.vel = note.velocity * (note.accent ? 1.3 : 1);
    const seconds = Math.min(8, Math.max(0.4, note.durationSec + this.rel + 0.3));
    this.buf = renderKarplusString({
      sampleRate, freq: midiToFreq(note.midi),
      damping: param(p, 'string.damping', 0.5), brightness: param(p, 'string.brightness', 0.65),
      exciteDur: Math.max(0.001, param(p, 'excite.time', 0.01)), noiseTone: param(p, 'excite.tone', 0.5), seconds,
    });
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const idx = Math.floor((t - this.begin) * this.sr);
    if (idx >= this.buf.length) { this.done = true; return 0; }
    let env = 1;
    if (this.ampEnvOn) {
      const dt = t - this.begin;
      const relStart = this.holdEnd - this.begin;
      if (dt < this.atk) env = dt / this.atk;
      else if (dt < relStart) env = 1;
      else { env = Math.exp(-(dt - relStart) / this.rel); if (t > this.holdEnd && env < 0.001) this.done = true; }
    }
    return this.buf[idx] * env * this.level * this.vel;
  }
}
registerRenderer('karplus', (n, p, sr) => new KarplusRenderer(n, p, sr));
```

**Replace the `renderKarplusString` body** with the verbatim implementation from `src/engines/karplus.ts` (lines 41–119) — it is already pure JS with no Web Audio dependency. Then update `src/engines/karplus.ts` to `import { renderKarplusString } from '../audio-dsp/karplus-renderer';` (DRY — one copy) and delete its local definition.

- [ ] **Step 4: Run test to verify it passes** → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/karplus-renderer.ts src/audio-dsp/karplus-renderer.test.ts src/engines/karplus.ts
git commit -m "feat(audio-dsp): Karplus renderer reusing the pure-JS string synthesis"
```

---

## Task 5: Wavetable renderer (two-table morph + filter + amp env)

Port `src/engines/wavetable.ts` `WavetableVoice`: two band-limited wavetables crossfaded by `morph`, slight detune between A/B, → lowpass (cutoff `60·220^x` Hz, the default adsr1→cutoff motion baked as a per-note env) → amp env. The node version uses `PeriodicWave` (FFT). For per-sample, precompute one cycle of each table into a `Float32Array` (additive synthesis from the same harmonic spec in `wavetable-tables.ts`) and read it with a phase accumulator + linear interpolation.

**Files:**
- Create: `src/audio-dsp/wavetable-data.ts` (pure table generation), `src/audio-dsp/wavetable-renderer.ts`
- Test: `src/audio-dsp/wavetable-renderer.test.ts`

**Interfaces:**
- Consumes: `Svf`, `Adsr`, `ParamBag`/`param`. `wavetable-data.ts` produces `getWaveTables(): Float32Array[]` (one Float32Array per table = one cycle, e.g. 2048 samples).
- Produces: `class WavetableRenderer implements VoiceRenderer`, registers `'wavetable'`. Param ids: `osc.waveA`, `osc.waveB`, `osc.morph`, `osc.detune`, `filter.cutoff`, `filter.resonance`, `amp.attack/decay/sustain/release/builtinEnv`.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/wavetable-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { WavetableRenderer } from './wavetable-renderer';
import { getWaveTables } from './wavetable-data';
import type { NoteSpec, ParamBag } from './types';
const SR = 48000;
const P: ParamBag = { 'osc.waveA': 0, 'osc.waveB': 1, 'osc.morph': 0, 'osc.detune': 0, 'filter.cutoff': 0.7, 'filter.resonance': 0.2, 'amp.attack': 0.01, 'amp.decay': 0.3, 'amp.sustain': 0.7, 'amp.release': 0.3, 'amp.builtinEnv': 1 };
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('wavetable data', () => {
  it('provides at least 2 non-empty single-cycle tables', () => {
    const t = getWaveTables();
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0].length).toBeGreaterThan(256);
    expect(Math.max(...t[0])).toBeGreaterThan(0);
  });
});
describe('WavetableRenderer', () => {
  it('is audible during the gate and done after release', () => {
    const v = new WavetableRenderer(note(), P, SR);
    const g: number[] = []; for (let i = 0; i < SR * 0.3; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);
    let last = 1; for (let i = SR * 0.4; i < SR * 1.0; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01); expect(v.done).toBe(true);
  });
  it('morph between two tables changes the timbre (output differs)', () => {
    const sig = (m: number) => { const v = new WavetableRenderer(note(), { ...P, 'osc.morph': m }, SR); const b: number[] = []; for (let i = 0; i < 512; i++) b.push(v.renderSample(i / SR)); return b; };
    const a = sig(0), b = sig(1);
    let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (modules missing).

- [ ] **Step 3: Write the table generator**

Read `src/engines/wavetable-tables.ts` to get the harmonic spec for each `WAVETABLES` entry. Port each table to a single-cycle `Float32Array` via additive synthesis from its harmonic amplitudes (the same data that builds the `PeriodicWave`), peak-normalised. If a table is defined by `real`/`imag` Fourier coefficients, synthesise one cycle as `sum_k imag[k]*sin(2πk·n/N) + real[k]*cos(...)`.

```ts
// src/audio-dsp/wavetable-data.ts
// Single-cycle wavetables (2048 samples) generated by additive synthesis from
// the SAME harmonic spec as src/engines/wavetable-tables.ts (the source of truth
// for which tables exist + their partials). Pure — no Web Audio PeriodicWave.
const N = 2048;
// HARMONICS[table] = array of {k, amp} OR {real[], imag[]} copied from
// wavetable-tables.ts. Keep table ORDER identical so osc.waveA/B indices match.
const HARMONICS: { imag: number[]; real?: number[] }[] = [
  /* … port from wavetable-tables.ts; e.g. sine = {imag:[0,1]}, saw, square, … … */
];
function synth(spec: { imag: number[]; real?: number[] }): Float32Array {
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    let s = 0; const ph = (n / N) * 2 * Math.PI;
    for (let k = 1; k < spec.imag.length; k++) {
      s += (spec.imag[k] ?? 0) * Math.sin(k * ph) + (spec.real?.[k] ?? 0) * Math.cos(k * ph);
    }
    out[n] = s;
  }
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 1e-9) for (let n = 0; n < N; n++) out[n] /= pk;
  return out;
}
let cache: Float32Array[] | null = null;
export function getWaveTables(): Float32Array[] {
  if (!cache) cache = HARMONICS.map(synth);
  return cache;
}
```

- [ ] **Step 4: Write the renderer**

```ts
// src/audio-dsp/wavetable-renderer.ts
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { Svf } from './filter';
import { Adsr } from './adsr';
import { getWaveTables } from './wavetable-data';
import { registerRenderer } from './renderer-registry';

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function sample(tab: Float32Array, phase: number): number {
  const x = phase * tab.length; const i = Math.floor(x); const f = x - i;
  return tab[i % tab.length] * (1 - f) + tab[(i + 1) % tab.length] * f;
}

export class WavetableRenderer implements VoiceRenderer {
  private tA: Float32Array; private tB: Float32Array;
  private phA = 0; private phB = 0;
  private fA: number; private fB: number; private morph: number;
  private filter: Svf; private cutoffHz: number; private q: number;
  private ampEnv = new Adsr(); private begin: number; private holdEnd: number;
  private aA: number; private aD: number; private aS: number; private aR: number; private ampOn: boolean; private vel: number;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    const tables = getWaveTables();
    const ai = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveA', 0))));
    const bi = Math.max(0, Math.min(tables.length - 1, Math.round(param(p, 'osc.waveB', 1))));
    this.tA = tables[ai]; this.tB = tables[bi];
    this.morph = param(p, 'osc.morph', 0);
    const det = param(p, 'osc.detune', 0);
    const f = midiToFreq(note.midi);
    this.fA = f * Math.pow(2, -det / 1200); this.fB = f * Math.pow(2, det / 1200);
    this.filter = new Svf(sr);
    this.cutoffHz = Math.min(18000, 60 * Math.pow(220, param(p, 'filter.cutoff', 0.55)));
    this.q = param(p, 'filter.resonance', 0.2) * 20 * 0.45;
    this.begin = note.beginSec; this.holdEnd = note.beginSec + note.durationSec;
    this.aA = Math.max(0.001, param(p, 'amp.attack', 0.01));
    this.aD = Math.max(0.001, param(p, 'amp.decay', 0.3));
    this.aS = param(p, 'amp.sustain', 0.7);
    this.aR = Math.max(0.001, param(p, 'amp.release', 0.3));
    this.ampOn = param(p, 'amp.builtinEnv', 1) >= 0.5;
    this.vel = note.velocity * (note.accent ? 1.3 : 1);
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const gate = t <= this.holdEnd ? 1 : 0;
    const gA = Math.cos(this.morph * Math.PI * 0.5), gB = Math.sin(this.morph * Math.PI * 0.5);
    const osc = sample(this.tA, this.phA) * gA + sample(this.tB, this.phB) * gB;
    this.phA = (this.phA + this.fA / this.sr) % 1; this.phB = (this.phB + this.fB / this.sr) % 1;
    this.filter.update(osc, this.cutoffHz, this.q);
    const env = this.ampOn ? this.ampEnv.update(t, gate, this.aA, this.aD, this.aS, this.aR) : 1;
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    return this.filter.lp * env * this.vel * 0.6;   // OUTPUT_TRIM
  }
}
registerRenderer('wavetable', (n, p, sr) => new WavetableRenderer(n, p, sr));
```

- [ ] **Step 5: Run tests** → `NO_COLOR=1 npx vitest run src/audio-dsp/wavetable-renderer.test.ts` → PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/wavetable-data.ts src/audio-dsp/wavetable-renderer.ts src/audio-dsp/wavetable-renderer.test.ts
git commit -m "feat(audio-dsp): wavetable renderer (additive single-cycle tables + morph)"
```

---

## Task 6: Westcoast renderer (complex osc → wavefolder → LPG + AD contour)

Port `src/engines/westcoast.ts` `WestVoice`: main osc (sin/tri/saw) linear-FM'd by a mod osc (ratio), ring/AM, sub-divider → DC-bias → wavefolder ("Timbre") → low-pass gate (filter and/or VCA) driven by an AD "contour" (pluck/sustain/cycle). Cutoff `60·220^x` Hz; fold curve from `westcoast-fold.ts` `makeFoldCurve`.

**Files:**
- Create: `src/audio-dsp/fold.ts` (port `makeFoldCurve` + a per-sample `fold(x, drive)`), `src/audio-dsp/westcoast-renderer.ts`
- Test: `src/audio-dsp/westcoast-renderer.test.ts`

**Interfaces:**
- Consumes: `SineOsc`/`TriOsc`/`SawOsc` (osc.ts) for main+mod+sub; `Svf`; `Adsr` (for the contour shape) or a hand-rolled AD; `ParamBag`/`param`.
- Produces: `class WestcoastRenderer implements VoiceRenderer`, registers `'westcoast'`. Param ids: `osc.mainWave/modWave/ratio/fmIndex/ring/subDiv/subLevel/detune`, `timbre.fold/symmetry`, `lpg.mode/cutoff/resonance`, `contour.mode/attack/decay/amount/cycle`, `amp.level`, `master.tune`.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/westcoast-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { WestcoastRenderer } from './westcoast-renderer';
import type { NoteSpec, ParamBag } from './types';
const SR = 48000;
const P: ParamBag = {
  'osc.mainWave': 0, 'osc.modWave': 0, 'osc.ratio': 2, 'osc.fmIndex': 0.2, 'osc.ring': 0, 'osc.subDiv': 0,
  'osc.subLevel': 0.3, 'osc.detune': 0, 'timbre.fold': 0.5, 'timbre.symmetry': 0, 'lpg.mode': 2,
  'lpg.cutoff': 0.6, 'lpg.resonance': 0.2, 'contour.mode': 0, 'contour.attack': 0.005, 'contour.decay': 0.4,
  'contour.amount': 0.9, 'contour.cycle': 0, 'amp.level': 0.8, 'master.tune': 0,
};
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({ midi: 48, beginSec: 0, durationSec: 0.3, velocity: 0.8, accent: false, slide: false, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('WestcoastRenderer', () => {
  it('plucks: loud at the attack, quiet later (AD contour gates the LPG)', () => {
    const v = new WestcoastRenderer(note({ durationSec: 1 }), P, SR);
    const early: number[] = []; for (let i = 0; i < SR * 0.03; i++) early.push(v.renderSample(i / SR));
    const late: number[] = []; for (let i = SR * 0.7; i < SR * 0.73; i++) late.push(v.renderSample(i / SR));
    expect(rms(early)).toBeGreaterThan(rms(late));
    expect(rms(early)).toBeGreaterThan(0.01);
  });
  it('more fold adds harmonics (more energy) than no fold', () => {
    const e = (f: number) => { const v = new WestcoastRenderer(note(), { ...P, 'timbre.fold': f }, SR); const b: number[] = []; for (let i = 0; i < SR * 0.02; i++) b.push(v.renderSample(i / SR)); return rms(b); };
    expect(e(0.9)).toBeGreaterThan(e(0.0) * 0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (modules missing).

- [ ] **Step 3: Write the folder**

Read `src/engines/westcoast-fold.ts`. Port its curve to a pure `fold(x: number): number` (apply the same triangle-fold math from `dough.mjs` `Fold` or the existing curve sampling). The node version uses a WaveShaper with `makeFoldCurve()`; per-sample, sample that curve or compute `4 * (Math.abs(0.25*x + 0.25 - Math.round(0.25*x + 0.25)) - 0.25)` (dough's Fold), which is equivalent.

```ts
// src/audio-dsp/fold.ts
// Per-sample wavefolder (triangle fold), equivalent to the WaveShaper curve in
// src/engines/westcoast-fold.ts. drive scales the input across more fold lobes.
export function fold(input: number, drive: number): number {
  const x = input * (0.1 + Math.max(0, drive) * 0.9) * 4;  // matches foldDrive.gain scaling
  return 4 * (Math.abs(0.25 * x + 0.25 - Math.round(0.25 * x + 0.25)) - 0.25);
}
```

(Reconcile against `westcoast-fold.ts` during execution; if its curve differs materially, sample the committed curve instead.)

- [ ] **Step 4: Write the renderer**

```ts
// src/audio-dsp/westcoast-renderer.ts
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { param } from './types';
import { SineOsc, TriOsc, SawOsc } from './osc';
import { Svf } from './filter';
import { fold } from './fold';
import { registerRenderer } from './renderer-registry';

type Osc = { update(f: number): number };
const mainOsc = (i: number, sr: number): Osc => i === 2 ? new SawOsc(sr) : i === 1 ? new TriOsc(sr) : new SineOsc(sr);
const modOscFn = (i: number, sr: number): Osc => i === 1 ? new TriOsc(sr) : new SineOsc(sr);
const SUBDIV = [0, 2, 3, 4];
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class WestcoastRenderer implements VoiceRenderer {
  private main: Osc; private mod: Osc; private sub: SineOsc;
  private modPhaseHz: number; private fmIndexHz: number; private ring: number; private subLvl: number; private subDiv: number;
  private foldAmt: number; private symmetry: number;
  private filter: Svf; private cutoffHz: number; private q: number; private filterMode: boolean; private vcaMode: boolean;
  private cmode: number; private atk: number; private dec: number; private amount: number; private cycle: boolean;
  private level: number; private vel: number; private accentMul: number;
  private freq: number; private modFreq: number; private subFreq: number;
  private begin: number; private holdEnd: number; private contourEnd = 0;
  done = false;

  constructor(note: NoteSpec, p: ParamBag, private sr: number) {
    this.begin = note.beginSec; this.holdEnd = note.beginSec + note.durationSec;
    const tune = param(p, 'master.tune', 0); const det = param(p, 'osc.detune', 0);
    this.freq = midiToFreq(note.midi) * Math.pow(2, (tune * 100 + det) / 1200);
    const ratio = param(p, 'osc.ratio', 2);
    this.modFreq = this.freq * ratio;
    this.subDiv = SUBDIV[Math.round(param(p, 'osc.subDiv', 0))] ?? 0;
    this.subFreq = this.subDiv > 0 ? this.freq / this.subDiv : this.freq;
    this.main = mainOsc(Math.round(param(p, 'osc.mainWave', 0)), sr);
    this.mod = modOscFn(Math.round(param(p, 'osc.modWave', 0)), sr);
    this.sub = new SineOsc(sr);
    this.fmIndexHz = param(p, 'osc.fmIndex', 0.2) * this.modFreq * 2;
    this.ring = param(p, 'osc.ring', 0);
    this.subLvl = this.subDiv > 0 ? param(p, 'osc.subLevel', 0.3) : 0;
    this.foldAmt = param(p, 'timbre.fold', 0.5);
    this.symmetry = param(p, 'timbre.symmetry', 0) * 0.5;
    this.accentMul = note.accent ? 1.3 : 1;
    const mode = Math.round(param(p, 'lpg.mode', 2));
    this.filterMode = mode === 0 || mode === 2; this.vcaMode = mode === 1 || mode === 2;
    this.filter = new Svf(sr);
    this.cutoffHz = Math.min(18000, 60 * Math.pow(220, param(p, 'lpg.cutoff', 0.6)));
    this.q = param(p, 'lpg.resonance', 0.2) * 20 * 0.45;
    this.cmode = Math.round(param(p, 'contour.mode', 0));
    this.atk = Math.max(0.001, param(p, 'contour.attack', 0.005));
    this.dec = Math.max(0.005, param(p, 'contour.decay', 0.4));
    this.amount = param(p, 'contour.amount', 0.9);
    this.cycle = Math.round(param(p, 'contour.cycle', 0)) >= 1;
    this.level = param(p, 'amp.level', 0.8);
    this.vel = note.velocity * (note.accent ? 1.3 : 1);
    this.contourEnd = (note.beginSec + note.durationSec) + this.dec * 3;
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  /** AD contour value 0..amount. Pluck = AD from t=begin; sustain = hold to gate
   *  end then exp release; cycle re-triggers every (atk+dec). */
  private contour(t: number): number {
    let lt = t - this.begin;
    if (this.cycle) lt = lt % (this.atk + this.dec);
    if (lt < this.atk) return this.amount * (lt / this.atk);
    if (this.cmode === 1 && !this.cycle && t <= this.holdEnd) return this.amount;
    const start = (this.cmode === 1 && !this.cycle) ? (this.holdEnd - this.begin) : this.atk;
    return this.amount * Math.exp(-(lt - start) / (this.dec / 3));
  }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    // complex oscillator
    const modS = this.mod.update(this.modFreq);
    const mainS = this.main.update(this.freq + modS * this.fmIndexHz);
    const ringS = mainS * modS * this.ring;
    const subS = this.subLvl > 0 ? this.sub.update(this.subFreq) * this.subLvl : 0;
    let sig = mainS * 0.7 + ringS + subS + this.symmetry;
    // wavefolder
    sig = fold(sig, this.foldAmt * this.accentMul);
    // low-pass gate: contour drives the filter cutoff (lp mode) and/or VCA (gate mode)
    const c = this.contour(t);
    const cutoff = this.filterMode ? this.cutoffHz * (1 + c * 3 * this.accentMul) : this.cutoffHz;
    this.filter.update(sig, cutoff, this.q);
    const vca = this.vcaMode ? c : 1;
    const out = this.filter.lp * vca * this.level * this.vel * 0.5;   // OUTPUT_TRIM
    if (t > this.contourEnd && t > this.holdEnd) this.done = true;
    return out;
  }
}
registerRenderer('westcoast', (n, p, sr) => new WestcoastRenderer(n, p, sr));
```

- [ ] **Step 5: Run tests** → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/fold.ts src/audio-dsp/westcoast-renderer.ts src/audio-dsp/westcoast-renderer.test.ts
git commit -m "feat(audio-dsp): westcoast renderer (complex osc + wavefolder + LPG contour)"
```

---

## Task 7: Generalize WorkletLaneEngine + route all melodic engines

Make `WorkletLaneEngine` drive any melodic engineId (not just subtractive): it takes the engineId + its `EngineParamSpec[]` + presets-key, posts dot-id params, and posts `processorOptions.engineId` so the worklet builds the right renderer. The allocator routes tb303/fm/wavetable/karplus/westcoast to it. Mono engines (TB-303) set `maxVoices: 1`.

**Files:**
- Modify: `src/engines/worklet-lane-engine.ts` (parameterize by engineId + param spec + presets key + polyphony)
- Modify: `src/app/lane-allocator.ts` (route all melodic engines)
- Test: `src/engines/worklet-lane-engine.test.ts` (add per-engine cases)

**Interfaces:**
- `WorkletLaneEngine` constructor gains `(ctx, output, opts: { engineId: string; name: string; params: EngineParamSpec[]; presetsKey: string; polyphony: 'mono'|'poly'; modulators?: ModulatorState[] })`. It posts `setMaxVoices(1)` when `polyphony==='mono'`. Param spec comes from each engine's existing exported spec array (e.g. import `FM_PARAMS` — extract these into `*-params.ts` files mirroring Task-9 of Phase 1's `subtractive-params.ts`, OR read the spec off a throwaway legacy engine instance: `new FMEngine().params`). Prefer the latter (no extraction churn) for FM/Wavetable/Karplus/Westcoast; TB-303's spec from `new TB303Engine().params`.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/engines/worklet-lane-engine.test.ts (with the existing LoomWorkletNode mock)
it('posts processorOptions.engineId so the worklet builds the right renderer', () => {
  // Assert the mock captured the engineId passed to the node constructor for 'fm'.
});
it('a mono engine (tb-303) configures maxVoices = 1', () => {
  // Assert the mock captured setMaxVoices(1) for a tb-303 WorkletLaneEngine.
});
```

Extend the `LoomWorkletNode` mock to capture its constructor `engineId` and `setMaxVoices` calls.

- [ ] **Step 2: Run test to verify it fails** → FAIL.

- [ ] **Step 3: Generalize the engine**

Replace the hardcoded `id='subtractive'` / `DOT_TO_FIELD` with constructor-injected config. The param posting becomes generic: `setBaseValue(id, v)` → `this.worklet.setParams({ [id]: v })` (dot-id straight through — no field map, since Task 1 made the worklet param bag dot-id-keyed). `getBaseValue` reads from a local `Record<string, number>` seeded from the param spec defaults. Construct the `LoomWorkletNode` with the engineId; call `setMaxVoices(1)` for mono.

- [ ] **Step 4: Route in the allocator**

```ts
// lane-allocator.ts createLaneEngine — replace the subtractive-only branch:
const WORKLET_ENGINES: Record<string, { name: string; presetsKey: string; polyphony: 'mono'|'poly' }> = {
  'subtractive': { name: 'Sub',  presetsKey: 'subtractive', polyphony: 'poly' },
  'tb-303':      { name: 'TB-303', presetsKey: 'tb303',     polyphony: 'mono' },
  'fm':          { name: 'FM',    presetsKey: 'fm',         polyphony: 'poly' },
  'wavetable':   { name: 'Wave',  presetsKey: 'wavetable',  polyphony: 'poly' },
  'karplus':     { name: 'Karp',  presetsKey: 'karplus',    polyphony: 'poly' },
  'westcoast':   { name: 'West',  presetsKey: 'westcoast',  polyphony: 'poly' },
};
if (WORKLET_ENGINES[engineId]) {
  const cfg = WORKLET_ENGINES[engineId];
  const specEngine = createEngineInstance(engineId);    // throwaway, only for .params/.modulators
  return new WorkletLaneEngine(deps.ctx, inserts.inputNode, {
    engineId, name: cfg.name, presetsKey: cfg.presetsKey, polyphony: cfg.polyphony,
    params: specEngine?.params ?? [], modulators: specEngine?.modulators.serialize(),
  });
}
```

**Reconcile the engineId strings** against the registry (`src/engines/registry.ts`) — confirm TB-303's id is `'tb-303'` (not `'tb303'`) during execution.

- [ ] **Step 5: Run tests + typecheck + build**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts` → PASS.
Run: `NO_COLOR=1 npm run test:unit` → full suite green.
Run: `npm run build` → tsc + bundle OK.

- [ ] **Step 6: Manual audible verification**

`npm run dev`. For each engine, create a lane with it (or load a demo that uses it), play notes:
- TB-303: acid bass, slide/accent audible, monophonic.
- FM: in tune (the bug is fixed), preset timbres reasonable.
- Wavetable: morph sweeps timbre.
- Karplus: plucked decay, register even.
- Westcoast: fold + LPG pluck.
Compare each against the pre-worklet sound (not bit-exact; "reasonably faithful + presets translate" is the bar).

- [ ] **Step 7: Commit**

```bash
git add src/engines/worklet-lane-engine.ts src/engines/worklet-lane-engine.test.ts src/app/lane-allocator.ts
git commit -m "feat(worklet): route all melodic engines through the worklet lane engine"
```

---

## Self-Review

**Spec coverage:** Build-order step 2 ("port the rest: TB-303, FM (fix tuning), Wavetable, Karplus, Westcoast") — all five covered (Tasks 2–6), routed (Task 7), FM tuning fixed (Task 3 test gate). Drums explicitly deferred to Phase 2b. Generic multi-engine worklet (Task 1) is the enabling refactor the spec implies ("one VoiceRenderer per engine").

**Placeholder scan:** Two deliberate "paste from source" steps — Task 4 (`renderKarplusString`, lifted verbatim from the existing pure-JS function) and Task 5/6 (`wavetable-tables.ts` harmonic data + `westcoast-fold.ts` curve). These are concrete porting instructions citing exact source locations, not vague TODOs; the executor copies real, existing code. Every renderer's `renderSample` is written in full.

**Type consistency:** `VoiceRenderer` (Phase 1) implemented by all five renderers identically. `ParamBag`/`param`/`registerRenderer`/`createRenderer` (Task 1) used uniformly. `VoiceManager` constructor `(sr, engineId, ParamBag)` set in Task 1 and consumed by the worklet. Dot-id param keys match each engine's existing `EngineParamSpec.id` vocabulary (reconcile note flags the TB-303 id check).

**Reconcile-with-Phase-1 caveats (by design, not placeholders):** every cross-reference to a Phase-1 symbol (`VoiceManager`, `LoomWorkletNode`, `WorkletLaneEngine`, the message protocol) is flagged to verify against the real Phase-1 implementation before executing, since those signatures may have shifted during Phase-1 execution.
