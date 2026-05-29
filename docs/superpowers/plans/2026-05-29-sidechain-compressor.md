# Sidechain Compressor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-lane compressor block, a master-bus compressor, and a per-target sidechain ducker driven by a small global `SidechainBus` — all bypassed/inert by default so existing patterns sound identical until enabled.

**Architecture:** Three thin primitives composed together. `CompBlock` wraps a `DynamicsCompressorNode` + makeup `GainNode` with a bypass rewire — used by both `ChannelStrip` and the new `MasterCompressor`. `SidechainBus` is a pure lane-id → tap registry. `DuckerSubgraph` builds the envelope-follower (`WaveShaper(|x|) → BiquadFilter(LP) → -depth gain + ConstantSourceNode(1.0)`) that modulates a target `duckGain.gain`. `ChannelStrip` owns one `CompBlock` and one `duckGain` and registers its post-mute tap with the bus on construction. The master comp sits between `FilterChain` and `analyser`.

**Tech Stack:** TypeScript, Vitest (unit + DSP via `node-web-audio-api` in `test/setup.ts`), Web Audio API. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-29-sidechain-compressor-design.md](../specs/2026-05-29-sidechain-compressor-design.md)

**Plan verified against HEAD on 2026-05-29.** Re-checked: `ChannelStrip` exposes `input`, `level`, `reverbSend`, `delaySend`, `serialize()`, `restore()` ([src/core/fx.ts:86](../../src/core/fx.ts)). The strip's internal chain is `input → eqLow → eqMid → eqHigh → level → panner → muteGain → {dry, reverbSend, delaySend}` ([src/core/fx.ts:113-122](../../src/core/fx.ts)). `SavedStateV3` does **not** currently persist per-strip mixer state ([src/save/saved-state-v3.ts](../../src/save/saved-state-v3.ts)) — comp/sidechain state lives only in memory via `ChannelStrip.serialize/restore` (used by history/undo), matching existing EQ/level/pan behavior. The mixer column builder has a working `addKnob` helper ([src/core/mixer.ts:45](../../src/core/mixer.ts)) and the M/S buttons demonstrate the toggle-button pattern. The FX page already mounts new sections at `index.html:256-270`.

---

## Phase A — Pure primitives (no audio graph)

Two pure modules first: the state shapes and the lane-id registry. Both are fully testable without `AudioContext`.

### Task 1: `CompState` + `SidechainState` types and defaults

**Files:**

- Create: `src/core/comp-state.ts`
- Create: `src/core/comp-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/comp-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMP_STATE,
  withCompDefaults,
  withSidechainDefaultsOrNull,
  type CompState,
  type SidechainState,
} from './comp-state';

describe('DEFAULT_COMP_STATE', () => {
  it('starts bypassed so existing patterns are unaffected', () => {
    expect(DEFAULT_COMP_STATE.bypass).toBe(true);
  });

  it('has musically sane defaults', () => {
    expect(DEFAULT_COMP_STATE.ratio).toBeGreaterThan(1);
    expect(DEFAULT_COMP_STATE.threshold).toBeLessThan(0);
    expect(DEFAULT_COMP_STATE.attack).toBeGreaterThan(0);
    expect(DEFAULT_COMP_STATE.release).toBeGreaterThan(0);
    expect(DEFAULT_COMP_STATE.knee).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_COMP_STATE.makeup).toBeGreaterThan(0);
  });
});

describe('withCompDefaults', () => {
  it('returns the defaults when the input is undefined', () => {
    expect(withCompDefaults(undefined)).toEqual(DEFAULT_COMP_STATE);
  });

  it('overlays provided fields atop the defaults', () => {
    const partial: Partial<CompState> = { bypass: false, ratio: 8 };
    const merged = withCompDefaults(partial);
    expect(merged.bypass).toBe(false);
    expect(merged.ratio).toBe(8);
    expect(merged.threshold).toBe(DEFAULT_COMP_STATE.threshold); // untouched
  });

  it('does not mutate its input', () => {
    const partial: Partial<CompState> = { ratio: 2 };
    const before = { ...partial };
    withCompDefaults(partial);
    expect(partial).toEqual(before);
  });
});

describe('withSidechainDefaultsOrNull', () => {
  it('returns null when input is null or undefined', () => {
    expect(withSidechainDefaultsOrNull(null)).toBeNull();
    expect(withSidechainDefaultsOrNull(undefined)).toBeNull();
  });

  it('fills missing fields with sane defaults when input is partial', () => {
    const partial: Partial<SidechainState> = { source: 'drums' };
    const sc = withSidechainDefaultsOrNull(partial)!;
    expect(sc.source).toBe('drums');
    expect(sc.depth).toBeGreaterThan(0);
    expect(sc.depth).toBeLessThanOrEqual(1);
    expect(sc.attack).toBeGreaterThan(0);
    expect(sc.release).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests; expect failures**

Run: `NO_COLOR=1 npx vitest run src/core/comp-state.test.ts`

Expected: FAIL — module `./comp-state` does not exist.

- [ ] **Step 3: Create `src/core/comp-state.ts` with the types and helpers**

```typescript
// Plain serializable state for a single-band compressor and an optional
// sidechain ducker block. The state shapes are referenced by ChannelStrip
// (per-lane comp + duck) and MasterCompressor (comp only).

export interface CompState {
  bypass: boolean;
  threshold: number;   // dB,  -100..0 — DynamicsCompressorNode range
  ratio: number;       // 1..20
  attack: number;      // s,    0..1
  release: number;     // s,    0..1
  knee: number;        // dB,   0..40
  makeup: number;      // linear gain, ~0..4 (≈ +12dB)
}

export interface SidechainState {
  source: string;      // lane id of the source (must be registered with SidechainBus)
  depth: number;       // 0..1 — how deep the duck dips
  attack: number;      // s
  release: number;     // s
  threshold: number;   // dB; envelope below this contributes nothing
}

export const DEFAULT_COMP_STATE: CompState = {
  bypass: true,
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 30,
  makeup: 1,
};

export const DEFAULT_SIDECHAIN_STATE: SidechainState = {
  source: '',
  depth: 0.6,
  attack: 0.005,
  release: 0.25,
  threshold: -40,
};

export function withCompDefaults(s: Partial<CompState> | undefined): CompState {
  if (!s) return { ...DEFAULT_COMP_STATE };
  return { ...DEFAULT_COMP_STATE, ...s };
}

export function withSidechainDefaultsOrNull(
  s: Partial<SidechainState> | null | undefined,
): SidechainState | null {
  if (s == null) return null;
  return { ...DEFAULT_SIDECHAIN_STATE, ...s };
}
```

- [ ] **Step 4: Run tests; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/comp-state.test.ts`

Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/core/comp-state.ts src/core/comp-state.test.ts
git commit -m "feat(fx): CompState/SidechainState shapes + default merge helpers"
```

---

### Task 2: `SidechainBus` — lane-id registry

**Files:**

- Create: `src/core/sidechain-bus.ts`
- Create: `src/core/sidechain-bus.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/sidechain-bus.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/setup';
import { SidechainBus } from './sidechain-bus';

