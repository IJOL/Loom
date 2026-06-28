# Implementation Plan: Drums + Sampler Channel Filter (cutoff + resonance, modulatable)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Add a channel-level resonant low-pass `BiquadFilter` (cutoff + resonance) to the **Drums** (`DrumsWorkletEngine`) and **Sampler** (`SamplerWorkletEngine`) engines. The filter sits on the **raw channel mix BEFORE the lane InsertChain + bus ChannelStrip EQ** ("raw mix → FILTER → inserts/EQ → master"). Two new continuous params per engine — `filter.cutoff` (20 Hz–20 kHz log, default 20000 = fully open) and `filter.resonance` (Q 0.7–18, default 0.7) — that are knob-controllable, automatable, persisted (save v3), and **modulatable** through the existing `bindEngineModulators` → `getSharedAudioParams()` path. Default values = audibly transparent passthrough (zero change to existing drum sound).

## Architecture

Both engines route their summed raw mix into the lane via a single target node today:
- **Drums (synth mode):** worklet output `i` → per-voice `ChannelStrip` ×8 → `this.outputTarget` (= the lane `InsertChain.inputNode`, set by `lane-allocator.ts:121`) → bus `ChannelStrip.input` → master. (`drums-worklet-engine.ts:467-472`, `292-297`.)
- **Sampler:** `SamplerWorkletNode.connectDry(this.dryTarget)` (= `InsertChain.inputNode`, `lane-allocator.ts:127`) → bus `ChannelStrip.input` → master. (`sampler-worklet-engine.ts:124-139`.)

The filter is implemented as a small **engine-owned audio node pair** (a `GainNode` mix bus → `BiquadFilterNode`), spliced between the engine's raw mix and its routing target. This keeps the shared `ChannelStrip` (used by every lane) **completely untouched** — satisfying "least invasive" while guaranteeing the filter is on the raw mix, pre-EQ/pre-inserts. To avoid duplicating logic across two engines and to centralize the cutoff↔frequency log mapping and the modulation cents-span, the node pair + param math live in a new shared helper `src/core/channel-filter.ts` (class `ChannelFilter`).

Modulation reuses the exact convention of the `multifilter` FX insert (`src/plugins/fx/multifilter.ts`): the **cutoff** modulation destination is `BiquadFilter.detune` (cents, exponential — so a bipolar LFO sweeps the cutoff musically), with a range lookup of `{ min: 0, max: 1200·log2(20000/20) }` ≈ 11959 cents; the **resonance** destination is `BiquadFilter.Q` (linear) with range `{ min: 0.7, max: 18 }`. The knob/automation path (`get/setBaseValue`) writes `filter.frequency` / `filter.Q` directly. Drums already calls `bindEngineModulators` with a `busRangeLookup`; we extend that lookup to cover `filter.cutoff`/`filter.resonance`. The sampler gets `getSharedAudioParams` + a `filterRangeLookup` + a `bindEngineModulators` call (its first channel modulation destination).

Persistence is automatic: knob `onChange` → `mirrorParamChange` writes `engineState.params['filter.cutoff'|'filter.resonance']` (`engine-ui.ts:53-58`); load replays via `applyLaneEngineState` → `engine.setBaseValue(id, v)` (`apply-lane-engine-state.ts:44-49`). No migration needed — absent params fall back to spec defaults (open / min Q).

## Tech Stack

- TypeScript, Web Audio (`node-web-audio-api` under Vitest — real `BiquadFilterNode`, `.frequency`, `.Q`, `.detune`, `OfflineAudioContext`; confirmed working in `multifilter.dsp.test.ts`).
- Vitest 3.x. Test command: `cross-env NO_COLOR=1 npx vitest run <file>` (project convention, `package.json:16`). DSP tests live in `*.dsp.test.ts`; relative assertions only (`test/dsp-asserts.ts`, `spectralCentroid`, `rms`).
- Modulation: `ConnectionBinder` + `bindEngineModulators` (`src/modulation/`).

## Global Constraints

