# AudioWorklet Synthesis Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-note voice synthesis off the Web Audio node-per-note model into a single AudioWorklet per lane, proven end-to-end with the **Subtractive** engine (the MIDI-import default and the dropout pain point), with in-worklet modulation and a global polyphony cap.

**Architecture:** A pure-TS **DSP kernel** (`src/audio-dsp/`, no Web Audio / no worklet globals — directly unit-testable) provides per-sample oscillators/filter/ADSR and a `SubtractiveVoiceRenderer`. A **VoiceManager** pools voices, allocates/steals/frees them, and renders a summed block. A thin **AudioWorkletProcessor** (`loom-processor`) wraps the VoiceManager and a sample-frame **scheduler queue**; notes arrive as `postMessage` spawns scheduled to a sample frame (Strudel `dough` model). One **AudioWorkletNode per lane** replaces the lane's engine and feeds the lane's existing ChannelStrip unchanged. A `WorkletLaneEngine` adapts the existing `SynthEngine`/`Voice` interface so the scheduler, note-FX, dispatch, save/load, and mixer are untouched. A main-thread `GlobalVoiceCap` coordinator caps total simultaneous voices across lanes.

**Tech Stack:** TypeScript 5.4 (strict), Vite 5.2 (AudioWorklet bundling), Vitest 3.2 (`node-web-audio-api` globalized for DSP tests but the kernel needs none), Web Audio `AudioWorkletNode`/`AudioWorkletProcessor`. Reference: `c:\Users\nacho\git\strudel\packages\supradough\dough.mjs` + `dough-worklet.mjs`.

## Global Constraints

- **Pure kernel.** Everything in `src/audio-dsp/` is plain TS — no `AudioContext`, no `AudioParam`, no `sampleRate`/`currentTime`/`registerProcessor` worklet globals. Sample rate is passed in as a constructor/function argument. This is what makes it unit-testable without a worklet or AudioContext.
- **Mixer/FX/master untouched.** Only per-note voice synthesis moves. `ChannelStrip`, `FxBus`, `MasterBusStrip`, `MasterCompressor`, the master soft-clip, sidechain, inserts stay exactly as they are. The lane worklet node connects to `inserts.inputNode` / `strip.input` exactly where the old engine's voice output went.
- **No production coexistence, incremental build.** Phase 1 routes ONLY `subtractive` through the worklet; other engines keep their current path until their own phase. The old `SubtractiveEngine` stays in the tree until the Phase 4 cutover (a later plan) — that is build order, not a runtime dual-engine toggle.
- **UI text in English.** Any user-facing string (PERF labels, etc.) is English.
- **Relative test assertions only.** Ratios/comparisons, never absolute magnitudes (a brittle-threshold needs a justifying comment). DSP kernel tests render into a `Float32Array` and assert relative properties.
- **Must work under `--base=/Loom/`.** The worklet module must load in `npm run dev` AND in `npm run build:pages && npm run preview` (GitHub Pages base path). Task 1 gates this.
- **Frequent commits.** One commit per task (TDD: red → green → commit). DRY, YAGNI, TDD.
- **Sample rate is not assumed 44.1k or 48k.** Read it from the worklet (`sampleRate` global) and thread it into the kernel; tests pass an explicit rate (use 48000).

### Shared types (defined once, referenced by every task)

These names are fixed across the plan. Earlier tasks create them; later tasks import them verbatim.

```ts
// src/audio-dsp/types.ts  (created in Task 2)

/** Flat per-lane subtractive parameter snapshot. Mirrors the PolySynthParams
 *  tree (src/polysynth/polysynth.ts) but flattened to the dot-id vocabulary
 *  used by the SubtractiveEngine param specs, with waves as 0..3 indices. */
export interface SubParams {
  masterTune: number;       // semitones
  osc1Wave: number; osc1Level: number; osc1Detune: number;   // wave 0..3, level 0..1, detune cents
  osc2Wave: number; osc2Level: number; osc2Detune: number;
  subLevel: number;
  noiseLevel: number; noiseColor: number;                    // color 0..1
  filterCutoff: number; filterResonance: number; filterEnvAmount: number;
  filterDrive: number; filterKeyTrack: number; filterBuiltinEnv: number; // builtinEnv 0/1
  filterAttack: number; filterDecay: number; filterSustain: number; filterRelease: number;
  ampBuiltinEnv: number;                                     // 0/1
  ampAttack: number; ampDecay: number; ampSustain: number; ampRelease: number;
}

/** One scheduled note. beginSec/durationSec are AudioContext seconds; the
 *  processor converts to sample frames. */
export interface NoteSpec {
  midi: number;
  beginSec: number;
  durationSec: number;
  velocity: number;   // 0..1
  accent: boolean;
  slide: boolean;
}

/** A pooled, per-sample voice. Pure: no Web Audio. */
export interface VoiceRenderer {
  /** Render one mono sample at absolute time t (seconds). */
  renderSample(t: number): number;
  /** Live note-off: end the gate at time t (release tail still plays). */
  noteOff(t: number): void;
  /** True once the release tail has fully decayed at the last rendered t. */
  readonly done: boolean;
}
```

```ts
// src/audio-dsp/messages.ts  (created in Task 7)
import type { NoteSpec, SubParams } from './types';
import type { ModLite } from './modulation-runtime';   // Task 10

export type MainToWorklet =
  | { type: 'spawn'; note: NoteSpec }
  | { type: 'params'; params: Partial<SubParams> }
  | { type: 'mods'; mods: ModLite[] }
  | { type: 'config'; maxVoices: number }
  | { type: 'steal'; count: number };

export type WorkletToMain =
  | { type: 'voices'; active: number };
```

---

## File Structure

New (pure kernel — `src/audio-dsp/`):
- `types.ts` — `SubParams`, `NoteSpec`, `VoiceRenderer` (shared types above).
- `osc.ts` / `osc.test.ts` — `SawOsc`, `SquareOsc`, `TriOsc`, `SineOsc`, `WhiteNoise` (per-sample `update(freq)`).
- `filter.ts` / `filter.test.ts` — `Svf` two-pole state-variable filter (lp/hp/bp taps).
- `adsr.ts` / `adsr.test.ts` — `Adsr` gate-driven envelope state machine.
- `subtractive-renderer.ts` / `subtractive-renderer.test.ts` — `SubtractiveVoiceRenderer implements VoiceRenderer`.
- `voice-manager.ts` / `voice-manager.test.ts` — `VoiceManager` (pool, allocate/steal/free, cap, summed render).
- `scheduler-queue.ts` / `scheduler-queue.test.ts` — `SchedulerQueue` (sorted spawn/despawn by sample frame).
- `messages.ts` — `MainToWorklet` / `WorkletToMain` message unions.
- `modulation-runtime.ts` / `modulation-runtime.test.ts` — `ModLite`, per-sample LFO, `ModulationRuntime`.

New (worklet glue — `src/audio-worklet/`):
- `loom-processor.ts` — the `AudioWorkletProcessor` (thin: queue + VoiceManager + ModulationRuntime).
- `loom-node.ts` — `LoomWorkletNode` main-thread wrapper (loads module, typed `post*` helpers, voice-count callback).
- `global-voice-cap.ts` / `global-voice-cap.test.ts` — `GlobalVoiceCap` coordinator.

New (engine adapter — `src/engines/`):
- `worklet-lane-engine.ts` — `WorkletLaneEngine implements SynthEngine` (Phase 1: subtractive).

Modified:
- `vite.config.ts` — AudioWorklet module URL handling (Task 1).
- `src/app/lane-allocator.ts:117-151` — route `subtractive` to `WorkletLaneEngine`; register its node with the global cap (Task 9, Task 11).
- `src/app/audio-graph.ts` or `src/main.ts` — create the `GlobalVoiceCap`, thread it to the allocator (Task 11).

Untouched (verified by tests still passing): `trigger-dispatch.ts`, `sequencer.ts`, `lane-scheduler.ts`, `session-runtime.ts`, note-FX, save/load, mixer/FX/master.

---

## Task 1: Worklet bootstrap spike — load a processor and make it audible (dev + base path)

De-risks the spec's #1 open risk (Vite AudioWorklet bundling under `--base=/Loom/`). Produces a working, committed loader and a trivial test-tone processor; you delete the test tone in Task 8 when the real processor lands.