describe('SidechainBus', () => {
  let ctx: AudioContext;
  let bus: SidechainBus;

  beforeEach(() => {
    ctx = new AudioContext();
    bus = new SidechainBus();
  });

  it('returns null for unknown lane ids', () => {
    expect(bus.getTap('does-not-exist')).toBeNull();
  });

  it('returns the registered tap by lane id', () => {
    const tap = ctx.createGain();
    bus.register('bass', tap, 'BASS');
    expect(bus.getTap('bass')).toBe(tap);
  });

  it('replaces the tap on duplicate register (last-write-wins)', () => {
    const a = ctx.createGain();
    const b = ctx.createGain();
    bus.register('bass', a, 'BASS');
    bus.register('bass', b, 'BASS');
    expect(bus.getTap('bass')).toBe(b);
  });

  it('unregister clears the lane id', () => {
    const tap = ctx.createGain();
    bus.register('bass', tap, 'BASS');
    bus.unregister('bass');
    expect(bus.getTap('bass')).toBeNull();
  });

  it('listSources returns a stable, alphabetised view of registrations', () => {
    bus.register('poly', ctx.createGain(), 'POLY');
    bus.register('bass', ctx.createGain(), 'BASS');
    bus.register('drums', ctx.createGain(), 'DRUMS');
    const ids = bus.listSources().map((s) => s.id);
    expect(ids).toEqual(['bass', 'drums', 'poly']);
  });

  it('listSources omits the optional excludeId so a lane cannot self-duck', () => {
    bus.register('poly', ctx.createGain(), 'POLY');
    bus.register('bass', ctx.createGain(), 'BASS');
    const ids = bus.listSources('poly').map((s) => s.id);
    expect(ids).toEqual(['bass']);
  });

  it('subscribe fires on register and unregister', () => {
    const seen: number[] = [];
    bus.subscribe(() => seen.push(bus.listSources().length));
    bus.register('bass', ctx.createGain(), 'BASS');
    bus.register('drums', ctx.createGain(), 'DRUMS');
    bus.unregister('bass');
    expect(seen).toEqual([1, 2, 1]);
  });
});
```

- [ ] **Step 2: Run tests; expect failures**

Run: `NO_COLOR=1 npx vitest run src/core/sidechain-bus.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/sidechain-bus.ts`**

```typescript
// Lane-id → sidechain tap registry. Each ChannelStrip registers a GainNode
// fed off its post-mute output as its "tap"; ducker subgraphs read from
// `getTap(sourceLaneId)` to drive their envelope follower.
//
// Pure data structure — never owns audio nodes' lifetime; strips create
// and dispose their own taps and call register/unregister at the boundary.

export interface SidechainSource {
  id: string;
  label: string;
}

type Listener = () => void;

export class SidechainBus {
  private taps = new Map<string, { tap: GainNode; label: string }>();
  private listeners: Set<Listener> = new Set();

  register(id: string, tap: GainNode, label: string): void {
    this.taps.set(id, { tap, label });
    this.fire();
  }

  unregister(id: string): void {
    if (this.taps.delete(id)) this.fire();
  }

  getTap(id: string): GainNode | null {
    return this.taps.get(id)?.tap ?? null;
  }