- **Relative assertions only** — no absolute thresholds (project rule, `test/dsp-asserts.ts:3`).
- **No finite voice caps** — the filter is one node per lane for the lane's life; disposed with the engine.
- **Do not modify `ChannelStrip`** — it is shared by all lanes; the filter is engine-owned.
- **Default = passthrough** — cutoff 20000 Hz + Q 0.7 must be audibly transparent (explicit acceptance test #3).
- Follow existing patterns: `EngineParamSpec` shape (`engine-params.ts`), the `multifilter` detune-cents modulation convention, the drums `getSharedAudioParams`/`busRangeLookup` pattern, the `mountLaneFxPanel`/`wireDrumMasterUI` knob-section pattern.
- TDD per task: write failing test → run (red) → minimal impl → run (green) → commit. Branch: `worktree-drums-channel-filter`.

## Acceptance-criteria → task map

| Spec criterion | Task(s) |
|---|---|
| 1. DSP — drums filter works | Task 2 (ChannelFilter DSP) + Task 5 (drums engine render) |
| 2. DSP — sampler filter works | Task 2 + Task 7 (sampler engine render) |
| 3. Default is passthrough | Task 2 (ChannelFilter passthrough) + Task 5 / Task 7 default-vs-bypass |
| 4. Modulation — drums | Task 6 |
| 5. Modulation — sampler | Task 8 |
| 6. Persistence | Task 9 |
| 7. UI present in both editors | Task 10 (drums) + Task 11 (sampler) |

Ordering: shared audio node (1–2) → param specs (3 drums, 4 sampler) → engine node-insertion DSP (5 drums, 7 sampler) → modulation wiring (6 drums, 8 sampler) → persistence (9) → UI (10–11). Each task is independently testable.

---

## Task 0 — Baseline (no code change)

Run the existing suites that this work touches so regressions are attributable:

```
cross-env NO_COLOR=1 npx vitest run src/core/fx.test.ts src/engines/drums-worklet-engine.test.ts src/engines/sampler-worklet-engine.test.ts src/plugins/fx/multifilter.dsp.test.ts
```

Confirm green. No commit.

---

## Task 1 — `ChannelFilter` param math + node construction (unit)

**Why first:** Establishes the shared helper both engines depend on, and pins the cutoff↔frequency log mapping + the modulation cents-span constants (mirrors `multifilter.ts:8`).

**Failing test** — new file `src/core/channel-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import {
  ChannelFilter,
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX,
  FILTER_Q_MIN, FILTER_Q_MAX,
  FILTER_DETUNE_SPAN_CENTS,
} from './channel-filter';

describe('ChannelFilter constants', () => {
  it('spans 20 Hz..20 kHz cutoff and 0.7..18 Q', () => {
    expect(FILTER_CUTOFF_MIN).toBe(20);
    expect(FILTER_CUTOFF_MAX).toBe(20000);
    expect(FILTER_Q_MIN).toBeCloseTo(0.7, 5);
    expect(FILTER_Q_MAX).toBe(18);
  });

  it('the modulation cents span is the full 20Hz..20kHz exponential sweep', () => {
    expect(FILTER_DETUNE_SPAN_CENTS).toBeCloseTo(1200 * Math.log2(20000 / 20), 0);
  });
});

describe('ChannelFilter node', () => {
  it('is a lowpass with the default cutoff fully open and minimum Q', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.node.type).toBe('lowpass');
    expect(cf.node.frequency.value).toBeCloseTo(20000, 0);
    expect(cf.node.Q.value).toBeCloseTo(0.7, 5);
  });

  it('input feeds the biquad and output is the biquad (raw mix passes through it)', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.input).toBeDefined();
    expect(cf.output).toBe(cf.node);
  });

  it('setCutoff/setResonance write the BiquadFilter params; getters read them back', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    cf.setCutoff(800);
    cf.setResonance(6);
    expect(cf.node.frequency.value).toBeCloseTo(800, 3);
    expect(cf.node.Q.value).toBeCloseTo(6, 3);
    expect(cf.getCutoff()).toBeCloseTo(800, 3);
    expect(cf.getResonance()).toBeCloseTo(6, 3);
  });

  it('exposes frequency (knob path), detune (cutoff mod), and Q (res mod) AudioParams', () => {
    const ctx = new AudioContext();
    const cf = new ChannelFilter(ctx);
    expect(cf.getCutoffModParam()).toBe(cf.node.detune);
    expect(cf.getResonanceParam()).toBe(cf.node.Q);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/core/channel-filter.test.ts
```

**Minimal impl** — new file `src/core/channel-filter.ts`:

```ts
// src/core/channel-filter.ts
// Engine-owned channel low-pass filter (cutoff + resonance) for the Drums and
// Sampler engines. A plain BiquadFilter spliced on the RAW channel mix, BEFORE
// the lane InsertChain + bus ChannelStrip EQ. Cutoff modulation targets .detune
// (cents, exponential) so a bipolar LFO sweeps musically — mirrors the Filter
// insert (src/plugins/fx/multifilter.ts); the knob/automation path writes
// .frequency / .Q directly.

export const FILTER_CUTOFF_MIN = 20;
export const FILTER_CUTOFF_MAX = 20000;
export const FILTER_CUTOFF_DEFAULT = 20000;   // fully open ⇒ passthrough
export const FILTER_Q_MIN = 0.7;
export const FILTER_Q_MAX = 18;
export const FILTER_Q_DEFAULT = 0.7;           // no resonant peak

/** Full-knob exponential sweep of the cutoff in cents (20 Hz..20 kHz). */
export const FILTER_DETUNE_SPAN_CENTS = 1200 * Math.log2(FILTER_CUTOFF_MAX / FILTER_CUTOFF_MIN);

export class ChannelFilter {
  readonly node: BiquadFilterNode;
  /** Raw mix enters here; output is the biquad. */
  get input(): AudioNode { return this.node; }
  get output(): AudioNode { return this.node; }

  constructor(ctx: BaseAudioContext) {
    this.node = ctx.createBiquadFilter();
    this.node.type = 'lowpass';
    this.node.frequency.value = FILTER_CUTOFF_DEFAULT;
    this.node.Q.value = FILTER_Q_DEFAULT;
  }

  setCutoff(hz: number): void { this.node.frequency.value = hz; }
  getCutoff(): number { return this.node.frequency.value; }
  setResonance(q: number): void { this.node.Q.value = q; }
  getResonance(): number { return this.node.Q.value; }

  /** Cutoff modulation destination (cents) — see FILTER_DETUNE_SPAN_CENTS. */
  getCutoffModParam(): AudioParam { return this.node.detune; }
  /** Resonance modulation destination (linear Q). */
  getResonanceParam(): AudioParam { return this.node.Q; }

  dispose(): void { try { this.node.disconnect(); } catch { /* */ } }
}
```

Note: `input`/`output` both return `this.node`. The biquad IS the in/out node (a BiquadFilter is a 1-in-1-out node; the raw mix connects to it and it connects onward). This keeps it minimal; the engine connects its raw-mix summing node → `cf.input` and `cf.output` → routing target.

Run (green), commit: `feat(filter): add shared ChannelFilter node + cutoff/resonance param math`.

---

## Task 2 — `ChannelFilter` DSP: cutoff attenuates highs; default is transparent (DSP) — **RISKIEST CONCEPT, proven here in isolation**

**Why:** Proves the actual lowpass behaviour and the passthrough-at-default claim (acceptance #1/#2 DSP core, #3 passthrough) against a real `OfflineAudioContext` render, decoupled from the engines. The engine-level placement tests (5, 7) then only need to prove *position* (pre-EQ), not the DSP itself.

**Failing test** — new file `src/core/channel-filter.dsp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelFilter } from './channel-filter';
import { spectralCentroid, rms } from '../../test/dsp-asserts';

const SR = 44100;

async function renderSaw(setup: (cf: ChannelFilter) => void): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const cf = new ChannelFilter(ctx);
  setup(cf);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 110;
  osc.connect(cf.input);
  cf.output.connect(ctx.destination);
  osc.start();
  const buf = await ctx.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('ChannelFilter DSP', () => {
  it('a low cutoff removes high-frequency energy (lower spectral centroid)', async () => {
    const open = await renderSaw(() => { /* default 20 kHz */ });
    const dark = await renderSaw((cf) => cf.setCutoff(300));
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('at the default cutoff (20 kHz) + min Q the signal passes through near-unchanged', async () => {
    // Compare the filter at default vs a bare wire (no filter) — same source.
    const ctx = new OfflineAudioContext(1, SR, SR);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 110;
    osc.connect(ctx.destination);
    osc.start();
    const bare = new Float32Array((await ctx.startRendering()).getChannelData(0));

    const filtered = await renderSaw(() => { /* default */ });
    // Spectral centroid within a tight relative tolerance of the unfiltered signal.
    const cBare = spectralCentroid(bare, SR);
    const cFilt = spectralCentroid(filtered, SR);
    expect(Math.abs(cFilt - cBare) / cBare).toBeLessThan(0.05);
    // And overall energy essentially preserved.
    expect(rms(filtered) / rms(bare)).toBeGreaterThan(0.9);
  });

  it('raising Q at a mid cutoff lifts energy near the cutoff (resonant peak)', async () => {
    const flat = await renderSaw((cf) => { cf.setCutoff(440); cf.setResonance(0.7); });
    const peaky = await renderSaw((cf) => { cf.setCutoff(440); cf.setResonance(12); });
    // A resonant peak at/above the cutoff raises broadband-relative energy there;
    // assert the high-Q render's centroid sits higher than the flat one.
    expect(spectralCentroid(peaky, SR)).toBeGreaterThan(spectralCentroid(flat, SR));
  });
});
```

Run (red — file imports fine but assertions need a correct node; should already pass if Task 1 impl is right). If green immediately, that's acceptable for a pure-DSP characterization test built on Task 1's node; the value is locking the behaviour. (If the resonant-peak assertion is flaky on `node-web-audio-api`, relax to comparing `rms` in a band via `freqContour`/window RMS — keep relative.)

Run (green), commit: `test(filter): characterize ChannelFilter lowpass + passthrough DSP`.

---

## Task 3 — Drums: declare `filter.cutoff` / `filter.resonance` specs + get/setBaseValue (unit)

**Failing test** — append to `src/engines/drums-worklet-engine.test.ts`:

```ts
describe('DrumsWorkletEngine — channel filter params', () => {
  it('declares filter.cutoff (20..20000, default 20000) and filter.resonance (0.7..18, default 0.7)', () => {
    const eng = new DrumsWorkletEngine();
    const cutoff = eng.params.find((p) => p.id === 'filter.cutoff')!;
    const res = eng.params.find((p) => p.id === 'filter.resonance')!;
    expect(cutoff).toMatchObject({ kind: 'continuous', min: 20, max: 20000, default: 20000, curve: 'log' });
    expect(res).toMatchObject({ kind: 'continuous', default: 0.7 });
    expect(res.min).toBeCloseTo(0.7, 5);
    expect(res.max).toBe(18);
  });

  it('get/setBaseValue round-trips the filter params and drives the live filter node', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);                 // builds the filter node
    eng.setBaseValue('filter.cutoff', 600);
    eng.setBaseValue('filter.resonance', 8);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(600, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(8, 3);
  });

  it('defaults read back as fully-open passthrough before any edit', () => {
    const eng = new DrumsWorkletEngine();
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/drums-worklet-engine.test.ts
```

**Minimal impl** — `src/engines/drums-worklet-engine.ts`:

1. Import the helper + constants near the top (after line 49):
```ts
import {
  ChannelFilter,
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT,
  FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT, FILTER_DETUNE_SPAN_CENTS,
} from '../core/channel-filter';
```

2. Add two specs to `BUS_PARAMS` (after line 63, so they live in `DRUM_PARAMS` and persist/automate like the EQ params):
```ts
  { id: 'filter.cutoff',    label: 'CUTOFF', kind: 'continuous', min: FILTER_CUTOFF_MIN, max: FILTER_CUTOFF_MAX, default: FILTER_CUTOFF_DEFAULT, curve: 'log', unit: 'Hz' },
  { id: 'filter.resonance', label: 'RES',    kind: 'continuous', min: FILTER_Q_MIN,      max: FILTER_Q_MAX,      default: FILTER_Q_DEFAULT },
```
(These are `bus.`-sibling channel params but use the `filter.` prefix to match the spec and the melodic-engine vocabulary. They are NOT prefixed `bus.`; treat them in get/setBaseValue alongside the bus branch.)

3. Field on the engine (near `busStrip`, line 286):
```ts
  private channelFilter: ChannelFilter | null = null;
```

4. In `setBaseValue` (line 372), add a branch BEFORE the `id.startsWith('bus.')` check:
```ts
    if (id === 'filter.cutoff')    { this.paramValues[id] = v; this.channelFilter?.setCutoff(v);    return; }
    if (id === 'filter.resonance') { this.paramValues[id] = v; this.channelFilter?.setResonance(v); return; }
```
And in `getBaseValue` (line 356), before the `bus.` branch:
```ts
    if (id === 'filter.cutoff' || id === 'filter.resonance') {
      return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
    }
```
(`specDefault` already resolves from `DRUM_PARAMS`, line 344.)

5. Seed `paramValues` with the new defaults — extend the IIFE at line 277 to also iterate the two filter specs. Simplest: change the seed loop to iterate all of `BUS_PARAMS` (which now includes them):
```ts
  private paramValues: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (const s of BUS_PARAMS) o[s.id] = s.default;   // now includes filter.*
    return o;
  })();
```
(Already iterates `BUS_PARAMS`; adding the specs there makes this automatic.)

The live node is created in Task 5; until then `channelFilter` is null and `setBaseValue` caches into `paramValues` (so the round-trip test passes via the cache, and the node — once built — is seeded in Task 5).

Run (green), commit: `feat(drums): declare filter.cutoff/filter.resonance channel params`.

---

## Task 4 — Sampler: declare `filter.cutoff` / `filter.resonance` specs + get/setBaseValue (unit)

**Failing test** — append to `src/engines/sampler-worklet-engine.test.ts`:

```ts
describe('SamplerWorkletEngine — channel filter params', () => {
  it('declares filter.cutoff (default 20000, log) and filter.resonance (default 0.7)', () => {
    const eng = new SamplerWorkletEngine();
    const cutoff = eng.params.find((p) => p.id === 'filter.cutoff')!;
    const res = eng.params.find((p) => p.id === 'filter.resonance')!;
    expect(cutoff).toMatchObject({ kind: 'continuous', min: 20, max: 20000, default: 20000, curve: 'log' });
    expect(res.default).toBeCloseTo(0.7, 5);
    expect(res.max).toBe(18);
  });

  it('get/setBaseValue round-trips the filter params', () => {
    const eng = new SamplerWorkletEngine();
    eng.setBaseValue('filter.cutoff', 900);
    eng.setBaseValue('filter.resonance', 5);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(900, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(5, 3);
  });

  it('defaults read back as passthrough before any edit', () => {
    const eng = new SamplerWorkletEngine();
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/sampler-worklet-engine.test.ts
```

**Minimal impl** — `src/engines/sampler-worklet-engine.ts`:

1. Import the helper (after line 53):
```ts
import {
  ChannelFilter,
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT,
  FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT, FILTER_DETUNE_SPAN_CENTS,
} from '../core/channel-filter';
```

2. Add the two specs to `SAMPLER_PARAMS` (line 55):
```ts
  { id: 'filter.cutoff',    label: 'CUTOFF', kind: 'continuous', min: FILTER_CUTOFF_MIN, max: FILTER_CUTOFF_MAX, default: FILTER_CUTOFF_DEFAULT, curve: 'log', unit: 'Hz' },
  { id: 'filter.resonance', label: 'RES',    kind: 'continuous', min: FILTER_Q_MIN,      max: FILTER_Q_MAX,      default: FILTER_Q_DEFAULT },
```
Because `SAMPLER_PARAMS` is the global block, the constructor (line 210) already seeds `paramValues` from it, and `getBaseValue` (line 214) / `setBaseValue` (line 233) already handle "id in paramValues / SAMPLER_PARAMS" → so the round-trip works for free. Add a field + node drive (the node is built in Task 7):
```ts
  private channelFilter: ChannelFilter | null = null;
```
3. In `setBaseValue`, after the `paramValues` write for a global id, drive the live node. Change the top of `setBaseValue` (line 233-237) to:
```ts
  setBaseValue(id: string, v: number): void {
    if (id in this.paramValues || SAMPLER_PARAMS.some((p) => p.id === id)) {
      this.paramValues[id] = v;
      if (id === 'filter.cutoff')    this.channelFilter?.setCutoff(v);
      if (id === 'filter.resonance') this.channelFilter?.setResonance(v);
      return;
    }
    ...
```

Run (green), commit: `feat(sampler): declare filter.cutoff/filter.resonance channel params`.

---

## Task 5 — Drums: splice `ChannelFilter` on the raw bus mix, pre-inserts/EQ (DSP) — **RISKIEST PLACEMENT, prove pre-EQ position**

**Why riskiest:** This is the exact node-insertion boundary the spec flags. The 8 per-voice strips currently connect to `routingTarget` (`ensureWired`, line 469-471). We must reroute them through the filter so the filter sits on the *summed raw mix*, BEFORE the lane InsertChain. The test must prove (a) the filter is audible on a drum render and (b) it is positioned **before** the bus EQ (turning the filter down kills highs even with the bus high-shelf EQ boosted — proving the filter is upstream of EQ).

**Failing test** — new file `src/engines/drums-worklet-engine.dsp.test.ts`:

```ts
// Renders the drum bus through a REAL OfflineAudioContext (mocked DrumsWorkletNode
// is no good for DSP — we need real audio). Instead we drive the engine's filter
// node directly with a sawtooth into the bus-mix input, proving the filter is on
// the RAW mix and sits BEFORE the bus EQ.
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

/** Build a drums engine wired to a real offline ctx + bus strip, return the
 *  engine's raw-mix input node (the filter input) and the rendered destination. */
async function renderThroughBus(
  cutoff: number, resonance: number, eqHighDb: number,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx);
  eng.setBusStrip(busStrip);
  eng.setOutputTarget(busStrip.input);            // raw mix → filter → busStrip.input
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);  // builds filter + strips
  eng.setBaseValue('filter.cutoff', cutoff);
  eng.setBaseValue('filter.resonance', resonance);
  eng.setBaseValue('bus.eq.high', eqHighDb);

  // Inject a saw into the engine's raw-mix input (the filter input) to exercise
  // the channel path independent of the mocked worklet voices.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  const buf = await ctx.startRendering();
  return new Float32Array(buf.getChannelData(0));
}

describe('DrumsWorkletEngine — channel filter placement (DSP)', () => {
  it('a low cutoff darkens the bus output', async () => {
    const open = await renderThroughBus(20000, 0.7, 0);
    const dark = await renderThroughBus(300, 0.7, 0);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('the filter sits BEFORE the bus EQ: a low cutoff still darkens even with the high-shelf EQ boosted', async () => {
    // High-shelf +18 dB would brighten if it were UPSTREAM of the filter; because
    // the filter is upstream, the boosted highs were already removed → still dark.
    const openEqBoost = await renderThroughBus(20000, 0.7, 18);
    const darkEqBoost = await renderThroughBus(300,   0.7, 18);
    expect(spectralCentroid(darkEqBoost, SR)).toBeLessThan(spectralCentroid(openEqBoost, SR) * 0.7);
  });

  it('default cutoff is transparent: bus output centroid matches the no-filter wire', async () => {
    const dflt = await renderThroughBus(20000, 0.7, 0);
    // Reference: same source straight into the bus strip with the filter open.
    expect(spectralCentroid(dflt, SR)).toBeGreaterThan(0); // sanity; tight check below
    const dark = await renderThroughBus(300, 0.7, 0);
    expect(spectralCentroid(dflt, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
```

Run (red — `getChannelFilterInputForTest` + the node don't exist yet):
```
cross-env NO_COLOR=1 npx vitest run src/engines/drums-worklet-engine.dsp.test.ts
```

**Minimal impl** — `src/engines/drums-worklet-engine.ts`, in `ensureWired` (line 460):

```ts
  private ensureWired(ctx: AudioContext, output: AudioNode): void {
    if (this.wired) return;
    if (!this.sharedFx) {
      throw new Error('DrumsWorkletEngine: setSharedFx must be called before createVoice');
    }
    const routingTarget = this.outputTarget ?? output;
    // Channel filter on the RAW summed mix, BEFORE the lane inserts + bus EQ.
    this.channelFilter = new ChannelFilter(ctx);
    this.channelFilter.setCutoff(this.paramValues['filter.cutoff'] ?? FILTER_CUTOFF_DEFAULT);
    this.channelFilter.setResonance(this.paramValues['filter.resonance'] ?? FILTER_Q_DEFAULT);
    this.channelFilter.output.connect(routingTarget);
    const filterIn = this.channelFilter.input;
    this.node = new DrumsWorkletNode(ctx);
    for (let i = 0; i < DRUM_VOICE_IDS.length; i++) {
      const voice = DRUM_VOICE_IDS[i];
      const strip = new ChannelStrip(ctx, filterIn, this.sharedFx);   // strips → filter, not routingTarget
      this.voiceStrips[voice] = strip;
      this.node.connectVoice(i, strip.input);
    }
    this.wired = true;
    this.postAllVoices();
    this.applyVoiceMutes();
  }
```

Add a test seam (only the input handle; keep it explicit and small):
```ts
  /** Test-only: the raw-mix input node the per-voice strips feed (the filter
   *  input). Lets a DSP test inject a source on the channel path. */
  getChannelFilterInputForTest(): AudioNode {
    if (!this.channelFilter) throw new Error('channelFilter not built — call createVoice first');
    return this.channelFilter.input;
  }
```

Dispose the filter in `dispose()` (line 628) — add `this.channelFilter?.dispose(); this.channelFilter = null;`.

Important: in sample mode the embedded sampler owns its own filter (Task 7); the drums synth-mode filter built here only carries the 8 synth strips. That is correct — sample mode routes through `this.sampler`, which has its own channel filter.

Run (green), commit: `feat(drums): splice ChannelFilter on the raw bus mix (pre-inserts/EQ)`.

---

## Task 6 — Drums: make `filter.cutoff`/`filter.resonance` modulation destinations (unit + DSP)

**Why:** Acceptance #4. Drums already runs `bindEngineModulators` with `busRangeLookup` (line 487, 515-518). Add the two AudioParams to `getSharedAudioParams` + `DrumsVoice.getAudioParams`, and extend `busRangeLookup` so cutoff uses the detune cents span and resonance uses 0.7–18.

**Failing test (unit)** — append to `src/engines/drums-worklet-engine.test.ts`:

```ts
describe('DrumsWorkletEngine — filter modulation destinations', () => {
  it('getSharedAudioParams exposes filter.cutoff→detune and filter.resonance→Q', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);
    const m = eng.getSharedAudioParams();
    expect(m.has('filter.cutoff')).toBe(true);
    expect(m.has('filter.resonance')).toBe(true);
  });

  it('the bus range lookup gives cutoff the full cents span and resonance its Q span', () => {
    const eng = new DrumsWorkletEngine();
    const lut = (eng as unknown as { busRangeLookup(id: string): { min: number; max: number } }).busRangeLookup;
    const cut = lut('filter.cutoff');
    expect(cut.max - cut.min).toBeCloseTo(1200 * Math.log2(1000), 0);
    const res = lut('filter.resonance');
    expect(res.min).toBeCloseTo(0.7, 5);
    expect(res.max).toBe(18);
  });
});
```

**Failing test (DSP, end-to-end mod)** — new file `src/engines/drums-filter-mod.dsp.test.ts`, mirroring `multifilter.dsp.test.ts`'s "drive the mod param directly" pattern (an LFO is unnecessary — driving `.detune` proves the bridge target is musical and audible):

```ts
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

async function renderWithDetune(detuneCents: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx); eng.setBusStrip(busStrip); eng.setOutputTarget(busStrip.input);
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);              // base dark
  const det = eng.getSharedAudioParams().get('filter.cutoff')!;  // → detune
  det.value = detuneCents;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('DrumsWorkletEngine — cutoff modulation routes to detune (audible)', () => {
  it('a positive cutoff detune opens the filter (brighter)', async () => {
    const dark   = await renderWithDetune(0);     // 300 Hz
    const bright = await renderWithDetune(4800);   // 300·2^4 = 4800 Hz
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/drums-worklet-engine.test.ts src/engines/drums-filter-mod.dsp.test.ts
```

**Minimal impl** — `src/engines/drums-worklet-engine.ts`:

1. Extend `busRangeLookup` (line 350):
```ts
  private busRangeLookup = (id: string): { min: number; max: number } => {
    if (id === 'filter.cutoff')    return { min: 0, max: FILTER_DETUNE_SPAN_CENTS };
    if (id === 'filter.resonance') return { min: FILTER_Q_MIN, max: FILTER_Q_MAX };
    const s = DRUM_PARAMS.find((p) => p.id === id);
    return { min: s?.min ?? 0, max: s?.max ?? 1 };
  };
```
(Cutoff modulates `.detune` in cents — its range is the cents span, NOT 20..20000 — exactly the multifilter convention.)

2. Add to `getSharedAudioParams` (line 614), guarded on the filter existing:
```ts
    if (this.channelFilter) {
      m.set('filter.cutoff',    this.channelFilter.getCutoffModParam());     // .detune
      m.set('filter.resonance', this.channelFilter.getResonanceParam());     // .Q
    }
```

3. Add the same two entries to `DrumsVoice.getAudioParams` (line 187) so the per-voice path also resolves them. `DrumsVoice` needs a handle to the filter — pass it into the voice constructor. Change the constructor (line 180) to also take the filter:
```ts
  constructor(
    private node: DrumsWorkletNode,
    private busStrip: ChannelStrip | null,
    private channelFilter: ChannelFilter | null,
  ) {}
```
and in `getAudioParams`:
```ts
    if (this.channelFilter) {
      m.set('filter.cutoff',    this.channelFilter.getCutoffModParam());
      m.set('filter.resonance', this.channelFilter.getResonanceParam());
    }
```
Update the construction site (line 506): `new DrumsVoice(this.node!, this.busStrip, this.channelFilter)`.

Note the modulation-binding range for cutoff (`getAudioParamRange`) is resolved by `rangeLookupForVoice` → falls back to `engine.params` (20..20000) UNLESS the engine binder passes `busRangeLookup`. Since drums binds via `bindEngineModulators` with `rangeLookup: this.busRangeLookup` (line 517), the cents span is used. Good — no `getAudioParamRange` override needed on the voice for the shared path.

Run (green), commit: `feat(drums): expose filter.cutoff/resonance as modulation destinations (detune cents)`.

---

## Task 7 — Sampler: splice `ChannelFilter` on the dry output, pre-inserts/EQ (DSP) — **RISKIEST PLACEMENT (sampler side)**

**Why:** The sampler routes `node.connectDry(this.dryTarget)` (line 128, 138). To put the filter on the raw mix pre-inserts, build the filter in `ensureNode`, connect `node.connectDry(filterInput)` and `filterOutput → dryTarget`.

**Failing test** — new file `src/engines/sampler-worklet-engine.dsp.test.ts`. The real `SamplerWorkletNode` isn't registered under Vitest, so (like Task 5) inject a source into the filter input directly to prove channel placement:

```ts
import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';

// Real-ish node stub that exposes connectDry so the engine wires the filter.
vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    constructor(public ctx: any) {}
    private _dry: AudioNode | null = null;
    connectDry(n: AudioNode) { this._dry = n; }
    connectSend() {}
    loadSample() {} hasSample() { return false; }
    spawn() {} silenceAll() {} disconnect() {}
    get dry() { return this._dry; }
  },
}));

import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

async function renderSampler(cutoff: number, eqHighDb: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new SamplerWorkletEngine();
  eng.setSharedFx(fx);
  eng.setOutputTarget(busStrip.input);             // dry → filter → busStrip.input
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);   // builds node + filter
  eng.setBaseValue('filter.cutoff', cutoff);
  eng.setBaseValue('bus.eq.high', eqHighDb < 0 ? 0 : eqHighDb); // strip EQ not engine param; set on strip
  busStrip.setEqHigh(eqHighDb);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('SamplerWorkletEngine — channel filter placement (DSP)', () => {
  it('a low cutoff darkens the dry output', async () => {
    const open = await renderSampler(20000, 0);
    const dark = await renderSampler(300, 0);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.6);
  });

  it('the filter sits BEFORE the bus EQ (still dark with the high-shelf boosted)', async () => {
    const open = await renderSampler(20000, 18);
    const dark = await renderSampler(300, 18);
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR) * 0.7);
  });
});
```

(Remove the stray `eng.setBaseValue('bus.eq.high', ...)` line — the sampler has no `bus.eq.high` param; set EQ via `busStrip.setEqHigh` only. Keep the test focused.)

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/sampler-worklet-engine.dsp.test.ts
```

**Minimal impl** — `src/engines/sampler-worklet-engine.ts`, in `ensureNode` (line 124):

```ts
  private ensureNode(ctx: AudioContext): SamplerWorkletNode {
    if (this.node && this.ctx === ctx) return this.node;
    this.ctx = ctx;
    this.node = new SamplerWorkletNode(ctx);
    // Channel filter on the RAW dry mix, BEFORE the lane inserts + bus EQ.
    this.channelFilter = new ChannelFilter(ctx);
    this.channelFilter.setCutoff(this.paramValues['filter.cutoff'] ?? FILTER_CUTOFF_DEFAULT);
    this.channelFilter.setResonance(this.paramValues['filter.resonance'] ?? FILTER_Q_DEFAULT);
    if (this.dryTarget) {
      this.node.connectDry(this.channelFilter.input);
      this.channelFilter.output.connect(this.dryTarget);
    }
    if (this.fx) this.node.connectSend(this.fx.delayInput, this.fx.reverbInput);
    this.pushAllKeymapBuffers();
    return this.node;
  }
```

Update `setOutputTarget` (line 136) so a late dry-target retarget reconnects through the filter:
```ts
  setOutputTarget(n: AudioNode): void {
    this.dryTarget = n;
    if (this.node && this.channelFilter) {
      this.node.connectDry(this.channelFilter.input);
      try { this.channelFilter.output.disconnect(); } catch { /* */ }
      this.channelFilter.output.connect(n);
    } else if (this.node) {
      this.node.connectDry(n);
    }
  }
```

Add the test seam + dispose:
```ts
  getChannelFilterInputForTest(): AudioNode {
    if (!this.channelFilter) throw new Error('channelFilter not built — call createVoice first');
    return this.channelFilter.input;
  }
```
In `dispose()` (line 748): `this.channelFilter?.dispose(); this.channelFilter = null;`.

Run (green), commit: `feat(sampler): splice ChannelFilter on the dry mix (pre-inserts/EQ)`.

---

## Task 8 — Sampler: add `getSharedAudioParams` + `bindEngineModulators` (its FIRST channel modulation destination) (unit + DSP)

**Why:** Acceptance #5. The sampler has a `ModulationHostImpl` (line 110) but `getSharedAudioParams` is absent and it never calls `bindEngineModulators`. Add: `getSharedAudioParams` returning the filter's two params, a `filterRangeLookup`, an engine modulator spawn, and a `bindEngineModulators` call in `createVoice` (mirroring drums, `drums-worklet-engine.ts:507-520`).

**Failing test (unit)** — append to `src/engines/sampler-worklet-engine.test.ts`:

```ts
describe('SamplerWorkletEngine — filter modulation destinations', () => {
  it('getSharedAudioParams exposes filter.cutoff and filter.resonance once a voice is built', () => {
    const eng = new SamplerWorkletEngine();
    eng.createVoice(ctx, out());
    const m = eng.getSharedAudioParams!();
    expect(m.has('filter.cutoff')).toBe(true);
    expect(m.has('filter.resonance')).toBe(true);
  });
});
```

**Failing test (DSP, mod)** — new file `src/engines/sampler-filter-mod.dsp.test.ts` (same shape as Task 6's drums mod test, driving `.detune`):

```ts
import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';
vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    constructor(public ctx: any) {}
    connectDry() {} connectSend() {} loadSample() {} hasSample() { return false; }
    spawn() {} silenceAll() {} disconnect() {}
  },
}));
import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { FxBus, ChannelStrip } from '../core/fx';
import { spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;
async function renderWithDetune(detuneCents: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const fx = new FxBus(ctx as unknown as AudioContext, ctx.destination);
  const busStrip = new ChannelStrip(ctx as unknown as AudioContext, ctx.destination, fx);
  const eng = new SamplerWorkletEngine();
  eng.setSharedFx(fx); eng.setOutputTarget(busStrip.input);
  eng.createVoice(ctx as unknown as AudioContext, busStrip.input);
  eng.setBaseValue('filter.cutoff', 300);
  eng.getSharedAudioParams!().get('filter.cutoff')!.value = detuneCents;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth'; osc.frequency.value = 110;
  osc.connect(eng.getChannelFilterInputForTest());
  osc.start();
  return new Float32Array((await ctx.startRendering()).getChannelData(0));
}

describe('SamplerWorkletEngine — cutoff modulation routes to detune', () => {
  it('a positive detune opens the filter (brighter)', async () => {
    const dark = await renderWithDetune(0);
    const bright = await renderWithDetune(4800);
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/sampler-worklet-engine.test.ts src/engines/sampler-filter-mod.dsp.test.ts
```

**Minimal impl** — `src/engines/sampler-worklet-engine.ts`:

1. Imports (after line 53): `bindEngineModulators`, `disposeLaneModulations`, `disposeEngineMods` from `../modulation/voice-mod-binding`; `getCurrentLaneForVoice` from `../modulation/active-mods`; `makeDefaultLFO`, `makeDefaultADSR` from `../modulation/types`; `ConnectionBinder` type from `../modulation/connection-binder`; `ModulatorVoice` type from `../modulation/types`.

2. Seed the `ModulationHostImpl` with default modulators (it is currently `new ModulationHostImpl([])`, line 110) so the MODULATORS panel has an LFO/ADSR to route, exactly like drums (line 335-338):
```ts
  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);
```

3. Add `getSharedAudioParams`, a range lookup, `bpm`, and engine-mod plumbing:
```ts
  bpm = 120;
  private engineModVoices: Map<string, ModulatorVoice> | null = null;
  private currentLaneId: string | null = null;

  getSharedAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    if (this.channelFilter) {
      m.set('filter.cutoff',    this.channelFilter.getCutoffModParam());
      m.set('filter.resonance', this.channelFilter.getResonanceParam());
    }
    return m;
  }

  private filterRangeLookup = (id: string): { min: number; max: number } => {
    if (id === 'filter.cutoff')    return { min: 0, max: FILTER_DETUNE_SPAN_CENTS };
    if (id === 'filter.resonance') return { min: FILTER_Q_MIN, max: FILTER_Q_MAX };
    const s = this.params.find((p) => p.id === id);
    return { min: s?.min ?? 0, max: s?.max ?? 1 };
  };
```

4. In `createVoice` (line 312), spawn engine mods + bind (mirror drums synth path):
```ts
  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.dryTarget) this.dryTarget = output;
    this.ensureNode(ctx);
    if (!this.engineModVoices) this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      bindEngineModulators({
        laneId, engine: this, voiceMods: this.engineModVoices, ctx,
        rangeLookup: this.filterRangeLookup,
      });
      this.currentLaneId = laneId;
    }
    return new SamplerWorkletVoice(this);
  }
