# Unified FX + Send A/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote reverb/delay from privileged hard-wired sends to two generic preconfigured send buses (Send A = Delay, Send B = Reverb), make every FX insertable on any rack (lane incl. audio / send / master), and add Compressor + Limiter insert plugins.

**Architecture:** A new lean `SendBus` (input → `InsertChain` → return level → master, with mute) is the unit of the send model. `FxBus` is repurposed (name kept to bound blast radius) into a 2-entry send bank holding `SendBus[]`; it keeps `reverbInput`/`delayInput` as aliases for the two seeded bus inputs so `ChannelStrip` and `DrumMachine` per-voice sends keep working. Reverb/delay become ordinary inserts living inside the send chains. New `SessionState.sends` persists the buses; a load-time migration seeds the two default buses and remaps old per-lane `rev`/`dly` send amounts to `sendA`/`sendB`. UI: mixer SEND knobs become A/B; the FX page renders two return modules each reusing the existing `buildLaneInsertUI` rack.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (+ `node-web-audio-api` for DSP), Playwright (e2e). Plugins are auto-discovered by `import.meta.glob` — dropping a file in `src/plugins/fx/` is the only registration step.

## Global Constraints

- **Test assertions are always relative** (ratios `>`, `<`, `* 2`), never absolute magnitudes. If an absolute threshold is unavoidable, justify it in a comment.
- **All UI text/labels in English** (the app is English; Spanish is conversation-only).
- **Run unit tests colour-free:** `NO_COLOR=1 npx vitest run <file>`. Never add `--reporter=`.
- **`test:unit` may exit non-zero with `ERR_IPC_CHANNEL_CLOSED` on teardown after all tests pass** — that is not a failure; re-run to confirm.
- **e2e serves `dist/` with no build step** — always `npm run build` before `npm run test:e2e`.
- **Plugins auto-register** via `import.meta.glob` over `src/plugins/**/*.ts` (test files excluded). A new FX file needs no edit to `plugin-bootstrap.ts`. Tests that rely on a plugin must `registerPlugin(...)` it explicitly after `_resetRegistry()`.
- **Vitest runs files serially** (`node-web-audio-api` is unsafe under parallel forks).
- Work happens in worktree `.claude/worktrees/unified-fx-sends` on branch `worktree-unified-fx-sends`. Commit freely; rebase onto `main` often.

---

## File Structure

**Create:**
- `src/plugins/fx/compressor.ts` — Compressor FX plugin (DynamicsCompressor + makeup).
- `src/plugins/fx/compressor.test.ts` — unit + DSP test.
- `src/plugins/fx/limiter.ts` — brickwall Limiter FX plugin.
- `src/plugins/fx/limiter.test.ts` — unit + DSP test.
- `src/core/send-bus.ts` — `SendBus` class + `SendBusState` type.
- `src/core/send-bus.test.ts` — wiring test.
- `src/core/send-migration.ts` — pure helpers: seed default sends, remap per-lane send amounts.
- `src/core/send-migration.test.ts` — migration unit tests.

**Modify:**
- `src/core/fx.ts` — repurpose `FxBus` into a 2-send bank; rename `ChannelStrip` sends to `sendA`/`sendB`; delete dead `FilterChain`/`MasterFilter` (Task 12).
- `src/core/fx.test.ts` — update for the reworked `FxBus`/`ChannelStrip`.
- `src/plugins/fx/delay.ts` — add `sync` param + `setBpm`.
- `src/plugins/fx/insert-chain.ts` — add `setBpm(bpm)` forwarding.
- `src/app/audio-graph.ts` — hold `sends` on the graph; rehydrate from session.
- `src/app/bpm-broadcast.ts` — broadcast bpm to all insert chains (lane/send/master).
- `src/session/session.ts` — add `SessionState.sends?: SendBusState[]`.
- `src/session/session-migration.ts` — seed default sends + remap per-lane send amounts.
- `src/session/session-host-persistence.ts` — rehydrate `sends` insert chains on load.
- `src/session/lane-insert-ui.ts` — drop `SEND_ONLY_IN_PHASE_1`.
- `src/core/mixer.ts` — REV/DLY knobs → A/B.
- `src/core/fx-ui.ts` — two Send return modules replacing reverb/delay rows.
- `src/modulation/modulation-ui.ts` — send param destinations from send insert chains.
- `src/save/saved-state-v3.ts` — serialize/restore `sends`.

---

## Phase 1 — Dynamics insert plugins

### Task 1: Compressor FX plugin

**Files:**
- Create: `src/plugins/fx/compressor.ts`
- Test: `src/plugins/fx/compressor.test.ts`