  /** Sorted by id, optionally excluding one (the self-id for the UI dropdown). */
  listSources(excludeId?: string): SidechainSource[] {
    const out: SidechainSource[] = [];
    for (const [id, { label }] of this.taps) {
      if (id === excludeId) continue;
      out.push({ id, label });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private fire() {
    for (const fn of this.listeners) fn();
  }
}
```

- [ ] **Step 4: Run tests; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/sidechain-bus.test.ts`

Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/core/sidechain-bus.ts src/core/sidechain-bus.test.ts
git commit -m "feat(fx): SidechainBus lane-id tap registry with subscribe"
```

---

## Phase B — Audio building blocks

Two reusable audio primitives that both `ChannelStrip` and `MasterCompressor` will compose.

### Task 3: `CompBlock` — DynamicsCompressorNode + makeup + bypass rewire

**Files:**

- Create: `src/core/comp-block.ts`
- Create: `src/core/comp-block.dsp.test.ts`

- [ ] **Step 1: Write the failing DSP test**

Create `src/core/comp-block.dsp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { CompBlock } from './comp-block';
import { DEFAULT_COMP_STATE } from './comp-state';

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

async function renderSine(active: boolean): Promise<number> {
  const sr = 44100;
  const dur = 0.5;
  const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  // High amplitude so the compressor has plenty to work with.
  const amp = ctx.createGain();
  amp.gain.value = 0.95;

  const block = new CompBlock(ctx, {
    ...DEFAULT_COMP_STATE,
    bypass: !active,
    threshold: -30,  // way below the source
    ratio: 8,
    attack: 0.001,
    release: 0.1,
    knee: 0,
    makeup: 1,       // no makeup so reduction is visible
  });

  osc.connect(amp).connect(block.input);
  block.output.connect(ctx.destination);
  osc.start(0);
  osc.stop(dur);

  const rendered = await ctx.startRendering();
  return rms(rendered.getChannelData(0));
}

describe('CompBlock DSP', () => {
  it('active compressor reduces RMS vs bypass on a sustained loud sine', async () => {
    const bypassedRms = await renderSine(false);
    const activeRms   = await renderSine(true);
    // Relative assertion only — never absolute magnitudes.
    expect(activeRms / bypassedRms).toBeLessThan(0.85);
  });

  it('bypass=true is a pass-through (rendered RMS within 1% of un-blocked)', async () => {
    const sr = 44100;
    const dur = 0.25;

    async function renderRaw(): Promise<number> {
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      osc.frequency.value = 440;
      osc.connect(amp).connect(ctx.destination);
      osc.start(0);
      osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }

    async function renderBypassed(): Promise<number> {
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      osc.frequency.value = 440;
      const block = new CompBlock(ctx, { ...DEFAULT_COMP_STATE, bypass: true, makeup: 1 });
      osc.connect(amp).connect(block.input);
      block.output.connect(ctx.destination);
      osc.start(0);
      osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }

    const raw = await renderRaw();
    const bypassed = await renderBypassed();
    expect(Math.abs(bypassed - raw) / raw).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run test; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/comp-block.dsp.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/comp-block.ts`**

```typescript
import {
  withCompDefaults,
  type CompState,
} from './comp-state';

// A reusable compressor block: input GainNode → DynamicsCompressorNode →
// makeup GainNode → output GainNode. When bypassed, input is rewired
// directly to output and the comp/makeup pair is disconnected.
//
// Both ChannelStrip (per-lane) and MasterCompressor (master bus) compose
// one of these. Construction does NOT touch any AudioParam after the
// initial assignment — subsequent setState() drives changes through
// setTargetAtTime so they're sample-accurate.

export class CompBlock {
  input: GainNode;
  output: GainNode;
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;
  private state: CompState;

  constructor(private ctx: BaseAudioContext, initial: Partial<CompState> = {}) {
    this.state = withCompDefaults(initial);

    this.input  = ctx.createGain();
    this.comp   = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.output = ctx.createGain();

    this.comp.threshold.value = this.state.threshold;
    this.comp.ratio.value     = this.state.ratio;
    this.comp.attack.value    = this.state.attack;
    this.comp.release.value   = this.state.release;
    this.comp.knee.value      = this.state.knee;
    this.makeup.gain.value    = this.state.makeup;

    this.rewire();
  }

  /** Replace internal state with a new snapshot, applying smoothing where it matters. */
  setState(next: Partial<CompState>): void {
    const merged = withCompDefaults({ ...this.state, ...next });
    const bypassChanged = merged.bypass !== this.state.bypass;
    this.state = merged;
    const t = this.ctx.currentTime;
    this.comp.threshold.setTargetAtTime(merged.threshold, t, 0.01);
    this.comp.ratio.setTargetAtTime(merged.ratio, t, 0.01);
    this.comp.attack.setTargetAtTime(merged.attack, t, 0.01);
    this.comp.release.setTargetAtTime(merged.release, t, 0.01);
    this.comp.knee.setTargetAtTime(merged.knee, t, 0.01);
    this.makeup.gain.setTargetAtTime(merged.makeup, t, 0.01);
    if (bypassChanged) this.rewire();
  }

  getState(): CompState { return { ...this.state }; }

  /** Read-only compression reduction (dB, negative). Useful for a future GR meter. */
  getReduction(): number { return this.comp.reduction; }

  private rewire(): void {
    this.input.disconnect();
    try { this.comp.disconnect(); } catch { /* not yet connected */ }
    try { this.makeup.disconnect(); } catch { /* idem */ }
    if (this.state.bypass) {
      this.input.connect(this.output);
    } else {
      this.input.connect(this.comp).connect(this.makeup).connect(this.output);
    }
  }
}
```

- [ ] **Step 4: Run test; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/comp-block.dsp.test.ts`

Expected: PASS (both DSP cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/comp-block.ts src/core/comp-block.dsp.test.ts
git commit -m "feat(fx): CompBlock — DynamicsCompressor + makeup + bypass rewire"
```

---

### Task 4: `DuckerSubgraph` — envelope-follower modulator for a GainNode

**Files:**

- Create: `src/core/ducker-subgraph.ts`
- Create: `src/core/ducker-subgraph.wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `src/core/ducker-subgraph.wiring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { DuckerSubgraph } from './ducker-subgraph';
import { DEFAULT_SIDECHAIN_STATE } from './comp-state';

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  const n = to - from;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

describe('DuckerSubgraph wiring', () => {
  it('duck.gain dips when the source signal is loud and recovers when it stops', async () => {
    const sr = 44100;
    const dur = 1.0;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

    // Target: steady 440Hz sine at unity level, routed through a dedicated
    // GainNode whose gain we'll modulate from the ducker subgraph.
    const target = ctx.createOscillator();
    target.frequency.value = 440;
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    // Source: a 0.2s burst of full-scale noise starting at t=0.2,
    // then silence again. Sourced from an AudioBufferSource so we can
    // shape it precisely.
    const sourceBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const srcData = sourceBuf.getChannelData(0);
    const burstStart = Math.floor(sr * 0.2);
    const burstEnd   = Math.floor(sr * 0.4);
    for (let i = burstStart; i < burstEnd; i++) srcData[i] = (Math.random() * 2 - 1) * 0.9;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = sourceBuf;
    const sourceTap = ctx.createGain();
    sourceNode.connect(sourceTap);

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap,
      duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'ignored', depth: 0.8, attack: 0.003, release: 0.05 },
    });
    expect(ducker).toBeDefined(); // suppress unused-var lint

    target.connect(duckGain).connect(ctx.destination);
    target.start(0);
    target.stop(dur);
    sourceNode.start(0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);

    // Window during the burst (target should be ducked).
    const duckedRms = rms(data, Math.floor(sr * 0.25), Math.floor(sr * 0.38));
    // Window before the burst (target at full level).
    const cleanRms  = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.18));

    expect(duckedRms / cleanRms).toBeLessThan(0.85);
  });

  it('dispose() detaches the follower so duck.gain recovers to 1.0', async () => {
    const sr = 44100;
    const dur = 0.5;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);

    const target = ctx.createOscillator();
    target.frequency.value = 440;
    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    const sourceBuf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const srcData = sourceBuf.getChannelData(0);
    for (let i = 0; i < srcData.length; i++) srcData[i] = (Math.random() * 2 - 1) * 0.9;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = sourceBuf;
    const sourceTap = ctx.createGain();
    sourceNode.connect(sourceTap);

    const ducker = new DuckerSubgraph(ctx, {
      sourceTap, duckGain,
      state: { ...DEFAULT_SIDECHAIN_STATE, source: 'ignored', depth: 0.9 },
    });
    ducker.dispose();

    target.connect(duckGain).connect(ctx.destination);
    target.start(0);
    target.stop(dur);
    sourceNode.start(0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    // No ducking expected at all; RMS should be roughly the un-ducked sine.
    const fullRms = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.45));
    expect(fullRms).toBeGreaterThan(0.5); // sine RMS = 0.707 for unit amplitude
  });
});
```

- [ ] **Step 2: Run test; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/ducker-subgraph.wiring.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/ducker-subgraph.ts`**

```typescript
import type { SidechainState } from './comp-state';

// Build/teardown an envelope-follower subgraph whose output modulates
// `duckGain.gain` so the effective gain is approximately:
//
//     duckGain.gain ≈ 1 − depth · env(source)
//
// Graph:
//
//   sourceTap
//     → WaveShaper (curve: y = |x|; full-wave rectify)
//     → BiquadFilter (lowpass; freq from release time constant)
//     → Gain (-depth)             ─┐
//                                   ├──→ duckGain.gain (AudioParam)
//   ConstantSourceNode(1.0)        ─┘
//
// v1 approximation: a single one-pole LP whose frequency is derived from
// `release` (the more audible side). `attack` clamps a small extra smoothing
// stage. A proper detector with separate up/down constants is a follow-up.

export interface DuckerOpts {
  sourceTap: GainNode;
  duckGain: GainNode;
  state: SidechainState;
}

const ABS_CURVE_LEN = 2048;
function makeAbsCurve(): Float32Array {
  const c = new Float32Array(ABS_CURVE_LEN);
  for (let i = 0; i < ABS_CURVE_LEN; i++) {
    const x = (i / (ABS_CURVE_LEN - 1)) * 2 - 1; // -1..+1
    c[i] = Math.abs(x);
  }
  return c;
}

// One-pole low-pass: f_c such that the -3dB time matches `timeSec`.
// f_c ≈ 1 / (2π · timeSec). Clamp to a sensible band.
function timeToCutoffHz(timeSec: number): number {
  const safe = Math.max(timeSec, 0.001);
  return Math.min(20000, Math.max(0.5, 1 / (2 * Math.PI * safe)));
}

export class DuckerSubgraph {
  private rectify: WaveShaperNode;
  private envelopeLp: BiquadFilterNode;
  private smoothLp: BiquadFilterNode;
  private scale: GainNode;
  private constOne: ConstantSourceNode;

  constructor(private ctx: BaseAudioContext, opts: DuckerOpts) {
    const { sourceTap, duckGain, state } = opts;

    this.rectify = ctx.createWaveShaper();
    this.rectify.curve = makeAbsCurve();

    this.envelopeLp = ctx.createBiquadFilter();
    this.envelopeLp.type = 'lowpass';
    this.envelopeLp.frequency.value = timeToCutoffHz(state.release);
    this.envelopeLp.Q.value = 0.707;

    this.smoothLp = ctx.createBiquadFilter();
    this.smoothLp.type = 'lowpass';
    this.smoothLp.frequency.value = timeToCutoffHz(Math.max(state.attack, 0.0005));
    this.smoothLp.Q.value = 0.707;

    this.scale = ctx.createGain();
    this.scale.gain.value = -state.depth;

    this.constOne = ctx.createConstantSource();
    this.constOne.offset.value = 1;
    this.constOne.start();

    // First clear whatever was on duckGain.gain so we don't double-drive.
    // AudioParam.disconnect() takes no arg; just leave the user-assigned
    // base value alone — connections from our nodes are additive.
    sourceTap.connect(this.rectify);
    this.rectify.connect(this.envelopeLp);
    this.envelopeLp.connect(this.smoothLp);
    this.smoothLp.connect(this.scale);
    this.scale.connect(duckGain.gain);
    this.constOne.connect(duckGain.gain);

    // Base value of 0 because the constOne provides the 1.0 — leaves the
    // user-facing knob (`level`) on a separate node, not this gain.
    duckGain.gain.value = 0;
  }

  setState(state: SidechainState): void {
    const t = this.ctx.currentTime;
    this.envelopeLp.frequency.setTargetAtTime(timeToCutoffHz(state.release), t, 0.01);
    this.smoothLp.frequency.setTargetAtTime(timeToCutoffHz(Math.max(state.attack, 0.0005)), t, 0.01);
    this.scale.gain.setTargetAtTime(-state.depth, t, 0.01);
  }

  dispose(): void {
    try { this.constOne.stop(); } catch { /* already stopped */ }
    try { this.rectify.disconnect(); } catch { /* */ }
    try { this.envelopeLp.disconnect(); } catch { /* */ }
    try { this.smoothLp.disconnect(); } catch { /* */ }
    try { this.scale.disconnect(); } catch { /* */ }
    try { this.constOne.disconnect(); } catch { /* */ }
  }
}
```

- [ ] **Step 4: Run test; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/ducker-subgraph.wiring.test.ts`

Expected: PASS. If the `dispose` case fails because the residual `duckGain.gain` base value is 0 (since the constOne is gone), update the dispose path to set `duckGain.gain.value = 1` on teardown. The first test must remain green.

- [ ] **Step 5: Commit**

```bash
git add src/core/ducker-subgraph.ts src/core/ducker-subgraph.wiring.test.ts
git commit -m "feat(fx): DuckerSubgraph envelope follower for sidechain ducking"
```

---

## Phase C — ChannelStrip integration

Splice the comp + duck blocks into `ChannelStrip` and extend its serialized state.

### Task 5: Splice `CompBlock` into `ChannelStrip` (comp only, no sidechain yet)

**Files:**

- Modify: `src/core/fx.ts`
- Modify: `src/core/fx.test.ts`

- [ ] **Step 1: Add failing tests to `src/core/fx.test.ts`**

Append the following test block to `src/core/fx.test.ts` (inside the file, after the existing `describe` block):

```typescript
describe('ChannelStrip compressor block', () => {
  let ctx: AudioContext;
  let strip: ChannelStrip;

  beforeAll(() => {
    ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    strip = new ChannelStrip(ctx, ctx.destination, fx);
  });

  it('starts bypassed by default', () => {
    expect(strip.serialize().comp.bypass).toBe(true);
  });

  it('setCompState merges with current state and round-trips through serialize', () => {
    strip.setCompState({ bypass: false, ratio: 6 });
    const s = strip.serialize();
    expect(s.comp.bypass).toBe(false);
    expect(s.comp.ratio).toBe(6);
  });

  it('restore() with a state missing `comp` falls back to defaults (migration)', () => {
    // Build a state object with no `comp` field (simulating undo history
    // saved before this feature landed).
    const fx2 = new FxBus(ctx, ctx.destination);
    const fresh = new ChannelStrip(ctx, ctx.destination, fx2);
    const legacy = fresh.serialize();
    // Force-delete to simulate truly absent field.
    delete (legacy as unknown as Record<string, unknown>).comp;
    fresh.restore(legacy as Parameters<ChannelStrip['restore']>[0]);
    expect(fresh.serialize().comp.bypass).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`

Expected: FAIL — `serialize().comp` is undefined; `setCompState` doesn't exist.

- [ ] **Step 3: Modify `src/core/fx.ts`** — extend `ChannelState`, splice `CompBlock`, expose `setCompState`

At the top of `src/core/fx.ts`, add an import:

```typescript
import { CompBlock } from './comp-block';
import {
  withCompDefaults,
  withSidechainDefaultsOrNull,
  type CompState,
  type SidechainState,
} from './comp-state';
```

Extend the `ChannelState` interface:

```typescript
export interface ChannelState {
  level: number;
  pan: number;
  reverbSend: number;
  delaySend: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  muted: boolean;
  comp: CompState;
  sidechain: SidechainState | null; // populated in Task 7
}
```

Update the `ChannelStrip` constructor. Replace the existing audio-graph block (`this.input.connect(this.eqLow)…`) with:

```typescript
    // EQ → comp → level → pan → mute → {dry, sends}
    this.comp = new CompBlock(ctx);

    this.input
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.comp.input);
    this.comp.output
      .connect(this.level)
      .connect(this.panner)
      .connect(this.muteGain);
    this.muteGain.connect(dry);
    this.muteGain.connect(this.reverbSend).connect(fx.reverbInput);
    this.muteGain.connect(this.delaySend ).connect(fx.delayInput);
```

Add the `comp` field declaration alongside the existing private nodes:

```typescript
  comp: CompBlock;
```

Add `setCompState`:

```typescript
  setCompState(s: Partial<CompState>) { this.comp.setState(s); }
  getCompState(): CompState { return this.comp.getState(); }
```

Extend `serialize`:

```typescript
  serialize(): ChannelState {
    return {
      level: this.level.gain.value,
      pan: this.panner.pan.value,
      reverbSend: this.reverbSend.gain.value,
      delaySend: this.delaySend.gain.value,
      eqLow:  this.eqLow.gain.value,
      eqMid:  this.eqMid.gain.value,
      eqHigh: this.eqHigh.gain.value,
      muted: this._muted,
      comp: this.comp.getState(),
      sidechain: null, // populated in Task 7
    };
  }
```

Extend `restore`:

```typescript
  restore(s: ChannelState) {
    this.setLevel(s.level);
    if (typeof s.pan === 'number') this.setPan(s.pan);
    this.setReverbSend(s.reverbSend);
    this.setDelaySend(s.delaySend);
    this.setEqLow(s.eqLow);
    this.setEqMid(s.eqMid);
    this.setEqHigh(s.eqHigh);
    this.setMuted(s.muted);
    this.comp.setState(withCompDefaults(s.comp));
    // sidechain restoration lives in Task 7
    void withSidechainDefaultsOrNull(s.sidechain);
  }
```

- [ ] **Step 4: Run tests; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`

Expected: PASS (existing EQ tests + 3 new comp tests).

- [ ] **Step 5: Run the full fast suite to catch regressions**

Run: `npm run test:fast`

Expected: 0 failures across all suites (any pre-existing tests that called `strip.serialize()` should still pass because the new fields are additive).

- [ ] **Step 6: Commit**

```bash
git add src/core/fx.ts src/core/fx.test.ts
git commit -m "feat(fx): ChannelStrip embeds CompBlock; ChannelState gains comp+sidechain"
```

---

### Task 6: `ChannelStrip` exposes a sidechain tap + registers with `SidechainBus`

**Files:**

- Modify: `src/core/fx.ts`
- Modify: `src/core/fx.test.ts`

- [ ] **Step 1: Add failing tests to `src/core/fx.test.ts`**

Append:

```typescript
import { SidechainBus } from './sidechain-bus';

describe('ChannelStrip sidechain tap registration', () => {
  let ctx: AudioContext;

  beforeAll(() => {
    ctx = new AudioContext();
  });

  it('registers itself with the bus on construction when a busId is given', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'bass', label: 'BASS' },
    });
    expect(bus.getTap('bass')).toBe(strip.sidechainTap);
  });

  it('dispose() unregisters the lane id from the bus', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'temp', label: 'TEMP' },
    });
    expect(bus.getTap('temp')).not.toBeNull();
    strip.dispose();
    expect(bus.getTap('temp')).toBeNull();
  });