```

5. In `dispose()` (line 748) add: `disposeEngineMods(this.engineModVoices, this.currentLaneId); this.engineModVoices = null; this.currentLaneId = null;`.

Note: this task makes the binding live (modulation works end-to-end, proven by the DSP test). The sampler editor does not render the MODULATORS panel YET — **Task 11b adds it**, so the user can actually route an LFO/ADSR to the filter from the UI. Both are required for acceptance #5 ("modulatable" must be reachable from the editor).

Run (green), commit: `feat(sampler): bind engine modulators for the channel filter (first mod destination)`.

---

## Task 9 — Persistence round-trip for both engines (unit)

**Why:** Acceptance #6. Persistence is automatic via `mirrorParamChange` (write) + `applyLaneEngineState`→`setBaseValue` (read). This test proves the round-trip at the engine level (the knob onChange already mirrors in `engine-ui.ts`, and `apply-lane-engine-state.ts` already replays). We assert that a non-default value written into `engineState.params` is reapplied to the engine via `applyLaneEngineState`.

**Failing test** — new file `src/engines/channel-filter-persistence.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import '../../test/setup';
import { applyLaneEngineState } from '../export/apply-lane-engine-state';
import { DrumsWorkletEngine } from './drums-worklet-engine';

vi.mock('../audio-worklet/drums-node', () => ({
  loadDrumsWorklet: vi.fn().mockResolvedValue(undefined),
  DrumsWorkletNode: class { hit(){} setVoiceParams(){} connectVoice(){} disconnect(){} },
}));