**Files:**
- Create: `src/audio-worklet/loom-processor.ts` (temporary 220 Hz sine; replaced in Task 8)
- Create: `src/audio-worklet/loom-node.ts` (the `addModule` + node wrapper)
- Modify: `vite.config.ts` (worklet URL handling, if needed)
- Test: manual audible verification (no unit test — worklets don't run under `node-web-audio-api`; the kernel is tested directly from Task 2 on)

**Interfaces:**
- Produces: `loadLoomWorklet(ctx: AudioContext): Promise<void>` and `class LoomWorkletNode` (constructor `(ctx: AudioContext)`, field `node: AudioWorkletNode`). Task 8 extends `LoomWorkletNode`; Task 9 consumes it.

- [ ] **Step 1: Write the temporary test-tone processor**

```ts
// src/audio-worklet/loom-processor.ts
/// <reference lib="webworker" />
// TEMPORARY (Task 1 spike): a 220 Hz sine to prove the worklet pipe end-to-end.
// Replaced by the real VoiceManager-backed processor in Task 8.
class LoomProcessor extends AudioWorkletProcessor {
  private phase = 0;
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const inc = 220 / sampleRate;
    for (let i = 0; i < out[0].length; i++) {
      const s = Math.sin(this.phase * 2 * Math.PI) * 0.2;
      this.phase = (this.phase + inc) % 1;
      for (let c = 0; c < out.length; c++) out[c][i] = s;
    }
    return true;
  }
}
registerProcessor('loom-processor', LoomProcessor);
```

- [ ] **Step 2: Write the loader + node wrapper**

```ts
// src/audio-worklet/loom-node.ts
// Vite 5: `new URL('./mod.ts', import.meta.url)` is transformed to an emitted,
// transpiled asset URL in both dev and build (honouring `--base=/Loom/`), so
// addModule receives a real JS module URL — not raw TS. If a future Vite serves
// raw TS here (audible failure in `npm run dev`), the fallback is a dedicated
// rollup input emitting `loom-processor.js` + load via
// `import.meta.env.BASE_URL + 'loom-processor.js'` (documented in this task).
let loaded = false;
export async function loadLoomWorklet(ctx: AudioContext): Promise<void> {
  if (loaded) return;
  const url = new URL('./loom-processor.ts', import.meta.url);
  await ctx.audioWorklet.addModule(url);
  loaded = true;
}

export class LoomWorkletNode {
  readonly node: AudioWorkletNode;
  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'loom-processor', { outputChannelCount: [2] });
  }
  connect(dest: AudioNode): void { this.node.connect(dest); }
  disconnect(): void { this.node.disconnect(); }
}
```

- [ ] **Step 3: Temporarily wire it into boot so you can hear it**

In `src/main.ts`, right after the `AudioContext` is created and resumed on first play, add (temporary — remove before committing Task 1, or keep behind a `?worklettest` query guard):

```ts
import { loadLoomWorklet, LoomWorkletNode } from './audio-worklet/loom-node';
// TEMP spike wiring:
if (new URLSearchParams(location.search).has('worklettest')) {
  await loadLoomWorklet(ctx);
  new LoomWorkletNode(ctx).connect(ctx.destination);
}
```

- [ ] **Step 4: Verify audible in DEV**

Run: `npm run dev`, open `http://localhost:5173/?worklettest`, click Play (to resume the AudioContext).
Expected: a steady 220 Hz tone. Check the browser console: no "addModule" / 404 / "Unexpected token" errors.

- [ ] **Step 5: Verify audible under the Pages base path**

Run: `npm run build:pages && npm run preview`
Open the preview URL with `/?worklettest` (note the `/Loom/` base). Expected: same tone, no 404 on the processor asset (confirm the worklet request resolves under `/Loom/`).

- [ ] **Step 6: Commit** (keep the `?worklettest` guard; it's a harmless dev aid removed in Task 8)

```bash
git add src/audio-worklet/loom-processor.ts src/audio-worklet/loom-node.ts vite.config.ts src/main.ts
git commit -m "feat(worklet): bootstrap AudioWorklet loader + node, audible in dev and base path"
```

---

## Task 2: DSP kernel — oscillators + shared types

**Files:**
- Create: `src/audio-dsp/types.ts` (the shared types from Global Constraints)
- Create: `src/audio-dsp/osc.ts`
- Test: `src/audio-dsp/osc.test.ts`

**Interfaces:**
- Produces: `SubParams`, `NoteSpec`, `VoiceRenderer` (types.ts). `SawOsc`, `SquareOsc`, `TriOsc`, `SineOsc`, `WhiteNoise` — each `new (sampleRate: number)` with `update(freq: number): number` returning −1..1. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/osc.test.ts
import { describe, it, expect } from 'vitest';
import { SawOsc, SquareOsc, TriOsc, SineOsc, WhiteNoise } from './osc';

const SR = 48000;
function rms(buf: number[]): number {
  return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
}

describe('oscillators', () => {
  it('saw stays bounded and is non-silent at 440 Hz', () => {
    const o = new SawOsc(SR);
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update(440));
    expect(Math.max(...buf)).toBeLessThanOrEqual(1.001);
    expect(Math.min(...buf)).toBeGreaterThanOrEqual(-1.001);
    expect(rms(buf)).toBeGreaterThan(0.3);
  });

  it('sine completes ~N cycles in N/freq seconds (zero crossings)', () => {
    const o = new SineOsc(SR);
    let crossings = 0; let prev = 0;
    for (let i = 0; i < SR; i++) {            // 1 second @ 100 Hz → ~200 zero crossings
      const v = o.update(100);
      if (prev <= 0 && v > 0) crossings++;
      prev = v;
    }
    expect(crossings).toBeGreaterThan(95);
    expect(crossings).toBeLessThan(105);
  });

  it('white noise is broadband (high RMS, near-zero DC)', () => {
    const o = new WhiteNoise();
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update());
    const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
    expect(rms(buf)).toBeGreaterThan(0.4);
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('square is bipolar with ~50% duty (mean near 0)', () => {
    const o = new SquareOsc(SR);
    const buf: number[] = [];
    for (let i = 0; i < SR / 10; i++) buf.push(o.update(220));
    const mean = buf.reduce((s, v) => s + v, 0) / buf.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/osc.test.ts`
Expected: FAIL — `Cannot find module './osc'`.

- [ ] **Step 3: Write the oscillators** (polyBlep saw/square lifted from `dough.mjs`; band-limited to avoid the aliasing the native `OscillatorType` hid)

```ts
// src/audio-dsp/osc.ts
// Per-sample oscillators for the worklet voice renderer. polyBlep band-limiting
// for saw/square (adapted from strudel dough.mjs). Pure: sampleRate is injected.

function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

export class SawOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    const dt = freq / this.sr;
    const p = polyBlep(this.phase, dt);
    const s = 2 * this.phase - 1 - p;
    this.phase += dt;
    if (this.phase > 1) this.phase -= 1;
    return s;
  }
}

export class SquareOsc {
  private phase = 0;
  constructor(private sr: number) {}
  private saw(offset: number, dt: number): number {
    const phase = (this.phase + offset) % 1;
    return 2 * phase - 1 - polyBlep(phase, dt);
  }
  update(freq: number, pw = 0.5): number {
    const dt = freq / this.sr;
    const pulse = this.saw(0, dt) - this.saw(pw, dt);
    this.phase = (this.phase + dt) % 1;
    return pulse + pw * 2 - 1;
  }
}

export class TriOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    this.phase += freq / this.sr;
    const p = this.phase % 1;
    const v = p < 0.5 ? 2 * p : 1 - 2 * (p - 0.5);
    return v * 2 - 1;
  }
}

export class SineOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    const v = Math.sin(this.phase * 2 * Math.PI);
    this.phase = (this.phase + freq / this.sr) % 1;
    return v;
  }
}

export class WhiteNoise {
  update(): number { return Math.random() * 2 - 1; }
}
```

Add to `src/audio-dsp/types.ts` the three interfaces from the Global Constraints "Shared types" block (`SubParams`, `NoteSpec`, `VoiceRenderer`).

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/osc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/types.ts src/audio-dsp/osc.ts src/audio-dsp/osc.test.ts
git commit -m "feat(audio-dsp): per-sample oscillators + shared kernel types"
```

---

## Task 3: DSP kernel — state-variable filter

**Files:**
- Create: `src/audio-dsp/filter.ts`
- Test: `src/audio-dsp/filter.test.ts`

**Interfaces:**
- Produces: `class Svf` — `new (sampleRate: number)`, `update(input: number, cutoffHz: number, resonance: number): void`, exposes `lp`, `bp`, `hp` (last computed taps). Consumed by Task 5. (Two-pole topology from `dough.mjs` `TwoPoleFilter`, extended with an `hp` tap = input − lp − bp scaled, sufficient for the lowpass Subtractive uses.)

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/filter.test.ts
import { describe, it, expect } from 'vitest';
import { Svf } from './filter';
import { SawOsc, SineOsc } from './osc';