  it('omitting the sidechain option leaves the strip un-registered (backward-compat)', () => {
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);
    new ChannelStrip(ctx, ctx.destination, fx);
    expect(bus.listSources()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`

Expected: FAIL — `sidechainTap` undefined, constructor doesn't accept options.

- [ ] **Step 3: Modify `src/core/fx.ts`** — add tap node + optional constructor options + dispose

Import:

```typescript
import { SidechainBus } from './sidechain-bus';
```

Add a new options interface near `ChannelState`:

```typescript
export interface ChannelStripOptions {
  sidechain?: { bus: SidechainBus; id: string; label: string };
}
```

Add fields to `ChannelStrip`:

```typescript
  sidechainTap: GainNode;
  private busRegistration: { bus: SidechainBus; id: string } | null = null;
```

Update the constructor signature:

```typescript
  constructor(
    ctx: AudioContext,
    dry: AudioNode,
    fx: FxBus,
    opts: ChannelStripOptions = {},
  ) {
```

Inside the constructor, **after** the existing wiring block, add:

```typescript
    // Post-mute fan-out tap for sidechain consumers. Connected to the same
    // signal that feeds master + sends, so muted lanes contribute nothing.
    this.sidechainTap = ctx.createGain();
    this.muteGain.connect(this.sidechainTap);

    if (opts.sidechain) {
      opts.sidechain.bus.register(opts.sidechain.id, this.sidechainTap, opts.sidechain.label);
      this.busRegistration = { bus: opts.sidechain.bus, id: opts.sidechain.id };
    }
```

Add a `dispose` method on `ChannelStrip`:

```typescript
  dispose(): void {
    if (this.busRegistration) {
      this.busRegistration.bus.unregister(this.busRegistration.id);
      this.busRegistration = null;
    }
    try { this.sidechainTap.disconnect(); } catch { /* */ }
  }
```

- [ ] **Step 4: Run tests; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`

Expected: PASS (all prior + 3 new sidechain-bus tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/fx.ts src/core/fx.test.ts
git commit -m "feat(fx): ChannelStrip sidechain tap + optional SidechainBus registration"
```

---

### Task 7: `ChannelStrip` ducker — `setSidechain(state | null)` builds/tears down the subgraph

**Files:**

- Modify: `src/core/fx.ts`
- Create: `src/core/strip-ducker.dsp.test.ts`

- [ ] **Step 1: Write the failing DSP test**

Create `src/core/strip-ducker.dsp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { ChannelStrip, FxBus } from './fx';
import { SidechainBus } from './sidechain-bus';

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  const n = to - from;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

describe('ChannelStrip ducker integration', () => {
  it('a target strip ducks when sidechain.source = source lane id', async () => {
    const sr = 44100;
    const dur = 1.0;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);

    // Source strip: registers itself as 'kick'.
    const sourceStrip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'kick', label: 'KICK' },
    });
    // Target strip: registers as 'lead'.
    const targetStrip = new ChannelStrip(ctx, ctx.destination, fx, {
      sidechain: { bus, id: 'lead', label: 'LEAD' },
    });
    targetStrip.setSidechain(bus, {
      source: 'kick', depth: 0.85, attack: 0.003, release: 0.06, threshold: -60,
    });

    // Target sound: steady 440Hz sine into target strip.
    const target = ctx.createOscillator();
    target.frequency.value = 440;
    target.connect(targetStrip.input);
    target.start(0);
    target.stop(dur);

    // Source signal: full-scale noise burst t=0.2..0.4.
    const sb = ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const sd = sb.getChannelData(0);
    for (let i = Math.floor(sr * 0.2); i < Math.floor(sr * 0.4); i++) {
      sd[i] = (Math.random() * 2 - 1) * 0.9;
    }
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = sb;
    sourceNode.connect(sourceStrip.input);
    sourceNode.start(0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);

    const duckedRms = rms(data, Math.floor(sr * 0.25), Math.floor(sr * 0.38));
    const cleanRms  = rms(data, Math.floor(sr * 0.05), Math.floor(sr * 0.18));
    expect(duckedRms / cleanRms).toBeLessThan(0.9);
  });

  it('setSidechain(bus, null) tears the ducker down — no further reduction', async () => {
    const sr = 44100;
    const dur = 0.5;
    const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const bus = new SidechainBus();
    const fx = new FxBus(ctx, ctx.destination);

    new ChannelStrip(ctx, ctx.destination, fx, { sidechain: { bus, id: 'kick', label: 'KICK' } });
    const targetStrip = new ChannelStrip(ctx, ctx.destination, fx, { sidechain: { bus, id: 'lead', label: 'LEAD' } });
    targetStrip.setSidechain(bus, { source: 'kick', depth: 0.9, attack: 0.003, release: 0.06, threshold: -60 });
    targetStrip.setSidechain(bus, null);

    const target = ctx.createOscillator();
    target.frequency.value = 440;
    target.connect(targetStrip.input);
    target.start(0);
    target.stop(dur);

    const rendered = await ctx.startRendering();
    expect(rms(rendered.getChannelData(0), 0, rendered.length)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run test; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/strip-ducker.dsp.test.ts`

Expected: FAIL — `setSidechain` does not exist.

- [ ] **Step 3: Modify `src/core/fx.ts`** — add `duckGain` + `setSidechain` + serialize/restore

Import the `DuckerSubgraph`:

```typescript
import { DuckerSubgraph } from './ducker-subgraph';
```

Add private fields on `ChannelStrip`:

```typescript
  private duckGain: GainNode;
  private ducker: DuckerSubgraph | null = null;
  private sidechainState: SidechainState | null = null;
```

In the constructor, **change the post-mute wiring**. Replace:

```typescript
    this.muteGain.connect(dry);
    this.muteGain.connect(this.reverbSend).connect(fx.reverbInput);
    this.muteGain.connect(this.delaySend ).connect(fx.delayInput);
```

with:

```typescript
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1; // base; subgraph rewires when active
    this.muteGain.connect(this.duckGain);
    this.duckGain.connect(dry);
    this.duckGain.connect(this.reverbSend).connect(fx.reverbInput);
    this.duckGain.connect(this.delaySend ).connect(fx.delayInput);
```

And move the sidechain tap connection to read from `muteGain` (already correct from Task 6 — leave it).

Add `setSidechain`:

```typescript
  setSidechain(bus: SidechainBus, state: SidechainState | null): void {
    if (this.ducker) {
      this.ducker.dispose();
      this.ducker = null;
      // Restore base value the subgraph stomped on:
      this.duckGain.gain.value = 1;
    }
    this.sidechainState = state;
    if (!state || !state.source) return;
    const sourceTap = bus.getTap(state.source);
    if (!sourceTap) {
      // Unknown source lane — leave the ducker disabled but keep the state
      // (it'll come online if the source registers later; caller re-applies).
      return;
    }
    this.ducker = new DuckerSubgraph(this.ctx, {
      sourceTap, duckGain: this.duckGain, state,
    });
  }

  getSidechain(): SidechainState | null { return this.sidechainState; }
```

You'll need to make `ctx` accessible. Change the constructor to capture it:

```typescript
  constructor(
    private ctx: AudioContext,
    dry: AudioNode,
    fx: FxBus,
    opts: ChannelStripOptions = {},
  ) {
```

Extend `serialize` to include the actual state:

```typescript
      sidechain: this.sidechainState ? { ...this.sidechainState } : null,
```

Extend `restore` to apply the sidechain. The restorer needs a bus reference, so add an overload — but to keep the existing call sites green, accept the bus as an **optional** field on `ChannelStripOptions` and stash it. Add to `ChannelStripOptions`:

```typescript
export interface ChannelStripOptions {
  sidechain?: { bus: SidechainBus; id: string; label: string };
}
```

(unchanged from Task 6). Store the bus on the strip:

```typescript
  private bus: SidechainBus | null = null;
```

Set it in the constructor:

```typescript
    if (opts.sidechain) {
      this.bus = opts.sidechain.bus;
      opts.sidechain.bus.register(opts.sidechain.id, this.sidechainTap, opts.sidechain.label);
      this.busRegistration = { bus: opts.sidechain.bus, id: opts.sidechain.id };
    }
```

Then in `restore`:

```typescript
    const sc = withSidechainDefaultsOrNull(s.sidechain);
    if (this.bus) this.setSidechain(this.bus, sc);
```

Update `dispose()` so an active ducker subgraph is torn down when the strip itself is disposed (relevant for dynamic lanes removed at runtime):

```typescript
  dispose(): void {
    if (this.ducker) {
      this.ducker.dispose();
      this.ducker = null;
    }
    if (this.busRegistration) {
      this.busRegistration.bus.unregister(this.busRegistration.id);
      this.busRegistration = null;
    }
    try { this.sidechainTap.disconnect(); } catch { /* */ }
  }
```

- [ ] **Step 4: Run tests; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/strip-ducker.dsp.test.ts src/core/fx.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full fast suite**

Run: `npm run test:fast`

Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/core/fx.ts src/core/strip-ducker.dsp.test.ts
git commit -m "feat(fx): ChannelStrip ducker — setSidechain wires DuckerSubgraph"
```

---

## Phase D — Master compressor

### Task 8: `MasterCompressor` class + DSP test

**Files:**

- Modify: `src/core/fx.ts` (add `MasterCompressor` at the bottom, next to `FilterChain`)
- Create: `src/core/master-comp.dsp.test.ts`

- [ ] **Step 1: Write the failing DSP test**

Create `src/core/master-comp.dsp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { MasterCompressor } from './fx';

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

describe('MasterCompressor DSP', () => {
  it('inserted between source and destination, reduces RMS vs bypass', async () => {
    async function render(active: boolean): Promise<number> {
      const sr = 44100;
      const dur = 0.5;
      const ctx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      amp.gain.value = 0.95;
      osc.frequency.value = 440;
      const mc = new MasterCompressor(ctx);
      mc.setState({ bypass: !active, threshold: -30, ratio: 8, attack: 0.001, release: 0.1, knee: 0, makeup: 1 });
      osc.connect(amp).connect(mc.input);
      mc.output.connect(ctx.destination);
      osc.start(0); osc.stop(dur);
      const r = await ctx.startRendering();
      return rms(r.getChannelData(0));
    }
    const bypassed = await render(false);
    const active   = await render(true);
    expect(active / bypassed).toBeLessThan(0.85);
  });
});
```

- [ ] **Step 2: Run test; expect failure**

Run: `NO_COLOR=1 npx vitest run src/core/master-comp.dsp.test.ts`

Expected: FAIL — `MasterCompressor` is not exported from `./fx`.

- [ ] **Step 3: Append `MasterCompressor` to `src/core/fx.ts`**

```typescript
// ── Master compressor ────────────────────────────────────────────────────
// A thin wrapper around CompBlock used at the tail of the master chain.
// Stored separately from FilterChain so the FX page UI can address them
// independently and so bypass/serialize remain isolated.

export class MasterCompressor {
  private block: CompBlock;

  constructor(ctx: BaseAudioContext, initial?: Partial<CompState>) {
    this.block = new CompBlock(ctx, initial);
  }

  get input(): AudioNode  { return this.block.input; }
  get output(): AudioNode { return this.block.output; }

  setState(s: Partial<CompState>) { this.block.setState(s); }
  getState(): CompState           { return this.block.getState(); }
  getReduction(): number          { return this.block.getReduction(); }
}
```

- [ ] **Step 4: Run test; expect green**

Run: `NO_COLOR=1 npx vitest run src/core/master-comp.dsp.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/fx.ts src/core/master-comp.dsp.test.ts
git commit -m "feat(fx): MasterCompressor — CompBlock wrapper for the master bus"
```

---

### Task 9: Wire master compressor into `main.ts`

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Locate the current master wiring**

Find lines around `src/main.ts:108-114`:

```typescript
const ctx = new AudioContext();
const master = ctx.createGain();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(ctx.destination);
const filterChain = new FilterChain(ctx, master, analyser);
```

- [ ] **Step 2: Insert the master compressor between `filterChain` and `analyser`**

Replace the block with:

```typescript
const ctx = new AudioContext();
const master = ctx.createGain();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
analyser.connect(ctx.destination);
const masterComp = new MasterCompressor(ctx);
masterComp.output.connect(analyser);
// FilterChain wires master → (filters) → masterComp.input.
const filterChain = new FilterChain(ctx, master, masterComp.input);
```

Update the import:

```typescript
import { FxBus, ChannelStrip, FilterChain, MasterCompressor } from './core/fx';
```

- [ ] **Step 3: Smoke-build to confirm no broken references**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 4: Run full fast suite**

Run: `npm run test:fast`

Expected: 0 failures (no test asserts on the master chain shape; the existing audio renders still work).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): mount MasterCompressor between FilterChain and analyser"
```

---

## Phase E — UI

### Task 10: Mixer column gains `COMP` + `SC` sections

**Files:**

- Modify: `src/core/mixer.ts`

- [ ] **Step 1: Extend `MixerColumnDeps` with the bus**

Add a `sidechainBus` field to `MixerColumnDeps`:

```typescript
export interface MixerColumnDeps {
  stripFor:      (trackId: string) => ChannelStrip;
  label:         (trackId: string) => string;
  muteState:     Record<string, boolean>;
  soloState:     Record<string, boolean>;
  applyMuteSolo: () => void;
  registerKnob:  (k: KnobHandle) => void;
  sidechainBus:  import('./sidechain-bus').SidechainBus;
  historyDeps?:  HistoryDeps;
}
```

- [ ] **Step 2: Append COMP + SC section builders**

First add the two new imports at the **top of `src/core/mixer.ts`** alongside the existing imports (NOT inside the function block):

```typescript
import { createSelectControl } from './select-control';
import type { CompState, SidechainState } from './comp-state';
```

Then at the bottom of `src/core/mixer.ts`, add the helper functions:

```typescript

const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;

function buildCompSection(
  trackId: string,
  strip: ChannelStrip,
  deps: MixerColumnDeps,
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'mix-section mix-comp';
  const lab = document.createElement('div');
  lab.className = 'mix-sec-label';
  lab.textContent = 'COMP';
  sec.appendChild(lab);

  const initial: CompState = strip.getCompState();
  const color = '#1abc9c';

  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.thr`, label: 'THR', min: -60, max: 0, step: 0.5,
    value: initial.threshold, defaultValue: -24, color, format: fmtDb,
    onChange: (v) => strip.setCompState({ threshold: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.rat`, label: 'RAT', min: 1, max: 20, step: 0.1,
    value: initial.ratio, defaultValue: 4, color, format: fmtRatio,
    onChange: (v) => strip.setCompState({ ratio: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.atk`, label: 'ATK', min: 0.001, max: 1, step: 0.001,
    value: initial.attack, defaultValue: 0.003, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => strip.setCompState({ attack: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.rel`, label: 'REL', min: 0.001, max: 1, step: 0.001,
    value: initial.release, defaultValue: 0.25, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => strip.setCompState({ release: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.knee`, label: 'KNEE', min: 0, max: 40, step: 0.5,
    value: initial.knee, defaultValue: 30, color, format: fmtDb,
    onChange: (v) => strip.setCompState({ knee: v }),
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.comp.mkup`, label: 'MKUP', min: 0, max: 4, step: 0.01,
    value: initial.makeup, defaultValue: 1, color, format: (v) => `${v.toFixed(2)}×`,
    onChange: (v) => strip.setCompState({ makeup: v }),
  });

  const byp = document.createElement('button');
  byp.className = 'mix-btn comp-bypass';
  byp.textContent = 'BYP';
  byp.classList.toggle('active', initial.bypass);
  byp.addEventListener('click', () => {
    const next = !strip.getCompState().bypass;
    strip.setCompState({ bypass: next });
    byp.classList.toggle('active', next);
  });
  sec.appendChild(byp);

  return sec;
}

function buildSidechainSection(
  trackId: string,
  strip: ChannelStrip,
  deps: MixerColumnDeps,
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'mix-section mix-sidechain';
  const lab = document.createElement('div');
  lab.className = 'mix-sec-label';
  lab.textContent = 'SC';
  sec.appendChild(lab);

  const color = '#e74c3c';
  const current = (): SidechainState | null => strip.getSidechain();

  const buildOptions = () => [
    { value: '', label: 'off' },
    ...deps.sidechainBus.listSources(trackId).map((s) => ({ value: s.id, label: s.label })),
  ];

  const initialSrc = current()?.source ?? '';
  const sel = createSelectControl({
    id: `mix.${trackId}.sc.src`,
    label: 'SRC',
    options: buildOptions(),
    initialValue: initialSrc,
    onChange: (v) => {
      const cur = current() ?? { source: '', depth: 0.6, attack: 0.005, release: 0.25, threshold: -40 };
      if (v === '') strip.setSidechain(deps.sidechainBus, null);
      else          strip.setSidechain(deps.sidechainBus, { ...cur, source: v });
    },
  });
  sec.appendChild(sel.el);
  deps.registerKnob(sel.handle);

  // Subscribe to bus changes so newly-registered lanes show up live.
  deps.sidechainBus.subscribe(() => {
    // Rebuild the dropdown in place. The radio-strip variant rebuilds in
    // createSelectControl; native select is mutable.
    const newOpts = buildOptions();
    const nativeSel = sel.el as HTMLSelectElement;
    if (nativeSel.tagName === 'SELECT') {
      const keep = nativeSel.value;
      nativeSel.innerHTML = '';
      for (const o of newOpts) {
        const optEl = document.createElement('option');
        optEl.value = o.value;
        optEl.textContent = o.label;
        nativeSel.appendChild(optEl);
      }
      nativeSel.value = newOpts.some((o) => o.value === keep) ? keep : '';
    }
  });

  addKnob(sec, deps, {
    id: `mix.${trackId}.sc.depth`, label: 'DEPTH', min: 0, max: 1, step: 0.01,
    value: current()?.depth ?? 0.6, defaultValue: 0.6, color, format: fmtPct,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, depth: v });
    },
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.sc.atk`, label: 'ATK', min: 0.001, max: 0.5, step: 0.001,
    value: current()?.attack ?? 0.005, defaultValue: 0.005, color,
    format: (v) => `${Math.round(v * 1000)}ms`,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, attack: v });
    },
  });
  addKnob(sec, deps, {
    id: `mix.${trackId}.sc.rel`, label: 'REL', min: 0.005, max: 1, step: 0.005,
    value: current()?.release ?? 0.25, defaultValue: 0.25, color,
    format: (v) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => {
      const cur = current(); if (!cur) return;
      strip.setSidechain(deps.sidechainBus, { ...cur, release: v });
    },
  });

  return sec;
}
```

- [ ] **Step 3: Insert the new sections into `buildMixerColumn`**

In `buildMixerColumn`, between the existing `sendSec` block (around lines 88-105) and the `panSec` block, add:

```typescript
  col.appendChild(buildCompSection(trackId, strip, deps));
  col.appendChild(buildSidechainSection(trackId, strip, deps));
```

- [ ] **Step 4: Typecheck and run the full fast suite**

Run: `npx tsc --noEmit && npm run test:fast`

Expected: 0 errors, 0 failures. Existing mixer tests still pass because `buildMixerColumn`'s call sites need to supply a `sidechainBus` — fix any failures by adding `sidechainBus: new SidechainBus()` to test fixtures. The known fixture is `src/session/session-host-presets.test.ts:32` (`mixerDeps: {} as never`) — this should keep compiling as-is because of the `{} as never` cast.

- [ ] **Step 5: Commit**

```bash
git add src/core/mixer.ts
git commit -m "feat(mixer): COMP + SC sections in per-lane mixer column"
```

---

### Task 11: Master compressor UI on the FX page

**Files:**

- Modify: `index.html`
- Modify: `src/core/fx-ui.ts`

- [ ] **Step 1: Add the DOM mount in `index.html`**

Find the FX page section around line 256:

```html
      <div class="page" data-page="fx" hidden>
        <div class="row poly-section">
          <div class="section-label">REVERB</div>
          <div id="fx-reverb-knobs" class="knob-row"></div>
        </div>
```

Insert a new section just before `MASTER FILTERS`:

```html
        <div class="row poly-section">
          <div class="section-label">MASTER COMP</div>
          <div id="fx-master-comp-knobs" class="knob-row"></div>
        </div>
```

- [ ] **Step 2: Extend `FxUIDeps`** in `src/core/fx-ui.ts`

Add a field:

```typescript
export interface FxUIDeps {
  // ...existing fields...
  masterComp: import('./fx').MasterCompressor;
}
```

- [ ] **Step 3: Build the master-comp knob row in `wireFxUI`**

At the end of `wireFxUI`, after the existing reverb/delay blocks, before the `fx-add-filter` button wiring, add:

```typescript
  const mcRow = document.getElementById('fx-master-comp-knobs') as HTMLDivElement;
  const mcColor = '#1abc9c';
  const fmtDbSigned = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
  const mc = deps.masterComp;
  const init = mc.getState();

  appendKnob(mcRow, { id: 'fx.mcomp.thr',  min: -60, max: 0,  step: 0.5,   value: init.threshold, defaultValue: -24,
    label: 'THR',  color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ threshold: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.rat',  min: 1,   max: 20, step: 0.1,   value: init.ratio,     defaultValue: 4,
    label: 'RAT',  color: mcColor, size: SIZE, format: fmtRatio,
    onChange: (v) => mc.setState({ ratio: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.atk',  min: 0.001, max: 1, step: 0.001, value: init.attack,   defaultValue: 0.003,
    label: 'ATK',  color: mcColor, size: SIZE, format: (v) => v < 1 ? `${Math.round(v*1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => mc.setState({ attack: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.rel',  min: 0.001, max: 1, step: 0.001, value: init.release,  defaultValue: 0.25,
    label: 'REL',  color: mcColor, size: SIZE, format: (v) => v < 1 ? `${Math.round(v*1000)}ms` : `${v.toFixed(2)}s`,
    onChange: (v) => mc.setState({ release: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.knee', min: 0,   max: 40, step: 0.5,   value: init.knee,     defaultValue: 30,
    label: 'KNEE', color: mcColor, size: SIZE, format: fmtDbSigned,
    onChange: (v) => mc.setState({ knee: v }) }, deps.registerKnob, undoHooks);
  appendKnob(mcRow, { id: 'fx.mcomp.mkup', min: 0,   max: 4,  step: 0.01,  value: init.makeup,   defaultValue: 1,
    label: 'MKUP', color: mcColor, size: SIZE, format: (v) => `${v.toFixed(2)}×`,
    onChange: (v) => mc.setState({ makeup: v }) }, deps.registerKnob, undoHooks);

  const mcByp = document.createElement('button');
  mcByp.className = 'rnd master-comp-bypass';
  mcByp.textContent = 'BYP';
  mcByp.classList.toggle('active', init.bypass);
  mcByp.addEventListener('click', () => {
    const next = !mc.getState().bypass;
    mc.setState({ bypass: next });
    mcByp.classList.toggle('active', next);
  });
  mcRow.appendChild(mcByp);
```

- [ ] **Step 4: Pass `masterComp` into `wireFxUI` at the call site in `src/main.ts`**

Find the `wireFxUI({ ... })` call in `src/main.ts` and add:

```typescript
masterComp,
```

to the dependency object.

- [ ] **Step 5: Typecheck + fast suite**

Run: `npx tsc --noEmit && npm run test:fast`

Expected: 0 errors, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add index.html src/core/fx-ui.ts src/main.ts
git commit -m "feat(fx-ui): master compressor section on FX page"
```

---

### Task 12: Wire `SidechainBus` into every strip-creation site in `main.ts`

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Import and construct the `SidechainBus` BEFORE the strip constructions**

Add the import alongside the other `./core/...` imports at the top of `main.ts`:

```typescript
import { SidechainBus } from './core/sidechain-bus';
```

Then, in the audio-graph init block, declare `sidechainBus` **after `fx` is created and before any `ChannelStrip` is constructed** (around line 117, between the `new FxBus(...)` line and the existing `const bassStrip = ...` line):

```typescript
const sidechainBus = new SidechainBus();
```

Order matters: every `ChannelStrip` constructor in Step 2 references `sidechainBus`, so it must already be in scope.

- [ ] **Step 2: Replace the three core `ChannelStrip` constructions**

Find lines 118-122:

```typescript
const bassStrip = new ChannelStrip(ctx, master, fx);
const polyStrip = new ChannelStrip(ctx, master, fx);
const drumBusStrip = new ChannelStrip(ctx, master, fx);
```

Replace with:

```typescript
const bassStrip    = new ChannelStrip(ctx, master, fx, { sidechain: { bus: sidechainBus, id: 'bass',    label: 'BASS' } });
const polyStrip    = new ChannelStrip(ctx, master, fx, { sidechain: { bus: sidechainBus, id: 'poly',    label: 'POLY' } });
const drumBusStrip = new ChannelStrip(ctx, master, fx, { sidechain: { bus: sidechainBus, id: 'drumBus', label: 'DRUMS' } });
```

- [ ] **Step 3: Update `ensureLaneStrip` and `ensureExtraPolyStrip` and the dynamic helper**

Find every other `new ChannelStrip(ctx, master, fx)` call (around lines 167, 410, 435 — use Grep to find them all):

Run: `Grep` for `new ChannelStrip(ctx, master, fx)` in `src/main.ts` to list every occurrence.

For each, derive a stable lane id and label and pass it via the `sidechain` option. For dynamically-created lanes, the lane id is already available at the call site (`laneId`, `extraId`, etc.); use it directly. For the label, use the human-readable lane name (`labelForLane(laneId)` or the existing fallback).

Example for `ensureLaneStrip` (line ~410):

```typescript
s = new ChannelStrip(ctx, master, fx, {
  sidechain: { bus: sidechainBus, id: laneId, label: labelForLane(laneId) ?? laneId.toUpperCase() },
});
```

If `labelForLane` does not exist, use `laneId.toUpperCase()` as a fallback label inline.

- [ ] **Step 4: Pass `sidechainBus` into `mixerDeps`**

Find where `mixerDeps` is constructed in `main.ts` (it's the object that goes to `SessionHostDeps.mixerDeps` and to direct `buildMixerColumn` callers). Add:

```typescript
sidechainBus,
```

to that object.

- [ ] **Step 5: Typecheck + fast suite + DSP suite**

Run: `npx tsc --noEmit && npm run test:fast && npm run test:dsp`

Expected: 0 errors, 0 failures.

- [ ] **Step 6: Manual smoke test in the browser**

Run: `npm run dev`

Open `http://localhost:5173`. Verify:
- Mixer columns show COMP and SC sections under each lane.
- Setting COMP `BYP` off + lowering threshold on a loud lane audibly reduces level.
- On the poly lane, setting SC source = `drumBus` and depth = 0.7 makes the poly pump when the drums play.
- The FX page shows MASTER COMP knobs; toggling `BYP` audibly changes the master.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): register every ChannelStrip with the global SidechainBus"
```

---

## Phase F — Final integration check

### Task 13: Rebase onto main, run the full test suite, verify no regressions

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean**

Run: `git status`

Expected: clean.

- [ ] **Step 2: Fetch + rebase onto current `main`**

Run: `git fetch origin 2>/dev/null; git rebase main`

(There is no `origin` remote in this repo as of HEAD; the `git fetch` is a no-op when not configured — the rebase against local `main` is the load-bearing step. See [[feedback-worktree-and-rebase]].)

Expected: clean rebase, or guided conflict resolution.

- [ ] **Step 3: Full suite**

Run: `npm test`

Expected: all unit + DSP + Playwright e2e tests pass.

- [ ] **Step 4: Audible sanity sweep**

Run: `npm run dev` and walk through:
- A demo session at default settings should sound identical to pre-feature behavior (everything bypassed/off by default).
- Enabling comp on bass with `RAT=8, THR=-30` audibly tames hot peaks.
- Setting poly SC source to `drumBus` with `DEPTH=0.7` produces a clean kick-pump on the poly lane.
- Master comp `BYP` toggle on the FX page audibly compresses the full mix when active.

- [ ] **Step 5: Hand off**

The branch is ready to merge to `main`. Per [[feedback-worktree-and-rebase]], the rebase in Step 2 was unconditional. Use `superpowers:finishing-a-development-branch` or merge directly.

---

## Risks called out for the implementer

- **Web Audio's `disconnect()` with no args** disconnects from everything — so `comp.disconnect()` inside `CompBlock.rewire()` will detach both the input and output sides on subsequent calls. The current code wraps these in try/catch and re-connects from scratch on every bypass change. Do not optimize this away.
- **`ConstantSourceNode.start()` is one-shot.** A second `start()` throws. `DuckerSubgraph.dispose()` calls `stop()`; if the strip rebuilds the ducker (calling `setSidechain` repeatedly), `dispose()` is followed by constructing a new subgraph — never reusing the old `ConstantSourceNode`.
- **`disconnect(AudioParam)` is not universally supported on the node-web-audio-api shim.** `DuckerSubgraph.dispose()` disconnects each node individually rather than calling `disconnect(duckGain.gain)` — fall back to `disconnect()` on the source side, as the implementation does.
- **The `select-control` radio strip variant has ≤ 4 options.** The SC source dropdown will almost always have > 4 options (bass, poly, drumBus, plus dynamic extras), so the implementation in Task 10 only re-mutates the native `<select>` variant on bus change. If `listSources` ever returns ≤ 4, the strip rebuild path won't trigger — acceptable for v1.
- **`ChannelStrip.restore()` resolves sidechain on the bus stored at construction time.** If a strip is constructed without a `sidechain` option (legacy test fixtures), `restore()` is a no-op for the sidechain field. That's correct — those strips have no tap registered and can't be referenced as sources anyway.