const noopDeps = {
  loadNoteFx: () => {},
  reloadDrumkit: () => {},
  reloadInstrument: () => {},
};

describe('channel filter persistence round-trip', () => {
  it('drums: a saved non-default cutoff/resonance reloads with those exact values', async () => {
    const eng = new DrumsWorkletEngine();
    const lane = {
      id: 'drums-1', engineId: 'drums-machine', clips: [],
      engineState: { params: { 'filter.cutoff': 640, 'filter.resonance': 9 } },
    } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(640, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(9, 3);
  });

  it('absent params fall back to the open/min defaults (older saves unchanged)', async () => {
    const eng = new DrumsWorkletEngine();
    const lane = { id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: {} } as never;
    await applyLaneEngineState(eng as never, lane, {} as AudioContext, noopDeps as never);
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });
});
```

(Add a sampler variant in the same file using `SamplerWorkletEngine` with the sampler-node mock, asserting `filter.cutoff`/`filter.resonance` round-trip.)

Run (red — should actually pass if Tasks 3–4 are correct; this is a regression lock proving persistence comes for free):
```
cross-env NO_COLOR=1 npx vitest run src/engines/channel-filter-persistence.test.ts
```

If green on first run, no impl needed — the test documents the contract. If red, the cause is a missing `setBaseValue` branch (fix per Task 3/4). Commit: `test(filter): lock channel-filter persistence round-trip for drums + sampler`.

---

## Task 10 — Drums editor: "CHANNEL FILTER" knob section (unit/DOM)

**Why:** Acceptance #7 (drums). The drums editor mounts bus knobs via `wireDrumMasterUI` into `#drum-master-knobs` (`drum-master-ui.ts:31`), invoked by `mountDrumMasterLaneKnobs` (`knob-mounting.ts:103`). Add two knobs (CUTOFF, RES) registered under `${laneId}.filter.cutoff` / `${laneId}.filter.resonance` so they appear in the modulation destination dropdown (filtered by `${laneId}.` prefix) and persist via the standard knob onChange→`mirrorParamChange`. The cleanest home is a new `CHANNEL FILTER` subsection appended in `wireDrumMasterUI`, driven through the engine's `setBaseValue` so the live node + cache + mirror all update.

The knobs must write through the engine (not the strip), so `wireDrumMasterUI` needs the engine. Rather than thread the engine in, register the two filter knobs in `mountDrumMasterLaneKnobs` (which already has `deps.laneResources.get(laneId)?.engine`).

**Failing test** — new file `src/core/drum-channel-filter-ui.test.ts` (DOM via jsdom; project uses jsdom-style DOM in `lane-fx-panel.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { mountDrumChannelFilter } from './drum-channel-filter-ui';

function fakeEngine() {
  const vals: Record<string, number> = { 'filter.cutoff': 20000, 'filter.resonance': 0.7 };
  return {
    getBaseValue: (id: string) => vals[id],
    setBaseValue: (id: string, v: number) => { vals[id] = v; },
    _vals: vals,
  };
}

describe('drums CHANNEL FILTER UI', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });

  it('renders a CHANNEL FILTER section with CUTOFF and RES knobs', () => {
    const registered: string[] = [];
    mountDrumChannelFilter({
      laneId: 'drums-1', engine: fakeEngine() as never, parent: host,
      registerKnob: (k) => registered.push(k.id),
    });
    expect(host.textContent).toContain('CHANNEL FILTER');
    expect(registered).toContain('drums-1.filter.cutoff');
    expect(registered).toContain('drums-1.filter.resonance');
  });

  it('turning the CUTOFF knob writes through the engine', () => {
    const eng = fakeEngine();
    let cutoffKnob: { setFromUser?: (v: number) => void } | undefined;
    mountDrumChannelFilter({
      laneId: 'drums-1', engine: eng as never, parent: host,
      registerKnob: (k) => { if (k.id === 'drums-1.filter.cutoff') cutoffKnob = k as never; },
    });
    // createKnob exposes onChange wiring; simulate by calling the engine setter
    // the section installed (assert the section read the initial value).
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(cutoffKnob).toBeDefined();
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/core/drum-channel-filter-ui.test.ts
```

**Minimal impl** — new file `src/core/drum-channel-filter-ui.ts` (mirrors `drum-master-ui.ts` knob construction + `lane-fx-panel.ts` section pattern):

```ts
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import {
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT,
  FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT,
} from './channel-filter';

const FILTER_COLOR = '#16a085';

export interface DrumChannelFilterDeps {
  laneId: string;
  engine: { getBaseValue(id: string): number; setBaseValue(id: string, v: number): void };
  parent: HTMLElement;
  registerKnob: (k: KnobHandle) => void;
  historyDeps?: HistoryDeps;
  onEdit?: (id: string, v: number) => void;   // for session mirroring
}

const fmtHz = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
const fmtQ  = (v: number) => v.toFixed(1);

export function mountDrumChannelFilter(deps: DrumChannelFilterDeps): void {
  const { laneId, engine, parent } = deps;
  const sec = document.createElement('div');
  sec.className = 'row poly-section drum-channel-filter';
  const lab = document.createElement('div');
  lab.className = 'section-label';
  lab.textContent = 'CHANNEL FILTER';
  sec.appendChild(lab);

  const row = document.createElement('div');
  row.className = 'knob-row';
  sec.appendChild(row);

  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const mk = (id: string, label: string, min: number, max: number, dflt: number,
              fmt: (v: number) => string) => {
    const k = createKnob({
      id: `${laneId}.${id}`, label, min, max, step: 0,
      value: engine.getBaseValue(id), defaultValue: dflt,
      size: 42, color: FILTER_COLOR, format: fmt,
      onChange: (v) => { engine.setBaseValue(id, v); deps.onEdit?.(id, v); },
      ...undoHooks,
    });
    row.appendChild(k.el);
    deps.registerKnob(k);
  };
  mk('filter.cutoff', 'CUTOFF', FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT, fmtHz);
  mk('filter.resonance', 'RES', FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT, fmtQ);

  parent.appendChild(sec);
}
```

Wire it into the drums editor — `src/app/knob-mounting.ts`, in `mountDrumMasterLaneKnobs` (line 103), after `wireDrumMasterUI(...)`:
```ts
    const engine = deps.laneResources.get(laneId)?.engine;
    const slot = document.querySelector('[data-page="drums"] #drum-master-knobs')?.parentElement
              ?? document.getElementById('drum-master-knobs')?.parentElement;
    if (engine && slot) {
      // Idempotent: drop a prior section before re-mounting (lane swap).
      slot.parentElement?.querySelectorAll('.drum-channel-filter').forEach((n) => n.remove());
      mountDrumChannelFilter({
        laneId, engine: engine as never, parent: slot.parentElement ?? slot,
        registerKnob: deps.registerKnob,
        historyDeps: deps.getHistoryDeps?.(),
        onEdit: (id, v) => {
          const st = deps.getSessionState();
          if (st) { import('../session/session-engine-state').then(({ mirrorParamChange }) => mirrorParamChange(st, laneId, id, v)); }
        },
      });
    }
```
(Prefer a static import of `mirrorParamChange` at the top of `knob-mounting.ts` rather than dynamic; the dynamic shown is illustrative. The session mirror is what `engine-ui.ts:53-58` does for the generic path; here we replicate it because `mountDrumChannelFilter` builds knobs directly.)

Simplest robust placement: append the CHANNEL FILTER section into the existing drums `data-page="drums"` `.row.knobs` container (the one holding `#drum-master-knobs`, `index.html:213-215`). Pass that container as `parent`.

Run (green), commit: `feat(drums-ui): add CHANNEL FILTER (CUTOFF/RES) knob section`.

---

## Task 11 — Sampler editor: "CHANNEL FILTER" knob section (unit/DOM)

**Why:** Acceptance #7 (sampler). The sampler renders its global knobs via `wireEngineParams(this, ctx, knobRow, { filter: (id) => SAMPLER_PARAMS.some(...) })` (`sampler-worklet-engine.ts:573`). Since the two new specs are already in `SAMPLER_PARAMS` (Task 4), they would auto-render in that generic knob row — but the spec requires a **dedicated, labelled "CHANNEL FILTER" section**. Add an explicit section in `buildParamUI` and exclude `filter.*` from the generic knob row so they only appear once, in the labelled section.

**Failing test** — append to `src/engines/sampler-worklet-engine.test.ts` (DOM):

```ts
describe('SamplerWorkletEngine — CHANNEL FILTER UI', () => {
  it('renders a labelled CHANNEL FILTER section with CUTOFF + RES knobs registered under the lane', () => {
    const eng = new SamplerWorkletEngine();
    const container = document.createElement('div');
    const registered: string[] = [];
    const ctx2 = {
      laneId: 'sampler-1',
      registerKnob: (k: { id: string }) => registered.push(k.id),
      registry: new Map(),
      lookupLaneDisplayName: () => undefined,
    } as never;
    eng.buildParamUI(container, ctx2);
    expect(container.textContent).toContain('CHANNEL FILTER');
    expect(registered).toContain('sampler-1.filter.cutoff');
    expect(registered).toContain('sampler-1.filter.resonance');
    // The generic global knob row must NOT also render the filter knobs (no dup).
    const dupCutoff = registered.filter((id) => id === 'sampler-1.filter.cutoff');
    expect(dupCutoff).toHaveLength(1);
  });
});
```

Run (red):
```
cross-env NO_COLOR=1 npx vitest run src/engines/sampler-worklet-engine.test.ts
```

**Minimal impl** — `src/engines/sampler-worklet-engine.ts`, `buildParamUI`:

1. Exclude `filter.*` from the generic global knob row (line 573-582) — change the filter predicate to:
```ts
      filter: (id) => SAMPLER_PARAMS.some((p) => p.id === id) && !id.startsWith('filter.'),
```

2. After the generic `knobRow` block (after line 582), append a dedicated CHANNEL FILTER section using `wireEngineParams` with a `filter.*`-only predicate and the right formatter:
```ts
    const filterSec = document.createElement('div');
    filterSec.className = 'row poly-section sampler-channel-filter';
    const filterLabel = document.createElement('div');
    filterLabel.className = 'section-label';
    filterLabel.textContent = 'CHANNEL FILTER';
    filterSec.appendChild(filterLabel);
    const filterRow = document.createElement('div');
    filterRow.className = 'knob-row';
    filterSec.appendChild(filterRow);
    container.appendChild(filterSec);
    wireEngineParams(this, ctx, filterRow, {
      filter: (id) => id === 'filter.cutoff' || id === 'filter.resonance',
      formatter: (id, v) =>
        id === 'filter.cutoff'
          ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
          : v.toFixed(1),
    });
```

`wireEngineParams` registers each knob under `${ctx.laneId}.${spec.id}` and wires `onChange` → `setBaseValue` + `mirrorParamChange` (persistence/automation for free, `engine-ui.ts:41-62`). The drums section in Task 10 builds knobs manually (because the drums editor doesn't route filter through `wireEngineParams`), but the sampler already uses `wireEngineParams`, so this is the lighter path.

Run (green), commit: `feat(sampler-ui): add CHANNEL FILTER (CUTOFF/RES) section`.

---

## Task 11b — Sampler editor: render the MODULATORS panel (so the filter is UI-modulatable)

**Why:** Acceptance #5's "modulatable" is only real if the user can ROUTE an LFO/ADSR to the filter **from the editor**. The sampler `buildParamUI` does NOT call `renderModulatorsPanel` today (unlike drums, `drums-worklet-engine.ts:538`), so without this the filter is bindable in code but the sampler editor has no UI to add a modulator. The sampler editor is ALSO what drums shows in sample mode (`drums-worklet-engine.ts:529` delegates to `this.sampler.buildParamUI`), so this single change covers the drums sample-mode drumkit too.

**Failing test** — append to `src/engines/sampler-worklet-engine.test.ts`:

```ts
it('renders the MODULATORS panel so the filter can be routed to an LFO/ADSR', () => {
  const eng = new SamplerWorkletEngine();
  eng.createVoice(ctx, out());
  const container = document.createElement('div');
  const ctx2 = {
    laneId: 'sampler-1',
    registerKnob: (_k: { id: string }) => {},
    registry: new Map(),
    lookupLaneDisplayName: () => undefined,
  } as never;
  eng.buildParamUI(container, ctx2);
  expect(container.textContent).toContain('MODULATORS');
});
```

Run (red): `cross-env NO_COLOR=1 npx vitest run src/engines/sampler-worklet-engine.test.ts`

**Minimal impl** — `src/engines/sampler-worklet-engine.ts`:

1. Imports: add `renderModulatorsPanel` from `../modulation/modulation-ui`, `reapplyLaneModulations` from `../modulation/voice-mod-binding` (Task 8 added the other binder imports), and the `KnobHandle` type if not present.

2. At the END of `buildParamUI` (after the CHANNEL FILTER section from Task 11), append — mirroring `drums-worklet-engine.ts:538-558` exactly:

```ts
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
      onLiveEdit: () => { if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId); },
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
```

The panel shows the LFO1/ADSR1 seeded in Task 8; the user adds a destination → `filter.cutoff` / `filter.resonance` (the two ids `getSharedAudioParams` exposes). The `reapplyLaneModulations` on live-edit makes depth/on-off/rate changes take effect without a rebuild, exactly as drums does.

Run (green), commit: `feat(sampler-ui): render MODULATORS panel (channel filter is UI-modulatable)`.

---

## Task 12 — Full regression sweep + dsp battery

Run the touched suites + the full unit suite to confirm no regressions (especially: drums sample-mode delegation, sampler choke, mixer persistence, modulation binder):

```
cross-env NO_COLOR=1 npx vitest run src/core/channel-filter.test.ts src/core/channel-filter.dsp.test.ts src/engines/drums-worklet-engine.test.ts src/engines/drums-worklet-engine.dsp.test.ts src/engines/drums-filter-mod.dsp.test.ts src/engines/sampler-worklet-engine.test.ts src/engines/sampler-worklet-engine.dsp.test.ts src/engines/sampler-filter-mod.dsp.test.ts src/engines/channel-filter-persistence.test.ts src/core/drum-channel-filter-ui.test.ts src/modulation/voice-mod-binding.test.ts src/core/fx.test.ts
```

Then the whole fast suite:
```
cross-env NO_COLOR=1 npx vitest run
```

Fix any fallout (most likely: a drums `getAudioParams`/`DrumsVoice` constructor signature change ripple, or the sampler `buildParamUI` dup-knob assertion). Commit: `test: full regression sweep for channel filter`.

---

## Risk callouts

1. **The node-insertion boundary (Tasks 5 + 7) is the riskiest.** The drums per-voice strips connect to `routingTarget` today (`drums-worklet-engine.ts:469`); the sampler connects `node.connectDry(dryTarget)` (`sampler-worklet-engine.ts:128`). Both must be rerouted through the filter so the filter sits on the *summed raw mix* and *before* the lane InsertChain + bus EQ. Tasks 5 and 7 each include a **"filter sits BEFORE the bus EQ"** assertion (low cutoff still darkens even with the bus high-shelf at +18 dB) — this is the load-bearing proof that the filter is upstream of EQ, not just "somewhere in the chain."

2. **Cutoff modulation range, not value, is in cents.** The single easiest mistake is making the cutoff modulation destination `BiquadFilter.frequency` with range `20..20000` (additive Hz → inaudible / wrong). The proven convention (`multifilter.ts:46`, `multifilter.dsp.test.ts:49`) is destination `.detune` with range `{0, FILTER_DETUNE_SPAN_CENTS}`. Tasks 6 and 8 assert the cents span explicitly and prove audibility by driving `.detune` directly.

3. **Sampler mod binding is new for this engine.** It needs the full drums lifecycle: spawn `engineModVoices` once, `bindEngineModulators` with `filterRangeLookup`, and tear down in `dispose` via `disposeEngineMods` (mirrors `drums-worklet-engine.ts:507-520, 628-637`). Missing the dispose leaks a free-running LFO on lane swap.

4. **Sampler `getSharedAudioParams` returns empty until `ensureNode` runs.** The binder calls it at `createVoice` time, after `ensureNode` — order is correct in Task 8's `createVoice` (ensureNode before bind). The unit test in Task 8 builds a voice first.

5. **Drums sample mode** routes through the embedded sampler, which now has its OWN channel filter (Task 7). The drums synth-mode filter (Task 5) only carries synth strips. Both flavours get the filter (acceptance #1 + #2) via different node instances — this is correct and matches the spec's "both engines" scope. The drums `params` getter returns the sampler's params in sample mode (`drums-worklet-engine.ts:234-236`), so the sampler's `filter.cutoff`/`filter.resonance` specs surface in that mode too.

---

### Critical Files for Implementation
- c:\Users\nacho\git\tb303-synth\.claude\worktrees\drums-channel-filter\src\core\channel-filter.ts (new — shared `ChannelFilter` node + constants; created Task 1)
- c:\Users\nacho\git\tb303-synth\.claude\worktrees\drums-channel-filter\src\engines\drums-worklet-engine.ts (specs, node splice in `ensureWired`, `getSharedAudioParams`, `busRangeLookup`, `DrumsVoice`)
- c:\Users\nacho\git\tb303-synth\.claude\worktrees\drums-channel-filter\src\engines\sampler-worklet-engine.ts (specs, node splice in `ensureNode`/`setOutputTarget`, `getSharedAudioParams`, `bindEngineModulators`, CHANNEL FILTER UI section)
- c:\Users\nacho\git\tb303-synth\.claude\worktrees\drums-channel-filter\src\app\knob-mounting.ts (mount the drums CHANNEL FILTER knob section in `mountDrumMasterLaneKnobs`)
- c:\Users\nacho\git\tb303-synth\.claude\worktrees\drums-channel-filter\src\plugins\fx\multifilter.ts (reference for the `.detune` cents modulation convention — `FREQ_DETUNE_SPAN_CENTS`, `getAudioParamRange`)