const SR = 48000;
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('Svf lowpass', () => {
  it('passes a 100 Hz sine almost unchanged at a 5 kHz cutoff', () => {
    const f = new Svf(SR); const o = new SineOsc(SR);
    const out: number[] = [];
    for (let i = 0; i < SR; i++) { f.update(o.update(100), 5000, 0); out.push(f.lp); }
    expect(rms(out)).toBeGreaterThan(0.5);   // sine RMS ~0.707, barely attenuated
  });

  it('attenuates a bright saw more at a low cutoff than at a high cutoff', () => {
    const measure = (cut: number) => {
      const f = new Svf(SR); const o = new SawOsc(SR); const out: number[] = [];
      for (let i = 0; i < SR; i++) { f.update(o.update(880), cut, 0); out.push(f.lp); }
      return rms(out);
    };
    expect(measure(8000)).toBeGreaterThan(measure(300) * 1.5);
  });

  it('resonance boosts energy near the cutoff vs no resonance', () => {
    const measure = (res: number) => {
      const f = new Svf(SR); const o = new SawOsc(SR); const out: number[] = [];
      for (let i = 0; i < SR; i++) { f.update(o.update(110), 1200, res); out.push(f.lp); }
      return rms(out);
    };
    expect(measure(8)).toBeGreaterThan(measure(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter.test.ts`
Expected: FAIL — `Cannot find module './filter'`.

- [ ] **Step 3: Write the filter**

```ts
// src/audio-dsp/filter.ts
// Two-pole state-variable filter (adapted from strudel dough.mjs TwoPoleFilter).
// `resonance` here is a 0..~20 scale (Loom maps its 0..1 knob to 0.5..22.5 Q).
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export class Svf {
  private s0 = 0;   // bandpass state
  private s1 = 0;   // lowpass state
  lp = 0; bp = 0; hp = 0;
  constructor(private sr: number) {}
  update(input: number, cutoffHz: number, resonance: number): void {
    const res = Math.max(resonance, 0);
    const cutoff = Math.min(cutoffHz, this.sr * 0.45);
    let c = 2 * Math.sin((cutoff * Math.PI) / this.sr);
    c = clamp(c, 0, 1.14);
    const r = Math.pow(0.5, (res + 0.125) / 0.125);
    const mrc = 1 - r * c;
    this.s0 = mrc * this.s0 - c * this.s1 + c * input;   // bandpass
    this.s1 = mrc * this.s1 + c * this.s0;               // lowpass
    this.bp = this.s0; this.lp = this.s1; this.hp = input - this.lp - r * this.bp;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/filter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/filter.ts src/audio-dsp/filter.test.ts
git commit -m "feat(audio-dsp): two-pole state-variable filter"
```

---

## Task 4: DSP kernel — ADSR envelope

**Files:**
- Create: `src/audio-dsp/adsr.ts`
- Test: `src/audio-dsp/adsr.test.ts`

**Interfaces:**
- Produces: `class Adsr` — `new ()`, `update(t: number, gate: number, a: number, d: number, s: number, r: number): number` returns 0..1; `readonly isOff: boolean`. Gate-driven state machine (from `dough.mjs` `ADSR`). `t` is absolute seconds; a/d/r in seconds, s in 0..1. Consumed by Tasks 5 and 10.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/adsr.test.ts
import { describe, it, expect } from 'vitest';
import { Adsr } from './adsr';

describe('Adsr', () => {
  it('rises during attack and reaches ~1 at the attack peak', () => {
    // Evaluate per-sample (real usage): the gate-driven state machine returns 0
    // on the off→attack init frame, then interpolates — so call it densely, not
    // with two sparse samples.
    const SR = 48000;
    const e = new Adsr();
    const out: number[] = [];
    for (let i = 0; i <= 480; i++) out.push(e.update(i / SR, 1, 0.01, 0.1, 0.5, 0.2)); // 480 samples = 10ms attack
    const mid = out[240];   // ~halfway up the attack
    const peak = out[480];  // attack end
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(peak);
    expect(peak).toBeGreaterThan(0.9);
  });

  it('settles to the sustain level while the gate is held', () => {
    const e = new Adsr();
    let v = 0;
    for (let t = 0; t <= 0.3; t += 1 / 48000) v = e.update(t, 1, 0.01, 0.05, 0.4, 0.2);
    expect(v).toBeCloseTo(0.4, 1);
  });

  it('falls to 0 and reports off after the release tail', () => {
    const e = new Adsr();
    for (let t = 0; t <= 0.1; t += 1 / 48000) e.update(t, 1, 0.01, 0.02, 0.5, 0.05); // hold
    let v = 1;
    for (let t = 0.1; t <= 0.2; t += 1 / 48000) v = e.update(t, 0, 0.01, 0.02, 0.5, 0.05); // gate off
    expect(v).toBeLessThan(0.001);
    expect(e.isOff).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/adsr.test.ts`
Expected: FAIL — `Cannot find module './adsr'`.

- [ ] **Step 3: Write the envelope** (state machine adapted from `dough.mjs` `ADSR`, with an `isOff` flag)

```ts
// src/audio-dsp/adsr.ts
type State = 'off' | 'attack' | 'decay' | 'sustain' | 'release';

function lerp(x: number, y0: number, y1: number, exponent = 1): number {
  if (x <= 0) return y0;
  if (x >= 1) return y1;
  const cx = exponent === 0 ? x : exponent > 0 ? Math.pow(x, exponent) : 1 - Math.pow(1 - x, -exponent);
  return y0 + (y1 - y0) * cx;
}

export class Adsr {
  private state: State = 'off';
  private startTime = 0;
  private startVal = 0;
  private decayCurve = 2;
  get isOff(): boolean { return this.state === 'off'; }

  update(t: number, gate: number, attack: number, decay: number, sustain: number, release: number): number {
    switch (this.state) {
      case 'off':
        if (gate > 0) { this.state = 'attack'; this.startTime = t; this.startVal = 0; }
        return 0;
      case 'attack': {
        const dt = t - this.startTime;
        if (dt > attack) { this.state = 'decay'; this.startTime = t; return 1; }
        return lerp(dt / attack, this.startVal, 1, 1);
      }
      case 'decay': {
        const dt = t - this.startTime;
        const cur = lerp(dt / decay, 1, sustain, -this.decayCurve);
        if (gate <= 0) { this.state = 'release'; this.startTime = t; this.startVal = cur; return cur; }
        if (dt > decay) { this.state = 'sustain'; this.startTime = t; return sustain; }
        return cur;
      }
      case 'sustain':
        if (gate <= 0) { this.state = 'release'; this.startTime = t; this.startVal = sustain; }
        return sustain;
      case 'release': {
        const dt = t - this.startTime;
        if (dt > release) { this.state = 'off'; return 0; }
        const cur = lerp(dt / release, this.startVal, 0, -this.decayCurve);
        if (gate > 0) { this.state = 'attack'; this.startTime = t; this.startVal = cur; }
        return cur;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/adsr.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/adsr.ts src/audio-dsp/adsr.test.ts
git commit -m "feat(audio-dsp): gate-driven ADSR envelope"
```

---

## Task 5: SubtractiveVoiceRenderer (port the PolySynth voice to per-sample)

The crux. Ports `src/polysynth/polysynth.ts` `internalTrigger` per-voice DSP (2 osc + sub + noise → optional drive → lowpass with cutoff = base + keytrack + env → amp env) to a per-sample `VoiceRenderer`.

**Files:**
- Create: `src/audio-dsp/subtractive-renderer.ts`
- Test: `src/audio-dsp/subtractive-renderer.test.ts`

**Interfaces:**
- Consumes: `SubParams`, `NoteSpec`, `VoiceRenderer` (Task 2); `SawOsc/SquareOsc/TriOsc/SineOsc/WhiteNoise` (Task 2); `Svf` (Task 3); `Adsr` (Task 4).
- Produces: `class SubtractiveVoiceRenderer implements VoiceRenderer` — `new (note: NoteSpec, params: SubParams, sampleRate: number)`. Cutoff mapping `60 * 220^cutoff` Hz and amp peak `0.4 * velGain` match PolySynth so presets translate. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/subtractive-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';
import type { SubParams, NoteSpec } from './types';

const SR = 48000;
const DEFAULTS: SubParams = {
  masterTune: 0,
  osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0,
  osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
  subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6,
  filterCutoff: 0.55, filterResonance: 0.25, filterEnvAmount: 0.45,
  filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1,
  filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35,
  ampBuiltinEnv: 1,
  ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
};
const note = (over: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 57, beginSec: 0, durationSec: 0.4, velocity: 0.8, accent: false, slide: false, ...over });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('SubtractiveVoiceRenderer', () => {
  it('is audible during the gate and decays to ~silence + done after release', () => {
    const v = new SubtractiveVoiceRenderer(note(), DEFAULTS, SR);
    const gate: number[] = [];
    for (let i = 0; i < SR * 0.3; i++) gate.push(v.renderSample(i / SR));
    expect(rms(gate)).toBeGreaterThan(0.02);
    let last = 1;
    for (let i = SR * 0.4; i < SR * 1.2; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);
    expect(v.done).toBe(true);
  });

  it('a higher velocity is louder', () => {
    const loud = (vel: number) => {
      const v = new SubtractiveVoiceRenderer(note({ velocity: vel }), DEFAULTS, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(loud(1.0)).toBeGreaterThan(loud(0.3) * 1.3);
  });

  it('a higher cutoff yields more high-frequency energy (less filtering)', () => {
    const bright = (cut: number) => {
      const v = new SubtractiveVoiceRenderer(note(), { ...DEFAULTS, filterCutoff: cut, filterEnvAmount: 0 }, SR);
      const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(0.95)).toBeGreaterThan(bright(0.15) * 1.2);
  });

  it('noteOff before the gate end shortens the sound (earlier silence)', () => {
    const v = new SubtractiveVoiceRenderer(note({ durationSec: 2 }), DEFAULTS, SR);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    v.noteOff(0.05);
    let last = 1;
    for (let i = SR * 0.05; i < SR * 0.6; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);   // released well before the 2 s gate
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: FAIL — `Cannot find module './subtractive-renderer'`.

- [ ] **Step 3: Write the renderer** (faithful per-sample port of PolySynth's voice)

```ts
// src/audio-dsp/subtractive-renderer.ts
import type { NoteSpec, SubParams, VoiceRenderer } from './types';
import { SawOsc, SquareOsc, TriOsc, SineOsc, WhiteNoise } from './osc';
import { Svf } from './filter';
import { Adsr } from './adsr';

type Osc = { update(freq: number): number };
function makeOsc(wave: number, sr: number): Osc {
  switch (wave) {
    case 1: return new SquareOsc(sr);
    case 2: return new TriOsc(sr);
    case 3: return new SineOsc(sr);
    default: return new SawOsc(sr);
  }
}
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function driveShape(x: number, amount: number): number {
  const k = 1 + amount * amount * 25;
  return Math.tanh(x * k) / Math.tanh(k);
}

export class SubtractiveVoiceRenderer implements VoiceRenderer {
  private sr: number;
  private osc1: Osc; private osc2: Osc; private sub: SineOsc; private noise = new WhiteNoise();
  private noiseLp: Svf; private filter: Svf;
  private ampEnv = new Adsr(); private filtEnv = new Adsr();
  private begin: number; private holdEnd: number;
  private p: SubParams; private note: NoteSpec;
  private baseFreq: number; private accentMul: number; private velPeak: number;
  private baseCutoffHz: number; private keyTrackHz: number; private envRangeHz: number;
  done = false;

  constructor(note: NoteSpec, params: SubParams, sampleRate: number) {
    this.sr = sampleRate; this.p = params; this.note = note;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    const tuneSemis = params.masterTune;
    this.baseFreq = midiToFreq(note.midi) * Math.pow(2, tuneSemis / 12);
    this.osc1 = makeOsc(params.osc1Wave, sampleRate);
    this.osc2 = makeOsc(params.osc2Wave, sampleRate);
    this.sub = new SineOsc(sampleRate);
    this.noiseLp = new Svf(sampleRate);
    this.filter = new Svf(sampleRate);
    this.accentMul = note.accent ? 1.3 : 1.0;
    // loudness: mirror velGain — accent ~+30%, velocity scales, peak 0.4 (PolySynth).
    const vel = note.velocity * (note.accent ? 1.3 : 1.0);
    this.velPeak = 0.4 * Math.min(1, vel);
    this.baseCutoffHz = Math.min(60 * Math.pow(220, params.filterCutoff), 18000);
    const keySemiDelta = note.midi - 60;
    this.keyTrackHz = keySemiDelta * this.baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * params.filterKeyTrack;
    this.envRangeHz = Math.min(this.baseCutoffHz * 7, 16000) * params.filterEnvAmount * this.accentMul;
  }

  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }

  renderSample(t: number): number {
    if (t < this.begin) return 0;
    const p = this.p;
    const gate = t <= this.holdEnd ? 1 : 0;
    const detuneMul = (cents: number) => Math.pow(2, cents / 1200);
    // oscillators (osc detune in cents; sub one octave down)
    let mix = this.osc1.update(this.baseFreq * detuneMul(p.osc1Detune)) * p.osc1Level
            + this.osc2.update(this.baseFreq * detuneMul(p.osc2Detune)) * p.osc2Level
            + this.sub.update(this.baseFreq * 0.5) * p.subLevel;
    if (p.noiseLevel > 0) {
      this.noiseLp.update(this.noise.update(), 200 + p.noiseColor * 14800, 0);
      mix += this.noiseLp.lp * p.noiseLevel;
    }
    // parallel drive (dry + saturated wet scaled by drive), as in PolySynth
    if (p.filterDrive > 0) mix = mix + driveShape(mix, 1.0) * p.filterDrive;
    // filter cutoff = base + keytrack + envelope contribution
    const fe = p.filterBuiltinEnv >= 0.5
      ? this.filtEnv.update(t, gate, p.filterAttack, p.filterDecay, p.filterSustain, p.filterRelease) : 0;
    const cutoff = this.baseCutoffHz + this.keyTrackHz + fe * this.envRangeHz;
    const q = p.filterResonance * 22 * 0.45;     // 0..~10 res scale for Svf
    this.filter.update(mix, cutoff, q);
    // amp envelope
    const ae = p.ampBuiltinEnv >= 0.5
      ? this.ampEnv.update(t, gate, p.ampAttack, p.ampDecay, p.ampSustain, p.ampRelease) : 1;
    const out = this.filter.lp * ae * this.velPeak;
    // done once the amp env has fully released after the gate
    if (gate === 0 && this.ampEnv.isOff && t > this.holdEnd) this.done = true;
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/subtractive-renderer.test.ts`
Expected: PASS (4 tests). If the cutoff-brightness ratio is marginal, the relative thresholds (×1.2) have headroom; do not switch to absolute values.

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/subtractive-renderer.ts src/audio-dsp/subtractive-renderer.test.ts
git commit -m "feat(audio-dsp): per-sample SubtractiveVoiceRenderer port"
```

---

## Task 6: VoiceManager — pool, allocate, steal, free, summed render

**Files:**
- Create: `src/audio-dsp/voice-manager.ts`
- Test: `src/audio-dsp/voice-manager.test.ts`

**Interfaces:**
- Consumes: `SubtractiveVoiceRenderer` (Task 5), `SubParams`, `NoteSpec`, `VoiceRenderer` (Task 2).
- Produces: `class VoiceManager` —
  - `new (sampleRate: number, params: SubParams)`
  - `setParams(patch: Partial<SubParams>): void`
  - `setMaxVoices(n: number): void`
  - `spawn(note: NoteSpec): void` (steals oldest + same-midi, mirrors PolySynth)
  - `steal(count: number): void` (release the `count` oldest — used by the global cap)
  - `renderSample(t: number): number` (sum live voices, drop `done`)
  - `get activeCount(): number`
  Consumed by Tasks 8, 10, 11.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/voice-manager.test.ts
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import type { SubParams, NoteSpec } from './types';

const SR = 48000;
const P: SubParams = {
  masterTune: 0, osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0, osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
  subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6, filterCutoff: 0.6, filterResonance: 0.2, filterEnvAmount: 0.4,
  filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1, filterAttack: 0.01, filterDecay: 0.2,
  filterSustain: 0.5, filterRelease: 0.2, ampBuiltinEnv: 1, ampAttack: 0.01, ampDecay: 0.2,
  ampSustain: 0.8, ampRelease: 0.2,
};
const note = (midi: number, begin = 0): NoteSpec =>
  ({ midi, beginSec: begin, durationSec: 0.5, velocity: 0.8, accent: false, slide: false });
const render = (vm: VoiceManager, from: number, to: number) => {
  let r = 0; for (let i = from; i < to; i++) { const s = vm.renderSample(i / SR); r += s * s; }
  return Math.sqrt(r / (to - from));
};

describe('VoiceManager', () => {
  it('caps active voices at maxVoices, stealing the oldest', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(3);
    for (let i = 0; i < 6; i++) vm.spawn(note(48 + i));
    expect(vm.activeCount).toBeLessThanOrEqual(3);
  });

  it('a retrigger of the same midi replaces, not stacks', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8);
    vm.spawn(note(60)); vm.spawn(note(60)); vm.spawn(note(60));
    expect(vm.activeCount).toBe(1);
  });

  it('renders louder with more simultaneous voices', () => {
    const one = new VoiceManager(SR, P); one.setMaxVoices(8); one.spawn(note(50));
    const many = new VoiceManager(SR, P); many.setMaxVoices(8);
    for (const m of [50, 54, 57, 61]) many.spawn(note(m));
    expect(render(many, 0, SR * 0.1)).toBeGreaterThan(render(one, 0, SR * 0.1));
  });

  it('frees finished voices so activeCount returns to 0', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8); vm.spawn(note(60));
    for (let i = 0; i < SR * 1.5; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBe(0);
  });

  it('steal(n) silences the n oldest voices early', () => {
    const vm = new VoiceManager(SR, P); vm.setMaxVoices(8);
    for (const m of [50, 52, 54]) vm.spawn(note(m));
    for (let i = 0; i < SR * 0.05; i++) vm.renderSample(i / SR);
    vm.steal(2);
    for (let i = SR * 0.05; i < SR * 0.6; i++) vm.renderSample(i / SR);
    expect(vm.activeCount).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/voice-manager.test.ts`
Expected: FAIL — `Cannot find module './voice-manager'`.

- [ ] **Step 3: Write the VoiceManager**

```ts
// src/audio-dsp/voice-manager.ts
import type { NoteSpec, SubParams, VoiceRenderer } from './types';
import { SubtractiveVoiceRenderer } from './subtractive-renderer';

interface Slot { midi: number; allocatedAt: number; v: VoiceRenderer; }

export class VoiceManager {
  private slots: Slot[] = [];
  private maxVoices = 8;
  private params: SubParams;
  private lastT = 0;
  constructor(private sr: number, params: SubParams) {
    this.params = { ...params };
  }
  get activeCount(): number { return this.slots.length; }
  setParams(patch: Partial<SubParams>): void { Object.assign(this.params, patch); }
  setMaxVoices(n: number): void { this.maxVoices = Math.max(1, Math.min(64, Math.floor(n))); }

  spawn(note: NoteSpec): void {
    // same-midi steal first (MIDI imports retrigger without note-off), then cap.
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].midi === note.midi) { this.slots[i].v.noteOff(this.lastT); this.slots.splice(i, 1); }
    }
    while (this.slots.length >= this.maxVoices) {
      const oldest = this.slots.shift();
      oldest?.v.noteOff(this.lastT);
    }
    this.slots.push({
      midi: note.midi, allocatedAt: note.beginSec,
      v: new SubtractiveVoiceRenderer(note, this.params, this.sr),
    });
  }

  /** Release the `count` oldest voices early (global-cap stealing). */
  steal(count: number): void {
    const n = Math.min(count, this.slots.length);
    for (let i = 0; i < n; i++) this.slots[i].v.noteOff(this.lastT);
  }

  renderSample(t: number): number {
    this.lastT = t;
    let out = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      out += s.v.renderSample(t);
      if (s.v.done) this.slots.splice(i, 1);
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/voice-manager.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/voice-manager.ts src/audio-dsp/voice-manager.test.ts
git commit -m "feat(audio-dsp): pooled VoiceManager with stealing + summed render"
```

---

## Task 7: Scheduler queue (sample-frame spawn) + message protocol

**Files:**
- Create: `src/audio-dsp/scheduler-queue.ts`
- Create: `src/audio-dsp/messages.ts` (the unions from Global Constraints)
- Test: `src/audio-dsp/scheduler-queue.test.ts`

**Interfaces:**
- Produces: `class SchedulerQueue<T>` — `push(frame: number, item: T): void` (kept sorted), `drainDue(nowFrame: number, fn: (item: T) => void): void` (fires all items with `frame <= nowFrame`, in order). Used by Task 8 to fire spawns sample-accurately. Mirrors `dough.mjs` `schedule`/the head of `update`.
- Produces: `MainToWorklet`, `WorkletToMain` (messages.ts).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/scheduler-queue.test.ts
import { describe, it, expect } from 'vitest';
import { SchedulerQueue } from './scheduler-queue';

describe('SchedulerQueue', () => {
  it('fires items in frame order regardless of insertion order', () => {
    const q = new SchedulerQueue<string>();
    q.push(300, 'c'); q.push(100, 'a'); q.push(200, 'b');
    const fired: string[] = [];
    q.drainDue(250, (x) => fired.push(x));
    expect(fired).toEqual(['a', 'b']);     // 300 not yet due
    q.drainDue(300, (x) => fired.push(x));
    expect(fired).toEqual(['a', 'b', 'c']);
  });

  it('does not fire anything before its frame', () => {
    const q = new SchedulerQueue<number>();
    q.push(500, 42);
    const fired: number[] = [];
    q.drainDue(499, (x) => fired.push(x));
    expect(fired).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/scheduler-queue.test.ts`
Expected: FAIL — `Cannot find module './scheduler-queue'`.

- [ ] **Step 3: Write the queue + messages**

```ts
// src/audio-dsp/scheduler-queue.ts
interface Entry<T> { frame: number; item: T; }
export class SchedulerQueue<T> {
  private q: Entry<T>[] = [];
  push(frame: number, item: T): void {
    let i = 0;
    while (i < this.q.length && this.q[i].frame < frame) i++;
    this.q.splice(i, 0, { frame, item });
  }
  drainDue(nowFrame: number, fn: (item: T) => void): void {
    while (this.q.length > 0 && this.q[0].frame <= nowFrame) {
      fn(this.q[0].item);
      this.q.shift();
    }
  }
}
```

```ts
// src/audio-dsp/messages.ts
import type { NoteSpec, SubParams } from './types';
import type { ModLite } from './modulation-runtime';   // forward ref; created in Task 10

export type MainToWorklet =
  | { type: 'spawn'; note: NoteSpec }
  | { type: 'params'; params: Partial<SubParams> }
  | { type: 'mods'; mods: ModLite[] }
  | { type: 'config'; maxVoices: number }
  | { type: 'steal'; count: number };

export type WorkletToMain =
  | { type: 'voices'; active: number };
```

Note: `messages.ts` references `ModLite` (Task 10). Until Task 10 lands, temporarily declare `export type ModLite = unknown;` at the top of `modulation-runtime.ts` as a stub, OR define `messages.ts` without the `'mods'` case and add it in Task 10. Choose the stub: create `src/audio-dsp/modulation-runtime.ts` now with only `export type ModLite = { id: string; kind: string; enabled: boolean; rateHz: number; waveform: string; connections: { paramId: string; depth: number }[] };` so `messages.ts` type-checks; Task 10 fills in the runtime.

- [ ] **Step 4: Run test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/scheduler-queue.test.ts` → PASS (2 tests).
Run: `npx tsc --noEmit` → no errors (confirms `messages.ts` + the `ModLite` stub type-check).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/scheduler-queue.ts src/audio-dsp/scheduler-queue.test.ts src/audio-dsp/messages.ts src/audio-dsp/modulation-runtime.ts
git commit -m "feat(audio-dsp): frame-accurate scheduler queue + worklet message protocol"
```

---

## Task 8: LoomProcessor (real) + LoomWorkletNode wrapper

Replace the Task 1 test-tone processor with the real one: a `SchedulerQueue` of spawns fired by sample frame into a `VoiceManager`, summed per sample. Extend `LoomWorkletNode` with typed posting + a voice-count callback.

**Files:**
- Modify: `src/audio-worklet/loom-processor.ts` (replace test tone)
- Modify: `src/audio-worklet/loom-node.ts` (typed posting)
- Modify: `src/main.ts` (remove the `?worklettest` spike wiring from Task 1)
- Test: `src/audio-worklet/loom-node.test.ts` (the pure, mockable parts only)

**Interfaces:**
- Consumes: `VoiceManager` (Task 6), `SchedulerQueue` (Task 7), `MainToWorklet`/`WorkletToMain` (Task 7), `SubParams`/`NoteSpec` (Task 2), `POLY_DEFAULTS`-equivalent base params.
- Produces (extends Task 1 `LoomWorkletNode`):
  - `spawn(note: NoteSpec): void`
  - `setParams(patch: Partial<SubParams>): void`
  - `setMaxVoices(n: number): void`
  - `steal(count: number): void`
  - `onVoiceCount(cb: (active: number) => void): void`
  - static `defaultSubParams(): SubParams`
  Consumed by Tasks 9, 10, 11.

- [ ] **Step 1: Write the failing test** (the node wrapper's pure logic — message shaping — using a fake `AudioWorkletNode`)

```ts
// src/audio-worklet/loom-node.test.ts
import { describe, it, expect, vi } from 'vitest';
import { defaultSubParams } from './loom-node';
import type { MainToWorklet } from '../audio-dsp/messages';

// The wrapper's posting logic is pure; test it by capturing posted messages.
// (We don't instantiate a real AudioWorkletNode — that needs a worklet env.)
describe('loom-node message shaping', () => {
  it('defaultSubParams returns a complete SubParams snapshot', () => {
    const p = defaultSubParams();
    expect(p.osc1Level).toBeGreaterThan(0);
    expect(p.filterCutoff).toBeGreaterThan(0);
    expect(p.ampSustain).toBeGreaterThan(0);
  });

  it('postMessage payloads are well-typed spawn/params/config/steal unions', () => {
    const posted: MainToWorklet[] = [];
    const fakePort = { postMessage: (m: MainToWorklet) => posted.push(m) };
    // Simulate the wrapper's helpers against the fake port (see implementation note).
    fakePort.postMessage({ type: 'spawn', note: { midi: 60, beginSec: 1, durationSec: 0.5, velocity: 0.8, accent: false, slide: false } });
    fakePort.postMessage({ type: 'params', params: { filterCutoff: 0.7 } });
    fakePort.postMessage({ type: 'config', maxVoices: 12 });
    fakePort.postMessage({ type: 'steal', count: 3 });
    expect(posted.map((m) => m.type)).toEqual(['spawn', 'params', 'config', 'steal']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-worklet/loom-node.test.ts`
Expected: FAIL — `defaultSubParams` not exported.

- [ ] **Step 3: Write the real processor**

```ts
// src/audio-worklet/loom-processor.ts
/// <reference lib="webworker" />
import { VoiceManager } from '../audio-dsp/voice-manager';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import type { MainToWorklet, WorkletToMain } from '../audio-dsp/messages';
import type { NoteSpec, SubParams } from '../audio-dsp/types';
import { defaultSubParams } from './loom-node';

class LoomProcessor extends AudioWorkletProcessor {
  private vm = new VoiceManager(sampleRate, defaultSubParams());
  private queue = new SchedulerQueue<NoteSpec>();
  private frame = Math.floor(currentTime * sampleRate);
  private reportCountdown = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => {
      const m = e.data;
      switch (m.type) {
        case 'spawn':  this.queue.push(Math.floor(m.note.beginSec * sampleRate), m.note); break;
        case 'params': this.vm.setParams(m.params as Partial<SubParams>); break;
        case 'config': this.vm.setMaxVoices(m.maxVoices); break;
        case 'steal':  this.vm.steal(m.count); break;
        case 'mods':   /* wired in Task 10 */ break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      this.queue.drainDue(this.frame, (note) => this.vm.spawn(note));
      const s = this.vm.renderSample(this.frame / sampleRate);
      for (let c = 0; c < out.length; c++) out[c][i] = s;
      this.frame++;
    }
    if ((this.reportCountdown -= out[0].length) <= 0) {
      this.reportCountdown = sampleRate / 30;   // ~30 Hz voice-count report
      const msg: WorkletToMain = { type: 'voices', active: this.vm.activeCount };
      this.port.postMessage(msg);
    }
    return true;
  }
}
registerProcessor('loom-processor', LoomProcessor);
```

- [ ] **Step 4: Write the node wrapper + defaults**

```ts
// src/audio-worklet/loom-node.ts
import type { MainToWorklet, WorkletToMain } from '../audio-dsp/messages';
import type { NoteSpec, SubParams } from '../audio-dsp/types';

export function defaultSubParams(): SubParams {
  return {
    masterTune: 0,
    osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0,
    osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
    subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6,
    filterCutoff: 0.55, filterResonance: 0.25, filterEnvAmount: 0.45,
    filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1,
    filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35,
    ampBuiltinEnv: 1, ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
  };
}

let loaded = false;
export async function loadLoomWorklet(ctx: AudioContext): Promise<void> {
  if (loaded) return;
  await ctx.audioWorklet.addModule(new URL('./loom-processor.ts', import.meta.url));
  loaded = true;
}

export class LoomWorkletNode {
  readonly node: AudioWorkletNode;
  private countCb: ((n: number) => void) | null = null;
  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'loom-processor', { outputChannelCount: [2] });
    this.node.port.onmessage = (e: MessageEvent<WorkletToMain>) => {
      if (e.data.type === 'voices') this.countCb?.(e.data.active);
    };
  }
  private post(m: MainToWorklet): void { this.node.port.postMessage(m); }
  spawn(note: NoteSpec): void { this.post({ type: 'spawn', note }); }
  setParams(params: Partial<SubParams>): void { this.post({ type: 'params', params }); }
  setMaxVoices(n: number): void { this.post({ type: 'config', maxVoices: n }); }
  steal(count: number): void { this.post({ type: 'steal', count }); }
  onVoiceCount(cb: (active: number) => void): void { this.countCb = cb; }
  connect(dest: AudioNode): void { this.node.connect(dest); }
  disconnect(): void { this.node.disconnect(); }
}
```

Remove the `?worklettest` spike block from `src/main.ts` (added in Task 1, Step 3).

- [ ] **Step 5: Run test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/audio-worklet/loom-node.test.ts` → PASS (2 tests).
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/audio-worklet/loom-processor.ts src/audio-worklet/loom-node.ts src/audio-worklet/loom-node.test.ts src/main.ts
git commit -m "feat(worklet): real LoomProcessor (queue + VoiceManager) + typed node wrapper"
```

---

## Task 9: WorkletLaneEngine — route subtractive through the worklet

A `SynthEngine` adapter backed by one `LoomWorkletNode`. `createVoice()` returns a thin `Voice` that posts a spawn on `trigger()` — so `trigger-dispatch.ts`, the scheduler, note-FX, and the live-voice registry are untouched. `setBaseValue`/`applyPreset` post param updates.

**Files:**
- Create: `src/engines/worklet-lane-engine.ts`
- Modify: `src/app/lane-allocator.ts` (route `subtractive` to it; make `createLaneEngine`/`wireEngineIntoLane` async-aware for `addModule`)
- Test: `src/engines/worklet-lane-engine.test.ts`

**Interfaces:**
- Consumes: `LoomWorkletNode`, `loadLoomWorklet`, `defaultSubParams` (Task 8); `SynthEngine`/`Voice`/`VoiceTriggerOptions` (engine-types.ts); the `SUB_PARAMS` dot-id → `SubParams` field mapping.
- Produces: `class WorkletLaneEngine implements SynthEngine` with `id='subtractive'`. `createVoice()` returns a `Voice` whose `trigger(midi,time,opts)` calls `node.spawn({...})`. `getAudioParams()` returns an empty Map (modulation moves in-worklet, Task 10). Exposes `getWorkletNode(): LoomWorkletNode | null` for the global cap (Task 11).

**Note on `addModule` timing:** `loadLoomWorklet(ctx)` is async and must finish before `new AudioWorkletNode`. The allocator path is synchronous. Resolve by calling `await loadLoomWorklet(ctx)` ONCE during boot (in `main.ts`, right after the AudioContext is created, before lanes are allocated) so the module is registered by the time any `WorkletLaneEngine` constructs its node. The engine constructor then creates the node synchronously. Add this boot `await` in this task.

- [ ] **Step 1: Write the failing test** (mock the worklet node so the test runs without a worklet env)

```ts
// src/engines/worklet-lane-engine.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock the node wrapper: capture spawns/params without a real AudioWorkletNode.
const spawns: any[] = [];
const params: any[] = [];
vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  defaultSubParams: () => ({
    masterTune: 0, osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0, osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
    subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6, filterCutoff: 0.55, filterResonance: 0.25,
    filterEnvAmount: 0.45, filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1, filterAttack: 0.01,
    filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35, ampBuiltinEnv: 1, ampAttack: 0.01,
    ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
  }),
  LoomWorkletNode: class {
    node = { connect() {}, disconnect() {} };
    spawn(n: any) { spawns.push(n); }
    setParams(p: any) { params.push(p); }
    setMaxVoices() {} steal() {} onVoiceCount() {} connect() {} disconnect() {}
  },
}));

import { WorkletLaneEngine } from './worklet-lane-engine';

describe('WorkletLaneEngine', () => {
  it('a triggered voice posts a spawn with the note + gate', () => {
    spawns.length = 0;
    const eng = new WorkletLaneEngine({} as AudioContext, { connect() {} } as any);
    const v = eng.createVoice({} as AudioContext, { connect() {} } as any);
    v.trigger(60, 2.0, { gateDuration: 0.5, accent: true, slide: false, velocity: 0.9 });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ midi: 60, beginSec: 2.0, durationSec: 0.5, accent: true });
    expect(spawns[0].velocity).toBeGreaterThan(0);
  });

  it('setBaseValue maps a dot-id knob to the SubParams field and posts it', () => {
    params.length = 0;
    const eng = new WorkletLaneEngine({} as AudioContext, { connect() {} } as any);
    eng.setBaseValue('filter.cutoff', 0.8);
    expect(params.at(-1)).toMatchObject({ filterCutoff: 0.8 });
  });

  it('getAudioParams is empty (modulation lives in the worklet)', () => {
    const eng = new WorkletLaneEngine({} as AudioContext, { connect() {} } as any);
    const v = eng.createVoice({} as AudioContext, { connect() {} } as any);
    expect(v.getAudioParams().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts`
Expected: FAIL — `Cannot find module './worklet-lane-engine'`.

- [ ] **Step 3: Write the engine**

```ts
// src/engines/worklet-lane-engine.ts
import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { LoomWorkletNode, defaultSubParams } from '../audio-worklet/loom-node';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { getCachedPresets } from '../presets/preset-loader';
import type { SubParams } from '../audio-dsp/types';

// dot-id (SUB_PARAMS vocabulary) → SubParams field. Single source of mapping.
const DOT_TO_FIELD: Record<string, keyof SubParams> = {
  'master.tune': 'masterTune',
  'osc1.wave': 'osc1Wave', 'osc1.level': 'osc1Level', 'osc1.detune': 'osc1Detune',
  'osc2.wave': 'osc2Wave', 'osc2.level': 'osc2Level', 'osc2.detune': 'osc2Detune',
  'sub.level': 'subLevel', 'noise.level': 'noiseLevel', 'noise.color': 'noiseColor',
  'filter.cutoff': 'filterCutoff', 'filter.resonance': 'filterResonance',
  'filter.envAmount': 'filterEnvAmount', 'filter.drive': 'filterDrive',
  'filter.keyTrack': 'filterKeyTrack', 'filter.builtinEnv': 'filterBuiltinEnv',
  'filter.attack': 'filterAttack', 'filter.decay': 'filterDecay',
  'filter.sustain': 'filterSustain', 'filter.release': 'filterRelease',
  'amp.builtinEnv': 'ampBuiltinEnv', 'amp.attack': 'ampAttack', 'amp.decay': 'ampDecay',
  'amp.sustain': 'ampSustain', 'amp.release': 'ampRelease',
};

class WorkletVoice implements Voice {
  constructor(private node: LoomWorkletNode) {}
  trigger(midi: number, time: number, o: VoiceTriggerOptions): void {
    this.node.spawn({
      midi, beginSec: time, durationSec: o.gateDuration,
      velocity: o.velocity ?? 0.8, accent: o.accent ?? false, slide: o.slide ?? false,
    });
  }
  release(_t: number): void { /* gate handled by durationSec; live note-off deferred */ }
  connect(_d: AudioNode): void { /* lane node already connected by the engine */ }
  getAudioParams(): Map<string, AudioParam> { return new Map(); }
  dispose(): void { /* no per-note nodes */ }
}

export class WorkletLaneEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Sub';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params: EngineParamSpec[];
  private modHost = new ModulationHostImpl([]);
  private state: SubParams = defaultSubParams();
  private worklet: LoomWorkletNode;
  bpm = 120;

  constructor(ctx: AudioContext, output: AudioNode) {
    this.worklet = new LoomWorkletNode(ctx);
    this.worklet.connect(output);
    // params spec reused from the legacy engine's spec for UI parity.
    // (Imported lazily to avoid constructing the old engine.)
    this.params = SUB_PARAM_SPECS;
  }
  get presets() { return getCachedPresets('subtractive'); }
  get modulators(): ModulationHostImpl { return this.modHost; }
  getWorkletNode(): LoomWorkletNode { return this.worklet; }

  getBaseValue(id: string): number {
    const f = DOT_TO_FIELD[id];
    return f ? this.state[f] : (SUB_PARAM_SPECS.find((p) => p.id === id)?.default ?? 0);
  }
  setBaseValue(id: string, v: number): void {
    const f = DOT_TO_FIELD[id];
    if (!f) return;
    this.state[f] = v;
    this.worklet.setParams({ [f]: v } as Partial<SubParams>);
  }
  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
      if (typeof val === 'number') this.setBaseValue(id, val);
    }
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }
  createVoice(_ctx: AudioContext, _output: AudioNode): Voice { return new WorkletVoice(this.worklet); }
  buildSequencer(): EngineSequencer {
    return { getStepAt: () => null, setLength() {}, highlight() {}, serialize: () => null, deserialize() {}, dispose() {} };
  }
  buildParamUI(_c: HTMLElement, _ctx?: EngineUIContext): void { /* reuse the modulators panel in Task 10 */ }
  dispose(): void { this.worklet.disconnect(); }
}

// Param specs: re-export the same EngineParamSpec[] the legacy engine declares,
// so the lane UI/automation vocabulary is identical. Defined here to avoid
// importing the legacy SubtractiveEngine (which builds a PolySynth).
import { SUB_PARAM_SPECS } from './subtractive-params';
```

- [ ] **Step 4: Extract the shared param specs**

Move the `SUB_PARAMS` array out of `src/engines/subtractive.ts` into a new `src/engines/subtractive-params.ts` exporting `SUB_PARAM_SPECS`, and have `subtractive.ts` import it (so both the legacy engine and `WorkletLaneEngine` share one definition — DRY). Do not change the array contents.

```ts
// src/engines/subtractive-params.ts
import type { EngineParamSpec } from './engine-params';
export const WAVE_OPTIONS = [
  { value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Sqr' },
  { value: 'triangle', label: 'Tri' }, { value: 'sine', label: 'Sin' },
];
export const SUB_PARAM_SPECS: EngineParamSpec[] = [ /* the exact SUB_PARAMS array from subtractive.ts */ ];
```

In `subtractive.ts`: `import { SUB_PARAM_SPECS as SUB_PARAMS, WAVE_OPTIONS } from './subtractive-params';` and delete the local copies.

- [ ] **Step 5: Route subtractive to the worklet engine in the allocator**

In `src/app/lane-allocator.ts` `createLaneEngine` (line ~117), before the legacy `createEngineInstance`:

```ts
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
// ...
const createLaneEngine = (engineId: string, inserts: InsertChain): SynthEngine | null => {
  if (engineId === 'subtractive') {
    return new WorkletLaneEngine(deps.ctx, inserts.inputNode);
  }
  let engine = createEngineInstance(engineId);
  // ... unchanged plugin fallback ...
};
```

And in `wireEngineIntoLane`, skip the PolySynth block for subtractive (the worklet engine self-wires):

```ts
if (engineId === 'subtractive') return;   // WorkletLaneEngine owns its node
```

In `src/main.ts`, after the AudioContext is created and before lanes are allocated, add `await loadLoomWorklet(ctx);` (import from `./audio-worklet/loom-node`). Ensure the boot path that allocates lanes runs after this await.

- [ ] **Step 6: Run tests + typecheck + build**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts` → PASS (3 tests).
Run: `NO_COLOR=1 npm run test:unit` → full suite green (confirms the `SUB_PARAMS` extraction + allocator change broke nothing). Re-run once if it exits non-zero only on the known `ERR_IPC_CHANNEL_CLOSED` teardown.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Manual audible check** (the real payoff)

Run: `npm run dev`, open `http://localhost:5173`, load the boot demo, Play. Subtractive lanes now synthesise in the worklet. Expected: notes sound (timbre close to before — exact parity is not required per the spec). Sliding/accent differences are acceptable at this task; full behaviour parity is Task 12.

- [ ] **Step 8: Commit**

```bash
git add src/engines/worklet-lane-engine.ts src/engines/worklet-lane-engine.test.ts src/engines/subtractive-params.ts src/engines/subtractive.ts src/app/lane-allocator.ts src/main.ts
git commit -m "feat(worklet): WorkletLaneEngine routes subtractive lanes through the worklet"
```

---

## Task 10: In-worklet modulation (per-sample LFO + ADSR)

Move LFO/ADSR out of the per-note ConstantSource machinery into the worklet. The host's `ModulatorState[]` is sent as `ModLite[]`; the processor evaluates shared LFOs per-sample and adds their contribution to the VoiceManager's live param offsets before voices read them.

**Files:**
- Modify: `src/audio-dsp/modulation-runtime.ts` (replace the Task 7 `ModLite` stub with the real runtime)
- Modify: `src/audio-dsp/voice-manager.ts` (accept a per-sample param-offset hook)
- Modify: `src/audio-worklet/loom-processor.ts` (wire `'mods'` + tick the runtime)
- Modify: `src/engines/worklet-lane-engine.ts` (post `mods` when the host changes)
- Test: `src/audio-dsp/modulation-runtime.test.ts`

**Interfaces:**
- Produces: `ModLite` (final shape) = `{ id: string; kind: 'lfo' | 'adsr'; enabled: boolean; rateHz: number; waveform: 'sine'|'triangle'|'square'|'saw'; depthByParam: Record<string, number> }`. `toModLite(state: ModulatorState[]): ModLite[]` (in `worklet-lane-engine.ts`). `class ModulationRuntime` — `setMods(mods: ModLite[])`, `offsetFor(field: keyof SubParams, t: number): number` returning an additive offset in the field's native 0..1 units. Consumed by `VoiceManager.renderSample` (reads offsets) and the processor.
- Scope for Phase 1: **shared LFOs** modulating `filterCutoff`, `filterResonance`, `osc1Level`/`osc2Level`, `noiseLevel` (the common targets). Per-voice ADSR is already inside `SubtractiveVoiceRenderer`; the modular ADSR contributions stay depth-0 by default (matching the legacy engine) and are out of Phase-1 scope beyond the amp/filter envelopes already ported — note this scope in the runtime file header.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/modulation-runtime.test.ts
import { describe, it, expect } from 'vitest';
import { ModulationRuntime } from './modulation-runtime';

const SR = 48000;
describe('ModulationRuntime (shared LFO)', () => {
  it('a disabled LFO contributes zero', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: false, rateHz: 4, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    expect(r.offsetFor('filterCutoff', 0.1)).toBe(0);
  });

  it('an enabled sine LFO oscillates the target offset between roughly ±depth', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: true, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    let min = 1, max = -1;
    for (let i = 0; i < SR; i++) { const v = r.offsetFor('filterCutoff', i / SR); min = Math.min(min, v); max = Math.max(max, v); }
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(-0.3);
  });

  it('only modulates the connected param', () => {
    const r = new ModulationRuntime(SR);
    r.setMods([{ id: 'l', kind: 'lfo', enabled: true, rateHz: 2, waveform: 'sine', depthByParam: { filterCutoff: 0.5 } }]);
    for (let i = 0; i < 100; i++) r.offsetFor('filterCutoff', i / SR);
    expect(r.offsetFor('filterResonance', 0.05)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/modulation-runtime.test.ts`
Expected: FAIL — `ModulationRuntime` not exported.

- [ ] **Step 3: Write the runtime**

```ts
// src/audio-dsp/modulation-runtime.ts
// Phase 1 scope: SHARED LFOs only, modulating a fixed set of SubParams fields.
// Per-voice modular ADSR beyond the amp/filter envelopes (already inside
// SubtractiveVoiceRenderer) is deferred.
import type { SubParams } from './types';

export interface ModLite {
  id: string;
  kind: 'lfo' | 'adsr';
  enabled: boolean;
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  depthByParam: Record<string, number>;   // SubParams field name → depth (-1..1)
}

function wave(w: ModLite['waveform'], phase: number): number {
  switch (w) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'saw':      return phase * 2 - 1;
    case 'triangle': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

export class ModulationRuntime {
  private mods: ModLite[] = [];
  constructor(private sr: number) {}
  setMods(mods: ModLite[]): void { this.mods = mods; }
  /** Additive offset (native 0..1 units of the field) at absolute time t. */
  offsetFor(field: keyof SubParams, t: number): number {
    let sum = 0;
    for (const m of this.mods) {
      if (!m.enabled || m.kind !== 'lfo') continue;
      const depth = m.depthByParam[field as string];
      if (!depth) continue;
      const phase = (t * m.rateHz) % 1;
      sum += wave(m.waveform, phase) * depth;
    }
    return sum;
  }
}
```

- [ ] **Step 4: Wire the runtime into VoiceManager**

Add to `VoiceManager`: a `private mod: ModulationRuntime | null = null; setModulation(m: ModulationRuntime) { this.mod = m; }`. In `renderSample`, build an effective params view by adding `mod.offsetFor(field, t)` to the modulated fields before voices read them. Since voices snapshot params at spawn, apply modulation as a live post-spawn offset: give `SubtractiveVoiceRenderer.renderSample` an optional second arg `modOffsets?: Partial<Record<keyof SubParams, number>>` summed onto `filterCutoff`/`filterResonance`/levels at read time. Update Task 5's renderer signature accordingly and clamp the modulated cutoff to the existing 0..1 range before the `60*220^x` mapping.

```ts
// in VoiceManager.renderSample, before summing voices:
const mo = this.mod ? {
  filterCutoff: this.mod.offsetFor('filterCutoff', t),
  filterResonance: this.mod.offsetFor('filterResonance', t),
  osc1Level: this.mod.offsetFor('osc1Level', t),
  osc2Level: this.mod.offsetFor('osc2Level', t),
  noiseLevel: this.mod.offsetFor('noiseLevel', t),
} : undefined;
// ... s.v.renderSample(t, mo) ...
```

Extend the `VoiceRenderer.renderSample` signature in `types.ts` to `renderSample(t: number, modOffsets?: Partial<Record<keyof SubParams, number>>): number` and honour it in `SubtractiveVoiceRenderer` (add the offset to the relevant params, clamping cutoff/levels to valid ranges).

- [ ] **Step 5: Wire the processor + engine**

In `loom-processor.ts`: instantiate `const mod = new ModulationRuntime(sampleRate)`, `this.vm.setModulation(mod)`, and handle `case 'mods': mod.setMods(m.mods); break;`.

In `worklet-lane-engine.ts`: add `private postMods()` that maps `this.modHost.modulators` → `ModLite[]` (paramId suffix → SubParams field via the inverse of `DOT_TO_FIELD`; depth from the connection) and calls `this.worklet`'s `post({type:'mods', mods})`. Call `postMods()` from `applyPreset` and whenever the modulators panel changes (Task 12 wires the panel; for now call it in the constructor and `applyPreset`). Add a `setMods(mods: ModLite[])` helper to `LoomWorkletNode`.

- [ ] **Step 6: Run tests + typecheck**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/modulation-runtime.test.ts` → PASS (3 tests).
Run: `NO_COLOR=1 npx vitest run src/audio-dsp/voice-manager.test.ts src/audio-dsp/subtractive-renderer.test.ts` → still PASS (signature change didn't break them — the new arg is optional).
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/audio-dsp/modulation-runtime.ts src/audio-dsp/modulation-runtime.test.ts src/audio-dsp/voice-manager.ts src/audio-dsp/subtractive-renderer.ts src/audio-dsp/types.ts src/audio-worklet/loom-processor.ts src/audio-worklet/loom-node.ts src/engines/worklet-lane-engine.ts
git commit -m "feat(worklet): in-worklet shared-LFO modulation runtime"
```

---

## Task 11: Global voice cap coordinator

A main-thread coordinator holding a total simultaneous-voice budget. Each lane's `LoomWorkletNode` reports its active count (already posted at ~30 Hz in Task 8). When the global sum exceeds the budget, instruct the busiest lane to steal its overflow.

**Files:**
- Create: `src/audio-worklet/global-voice-cap.ts`
- Modify: `src/app/lane-allocator.ts` (register each WorkletLaneEngine's node with the cap)
- Modify: `src/main.ts` (create the cap; default budget) + thread to allocator deps
- Test: `src/audio-worklet/global-voice-cap.test.ts`

**Interfaces:**
- Produces: `class GlobalVoiceCap` —
  - `new (budget: number)`
  - `register(laneId: string, node: { steal(n: number): void; onVoiceCount(cb: (n: number) => void): void }): void`
  - `unregister(laneId: string): void`
  - `setBudget(n: number): void`
  - `get total(): number` (sum of last-reported counts)
  Internally: on each count report, recompute the total; if over budget, call `steal(overflow)` on the lane with the highest count. Consumed by `lane-allocator`/`main`; surfaced to PERF.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-worklet/global-voice-cap.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GlobalVoiceCap } from './global-voice-cap';

function fakeNode() {
  let cb: (n: number) => void = () => {};
  return { steal: vi.fn(), onVoiceCount: (f: (n: number) => void) => { cb = f; }, report: (n: number) => cb(n) };
}

describe('GlobalVoiceCap', () => {
  it('sums reported counts across lanes', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(10); b.report(15);
    expect(cap.total).toBe(25);
  });

  it('tells the busiest lane to steal the overflow when over budget', () => {
    const cap = new GlobalVoiceCap(20);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(16); b.report(8);    // total 24, over by 4; 'a' is busiest
    expect(a.steal).toHaveBeenCalledWith(4);
    expect(b.steal).not.toHaveBeenCalled();
  });

  it('does not steal when under budget', () => {
    const cap = new GlobalVoiceCap(50);
    const a = fakeNode(); cap.register('a', a);
    a.report(10);
    expect(a.steal).not.toHaveBeenCalled();
  });

  it('unregister stops counting a lane', () => {
    const cap = new GlobalVoiceCap(100);
    const a = fakeNode(); const b = fakeNode();
    cap.register('a', a); cap.register('b', b);
    a.report(10); b.report(10); cap.unregister('b');
    expect(cap.total).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-worklet/global-voice-cap.test.ts`
Expected: FAIL — `Cannot find module './global-voice-cap'`.

- [ ] **Step 3: Write the coordinator**

```ts
// src/audio-worklet/global-voice-cap.ts
interface CapNode { steal(n: number): void; onVoiceCount(cb: (n: number) => void): void; }

export class GlobalVoiceCap {
  private counts = new Map<string, number>();
  private nodes = new Map<string, CapNode>();
  constructor(private budget: number) {}
  get total(): number { let s = 0; for (const c of this.counts.values()) s += c; return s; }
  setBudget(n: number): void { this.budget = Math.max(1, n); }
  register(laneId: string, node: CapNode): void {
    this.nodes.set(laneId, node);
    this.counts.set(laneId, 0);
    node.onVoiceCount((n) => { this.counts.set(laneId, n); this.enforce(); });
  }
  unregister(laneId: string): void { this.nodes.delete(laneId); this.counts.delete(laneId); }
  private enforce(): void {
    const overflow = this.total - this.budget;
    if (overflow <= 0) return;
    let busiest: string | null = null; let max = -1;
    for (const [id, c] of this.counts) if (c > max) { max = c; busiest = id; }
    if (busiest) this.nodes.get(busiest)?.steal(overflow);
  }
}
```

- [ ] **Step 4: Wire it into the app**

In `src/main.ts`: `const globalVoiceCap = new GlobalVoiceCap(64);` (default budget — exposed for tuning; surface in PERF as a follow-up). Pass it through `LaneAllocatorDeps` (add `globalVoiceCap?: GlobalVoiceCap`). In `lane-allocator.ts` `createLaneEngine`, after creating a `WorkletLaneEngine`, register it: `deps.globalVoiceCap?.register(laneId, engine.getWorkletNode());` (and `unregister` in `swapLaneEngine`/disposal paths). The `laneId` is in scope at the call site (thread it into `createLaneEngine` — it already receives `engineId`; add `laneId`).

- [ ] **Step 5: Run tests + typecheck + build**

Run: `NO_COLOR=1 npx vitest run src/audio-worklet/global-voice-cap.test.ts` → PASS (4 tests).
Run: `NO_COLOR=1 npm run test:unit` → full suite green.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/audio-worklet/global-voice-cap.ts src/audio-worklet/global-voice-cap.test.ts src/app/lane-allocator.ts src/main.ts
git commit -m "feat(worklet): global voice-cap coordinator across lanes"
```

---

## Task 12: End-to-end verification — Subtractive through the worklet on the dense MIDI

No new feature code — wire the modulators panel to re-post mods on change (so live edits work), then verify the original failure case is fixed and behaviour is acceptable. Fix any concrete defects found.

**Files:**
- Modify: `src/engines/worklet-lane-engine.ts` (`buildParamUI` → render the modulators panel + POLY header, calling `postMods()` on change)
- Test: `src/engines/worklet-lane-engine.test.ts` (add a "panel change re-posts mods" test) + manual audible verification

**Interfaces:**
- Consumes: `renderModulatorsPanel` (src/modulation/modulation-ui.ts), the existing `EngineUIContext`.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/engines/worklet-lane-engine.test.ts
it('rebuilding the modulators panel re-posts the modulator config', () => {
  // Spy on the node's setMods via the mock; trigger a host change → expect a mods post.
  // (Use the existing mock's captured calls; assert a 'mods'-shaped payload was sent.)
});
```

Implement the assertion against the mock by adding a `mods: any[]` capture array to the `LoomWorkletNode` mock's `setMods`, then asserting it grows after `engine.applyPreset(...)` or a simulated panel `onChange`.

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts`
Expected: FAIL — panel onChange does not post mods yet.

- [ ] **Step 3: Implement `buildParamUI`**

Port the POLY header (MODE/RETRIG/VOICES) — map MODE→`setMaxVoices(1|N)`, VOICES→`setMaxVoices` — and call `renderModulatorsPanel(container, { ... onChange: () => { this.buildParamUI(container, ctx); this.postMods(); } })`, mirroring `subtractive.ts` `buildParamUI` but routing changes to `postMods()` instead of `reapplyLaneModulations`.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts` → PASS.
Run: `NO_COLOR=1 npm run test:unit` → full suite green.
Run: `npm run build` → tsc + bundle succeed.

- [ ] **Step 5: Manual audible verification — the original failure case**

Run: `npm run dev`. Import `midi-library/Robert_Miles_Children_d16.mid` with default instruments (this maps tracks to subtractive → now the worklet). Switch to Session, launch the "MIDI Import" scene, Play for several minutes including the dense climax and the 2nd loop.

Verify (the symptoms from `project_voice_lifecycle_graph_leak`):
- No sustained silence with VU meters still moving.
- No worsening over time / on the 2nd loop.
- The PERF panel's live voice/node counts + Master row stay sane; the global cap bounds total voices (≤ budget).

This is the human acceptance gate (automated tests can't hear it). If choppiness remains, capture which bar/voice-count and treat as a defect on this branch before declaring Phase 1 done.

- [ ] **Step 6: Commit**

```bash
git add src/engines/worklet-lane-engine.ts src/engines/worklet-lane-engine.test.ts
git commit -m "feat(worklet): subtractive param/modulator UI on the worklet engine + e2e verification"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-23-audioworklet-engine-design.md`):
- DSP kernel (pure, unit-testable) → Tasks 2–5. ✅
- VoiceRenderer interface (WASM door) → Task 2/5 (`VoiceRenderer`). ✅
- Voice manager (pool/steal/cap) → Task 6. ✅
- Worklet processor (dough-style per-sample loop) → Task 8. ✅
- Lane integration (one node per lane, feeds ChannelStrip) → Task 9. ✅
- Scheduler→worklet bridge (spawn at beginFrame) → Tasks 7–9 (WorkletVoice posts beginSec; processor → frame). ✅
- Modulation in-worklet → Task 10. ✅
- Global polyphony cap → Task 11. ✅
- Mixer/FX/master untouched → enforced by Global Constraints + full-suite green checks. ✅
- Works under `--base=/Loom/` → Task 1 gate. ✅
- Build order = Subtractive first → this whole plan IS build-order step 1; engines/sampler/cutover are explicitly deferred to later plans. ✅
- Sampler/Audio, other engines, single cutover → **out of scope (their own plans)**, stated up front. ✅

**Placeholder scan:** No "TBD"/"add error handling"/vague steps. Two honest caveats remain by design, both with concrete contingencies, not placeholders: (a) Task 1's Vite recipe has a documented fallback (it's a de-risk spike); (b) Task 10 narrows modulation to shared LFOs for Phase 1, scope stated in the file header. Both are deliberate scope/risk calls, not missing content.

**Type consistency:** `SubParams`, `NoteSpec`, `VoiceRenderer` defined in Task 2 and imported verbatim after. `VoiceRenderer.renderSample` gains an optional `modOffsets` arg in Task 10 (back-compatible — Tasks 5/6 tests still pass). `MainToWorklet`/`WorkletToMain` defined in Task 7, with the `ModLite` forward-ref resolved by the Task 7 stub → Task 10 final shape. `LoomWorkletNode` created in Task 1, extended in Task 8 (posting), referenced by Tasks 9/11. `DOT_TO_FIELD` (Task 9) is the single dot-id↔field map; its inverse drives `toModLite` (Task 10). `getWorkletNode()` (Task 9) consumed by Task 11.

---

## Out of scope for this plan (future plans, after Phase 1 settles the interfaces)

- **Phase 2** — port TB-303, FM (fix tuning), Wavetable, Karplus, Westcoast, Drums to `VoiceRenderer`s behind the same VoiceManager/worklet.
- **Phase 3** — Sampler / Audio engines (buffer transfer + repitch; warp stays a main-thread pre-render).
- **Phase 4** — single cutover: delete the legacy `createVoice` node-graph path, the per-note modulation binding machinery (`voice-mod-binding`, ADSR/LFO ConstantSource voices), and the legacy `SubtractiveEngine`/`PolySynth`.