**Interfaces:**
- Produces: `export const compressorPlugin: PluginFactory` (kind `'fx'`, manifest id `'compressor'`, name `'Compressor'`). Params (all `continuous` except none): `threshold` (-60..0 dB, default -24), `ratio` (1..20, default 4), `attack` (0.001..1 s, default 0.003), `release` (0.001..1 s, default 0.25), `knee` (0..40 dB, default 30), `makeup` (0..4 linear, default 1). `FxInstance` exposes AudioParams `threshold/ratio/attack/release/knee/makeup` (makeup = the makeup gain's `.gain`).
- Consumes: `FxInstance`, `PluginFactory` from `../types`.

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/fx/compressor.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { compressorPlugin } from './compressor';

describe('compressor plugin', () => {
  it('has fx manifest with the documented params', () => {
    expect(compressorPlugin.kind).toBe('fx');
    expect(compressorPlugin.manifest.id).toBe('compressor');
    const ids = compressorPlugin.manifest.params.map((p) => p.id).sort();
    expect(ids).toEqual(['attack', 'knee', 'makeup', 'ratio', 'release', 'threshold']);
  });

  it('exposes its params as AudioParams and round-trips base values', () => {
    const ctx = new AudioContext();
    const inst = compressorPlugin.kind === 'fx' ? compressorPlugin.create(ctx) : null!;
    inst.setBaseValue('ratio', 8);
    expect(inst.getBaseValue('ratio')).toBeCloseTo(8, 3);
    expect(inst.getAudioParams().has('threshold')).toBe(true);
    expect(inst.getAudioParams().has('makeup')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/compressor.test.ts`
Expected: FAIL — cannot find module `./compressor`.

- [ ] **Step 3: Write the plugin**

```ts
// src/plugins/fx/compressor.ts
import type { FxInstance, PluginFactory } from '../types';

export const compressorPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'compressor',
    name: 'Compressor',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'threshold', label: 'Thr',   kind: 'continuous', min: -60,    max: 0,  default: -24, unit: 'dB' },
      { id: 'ratio',     label: 'Ratio', kind: 'continuous', min: 1,      max: 20, default: 4 },
      { id: 'attack',    label: 'Atk',   kind: 'continuous', min: 0.001,  max: 1,  default: 0.003, unit: 's' },
      { id: 'release',   label: 'Rel',   kind: 'continuous', min: 0.001,  max: 1,  default: 0.25,  unit: 's' },
      { id: 'knee',      label: 'Knee',  kind: 'continuous', min: 0,      max: 40, default: 30, unit: 'dB' },
      { id: 'makeup',    label: 'Mkup',  kind: 'continuous', min: 0,      max: 4,  default: 1 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const comp   = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    const output = ctx.createGain();
    comp.threshold.value = -24;
    comp.ratio.value     = 4;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.25;
    comp.knee.value      = 30;
    makeup.gain.value    = 1;
    input.connect(comp).connect(makeup).connect(output);

    const params = new Map<string, AudioParam>([
      ['threshold', comp.threshold],
      ['ratio',     comp.ratio],
      ['attack',    comp.attack],
      ['release',   comp.release],
      ['knee',      comp.knee],
      ['makeup',    makeup.gain],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => params.get(id)?.value ?? 0,
      setBaseValue: (id, v) => { const p = params.get(id); if (p) p.value = v; },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); comp.disconnect(); makeup.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/compressor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a DSP gain-reduction test**

Append to `src/plugins/fx/compressor.test.ts`:

```ts
import { describe as describe2 } from 'vitest';

describe2('compressor DSP', () => {
  it('reduces peak of a hot signal vs an uncompressed copy (relative)', async () => {
    const sr = 44100;
    const render = async (compress: boolean) => {
      const ctx = new OfflineAudioContext(1, sr, sr);
      const osc = ctx.createOscillator();
      const drive = ctx.createGain();
      drive.gain.value = 4; // hot input well above threshold
      osc.frequency.value = 200;
      let tail: AudioNode = drive;
      osc.connect(drive);
      if (compress) {
        const inst = compressorPlugin.kind === 'fx' ? compressorPlugin.create(ctx as unknown as AudioContext) : null!;
        inst.setBaseValue('threshold', -30);
        inst.setBaseValue('ratio', 20);
        inst.setBaseValue('makeup', 1);
        drive.connect(inst.input);
        tail = inst.output;
      }
      tail.connect(ctx.destination);
      osc.start();
      const buf = await ctx.startRendering();
      let peak = 0;
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      return peak;
    };
    const [dry, wet] = await Promise.all([render(false), render(true)]);
    expect(wet).toBeLessThan(dry);
  });
});
```

- [ ] **Step 6: Run the DSP test**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/compressor.test.ts`
Expected: PASS (3 tests). (`OfflineAudioContext`/`AudioContext` are globalized via `test/setup.ts`.)

- [ ] **Step 7: Commit**

```bash
git add src/plugins/fx/compressor.ts src/plugins/fx/compressor.test.ts
git commit -m "feat(fx): insertable Compressor plugin"
```

### Task 2: Limiter FX plugin

**Files:**
- Create: `src/plugins/fx/limiter.ts`
- Test: `src/plugins/fx/limiter.test.ts`

**Interfaces:**
- Produces: `export const limiterPlugin: PluginFactory` (kind `'fx'`, id `'limiter'`, name `'Limiter'`). Params: `ceiling` (-30..0 dB, default -1) → DynamicsCompressor `threshold`; `release` (0.001..0.5 s, default 0.05). Internally ratio fixed 20, knee 0, attack 0.001. AudioParams exposed: `ceiling` (= threshold), `release`.

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/fx/limiter.test.ts
import { describe, it, expect } from 'vitest';
import { limiterPlugin } from './limiter';

describe('limiter plugin', () => {
  it('has fx manifest with ceiling + release', () => {
    expect(limiterPlugin.kind).toBe('fx');
    expect(limiterPlugin.manifest.id).toBe('limiter');
    const ids = limiterPlugin.manifest.params.map((p) => p.id).sort();
    expect(ids).toEqual(['ceiling', 'release']);
  });

  it('caps output peak below an over-ceiling input (relative)', async () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const osc = ctx.createOscillator();
    const drive = ctx.createGain();
    drive.gain.value = 6; // way over ceiling
    osc.frequency.value = 200;
    const inst = limiterPlugin.kind === 'fx' ? limiterPlugin.create(ctx as unknown as AudioContext) : null!;
    inst.setBaseValue('ceiling', -6);
    osc.connect(drive).connect(inst.input);
    inst.output.connect(ctx.destination);
    osc.start();
    const buf = await ctx.startRendering();
    let peak = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    // -6 dBFS ≈ 0.5 linear; allow the compressor's soft overshoot but require
    // it well under the 6× drive. Relative ceiling check, not an absolute spec.
    expect(peak).toBeLessThan(1.0);
    expect(peak).toBeLessThan(drive.gain.value);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/limiter.test.ts`
Expected: FAIL — cannot find module `./limiter`.

- [ ] **Step 3: Write the plugin**

```ts
// src/plugins/fx/limiter.ts
import type { FxInstance, PluginFactory } from '../types';

export const limiterPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'limiter',
    name: 'Limiter',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'ceiling', label: 'Ceil', kind: 'continuous', min: -30,   max: 0,   default: -1,   unit: 'dB' },
      { id: 'release', label: 'Rel',  kind: 'continuous', min: 0.001, max: 0.5, default: 0.05, unit: 's' },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input  = ctx.createGain();
    const comp   = ctx.createDynamicsCompressor();
    const output = ctx.createGain();
    comp.threshold.value = -1;   // ceiling
    comp.ratio.value     = 20;   // brickwall
    comp.knee.value      = 0;
    comp.attack.value    = 0.001;
    comp.release.value   = 0.05;
    input.connect(comp).connect(output);

    const params = new Map<string, AudioParam>([
      ['ceiling', comp.threshold],
      ['release', comp.release],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => params.get(id)?.value ?? 0,
      setBaseValue: (id, v) => { const p = params.get(id); if (p) p.value = v; },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); comp.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/limiter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/fx/limiter.ts src/plugins/fx/limiter.test.ts
git commit -m "feat(fx): insertable brickwall Limiter plugin"
```

---

## Phase 2 — Send bus DSP model

### Task 3: `SendBus` class

**Files:**
- Create: `src/core/send-bus.ts`
- Test: `src/core/send-bus.test.ts`

**Interfaces:**
- Produces:
  - `interface SendBusState { id: string; label: string; returnLevel: number; muted: boolean; inserts: InsertSlot[]; }`
  - `class SendBus { readonly id: string; label: string; readonly input: GainNode; readonly inserts: InsertChain; constructor(ctx: AudioContext, id: string, label: string, output: AudioNode); setReturnLevel(g: number): void; getReturnLevel(): number; setMuted(m: boolean): void; isMuted(): boolean; serialize(paramIdsByPlugin?: unknown): SendBusState; }`
  - Internal wiring: `input → inserts(InsertChain) → returnLevel(GainNode) → output`. `muted` zeroes `returnLevel`.
- Consumes: `InsertChain` from `../plugins/fx/insert-chain`, `InsertSlot` from `../session/insert-slot`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/send-bus.test.ts
import { describe, it, expect } from 'vitest';
import { SendBus } from './send-bus';

describe('SendBus', () => {
  it('routes input → inserts → returnLevel → output and respects mute', async () => {
    const sr = 44100;
    const renderReturn = async (muted: boolean) => {
      const ctx = new OfflineAudioContext(1, sr, sr);
      const out = ctx.createGain();
      out.connect(ctx.destination);
      const bus = new SendBus(ctx as unknown as AudioContext, 'A', 'Send A', out);
      bus.setReturnLevel(1);
      bus.setMuted(muted);
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(bus.input);
      osc.start();
      const buf = await ctx.startRendering();
      let peak = 0;
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      return peak;
    };
    const [open, muted] = await Promise.all([renderReturn(false), renderReturn(true)]);
    expect(open).toBeGreaterThan(0.01);
    expect(muted).toBeLessThan(open * 0.01);
  });

  it('serializes its state', () => {
    const ctx = new AudioContext();
    const bus = new SendBus(ctx, 'B', 'Send B', ctx.destination);
    bus.setReturnLevel(0.7);
    const s = bus.serialize();
    expect(s.id).toBe('B');
    expect(s.label).toBe('Send B');
    expect(s.returnLevel).toBeCloseTo(0.7, 3);
    expect(s.muted).toBe(false);
    expect(Array.isArray(s.inserts)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/send-bus.test.ts`
Expected: FAIL — cannot find module `./send-bus`.

- [ ] **Step 3: Write the class**

```ts
// src/core/send-bus.ts
// A generic FX send bus: lanes connect a per-channel send gain into `input`;
// the signal passes through an InsertChain (seeded with one effect, e.g. delay
// or reverb), through a return-level gain, and into the master sum bus. Muting
// zeroes the return without disconnecting the chain.
import { InsertChain } from '../plugins/fx/insert-chain';
import type { InsertSlot } from '../session/insert-slot';

export interface SendBusState {
  id: string;
  label: string;
  returnLevel: number;
  muted: boolean;
  inserts: InsertSlot[];
}

export class SendBus {
  readonly input: GainNode;
  readonly inserts: InsertChain;
  private readonly returnGain: GainNode;
  private _muted = false;
  private _level = 1;

  constructor(
    ctx: AudioContext,
    public readonly id: string,
    public label: string,
    output: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.returnGain = ctx.createGain();
    this.returnGain.gain.value = 1;
    // input → [inserts] → returnGain → output(master)
    this.inserts = new InsertChain(this.input, this.returnGain);
    this.returnGain.connect(output);
  }

  setReturnLevel(g: number): void {
    this._level = g;
    if (!this._muted) this.returnGain.gain.value = g;
  }
  getReturnLevel(): number { return this._level; }

  setMuted(m: boolean): void {
    this._muted = m;
    this.returnGain.gain.value = m ? 0 : this._level;
  }
  isMuted(): boolean { return this._muted; }

  /** Serialize bus-level state. Insert slots are owned by the session and
   *  serialized there (mirrors lane/master inserts), so default to []. */
  serialize(inserts: InsertSlot[] = []): SendBusState {
    return { id: this.id, label: this.label, returnLevel: this._level, muted: this._muted, inserts };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/send-bus.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/send-bus.ts src/core/send-bus.test.ts
git commit -m "feat(fx): lean SendBus (input → inserts → return level → master)"
```

### Task 4: Repurpose `FxBus` into a 2-send bank

**Files:**
- Modify: `src/core/fx.ts` (the `FxBus` class only; `ChannelStrip` is Task 5)
- Modify: `src/core/fx.test.ts`

**Interfaces:**
- Consumes: `SendBus`, `SendBusState` (Task 3); `createInstance` from `../plugins/registry`; `delayPlugin`/`reverbPlugin`.
- Produces (new public API on `FxBus`):
  - `sends: SendBus[]` (index 0 = `'A'` delay, index 1 = `'B'` reverb).
  - `getSendBus(id: 'A' | 'B'): SendBus`.
  - `reverbInput: GainNode` (getter → `getSendBus('B').input`), `delayInput: GainNode` (getter → `getSendBus('A').input`) — kept so `ChannelStrip`/`DrumMachine` need no change.
  - **Kept as transitional shims** (delegate to the seeded reverb/delay inserts; removed in Task 12): `setReverbWet/Size/Decay/Predelay`, `getReverbWet/Size/Decay/Predelay`, `setDelayTime/Feedback/Wet/Damping`, `getDelayFeedback/Wet/Damping`, `setBpmSync`, `getMasterSendInstances`.
- Note: the bus is seeded by inserting a delay (bus A) and reverb (bus B) instance via `createInstance('fx', …)`. In unit tests the registry is empty, so `FxBus` must seed gracefully (a null insert → empty chain) and the shims must no-op when no seed insert exists.

- [ ] **Step 1: Update `fx.test.ts` to the new shape (failing)**

Replace the `FxBus` describe block in `src/core/fx.test.ts` with:

```ts
// src/core/fx.test.ts  (FxBus section)
import { describe, it, expect, beforeAll } from 'vitest';
import { ChannelStrip, FxBus } from './fx';
import { registerPlugin, _resetRegistry } from '../plugins/registry';
import { reverbPlugin } from '../plugins/fx/reverb';
import { delayPlugin } from '../plugins/fx/delay';

describe('FxBus as a 2-send bank', () => {
  beforeAll(() => { _resetRegistry(); registerPlugin(reverbPlugin); registerPlugin(delayPlugin); });

  it('exposes two sends A(delay) and B(reverb)', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.sends.map((s) => s.id)).toEqual(['A', 'B']);
    expect(fx.getSendBus('A').label).toMatch(/delay/i);
    expect(fx.getSendBus('B').label).toMatch(/reverb/i);
  });

  it('reverbInput aliases bus B and delayInput aliases bus A', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.reverbInput).toBe(fx.getSendBus('B').input);
    expect(fx.delayInput).toBe(fx.getSendBus('A').input);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: FAIL — `fx.sends`/`getSendBus` undefined.

- [ ] **Step 3: Rewrite the `FxBus` class**

In `src/core/fx.ts`, replace the entire `FxBus` class (lines ~22–76) with:

```ts
import { SendBus } from './send-bus';
import { createInstance } from '../plugins/registry';

// FxBus is the FX send bank: two generic send buses, A (seeded Delay) and B
// (seeded Reverb). Kept under the name `FxBus` to bound blast radius; it is no
// longer a privileged reverb+delay pair — reverb/delay are ordinary inserts
// living in the bus insert chains. `reverbInput`/`delayInput` alias the bus
// inputs so ChannelStrip and DrumMachine per-voice sends route unchanged.
export class FxBus {
  readonly sends: SendBus[];

  constructor(ctx: AudioContext, output: AudioNode) {
    const a = new SendBus(ctx, 'A', 'Send A (Delay)', output);
    const b = new SendBus(ctx, 'B', 'Send B (Reverb)', output);
    // Seed each bus with its default insert. createInstance returns undefined
    // when the registry isn't bootstrapped (e.g. pure unit tests) — the chain
    // stays empty (pass-through) and the shims below no-op.
    const delay  = createInstance('fx', 'delay',  ctx);
    const reverb = createInstance('fx', 'reverb', ctx);
    if (delay)  a.inserts.insert(delay);
    if (reverb) b.inserts.insert(reverb);
    this.sends = [a, b];
  }

  getSendBus(id: 'A' | 'B'): SendBus {
    const s = this.sends.find((x) => x.id === id);
    if (!s) throw new Error(`FxBus: unknown send bus "${id}"`);
    return s;
  }

  get reverbInput(): GainNode { return this.getSendBus('B').input; }
  get delayInput(): GainNode  { return this.getSendBus('A').input; }

  // ── Transitional shims (removed in Task 12 once fx-ui/modulation-ui migrate).
  // They drive the seeded reverb (bus B) / delay (bus A) inserts directly.
  private seed(id: 'A' | 'B') { return this.getSendBus(id).inserts.list()[0]?.fx; }
  setReverbWet(g: number)        { this.seed('B')?.setBaseValue('wet', g); }
  setReverbPredelay(sec: number) { this.seed('B')?.setBaseValue('predelay', sec); }
  setReverbSize(sec: number, decay?: number) { this.seed('B')?.setBaseValue('size', sec); if (decay !== undefined) this.seed('B')?.setBaseValue('decay', decay); }
  setReverbDecay(d: number)      { this.seed('B')?.setBaseValue('decay', d); }
  getReverbWet()      { return this.seed('B')?.getBaseValue('wet') ?? 0; }
  getReverbSize()     { return this.seed('B')?.getBaseValue('size') ?? 0; }
  getReverbDecay()    { return this.seed('B')?.getBaseValue('decay') ?? 0; }
  getReverbPredelay() { return this.seed('B')?.getBaseValue('predelay') ?? 0; }
  setDelayTime(sec: number)   { this.seed('A')?.setBaseValue('time', sec); }
  setDelayFeedback(g: number) { this.seed('A')?.setBaseValue('feedback', g); }
  setDelayWet(g: number)      { this.seed('A')?.setBaseValue('wet', g); }
  setDelayDamping(hz: number) { this.seed('A')?.setBaseValue('damping', hz); }
  getDelayFeedback() { return this.seed('A')?.getBaseValue('feedback') ?? 0; }
  getDelayWet()      { return this.seed('A')?.getBaseValue('wet') ?? 0; }
  getDelayDamping()  { return this.seed('A')?.getBaseValue('damping') ?? 0; }
  setBpmSync(bpm: number, beatFraction = 0.375) { this.setDelayTime((60 / bpm) * beatFraction * 4); }
  getMasterSendInstances() { return { reverb: this.seed('B'), delay: this.seed('A') }; }
}
```

Delete the now-unused imports `reverbPlugin`/`delayPlugin`/`FxFactory` at the top of `fx.ts` (the seeding goes through `createInstance`). Keep the `FxInstance` import if still referenced; otherwise remove it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: PASS. Then `NO_COLOR=1 npx vitest run src/core/drums.dsp.test.ts src/app/lane-allocator.test.ts` — expected PASS (these construct `new FxBus(...)` and rely on `reverbInput`/`delayInput`).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`fx-ui.ts`/`modulation-ui.ts`/`saved-state-v3.ts` still compile because the shims remain.)

- [ ] **Step 6: Commit**

```bash
git add src/core/fx.ts src/core/fx.test.ts
git commit -m "refactor(fx): FxBus is a 2-send bank (A=delay, B=reverb) with insert chains"
```

### Task 5: Rename `ChannelStrip` sends to A/B

**Files:**
- Modify: `src/core/fx.ts` (`ChannelStrip` + `ChannelState`)
- Modify: `src/core/fx.test.ts`

**Interfaces:**
- Produces on `ChannelStrip`: `sendA: GainNode`, `sendB: GainNode`; `setSendA(g)`, `setSendB(g)`. Wiring: `duckGain → sendA → fx.delayInput`, `duckGain → sendB → fx.reverbInput`.
- `ChannelState` gains `sendA`/`sendB` and drops `reverbSend`/`delaySend`; `restore()` accepts old keys for back-compat: old `delaySend → sendA`, old `reverbSend → sendB`.

- [ ] **Step 1: Write the failing test**

Add to `src/core/fx.test.ts`:

```ts
describe('ChannelStrip A/B sends', () => {
  beforeAll(() => { _resetRegistry(); registerPlugin(reverbPlugin); registerPlugin(delayPlugin); });

  it('serializes sendA/sendB and restores legacy reverbSend/delaySend', () => {
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    const strip = new ChannelStrip(ctx, ctx.destination, fx);
    strip.setSendA(0.3); strip.setSendB(0.6);
    const s = strip.serialize();
    expect(s.sendA).toBeCloseTo(0.3, 3);
    expect(s.sendB).toBeCloseTo(0.6, 3);

    const strip2 = new ChannelStrip(ctx, ctx.destination, fx);
    // Legacy save: delaySend → sendA, reverbSend → sendB
    strip2.restore({ ...s, sendA: undefined as unknown as number, sendB: undefined as unknown as number,
      delaySend: 0.2, reverbSend: 0.5 } as never);
    expect(strip2.serialize().sendA).toBeCloseTo(0.2, 3);
    expect(strip2.serialize().sendB).toBeCloseTo(0.5, 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: FAIL — `setSendA`/`s.sendA` undefined.

- [ ] **Step 3: Edit `ChannelStrip`**

In `src/core/fx.ts`:
- Rename fields `reverbSend`/`delaySend` → `sendA`/`sendB`.
- In the constructor, replace the send creation + wiring:

```ts
    this.sendA = ctx.createGain(); this.sendA.gain.value = 0;
    this.sendB = ctx.createGain(); this.sendB.gain.value = 0;
```
```ts
    this.duckGain.connect(this.sendA).connect(fx.delayInput);   // Send A → Delay bus
    this.duckGain.connect(this.sendB).connect(fx.reverbInput);  // Send B → Reverb bus
```
- Replace setters:

```ts
  setSendA(g: number) { this.sendA.gain.value = g; }
  setSendB(g: number) { this.sendB.gain.value = g; }
```
- In `ChannelState`: replace `reverbSend: number; delaySend: number;` with `sendA: number; sendB: number;`.
- In `serialize()`: `sendA: this.sendA.gain.value, sendB: this.sendB.gain.value,`.
- In `restore(s)`: replace the two send lines with back-compat:

```ts
    const legacy = s as ChannelState & { reverbSend?: number; delaySend?: number };
    this.setSendA(s.sendA ?? legacy.delaySend ?? 0);
    this.setSendB(s.sendB ?? legacy.reverbSend ?? 0);
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix remaining references + typecheck**

`mixer.ts`, `voice-mod-binding.ts`, and any test referencing `state.reverbSend`/`setReverbSend` will break. Mixer is handled in Task 8; for now update non-UI references. Run: `npx tsc --noEmit` and fix each reported `reverbSend`/`delaySend`/`setReverbSend`/`setDelaySend` site to the A/B equivalents (mixer is updated in Task 8 — if tsc flags `mixer.ts`, apply the minimal rename there now to keep the build green and refine the labels in Task 8).
Expected after fixes: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/fx.ts src/core/fx.test.ts src/core/mixer.ts src/modulation/voice-mod-binding.ts
git commit -m "refactor(fx): ChannelStrip sends are sendA/sendB (A=delay, B=reverb) with legacy restore"
```

---

## Phase 3 — Persistence & migration

### Task 6: `SessionState.sends` + audio-graph rehydration

**Files:**
- Modify: `src/session/session.ts`
- Modify: `src/app/audio-graph.ts`
- Modify: `src/session/session-host-persistence.ts`
- Modify: `src/save/saved-state-v3.ts`
- Test: extend `src/app/audio-graph.test.ts`

**Interfaces:**
- `SessionState.sends?: SendBusState[]` (import type from `../core/send-bus`).
- On load: for each `SessionState.sends[i]`, set the matching `fx.sends` bus return level + mute, then rehydrate its insert chain from `sends[i].inserts` (clearing the seed first). Reuse `rehydrateInsertChain`.
- On save: `sends` is collected from `fx.sends` (`bus.serialize(insertSlotsFor(bus))`).

- [ ] **Step 1: Write the failing test**

Add to `src/app/audio-graph.test.ts`:

```ts
import { rehydrateSends, collectSends } from '../session/session-host-persistence';
// (helpers exported in Step 3)

it('collectSends → rehydrateSends round-trips return level + mute', () => {
  const g = buildAudioGraph(new AudioContext());
  g.fx.getSendBus('A').setReturnLevel(0.4);
  g.fx.getSendBus('B').setMuted(true);
  const snap = collectSends(g.fx);
  const g2 = buildAudioGraph(new AudioContext());
  rehydrateSends(g2.ctx, g2.fx, snap);
  expect(g2.fx.getSendBus('A').getReturnLevel()).toBeCloseTo(0.4, 3);
  expect(g2.fx.getSendBus('B').isMuted()).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/audio-graph.test.ts`
Expected: FAIL — `collectSends`/`rehydrateSends` not exported.

- [ ] **Step 3: Add the type + helpers**

In `src/session/session.ts`, add to `SessionState`:

```ts
  /** FX send buses (A=delay, B=reverb). Optional/additive; absent ⇒ seeded by migration. */
  sends?: import('../core/send-bus').SendBusState[];
```

In `src/session/session-host-persistence.ts`, add and export:

```ts
import type { FxBus } from '../core/fx';
import type { SendBusState } from '../core/send-bus';
import { rehydrateInsertChain, snapshotInsertSlot, type InsertSlot } from './insert-slot';

/** Snapshot the two send buses (return level, mute, insert slots). */
export function collectSends(fx: FxBus): SendBusState[] {
  return fx.sends.map((bus) => {
    const slots: InsertSlot[] = bus.inserts.list().map((cs) => {
      const factory = listPluginsFx().find((p) => p.manifest.id === idOf(cs.fx));
      return { pluginId: idOf(cs.fx), params: paramsOf(cs.fx, factory), bypass: cs.bypass };
    });
    return bus.serialize(slots);
  });
}

/** Apply persisted send-bus state: return level, mute, and rehydrated inserts. */
export function rehydrateSends(ctx: AudioContext, fx: FxBus, sends: SendBusState[] | undefined): void {
  if (!sends) return;
  for (const state of sends) {
    const bus = fx.sends.find((b) => b.id === state.id);
    if (!bus) continue;
    bus.label = state.label;
    bus.setReturnLevel(state.returnLevel);
    bus.setMuted(state.muted);
    while (bus.inserts.size() > 0) bus.inserts.remove(0);
    rehydrateInsertChain(ctx, bus.inserts, state.inserts);
  }
}
```

Because `FxInstance` carries no plugin id, `collectSends` cannot read `idOf(cs.fx)` directly. To avoid that, **store the slot list on the session, not derived from live instances**: maintain `sessionState.sends` as the source of truth for the insert *slots* (exactly like `lane.inserts`/`masterInserts`), and have the FX-page rack (Task 10) write into `sessionState.sends[i].inserts`. So replace `collectSends` with a pass-through over the session's own `sends` slots, only refreshing return level + mute from the live buses:

```ts
export function collectSends(fx: FxBus, prev: SendBusState[] | undefined): SendBusState[] {
  return fx.sends.map((bus, i) => ({
    id: bus.id,
    label: bus.label,
    returnLevel: bus.getReturnLevel(),
    muted: bus.isMuted(),
    inserts: prev?.[i]?.inserts ?? [],
  }));
}
```

(Delete the `idOf`/`paramsOf`/`listPluginsFx` helper sketch — not needed.)

In `src/app/audio-graph.ts`, no structural change is required (the `fx` already exists); the graph exposes `fx.sends` already. Wire rehydration in the load path:

In `src/session/session-host-persistence.ts` `applyLoadedSessionState`, after the master-insert rehydration block, add:

```ts
  // FX send buses: return level, mute, and insert chains.
  if (self.deps.fx) rehydrateSends(self.deps.ctx, self.deps.fx, self.state.sends);
```
and set `self.state.sends = migrated.sends;` near the other `self.state.* = migrated.*` assignments.

In `src/save/saved-state-v3.ts`:
- `applyLoadedStateV3` already calls `sessionHost.applyLoadedSessionState(s.sessionState)` — `sends` lives inside `sessionState`, so no separate field is needed. Confirm `s.sessionState.sends` survives the round-trip (it is part of `getStateForSave()` → Step 4).

Add `fx: FxBus` to `SessionHostDeps` if not already present (it is referenced as `self.deps.fx`). Verify in `src/session/session-host-deps.ts`; if absent, add `fx?: import('../core/fx').FxBus;` and wire it where the host is constructed in `main.ts`.

- [ ] **Step 4: Ensure `sends` is included in save + state**

In the SessionHost `getStateForSave()` path, ensure `sends` is refreshed from the live buses before save (return level + mute), preserving the slot arrays:

```ts
state.sends = collectSends(this.deps.fx, state.sends);
```
(Place alongside where `masterInserts` is finalized for save.)

- [ ] **Step 5: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/app/audio-graph.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/app/audio-graph.ts src/session/session-host-persistence.ts src/save/saved-state-v3.ts src/app/audio-graph.test.ts src/session/session-host-deps.ts
git commit -m "feat(fx): persist + rehydrate send-bus state (level/mute/inserts)"
```

### Task 7: Migration — seed default sends + remap per-lane send amounts

**Files:**
- Create: `src/core/send-migration.ts`
- Test: `src/core/send-migration.test.ts`
- Modify: `src/session/session-migration.ts`

**Interfaces:**
- Produces:
  - `export function defaultSends(): SendBusState[]` — `[{id:'A',label:'Send A (Delay)',returnLevel:1,muted:false,inserts:[{pluginId:'delay',params:{},bypass:false}]},{id:'B',label:'Send B (Reverb)',returnLevel:1,muted:false,inserts:[{pluginId:'reverb',params:{},bypass:false}]}]`.
  - `export function remapLaneSendParams(params: Record<string, number>): Record<string, number>` — for each key matching `mix.<lane>.dly` → `mix.<lane>.sendA`, `mix.<lane>.rev` → `mix.<lane>.sendB`; other keys unchanged. Returns a new object.
- Consumes: `SendBusState` from `./send-bus`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/send-migration.test.ts
import { describe, it, expect } from 'vitest';
import { defaultSends, remapLaneSendParams } from './send-migration';

describe('send migration', () => {
  it('defaultSends seeds A=delay, B=reverb', () => {
    const s = defaultSends();
    expect(s.map((b) => b.id)).toEqual(['A', 'B']);
    expect(s[0].inserts[0].pluginId).toBe('delay');
    expect(s[1].inserts[0].pluginId).toBe('reverb');
  });

  it('remaps mix.<lane>.rev → sendB and .dly → sendA, leaving others', () => {
    const out = remapLaneSendParams({
      'mix.bass.rev': 0.5, 'mix.bass.dly': 0.2, 'mix.bass.pan': -0.3,
    });
    expect(out['mix.bass.sendB']).toBe(0.5);
    expect(out['mix.bass.sendA']).toBe(0.2);
    expect(out['mix.bass.pan']).toBe(-0.3);
    expect(out['mix.bass.rev']).toBeUndefined();
    expect(out['mix.bass.dly']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/send-migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

```ts
// src/core/send-migration.ts
import type { SendBusState } from './send-bus';

export function defaultSends(): SendBusState[] {
  return [
    { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ pluginId: 'delay',  params: {}, bypass: false }] },
    { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ pluginId: 'reverb', params: {}, bypass: false }] },
  ];
}

const REV_RE = /^(mix\..+)\.rev$/;
const DLY_RE = /^(mix\..+)\.dly$/;

/** Map legacy per-lane send knob ids to A/B. `<id>.rev` → `<id>.sendB`,
 *  `<id>.dly` → `<id>.sendA`. Non-send keys pass through unchanged. */
export function remapLaneSendParams(params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    const rev = REV_RE.exec(k);
    const dly = DLY_RE.exec(k);
    if (rev) out[`${rev[1]}.sendB`] = v;
    else if (dly) out[`${dly[1]}.sendA`] = v;
    else out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/send-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire migration into `session-migration.ts`**

In `migrateLoadedSessionState`, before `return s;`:

```ts
  // FX sends: seed the two default buses if absent (old saves predate them).
  if (!s.sends) s.sends = defaultSends();
  // Remap legacy per-lane send knob ids (mix.<lane>.rev/.dly → .sendB/.sendA).
  for (const lane of s.lanes) {
    if (lane.engineState?.params) {
      lane.engineState.params = remapLaneSendParams(lane.engineState.params);
    }
  }
```
Add the import: `import { defaultSends, remapLaneSendParams } from '../core/send-migration';`.

- [ ] **Step 6: Write a migration integration test**

Add to `src/session/session-migration.test.ts` (create if absent, mirroring existing migration tests):

```ts
import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session';

it('seeds default sends and remaps legacy lane send knobs', () => {
  const s = {
    lanes: [{ id: 'bass', engineId: 'tb303', clips: [],
      engineState: { params: { 'mix.bass.rev': 0.5, 'mix.bass.dly': 0.2 } } }],
    scenes: [], globalQuantize: '1/1',
  } as unknown as SessionState;
  const out = migrateLoadedSessionState(s);
  expect(out.sends?.map((b) => b.id)).toEqual(['A', 'B']);
  expect(out.lanes[0].engineState!.params!['mix.bass.sendB']).toBe(0.5);
  expect(out.lanes[0].engineState!.params!['mix.bass.sendA']).toBe(0.2);
});
```

- [ ] **Step 7: Run + typecheck + commit**

Run: `NO_COLOR=1 npx vitest run src/core/send-migration.test.ts src/session/session-migration.test.ts` → PASS.
Run: `npx tsc --noEmit` → no errors.

```bash
git add src/core/send-migration.ts src/core/send-migration.test.ts src/session/session-migration.ts src/session/session-migration.test.ts
git commit -m "feat(fx): migrate old saves — seed A/B sends + remap rev/dly knob ids"
```

---

## Phase 4 — UI

### Task 8: Mixer SEND knobs → A / B

**Files:**
- Modify: `src/core/mixer.ts` (the "Sends" section, lines ~96–113)

**Interfaces:**
- Consumes: `strip.setSendA`/`strip.setSendB`, `state.sendA`/`state.sendB` (Task 5).

- [ ] **Step 1: Edit the Sends section**

Replace the two `addKnob(sendSec, …)` calls with:

```ts
  addKnob(sendSec, deps, {
    id: `mix.${trackId}.sendA`, label: 'A', min: 0, max: 1, step: 0.01,
    value: state.sendA, defaultValue: 0, color: '#3498db', format: fmtPct,
    onChange: (v) => strip.setSendA(v),
  });
  addKnob(sendSec, deps, {
    id: `mix.${trackId}.sendB`, label: 'B', min: 0, max: 1, step: 0.01,
    value: state.sendB, defaultValue: 0, color: '#9b59b6', format: fmtPct,
    onChange: (v) => strip.setSendB(v),
  });
```

(A = delay = blue, B = reverb = purple, matching the FX-page colors.)

- [ ] **Step 2: Typecheck + run mixer-related tests**

Run: `npx tsc --noEmit` → no errors.
Run: `NO_COLOR=1 npx vitest run src/core` → PASS (re-run once if `ERR_IPC_CHANNEL_CLOSED` on teardown).

- [ ] **Step 3: Commit**

```bash
git add src/core/mixer.ts
git commit -m "feat(mixer): SEND knobs are A/B (replacing REV/DLY)"
```

### Task 9: Delay BPM-sync as an insert param

**Files:**
- Modify: `src/plugins/fx/delay.ts`
- Modify: `src/plugins/fx/insert-chain.ts`
- Modify: `src/app/bpm-broadcast.ts`
- Test: `src/plugins/fx/delay.test.ts` (create) + extend `src/plugins/fx/insert-chain.test.ts`

**Interfaces:**
- Delay plugin gains a discrete `sync` param: `0 = Free` (use `time`), `1.. = 1/4, 1/8, 1/8., 1/8t, 1/16` etc. `setBpm(bpm)` recomputes `delayTime` from the active division when `sync !== 0`.
- `InsertChain.setBpm(bpm: number): void` — forwards to each slot's `fx.setBpm?.(bpm)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/plugins/fx/delay.test.ts
import { describe, it, expect } from 'vitest';
import { delayPlugin } from './delay';

describe('delay sync', () => {
  it('Free mode leaves time under manual control', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 0);
    inst.setBaseValue('time', 0.5);
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.5, 3);
  });

  it('synced mode derives time from bpm (1/8 at 120 BPM = 0.25s)', () => {
    const ctx = new AudioContext();
    const inst = delayPlugin.kind === 'fx' ? delayPlugin.create(ctx) : null!;
    inst.setBaseValue('sync', 2); // index 2 = 1/8 per the options table
    inst.setBpm?.(120);
    expect(inst.getBaseValue('time')).toBeCloseTo(0.25, 2);
  });
});
```

Add to `src/plugins/fx/insert-chain.test.ts`:

```ts
it('setBpm forwards to slot instances that implement setBpm', () => {
  const ctx = new AudioContext();
  const input = ctx.createGain(), output = ctx.createGain();
  const chain = new InsertChain(input, output);
  let seen = 0;
  const fake = { input: ctx.createGain(), output: ctx.createGain(),
    getAudioParams: () => new Map(), getBaseValue: () => 0, setBaseValue: () => {},
    applyPreset: () => {}, setBpm: (b: number) => { seen = b; }, dispose: () => {} };
  chain.insert(fake as never);
  chain.setBpm(140);
  expect(seen).toBe(140);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/delay.test.ts src/plugins/fx/insert-chain.test.ts`
Expected: FAIL — `sync` unknown / `setBpm` not a function.

- [ ] **Step 3: Add `sync` to the delay plugin**

In `src/plugins/fx/delay.ts`:
- Add to `manifest.params`:

```ts
      { id: 'sync', label: 'Sync', kind: 'discrete', min: 0, max: 6, default: 0,
        options: [
          { value: 'free', label: 'Free' },
          { value: '1/4',  label: '1/4' },
          { value: '1/8',  label: '1/8' },
          { value: '1/8.', label: '1/8.' },
          { value: '1/8t', label: '1/8t' },
          { value: '1/16', label: '1/16' },
          { value: '1/16t', label: '1/16t' },
        ] },
```
- Inside `create`, track `let syncIdx = 0; let bpm = 120;` and a beats table:

```ts
    const SYNC_BEATS = [0, 1, 0.5, 0.75, 1/3, 0.25, 1/6]; // index → beats (0 = free)
    const applySync = () => {
      const beats = SYNC_BEATS[syncIdx];
      if (beats > 0) delay.delayTime.setTargetAtTime((60 / bpm) * beats, ctx.currentTime, 0.01);
    };
```
- Extend `getBaseValue`/`setBaseValue` for `sync`:

```ts
        if (id === 'sync') return syncIdx;
```
```ts
        if (id === 'sync') { syncIdx = v | 0; applySync(); }
```
- Add `setBpm` to the returned `FxInstance`:

```ts
      setBpm: (b) => { bpm = b; applySync(); },
```

- [ ] **Step 4: Add `setBpm` to `InsertChain`**

In `src/plugins/fx/insert-chain.ts`, add a method:

```ts
  setBpm(bpm: number): void {
    for (const s of this.slots) s.fx.setBpm?.(bpm);
  }
```

- [ ] **Step 5: Broadcast bpm to all chains**

In `src/app/bpm-broadcast.ts`, wherever bpm changes are fanned out, add calls to forward bpm to every insert chain. Read the file first; add (alongside the existing `fx.setBpmSync(bpm)` call, which can stay during transition):

```ts
  for (const send of graph.fx.sends) send.inserts.setBpm(bpm);
  for (const [, res] of lanes.resources) res.inserts.setBpm(bpm);
  graph.masterInsertChain.setBpm(bpm);
```
(Adapt variable names to the file's existing deps. If `bpm-broadcast.ts` lacks access to `lanes`/`graph`, pass them through its deps object — match the file's current dependency-injection shape.)

- [ ] **Step 6: Run + commit**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/delay.test.ts src/plugins/fx/insert-chain.test.ts` → PASS.
Run: `npx tsc --noEmit` → no errors.

```bash
git add src/plugins/fx/delay.ts src/plugins/fx/delay.test.ts src/plugins/fx/insert-chain.ts src/plugins/fx/insert-chain.test.ts src/app/bpm-broadcast.ts
git commit -m "feat(fx): delay BPM-sync as an insert param; InsertChain.setBpm forwarding"
```

### Task 10: FX page — two Send return modules + reverb/delay in picker

**Files:**
- Modify: `src/core/fx-ui.ts`
- Modify: `src/session/lane-insert-ui.ts`
- Modify: `index.html` (FX zone markup) — add containers for the two send modules; verify ids.

**Interfaces:**
- Consumes: `fx.sends` (Task 4), `buildLaneInsertUI` (existing), `SendBusState` slots from `sessionState.sends`.
- The two reverb/delay knob rows (`#fx-reverb-knobs`, `#fx-delay-knobs`) are replaced by two modules: each has a return-level knob, a mute button, and an insert rack bound to that send's `InsertChain`, reading/writing slots in `sessionState.sends[i].inserts`.

- [ ] **Step 1: Drop the picker exclusion**

In `src/session/lane-insert-ui.ts`, delete the `SEND_ONLY_IN_PHASE_1` set and its use in the picker loop (so reverb + delay appear as insertable FX):

```ts
// remove: const SEND_ONLY_IN_PHASE_1 = new Set<string>(['reverb', 'delay']);
```
and change the picker loop to list all fx plugins:

```ts
    for (const p of listPlugins('fx')) {
      picker.appendChild(new Option(p.manifest.name, p.manifest.id));
    }
```

- [ ] **Step 2: Replace reverb/delay rows with Send return modules**

In `src/core/fx-ui.ts` `wireFxUI`, remove the REVERB and DELAY `appendKnob`/`appendSelect` blocks and the `applyDelaySync`/`_delaySyncDiv` machinery. Add a helper that builds one send module and call it for each bus:

```ts
  const buildSendModule = (bus: import('./send-bus').SendBus, slots: InsertSlot[]) => {
    const host = document.getElementById(`fx-send-${bus.id.toLowerCase()}`) as HTMLDivElement | null;
    if (!host) return;
    host.replaceChildren();
    const title = document.createElement('div');
    title.className = 'fx-send-title';
    title.textContent = bus.label;
    host.appendChild(title);
    const ctrls = document.createElement('div');
    ctrls.className = 'fx-send-ctrls';
    appendKnob(ctrls, { id: `fx.send.${bus.id}.level`, min: 0, max: 1.5, step: 0.01,
      value: bus.getReturnLevel(), defaultValue: 1, label: 'RET', size: SIZE, format: fmtPct,
      onChange: (v) => bus.setReturnLevel(v) }, deps.registerKnob, undoHooks);
    const mute = document.createElement('button');
    mute.className = 'rnd';
    mute.textContent = 'MUTE';
    mute.classList.toggle('active', bus.isMuted());
    mute.onclick = () => { const m = !bus.isMuted(); bus.setMuted(m); mute.classList.toggle('active', m); deps.saveSession?.(); };
    ctrls.appendChild(mute);
    host.appendChild(ctrls);
    const rack = document.createElement('div');
    host.appendChild(rack);
    buildLaneInsertUI({ ctx: deps.ctx, container: rack, chain: bus.inserts, slots, onChange: () => deps.saveSession?.() });
  };

  const rebuildSends = () => {
    const ss = deps.getSessionState?.();
    deps.fx.sends.forEach((bus, i) => {
      const slots = ss?.sends?.[i]?.inserts ?? [];
      buildSendModule(bus, slots);
    });
  };
  rebuildSends();
```

Return `rebuildSends` from `wireFxUI` alongside `rebuildMasterInserts`, and call it after `applyLoadedSessionState` (wire the call where `rebuildMasterInserts` is already called on state-applied).

- [ ] **Step 3: Add markup + styles**

In `index.html`, inside the FX zone, replace the `#fx-reverb-knobs` / `#fx-delay-knobs` rows with:

```html
<div id="fx-send-a" class="fx-send-module"></div>
<div id="fx-send-b" class="fx-send-module"></div>
```

In `src/styles/_fx.scss`, add minimal styling for `.fx-send-module`, `.fx-send-title`, `.fx-send-ctrls` (match existing FX-zone spacing). Remove now-dead `.fx-filter-row` rules if unused.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` → no errors (some shim methods on `FxBus` are now unused but still present until Task 12; that's fine).
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/core/fx-ui.ts src/session/lane-insert-ui.ts index.html src/styles/_fx.scss
git commit -m "feat(fx): FX page shows Send A/B return modules; reverb/delay now insertable"
```

### Task 11: Modulation destinations from send insert chains

**Files:**
- Modify: `src/modulation/modulation-ui.ts`

**Interfaces:**
- Replace the `deps.fxBus.getMasterSendInstances()` "Master Sends" optgroup with one built from `fx.sends[i].inserts.list()` — each insert's `getAudioParams()` keys become destinations under an optgroup per send (e.g. "Send A — Delay").

- [ ] **Step 1: Read the current Master Sends block**

Read `src/modulation/modulation-ui.ts` around lines 360–375 (the `getMasterSendInstances()` use).

- [ ] **Step 2: Rewrite the destinations block**

Replace the Master-Sends optgroup construction with iteration over send buses:

```ts
  if (deps.fxBus) {
    deps.fxBus.sends.forEach((bus) => {
      const group = document.createElement('optgroup');
      group.label = bus.label;
      bus.inserts.list().forEach((cs, slotIdx) => {
        for (const [paramId] of cs.fx.getAudioParams()) {
          const dest = `send.${bus.id}.${slotIdx}.${paramId}`;
          group.appendChild(new Option(`${paramId}`, dest));
        }
      });
      if (group.childElementCount > 0) sel.appendChild(group);
    });
  }
```

(Match the existing `sel`/option-id conventions in the file; the binder that resolves a destination id to an `AudioParam` must learn the `send.<id>.<slot>.<param>` form — extend the resolver alongside the existing master/lane resolvers.)

- [ ] **Step 3: Typecheck + run modulation tests**

Run: `npx tsc --noEmit` → no errors.
Run: `NO_COLOR=1 npx vitest run src/modulation` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modulation/modulation-ui.ts
git commit -m "feat(mod): send insert params are modulation destinations"
```

---

## Phase 5 — Cleanup

### Task 12: Remove dead `FilterChain`/`MasterFilter` + FxBus shims

**Files:**
- Modify: `src/core/fx.ts`
- Modify: `src/core/fx-ui.ts` (drop the hidden "Add Filter" button handling if now unused)
- Modify: any test importing `FilterChain`/`MasterFilter`/`SyncDiv` that is now dead.

**Interfaces:**
- Remove `FilterChain`, `MasterFilter`, `SyncDiv`, `SYNC_BEATS`, `syncDivToHz`, `MasterFilterState` from `fx.ts` (confirm no remaining importers first).
- Remove the `FxBus` transitional shims (`setReverbWet`/…/`getMasterSendInstances`/`setBpmSync`) now that `fx-ui`/`modulation-ui` no longer call them.

- [ ] **Step 1: Confirm no live importers**

Run: `NO_COLOR=1 npx vitest run` is premature; first grep:
Run (background, then read output): `git grep -n "FilterChain\|MasterFilter\|syncDivToHz\|getMasterSendInstances\|setReverbWet\|setBpmSync\|SyncDiv"`
Expected: matches only in `fx.ts` itself, `fx-ui.ts` (the `SyncDiv`/`SYNC_OPTS` it may still export — keep `SYNC_OPTS` only if used elsewhere; otherwise remove), and test files to be cleaned.

- [ ] **Step 2: Delete the dead code**

In `src/core/fx.ts`, delete the `SyncDiv` type, `SYNC_BEATS`, `syncDivToHz`, `MasterFilterState`, `MasterFilter`, and `FilterChain` (the entire "Master filter chain" section). Delete the `FxBus` shim methods listed above and the `seed()` helper.

In `src/core/fx-ui.ts`, remove the `SYNC_OPTS`/`SyncDiv` import and any `applyDelaySync` remnants (already removed in Task 10) and the now-unused "Add Filter" hide logic if the element is gone.

- [ ] **Step 3: Clean affected tests**

Update/remove tests that referenced the deleted symbols (search output from Step 1). For `fx.test.ts`, ensure no `getMasterSendInstances`/`setReverbWet` assertions remain.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → succeeds.
Run: `NO_COLOR=1 npx vitest run` → all green (re-run once if `ERR_IPC_CHANNEL_CLOSED` teardown).

- [ ] **Step 5: Commit**

```bash
git add src/core/fx.ts src/core/fx-ui.ts src/core/fx.test.ts
git commit -m "chore(fx): remove dead FilterChain/MasterFilter + FxBus transitional shims"
```

---

## Phase 6 — Verification

### Task 13: e2e + live verification

**Files:**
- Create/extend: `tests/e2e/fx-sends.spec.ts`

- [ ] **Step 1: Build first (e2e serves dist/)**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 2: Write an e2e covering each user path (no `(or …)` alternatives)**

```ts
// tests/e2e/fx-sends.spec.ts
import { test, expect } from '@playwright/test';

test('Compressor insert can be added on an audio lane', async ({ page }) => {
  await page.goto('/');
  // (Follow the repo's existing e2e helpers to add an audio lane + open its
  //  inspector insert rack, then pick "Compressor" from the + Add insert menu.)
  // Assert the slot row shows "Compressor".
});

test('Reverb can be added as a lane insert (no longer send-only)', async ({ page }) => {
  await page.goto('/');
  // Open a lane insert rack; assert the picker now lists "Reverb".
});

test('FX page shows Send A and Send B return modules', async ({ page }) => {
  await page.goto('/');
  // Open the FX page; assert #fx-send-a and #fx-send-b render with a return
  // knob + insert rack each.
});
```

Fill the bodies using the existing e2e helper patterns in `tests/e2e/` (selectors for opening the inspector, the FX page, and the insert picker). One assertion per user path.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e`
Expected: the three specs pass.

- [ ] **Step 4: Live look (mandatory for UI claims)**

Start `npm run dev`, open `http://localhost:5173`, and confirm by eye:
- Mixer columns show `A` / `B` send knobs.
- FX page shows Send A (Delay) + Send B (Reverb) modules, each editable.
- Adding a Filter/Compressor/Limiter insert on an **audio** lane works and is audible.
- Loading each of the 4 demos still sounds equivalent (reverb/delay present via the migrated sends).

- [ ] **Step 5: Final full suite + commit**

Run: `npm run build && NO_COLOR=1 npx vitest run` → all green.

```bash
git add tests/e2e/fx-sends.spec.ts
git commit -m "test(fx): e2e for inserts on audio lanes + Send A/B return modules"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (two generic send buses A=Delay/B=Reverb): Tasks 3, 4, 7. ✓
- Goal 2 (per-channel A/B knobs): Tasks 5, 8. ✓
- Goal 3 (any FX insertable anywhere; reverb/delay no longer send-only): Tasks 4, 10 (drop `SEND_ONLY_IN_PHASE_1`). ✓
- Goal 4 (Compressor + Limiter plugins): Tasks 1, 2. ✓
- Goal 5 (keep fixed mixer strip): respected — `ChannelStrip` EQ/comp untouched (only sends renamed). ✓
- Non-goal "remove MasterFilter": Task 12. ✓
- Persistence/migration (new `sends`, remap rev/dly, demos): Tasks 6, 7. ✓
- Delay sync moves to the insert: Task 9. ✓
- Modulation destinations preserved via insert params: Task 11. ✓
- Testing (pure/wiring/DSP/e2e): Tasks 1–3, 6, 7, 13. ✓

**Placeholder scan:** Task 10 (`bpm-broadcast` deps) and Task 11 (modulation destination resolver) intentionally say "match the file's existing shape" because they depend on injected deps that must be read at implementation time; both name the exact symbols to add and the exact destination-id format. Task 13 e2e bodies reference "existing e2e helpers" — acceptable because they must reuse repo-specific selectors; the assertions are specified. No `TBD`/`TODO`/"implement later".

**Type consistency:** `SendBus`/`SendBusState`, `sendA`/`sendB`, `setSendA`/`setSendB`, `getReturnLevel`/`setReturnLevel`, `isMuted`/`setMuted`, `collectSends`/`rehydrateSends`, `defaultSends`/`remapLaneSendParams`, `InsertChain.setBpm`, delay `sync` indices — names are consistent across all tasks. `reverbInput → bus B`, `delayInput → bus A`, `sendA → delay`, `sendB → reverb` mapping is consistent in Tasks 4, 5, 7, 8.

**Note on `bus.serialize()` insert slots:** Task 3's `serialize(inserts=[])` takes slots from the session (Task 6 `collectSends` passes prior slots) — the live `FxInstance` carries no plugin id, so slots are session-owned exactly like `lane.inserts`. This is consistent and called out in Task 6 Step 3.
