# Sampler Per-Pad Control (Plan A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Sampler pad/zone its own sound + playback params (tune, filter, amp envelope, level, pan, reverb/delay sends, loop, mono-retrigger) instead of one global set — and render a drumkit sampler through the SAME per-voice rack as the synth drums.

**Architecture:** Per-pad params live in a `PadParamStore` keyed by MIDI note on the `SamplerEngine`. Each per-note `SamplerVoice` resolves its pad at trigger time and reads that pad's params (a fresh voice is created per note by `trigger-dispatch`). Per-pad level/pan/sends are applied by per-voice nodes (panner + send gains into the shared `FxBus`). A drumkit lane exposes `<voice>.<leaf>` param ids (GM voice names) + the mute/solo + rack-layout contract, so it reuses `drum-voice-rack`. **Modulation (LFO/ADSR per-pad) is deferred to Plan A2** — it needs trigger-time modulator binding.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (+ `node-web-audio-api` for DSP renders), SCSS.

**Reference spec:** [docs/superpowers/specs/2026-06-04-sampler-per-pad-modulation-design.md](../specs/2026-06-04-sampler-per-pad-modulation-design.md)

**Test conventions:** single files via `NO_COLOR=1 npx vitest run <path>` (no `--reporter`). DSP files end `.dsp.test.ts`, need `node-web-audio-api` (globalized in `test/setup.ts`); assertions RELATIVE (ratios, not absolute magnitudes). jsdom DOM tests need `/** @vitest-environment jsdom */` as the FIRST line (the project defaults to `environment: 'node'`).

**Pre-flight (advisory, per CLAUDE.md):** GitNexus is worktree-blind — its `impact`/`detect_changes` see the main repo, not this worktree; treat as advisory only.

---

## File Structure

- **Create** `src/engines/sampler-pad-params.ts` — `PadParams` type, defaults, per-leaf `EngineParamSpec` templates, and the pad-key↔note helpers. (Task 1)
- **Modify** `src/engines/sampler.ts` — the bulk:
  - `PadParamStore` + `getPad`/`setPad`; dynamic `get params()`; `getBaseValue`/`setBaseValue` per-pad routing; `setSharedFx`. (Task 2)
  - `SamplerVoice` per-pad sound reads (tune/cutoff/res/attack/decay). (Task 3)
  - `SamplerVoice` per-pad mixer (level/pan/rev/dly via nodes). (Task 4)
  - Loop. (Task 5)
  - Retrigger-mono. (Task 6)
  - Per-pad mute/solo + the `drum-voice-rack` contract. (Task 7)
  - `buildParamUI` rack (drumkit) / per-zone (melodic). (Tasks 9, 10)
- **Modify** `src/engines/drum-voice-rack.ts` — read the curated/advanced split from the engine via a `getRackLayout()` contract. (Task 8)
- **Modify** `src/engines/drums-engine.ts` — implement `getRackLayout()`. (Task 8)
- **Modify** `src/app/lane-allocator.ts` — call `setSharedFx` for the sampler. (Task 4)
- **Modify** `src/session/session.ts` — `engineState.sampler.padParams?`. (Task 11)
- **Modify** `src/session/session-engine-state.ts` — `mirrorPadParams`. (Task 11)
- **Modify** `src/session/session-host.ts` — restore `padParams` in `applyEngineState`. (Task 11)

### Canonical names (keep identical across tasks)

`PadParams` leaves: `tune, cutoff, res, attack, decay, level, pan, rev, dly, loop, loopStart, retrig`.
Pad key: `padKeyForNote(note)` = GM voice name (`kick`…) if `GM_DRUM_MAP[note]` exists, else `zone<note>`. Reverse: `noteForPadKey(key)` = `VOICE_MIDI[key]` if a voice name, else `Number(key.slice(4))`.
Engine methods (drum-rack contract, same as `DrumsEngine`): `getDrumVoiceMute/setDrumVoiceMute/getDrumVoiceSolo/toggleDrumVoiceSolo/getDrumVoiceMutes/setDrumVoiceMutes`, plus new `getRackLayout()`.

---

## Task 1: PadParams model + key helpers

**Files:**
- Create: `src/engines/sampler-pad-params.ts`
- Test: `src/engines/sampler-pad-params.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey } from './sampler-pad-params';
import { validateSpec } from './engine-params';

describe('sampler pad params', () => {
  it('defaults cover every leaf', () => {
    const leaves = PAD_LEAF_SPECS.map((s) => s.leaf);
    for (const l of leaves) expect(PAD_DEFAULTS).toHaveProperty(l);
    expect(leaves).toContain('loop');
    expect(leaves).toContain('retrig');
  });

  it('every leaf spec validates as an EngineParamSpec when prefixed', () => {
    for (const s of PAD_LEAF_SPECS) {
      const { leaf, ...rest } = s;
      expect(() => validateSpec({ ...rest, id: `kick.${leaf}` })).not.toThrow();
    }
  });

  it('padKeyForNote maps GM drum notes to voice names, else zone<note>', () => {
    expect(padKeyForNote(36)).toBe('kick');
    expect(padKeyForNote(38)).toBe('snare');
    expect(padKeyForNote(60)).toBe('zone60');
  });

  it('noteForPadKey is the inverse for voice names and zones', () => {
    expect(noteForPadKey('kick')).toBe(36);
    expect(noteForPadKey('snare')).toBe(38);
    expect(noteForPadKey('zone60')).toBe(60);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-params.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/engines/sampler-pad-params.ts`:

```ts
// src/engines/sampler-pad-params.ts
// Per-pad (per-keymap-entry) sound + playback params for the Sampler. A pad is
// identified by its trigger MIDI note; param ids use a pad KEY: the GM voice
// name for drumkit pads (so a drumkit reuses drum-voice-rack), else `zone<note>`.

import type { EngineParamSpec } from './engine-params';
import { GM_DRUM_MAP } from './drum-gm-map';
import { VOICE_MIDI } from './drum-gm-map';

export interface PadParams {
  tune: number;      // semitones, -24..24
  cutoff: number;    // 0..1 (60..18000 Hz exp)
  res: number;       // 0..1
  attack: number;    // s
  decay: number;     // s (release tail)
  level: number;     // 0..1.5
  pan: number;       // -1..1
  rev: number;       // 0..1
  dly: number;       // 0..1
  loop: number;      // 0 = one-shot, 1 = loop while gated
  loopStart: number; // 0..1 of sample duration
  retrig: number;    // 0 = poly, 1 = mono (re-hit cuts previous)
}

export const PAD_DEFAULTS: PadParams = {
  tune: 0, cutoff: 1, res: 0, attack: 0.005, decay: 0.08,
  level: 1, pan: 0, rev: 0, dly: 0, loop: 0, loopStart: 0, retrig: 0,
};

const ON_OFF = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
const POLY_MONO = [{ value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }];

/** Per-leaf spec templates; id is filled with `${padKey}.${leaf}` per pad. */
export const PAD_LEAF_SPECS: Array<Omit<EngineParamSpec, 'id'> & { leaf: keyof PadParams }> = [
  { leaf: 'tune',      label: 'TUNE',   kind: 'continuous', min: -24,   max: 24,  default: 0, unit: 'st' },
  { leaf: 'cutoff',    label: 'CUTOFF', kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { leaf: 'res',       label: 'RES',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'attack',    label: 'ATTACK', kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { leaf: 'decay',     label: 'DECAY',  kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { leaf: 'level',     label: 'LEVEL',  kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { leaf: 'pan',       label: 'PAN',    kind: 'continuous', min: -1,    max: 1,   default: 0 },
  { leaf: 'rev',       label: 'REV',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'dly',       label: 'DLY',    kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'loopStart', label: 'LSTART', kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { leaf: 'loop',      label: 'LOOP',   kind: 'discrete',   min: 0,     max: 1,   default: 0, options: ON_OFF },
  { leaf: 'retrig',    label: 'RETRIG', kind: 'discrete',   min: 0,     max: 1,   default: 0, options: POLY_MONO },
];

/** Pad key for a trigger note. */
export function padKeyForNote(note: number): string {
  return GM_DRUM_MAP[note] ?? `zone${note}`;
}

/** Inverse of padKeyForNote. */
export function noteForPadKey(key: string): number {
  if (key in VOICE_MIDI) return VOICE_MIDI[key as keyof typeof VOICE_MIDI];
  return Number(key.replace(/^zone/, ''));
}
```

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-params.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler-pad-params.ts src/engines/sampler-pad-params.test.ts
git commit -m "feat(sampler): per-pad param model (types, specs, note<->padKey helpers)"
```

---

## Task 2: SamplerEngine PadParamStore + dynamic params + routing

**Files:**
- Modify: `src/engines/sampler.ts`
- Test: `src/engines/sampler-pad-store.test.ts`

Context: `SamplerEngine` currently has flat global `paramValues` + `SAMPLER_PARAMS`. This task adds a per-pad store keyed by note, makes `params` dynamic (reflecting the keymap), and routes `getBaseValue`/`setBaseValue` for `<padKey>.<leaf>` ids. The GLOBAL params shrink to `gain` + `poly.voices` (keep them in `SAMPLER_PARAMS`); pitch/filter/amp move per-pad.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SamplerEngine } from './sampler';
import type { KeymapEntry } from '../samples/types';

function kit(): KeymapEntry[] {
  return [
    { sampleId: 'a', rootNote: 36, loNote: 36, hiNote: 36 }, // kick
    { sampleId: 'b', rootNote: 38, loNote: 38, hiNote: 38 }, // snare
  ];
}

describe('SamplerEngine per-pad params', () => {
  it('params reflect the keymap as <padKey>.<leaf> ids', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    const ids = e.params.map((p) => p.id);
    expect(ids).toContain('kick.tune');
    expect(ids).toContain('kick.decay');
    expect(ids).toContain('kick.loop');
    expect(ids).toContain('snare.cutoff');
    // global params still present
    expect(ids).toContain('gain');
    expect(ids).toContain('poly.voices');
  });

  it('set/getBaseValue round-trip a per-pad value (keyed by note)', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    e.setBaseValue('kick.tune', 7);
    expect(e.getBaseValue('kick.tune')).toBe(7);
    expect(e.getPad(36).tune).toBe(7);          // stored by note
    expect(e.getBaseValue('snare.tune')).toBe(0); // untouched default
  });

  it('an untouched per-pad param returns the default', () => {
    const e = new SamplerEngine();
    e.setKeymap(kit());
    expect(e.getBaseValue('kick.cutoff')).toBe(1);
    expect(e.getBaseValue('snare.decay')).toBe(0.08);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-store.test.ts`
Expected: FAIL — `e.getPad` is not a function; `kick.tune` not in params.

- [ ] **Step 3: Implement on `SamplerEngine`**

In `src/engines/sampler.ts`:

1. Imports (top, after existing imports):

```ts
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, type PadParams } from './sampler-pad-params';
import type { FxBus } from '../core/fx';
```

2. Shrink `SAMPLER_PARAMS` to the two globals (replace the whole array):

```ts
const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',        label: 'Gain',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16,  default: 8 },
];
```

3. On the class, replace `readonly params = SAMPLER_PARAMS;` with a dynamic getter and add the pad store + fx:

```ts
  // dynamic: globals + one <padKey>.<leaf> spec per keymap entry.
  get params(): EngineParamSpec[] {
    const out: EngineParamSpec[] = [...SAMPLER_PARAMS];
    for (const entry of this.keymap) {
      const key = padKeyForNote(entry.rootNote);
      for (const s of PAD_LEAF_SPECS) {
        const { leaf, ...rest } = s;
        out.push({ ...rest, id: `${key}.${leaf}` });
      }
    }
    return out;
  }

  private padStore: Record<number, Partial<PadParams>> = {};
  private fx: FxBus | null = null;
  setSharedFx(fx: FxBus): void { this.fx = fx; }

  /** Resolved pad params for a note (defaults merged with stored overrides). */
  getPad(note: number): PadParams {
    return { ...PAD_DEFAULTS, ...(this.padStore[note] ?? {}) };
  }
  /** Full per-pad override store — for persistence. */
  getPadStore(): Record<number, Partial<PadParams>> { return this.padStore; }
  setPadStore(store: Record<number, Partial<PadParams>>): void {
    this.padStore = {};
    for (const [k, v] of Object.entries(store)) this.padStore[Number(k)] = { ...v };
  }
```

4. Rewrite `getBaseValue`/`setBaseValue` to route per-pad ids:

```ts
  getBaseValue(id: string): number {
    if (id in this.paramValues) return this.paramValues[id];
    const dot = id.indexOf('.');
    if (dot > 0) {
      const key = id.slice(0, dot);
      const leaf = id.slice(dot + 1) as keyof PadParams;
      if (leaf in PAD_DEFAULTS) {
        const note = noteForPadKey(key);
        const stored = this.padStore[note]?.[leaf];
        return typeof stored === 'number' ? stored : PAD_DEFAULTS[leaf];
      }
    }
    return SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id in this.paramValues || SAMPLER_PARAMS.some((p) => p.id === id)) {
      this.paramValues[id] = v;
      return;
    }
    const dot = id.indexOf('.');
    if (dot <= 0) return;
    const key = id.slice(0, dot);
    const leaf = id.slice(dot + 1) as keyof PadParams;
    if (!(leaf in PAD_DEFAULTS)) return;
    const note = noteForPadKey(key);
    (this.padStore[note] ??= {})[leaf] = v;
  }
```

(Keep the constructor's `for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;` — it now seeds only the 2 globals.)

- [ ] **Step 4: Run → PASS** (new test + the existing `src/engines` sampler tests)

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-pad-store.test.ts`
Then: `NO_COLOR=1 npx vitest run src/engines` and `npx tsc --noEmit`.
Expected: PASS / clean. (Existing sampler DSP tests still use global `gain`/`pitch`/etc. — `pitch`/`filter.*`/`amp.*` ids are no longer in `SAMPLER_PARAMS`; the voice changes in Tasks 3-4 move those reads to per-pad. If an existing test sets `e.setBaseValue('pitch', …)` it now no-ops; update those tests to use `kick.tune` / per-pad equivalents in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-pad-store.test.ts
git commit -m "feat(sampler): per-pad PadParamStore + dynamic params + per-pad get/setBaseValue"
```

---

## Task 3: SamplerVoice reads per-pad sound params

**Files:**
- Modify: `src/engines/sampler.ts` (`SamplerVoice` + `createVoice`)
- Test: `src/engines/sampler-per-pad.dsp.test.ts`

The voice is created per note (`trigger-dispatch` does `createVoice` then `voice.trigger`). It must resolve its pad from the triggered note and read that pad's tune/cutoff/res/attack/decay. Replace the voice's `getParam(id)` global reads with a `getPad(note)` lookup.

- [ ] **Step 1: Write the failing DSP test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { spectralCentroid, rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;

// A short bright noise burst as the kick sample, a second for the snare.
function putNoise(id: string, ctx: OfflineAudioContext, dur = 0.3): void {
  const buf = ctx.createBuffer(1, Math.round(SR * dur), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.1));
  sampleCache.put(id, buf as unknown as AudioBuffer);
}

const KIT: KeymapEntry[] = [
  { sampleId: 'kick', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 'snare', rootNote: 38, loNote: 38, hiNote: 38 },
];

async function renderNote(note: number, mut: (e: SamplerEngine) => void): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putNoise('kick', ctx); putNoise('snare', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine();
  e.setSharedFx(fx);
  e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(note, 0, { gateDuration: 0.2, accent: false, slide: false });
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('sampler per-pad sound params are independent per pad', () => {
  it('kick CUTOFF down darkens the kick (lower centroid)', async () => {
    const open = await renderNote(36, (e) => e.setBaseValue('kick.cutoff', 1));
    const dark = await renderNote(36, (e) => e.setBaseValue('kick.cutoff', 0.15));
    expect(spectralCentroid(dark, SR)).toBeLessThan(spectralCentroid(open, SR));
  });

  it('kick TUNE only affects the kick, not the snare', async () => {
    // Tuning the kick up raises its centroid; the snare (untouched) is unchanged.
    const kickLo = await renderNote(36, () => {});
    const kickHi = await renderNote(36, (e) => e.setBaseValue('kick.tune', 12));
    expect(spectralCentroid(kickHi, SR)).toBeGreaterThan(spectralCentroid(kickLo, SR));
    const snareA = await renderNote(38, (e) => e.setBaseValue('kick.tune', 12));
    const snareB = await renderNote(38, () => {});
    expect(rms(snareA)).toBeCloseTo(rms(snareB), 5); // kick tune left snare alone
  });

  it('kick DECAY shorter shortens its tail', async () => {
    const tail = (b: Float32Array) => rms(b.subarray(Math.round(0.25 * SR)));
    const long  = await renderNote(36, (e) => e.setBaseValue('kick.decay', 0.4));
    const short = await renderNote(36, (e) => e.setBaseValue('kick.decay', 0.02));
    expect(tail(short)).toBeLessThan(tail(long));
  });
});
```

- [ ] **Step 2: Run → FAIL** (per-pad reads not wired)

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-per-pad.dsp.test.ts`
Expected: FAIL — the voice still reads global params; `kick.cutoff`/`kick.tune`/`kick.decay` have no effect.

- [ ] **Step 3: Rewrite SamplerVoice to read per-pad**

In `src/engines/sampler.ts`:

1. Change `createVoice` to pass a pad-aware API instead of `getParam`:

```ts
  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new SamplerVoice(ctx, output, this.keymap, {
      getPad: (note) => this.getPad(note),
      getGlobal: (id) => this.getBaseValue(id),
      fx: this.fx,
    });
  }
```

2. Define the API type + rewrite `SamplerVoice`'s constructor signature and the `trigger(midi…)` one-shot path (NOT `triggerSample`, which stays as-is for audio clips). Replace the constructor + `trigger` method:

```ts
interface SamplerVoiceApi {
  getPad: (note: number) => import('./sampler-pad-params').PadParams;
  getGlobal: (id: string) => number;
  fx: import('../core/fx').FxBus | null;
}

class SamplerVoice implements Voice {
  private src: AudioBufferSourceNode | null = null;
  private readonly filter: BiquadFilterNode;
  private readonly ampGain: GainNode;
  private started = false;
  private endTime = Infinity;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private api: SamplerVoiceApi,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.filter.connect(this.ampGain).connect(output);
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (opts.sample) { this.triggerSample(time, opts); return; }
    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return;
    const pad = this.api.getPad(entry.rootNote);

    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* */ }
      this.src.disconnect();
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // repitch by key distance + per-pad TUNE semitones.
    src.playbackRate.value = repitchRate(midi, entry.rootNote, pad.tune);
    src.connect(this.filter);
    this.src = src;

    // Per-pad lowpass.
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, pad.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + pad.res * 20, time);

    // Per-pad amp envelope.
    const peak = this.api.getGlobal('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM * pad.level;
    const atk = Math.max(0.001, pad.attack);
    const rel = Math.max(0.005, pad.decay);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + atk);
    const releaseAt = Math.max(time + atk, time + opts.gateDuration);
    g.setValueAtTime(peak, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, 0);
    src.stop(this.endTime);
    this.started = true;
  }
```

(Note: `repitchRate(midi, rootNote, semitones)` already adds a semitone offset — confirm its signature in `src/samples/keymap.ts`; `pad.tune` replaces the old global `pitch`.)

3. Update `getAudioParams()` to expose generic ids (still useful for Plan A2's binding, but no per-pad routing yet): leave it returning `gain`/`filter.cutoff`/`filter.resonance` as today — it does not block this task.

- [ ] **Step 4: Run → PASS + fix any existing sampler test**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-per-pad.dsp.test.ts`
Expected: PASS.
Then run the existing sampler DSP/unit tests: `NO_COLOR=1 npx vitest run src/engines` (and `src/samples`). If a pre-existing test sets a global `pitch`/`filter.cutoff`/`amp.*` and asserts an effect, migrate it to the per-pad id (`<voice>.tune`/`.cutoff`/`.decay`) — those params are now per-pad. Report any test you change.
`npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-per-pad.dsp.test.ts
git commit -m "feat(sampler): voice reads per-pad tune/cutoff/res/attack/decay at trigger"
```

---

## Task 4: Per-pad mixer (level applied; pan + rev/dly sends) + setSharedFx wiring

**Files:**
- Modify: `src/engines/sampler.ts` (`SamplerVoice` graph + trigger)
- Modify: `src/app/lane-allocator.ts` (call `setSharedFx('sampler')`)
- Test: `src/engines/sampler-per-pad-mixer.dsp.test.ts`

`level` is already applied (Task 3). This task adds the per-voice `StereoPanner` + reverb/delay send gains into the shared `FxBus`, and wires `setSharedFx` for sampler lanes in the allocator (today only `drums-machine` gets it).

- [ ] **Step 1: Write the failing DSP test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.2), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.8;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 }];

// Render STEREO so PAN is observable.
async function render(mut: (e: SamplerEngine) => void): Promise<{ L: Float32Array; R: Float32Array; revTail: number }> {
  const ctx = new OfflineAudioContext(2, Math.round(SR * 0.6), SR);
  putTone('k', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  fx.setReverbWet(1);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(36, 0, { gateDuration: 0.1, accent: false, slide: false });
  const ab = await ctx.startRendering();
  const L = new Float32Array(ab.getChannelData(0));
  const R = new Float32Array(ab.getChannelData(1));
  const revTail = rms(L.subarray(Math.round(0.3 * SR))); // long after the 0.1s gate = reverb only
  return { L, R, revTail };
}

describe('sampler per-pad mixer', () => {
  it('PAN left pushes more energy to L than R', async () => {
    const { L, R } = await render((e) => e.setBaseValue('kick.pan', -1));
    expect(rms(L)).toBeGreaterThan(rms(R) * 1.5);
  });
  it('REV send up adds reverb tail energy', async () => {
    const dry = await render((e) => e.setBaseValue('kick.rev', 0));
    const wet = await render((e) => e.setBaseValue('kick.rev', 1));
    expect(wet.revTail).toBeGreaterThan(dry.revTail * 2);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-per-pad-mixer.dsp.test.ts`
Expected: FAIL — no panner/sends yet (pan has no effect; rev tail unchanged).

- [ ] **Step 3: Add panner + sends to SamplerVoice**

In `src/engines/sampler.ts` `SamplerVoice`:

1. Add fields + build the graph in the constructor (replace the constructor body's node wiring):

```ts
  private readonly panner: StereoPannerNode;
  private readonly revSend: GainNode;
  private readonly dlySend: GainNode;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private api: SamplerVoiceApi,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0;
    this.dlySend = ctx.createGain(); this.dlySend.gain.value = 0;
    this.filter.connect(this.ampGain).connect(this.panner).connect(output);
    if (this.api.fx) {
      this.panner.connect(this.revSend).connect(this.api.fx.reverbInput);
      this.panner.connect(this.dlySend).connect(this.api.fx.delayInput);
    }
  }
```

2. In `trigger`, after computing `pad`, set pan + sends (just before `this.endTime = …`):

```ts
    this.panner.pan.setValueAtTime(pad.pan, time);
    this.revSend.gain.setValueAtTime(pad.rev, time);
    this.dlySend.gain.setValueAtTime(pad.dly, time);
```

3. In `dispose()`, disconnect the new nodes:

```ts
  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.filter.disconnect();
    this.ampGain.disconnect();
    this.panner.disconnect();
    this.revSend.disconnect();
    this.dlySend.disconnect();
  }
```

4. Mirror the pan/sends into `triggerSample` too (the audio-clip path) for consistency — add the same 3 `setValueAtTime` lines there reading `this.api.getPad`… (for clips there's no pad note; use `PAD_DEFAULTS` pan/rev/dly = neutral, so just connect through the panner at 0). Minimal: the panner is in-graph at pan=0, sends at 0 → clips are unchanged.

- [ ] **Step 4: Wire setSharedFx for the sampler in the allocator**

In `src/app/lane-allocator.ts`, find the `if (engineId === 'drums-machine') { … setSharedFx?.(deps.fx); … }` block (~line 142) and add a sibling:

```ts
    if (engineId === 'sampler') {
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
    }
```

(`FxBus` is already imported in lane-allocator; if not, add `import type { FxBus } from '../core/fx';`.)

- [ ] **Step 5: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-per-pad-mixer.dsp.test.ts`
Then `NO_COLOR=1 npx vitest run src/engines src/app/lane-allocator.test.ts` and `npx tsc --noEmit`.
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/engines/sampler.ts src/app/lane-allocator.ts src/engines/sampler-per-pad-mixer.dsp.test.ts
git commit -m "feat(sampler): per-voice panner + reverb/delay sends; setSharedFx for sampler lanes"
```

---

## Task 5: Per-pad LOOP

**Files:**
- Modify: `src/engines/sampler.ts` (`SamplerVoice.trigger`)
- Test: `src/engines/sampler-loop.dsp.test.ts`

When `pad.loop` is on, the source loops from `loopStart*duration` to the buffer end while the gate (+release) holds, so a short sample sustains.

- [ ] **Step 1: Write the failing DSP test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
// A SHORT 50 ms tone; without loop it is silent after 50 ms, with loop it sustains.
function putShort(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.05), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.7;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 's', rootNote: 36, loNote: 36, hiNote: 36 }];

async function render(loop: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putShort('s', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  e.setBaseValue('kick.loop', loop);
  e.setBaseValue('kick.decay', 0.01);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(36, 0, { gateDuration: 0.3, accent: false, slide: false }); // gate 300ms >> 50ms sample
  const ab = await ctx.startRendering();
  // energy in the 100..250 ms window — silent (one-shot) vs sustained (loop).
  return rms(new Float32Array(ab.getChannelData(0)).subarray(Math.round(0.1 * SR), Math.round(0.25 * SR)));
}

describe('sampler per-pad loop', () => {
  it('loop on sustains a short sample through the gate', async () => {
    const oneShot = await render(0);
    const looped  = await render(1);
    expect(looped).toBeGreaterThan(oneShot * 4);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-loop.dsp.test.ts`
Expected: FAIL — no loop; the short sample is silent in the window for both.

- [ ] **Step 3: Implement loop in `trigger`**

In `SamplerVoice.trigger`, after `src.buffer = buf;` and before `src.start(...)`, add:

```ts
    if (pad.loop > 0.5) {
      src.loop = true;
      src.loopStart = Math.min(pad.loopStart, 0.999) * buf.duration;
      src.loopEnd = buf.duration;
    }
```

(The existing `src.stop(this.endTime)` already bounds the loop to gate+release.)

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-loop.dsp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-loop.dsp.test.ts
git commit -m "feat(sampler): per-pad LOOP (loop + loopStart while gated)"
```

---

## Task 6: Per-pad RETRIGGER (mono)

**Files:**
- Modify: `src/engines/sampler.ts` (engine per-pad active-voice map + `SamplerVoice` registers/cuts)
- Test: `src/engines/sampler-retrig.test.ts`

When `pad.retrig` is mono, a new hit on the SAME note cuts the previous voice of that note. The engine holds `Map<note, SamplerVoice>`; each voice, on trigger, asks the engine to cut+replace if its pad is mono.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.5), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.5;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [{ sampleId: 't', rootNote: 36, loNote: 36, hiNote: 36 }];

function setup() {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  putTone('t', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  return { ctx: ctx as unknown as AudioContext, dest, e };
}

describe('sampler per-pad retrigger (mono)', () => {
  it('mono: a second hit cuts the first voice of the same pad', () => {
    const { ctx, dest, e } = setup();
    e.setBaseValue('kick.retrig', 1); // mono
    const v1 = e.createVoice(ctx, dest);
    v1.trigger(36, 0, { gateDuration: 0.4, accent: false, slide: false });
    const cut = vi_spyRelease(v1);
    const v2 = e.createVoice(ctx, dest);
    v2.trigger(36, 0.05, { gateDuration: 0.4, accent: false, slide: false });
    expect(cut.calledWith).toBeGreaterThanOrEqual(0); // v1 was released by the engine when v2 hit
  });

  it('poly (default): a second hit does NOT cut the first', () => {
    const { ctx, dest, e } = setup(); // retrig default = poly
    const v1 = e.createVoice(ctx, dest);
    let released = false;
    (v1 as unknown as { release: (t: number) => void }).release = () => { released = true; };
    v1.trigger(36, 0, { gateDuration: 0.4, accent: false, slide: false });
    const v2 = e.createVoice(ctx, dest);
    v2.trigger(36, 0.05, { gateDuration: 0.4, accent: false, slide: false });
    expect(released).toBe(false);
  });
});

// tiny local spy helper (avoid importing vi just for this)
function vi_spyRelease(v: unknown): { calledWith: number } {
  const rec = { calledWith: -1 };
  const orig = (v as { release: (t: number) => void }).release.bind(v);
  (v as { release: (t: number) => void }).release = (t: number) => { rec.calledWith = t; orig(t); };
  return rec;
}
```

> The first test asserts the engine *invoked* the previous voice's release on the second same-pad hit. The second asserts poly does not. (Simpler than rendering — the cut behavior is structural.)

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-retrig.test.ts`
Expected: FAIL — no retrig cut wiring; v1 never released.

- [ ] **Step 3: Implement engine-side mono retrig**

In `src/engines/sampler.ts`:

1. On `SamplerEngine`, add the active map + a cut method, and pass them into the voice API:

```ts
  private activeByNote = new Map<number, SamplerVoice>();

  // Mono retrig: if a new voice triggers a note whose pad is mono, release the
  // previous voice for that note, then register the new one.
  private retrigRegister(note: number, voice: SamplerVoice, time: number): void {
    if (this.getPad(note).retrig > 0.5) {
      const prev = this.activeByNote.get(note);
      if (prev && prev !== voice) prev.release(time);
    }
    this.activeByNote.set(note, voice);
  }
  private retrigUnregister(note: number, voice: SamplerVoice): void {
    if (this.activeByNote.get(note) === voice) this.activeByNote.delete(note);
  }
```

2. Extend `SamplerVoiceApi` and `createVoice`:

```ts
interface SamplerVoiceApi {
  getPad: (note: number) => import('./sampler-pad-params').PadParams;
  getGlobal: (id: string) => number;
  fx: import('../core/fx').FxBus | null;
  onTrigger: (note: number, voice: SamplerVoice, time: number) => void;
  onDispose: (note: number, voice: SamplerVoice) => void;
}
```
```ts
  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new SamplerVoice(ctx, output, this.keymap, {
      getPad: (note) => this.getPad(note),
      getGlobal: (id) => this.getBaseValue(id),
      fx: this.fx,
      onTrigger: (note, voice, time) => this.retrigRegister(note, voice, time),
      onDispose: (note, voice) => this.retrigUnregister(note, voice),
    });
  }
```

3. In `SamplerVoice.trigger`, capture the note and notify the engine BEFORE starting the source:

```ts
    this.note = entry.rootNote;
    this.api.onTrigger(entry.rootNote, this, time);
```
Add `private note = -1;` field. In `dispose()`, call `if (this.note >= 0) this.api.onDispose(this.note, this);` first.

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-retrig.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-retrig.test.ts
git commit -m "feat(sampler): per-pad RETRIGGER mono (new same-pad hit cuts the previous voice)"
```

---

## Task 7: Per-pad mute/solo + drum-rack contract

**Files:**
- Modify: `src/engines/sampler.ts`
- Test: `src/engines/sampler-mute-solo.test.ts`

Reuse the SAME contract the synth drums + `drum-voice-rack` use. Sampler voices are ephemeral, so a muted pad's voice simply triggers at level 0. The engine holds `voiceMute`/`voiceSolo` keyed by voice name; the voice checks `isPadAudible(note)` at trigger.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import { rms } from '../../test/dsp-asserts';
import type { KeymapEntry } from '../samples/types';

const SR = 44100;
function putTone(id: string, ctx: OfflineAudioContext): void {
  const buf = ctx.createBuffer(1, Math.round(SR * 0.2), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.7;
  sampleCache.put(id, buf as unknown as AudioBuffer);
}
const KIT: KeymapEntry[] = [
  { sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 's', rootNote: 38, loNote: 38, hiNote: 38 },
];
async function renderNote(note: number, mut: (e: SamplerEngine) => void): Promise<number> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.3), SR);
  putTone('k', ctx); putTone('s', ctx);
  const dest = ctx.createGain(); dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const e = new SamplerEngine(); e.setSharedFx(fx); e.setKeymap(KIT);
  mut(e);
  const v = e.createVoice(ctx as unknown as AudioContext, dest);
  v.trigger(note, 0, { gateDuration: 0.15, accent: false, slide: false });
  return rms(new Float32Array((await ctx.startRendering()).getChannelData(0)));
}

describe('sampler per-pad mute/solo', () => {
  it('muting kick silences the kick pad, snare unaffected', async () => {
    expect(await renderNote(36, (e) => e.setDrumVoiceMute('kick', true))).toBeLessThan(1e-4);
    expect(await renderNote(38, (e) => e.setDrumVoiceMute('kick', true))).toBeGreaterThan(1e-3);
  });
  it('soloing snare silences the kick', async () => {
    expect(await renderNote(36, (e) => e.toggleDrumVoiceSolo('snare'))).toBeLessThan(1e-4);
    expect(await renderNote(38, (e) => e.toggleDrumVoiceSolo('snare'))).toBeGreaterThan(1e-3);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-mute-solo.test.ts`
Expected: FAIL — `setDrumVoiceMute` not a function.

- [ ] **Step 3: Implement on `SamplerEngine`**

In `src/engines/sampler.ts`, import the shared compute + GM map:

```ts
import { computeVoiceMutes } from '../core/mute-solo';
import { padKeyForNote } from './sampler-pad-params';
```

Add state + the contract methods + an audibility check:

```ts
  private voiceMute: Record<string, boolean> = {};
  private voiceSolo: Record<string, boolean> = {};

  getDrumVoiceMute(v: string): boolean { return !!this.voiceMute[v]; }
  setDrumVoiceMute(v: string, m: boolean): void { this.voiceMute[v] = m; }
  getDrumVoiceSolo(v: string): boolean { return !!this.voiceSolo[v]; }
  toggleDrumVoiceSolo(v: string): void { this.voiceSolo[v] = !this.voiceSolo[v]; }
  getDrumVoiceMutes(): Record<string, boolean> { return { ...this.voiceMute }; }
  setDrumVoiceMutes(m: Record<string, boolean>): void { this.voiceMute = { ...m }; }

  /** True if the pad at `note` should sound now (per mute/solo over the kit's
   *  voice keys). Read by the voice at trigger time. */
  isPadAudible(note: number): boolean {
    const keys = this.keymap.map((e) => padKeyForNote(e.rootNote));
    const muted = computeVoiceMutes(keys, this.voiceMute, this.voiceSolo);
    return !muted[padKeyForNote(note)];
  }
```

Add `isPadAudible` to `SamplerVoiceApi` and `createVoice`:

```ts
  isPadAudible: (note: number) => boolean;
```
```ts
      isPadAudible: (note) => this.isPadAudible(note),
```

In `SamplerVoice.trigger`, fold audibility into the peak:

```ts
    const audible = this.api.isPadAudible(entry.rootNote) ? 1 : 0;
    const peak = this.api.getGlobal('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM * pad.level * audible;
```

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-mute-solo.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-mute-solo.test.ts
git commit -m "feat(sampler): per-pad mute/solo (drum-rack contract; voice gates at trigger)"
```

---

## Task 8: `drum-voice-rack` engine-driven layout (`getRackLayout`)

**Files:**
- Modify: `src/engines/drum-voice-rack.ts`
- Modify: `src/engines/drums-engine.ts`
- Test: `src/engines/drum-voice-rack.test.ts` (extend)

Today `drum-voice-rack` hard-codes `CURATED_SYNTH`/`CURATED_MIXER`/`ADVANCED_MIXER` (synth ids). To let the sampler reuse it, read the curated/advanced split from the engine via a `getRackLayout()` method, with the current synth split as the drums-engine's implementation.

- [ ] **Step 1: Write the failing test**

Append to `src/engines/drum-voice-rack.test.ts`:

```ts
  it('uses the engine getRackLayout for curated/advanced ids when present', () => {
    const host = document.createElement('div');
    const ids: string[] = [];
    const fakeEngine = {
      params: [
        { id: 'kick.tune', label: 'TUNE', kind: 'continuous', min: 0, max: 1, default: 0 },
        { id: 'kick.weird', label: 'W', kind: 'continuous', min: 0, max: 1, default: 0 },
        { id: 'kick.level', label: 'L', kind: 'continuous', min: 0, max: 1, default: 0 },
      ],
      getBaseValue: () => 0, setBaseValue: () => {},
      getRackLayout: () => ({ curatedSynth: ['tune'], curatedMixer: ['level'], advancedMixer: [] }),
      getDrumVoiceMute: () => false, setDrumVoiceMute: () => {},
      getDrumVoiceSolo: () => false, toggleDrumVoiceSolo: () => {}, getDrumVoiceMutes: () => ({}),
    } as unknown as import('./engine-types').SynthEngine;
    renderDrumVoiceRack(fakeEngine, makeCtx(ids), host, ['kick']);
    expect(ids).toContain('drums-1.kick.tune');   // curated synth
    expect(ids).toContain('drums-1.kick.level');  // curated mixer
    expect(ids).toContain('drums-1.kick.weird');  // falls into advanced
  });
```

> `renderDrumVoiceRack` gains an optional 4th arg: the explicit voice list (so the sampler can pass its kit's voice keys). When omitted it defaults to `DRUM_LANES` (synth behavior unchanged).

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-voice-rack.test.ts`
Expected: FAIL — `renderDrumVoiceRack` ignores `getRackLayout` / the 4th arg.

- [ ] **Step 3: Refactor `drum-voice-rack.ts`**

Add a layout type + read it from the engine; accept an optional voices arg. Replace the `CURATED_SYNTH` hard-coded map usage:

```ts
export interface RackLayout {
  curatedSynth: string[];   // leaf names
  curatedMixer: string[];
  advancedMixer: string[];
}

const DEFAULT_LAYOUT: RackLayout = {
  curatedSynth: [], // engines without getRackLayout: everything synth → advanced
  curatedMixer: ['level', 'rev', 'dly'],
  advancedMixer: ['pan', 'eq.low', 'eq.mid', 'eq.high'],
};

export function renderDrumVoiceRack(
  engine: SynthEngine,
  ctx: EngineUIContext,
  host: HTMLElement,
  voices: string[] = DRUM_LANES as unknown as string[],
): void {
  const layout = (engine as unknown as { getRackLayout?: () => RackLayout }).getRackLayout?.() ?? DEFAULT_LAYOUT;
  // ...build per voice using layout.curatedSynth / layout.curatedMixer / layout.advancedMixer
  // (replace the per-voice `CURATED_SYNTH[voice]` lookup with `layout.curatedSynth`,
  //  and the constants CURATED_MIXER/ADVANCED_MIXER with layout.curatedMixer/advancedMixer).
}
```

Inside the loop, change `for (const voice of DRUM_LANES)` → `for (const voice of voices)`, and `VOICE_LABELS[voice]` → `VOICE_LABELS[voice as DrumVoice] ?? voice.toUpperCase()` (sampler zones aren't in `VOICE_LABELS`). Build the curated/advanced Sets from `layout` instead of the module constants. Keep the M/S buttons exactly as they are (they already use the `getDrumVoice*` contract, which the sampler now implements).

- [ ] **Step 4: Implement `getRackLayout()` on `DrumsEngine`**

In `src/engines/drums-engine.ts`, add (near `getSharedAudioParams`):

```ts
  getRackLayout() {
    return {
      curatedSynth: ['tune', 'attack', 'decay', 'tone', 'snap'],
      curatedMixer: ['level', 'rev', 'dly'],
      advancedMixer: ['pan', 'eq.low', 'eq.mid', 'eq.high'],
    };
  }
```

> The synth rack's curated split previously lived in `drum-voice-rack`'s `CURATED_SYNTH` per-voice map. `getRackLayout` returns a SINGLE curated-synth leaf list shared by all voices; a voice only renders the leaves that actually exist as `<voice>.<leaf>` params (the rack already filters by existing ids). The union `['tune','attack','decay','tone','snap']` reproduces the OLD per-voice sets EXACTLY because `attack` exists only on kick, `tone` only on snare/clap, `snap` only on snare — so e.g. kick∩union = {tune,attack,decay}, snare∩union = {tune,tone,snap}, hats∩union = {tune,decay}. (Do NOT add `sweep`: it would wrongly promote kick/tom SWEEP from advanced to curated.) Verify the existing rack test (`'kick.tune' present`, advanced toggle) still passes.

- [ ] **Step 5: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-voice-rack.test.ts src/engines/drums-engine.test.ts src/engines/drums-buildparamui.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / clean. (If the synth rack's per-voice curated split changed visibly, adjust `getRackLayout` so each voice still shows its intended curated knobs.)

- [ ] **Step 6: Commit**

```bash
git add src/engines/drum-voice-rack.ts src/engines/drums-engine.ts src/engines/drum-voice-rack.test.ts
git commit -m "refactor(drums): drum-voice-rack reads curated/advanced split from engine.getRackLayout"
```

---

## Task 9: Sampler buildParamUI — drumkit rack

**Files:**
- Modify: `src/engines/sampler.ts` (`buildParamUI` + `getRackLayout`)
- Test: `src/engines/sampler-rack.test.ts`

When the lane is a drumkit (the keymap's notes are GM drum notes), render the per-pad rack via `renderDrumVoiceRack`, passing the kit's voice keys. Keep the keymap/file UI below.

- [ ] **Step 1: Write the failing test**

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import type { EngineUIContext } from './engine-types';
import type { KeymapEntry } from '../samples/types';

const KIT: KeymapEntry[] = [
  { sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 },
  { sampleId: 's', rootNote: 38, loNote: 38, hiNote: 38 },
];
function makeCtx(ids: string[]): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) ids.push(k.meta.id); },
    registry: new Map(),
  } as unknown as EngineUIContext;
}

describe('SamplerEngine.buildParamUI drumkit rack', () => {
  it('renders the per-voice rack with kick/snare columns for a GM drumkit', () => {
    const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
    const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination));
    e.setKeymap(KIT);
    const host = document.createElement('div');
    const ids: string[] = [];
    e.buildParamUI(host, makeCtx(ids));
    expect(host.querySelector('.drum-voice-rack')).not.toBeNull();
    expect(host.querySelectorAll('.dv-col').length).toBe(2);
    expect(ids).toContain('drums-1.kick.tune');
    expect(ids).toContain('drums-1.snare.decay');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-rack.test.ts`
Expected: FAIL — no `.drum-voice-rack` rendered.

- [ ] **Step 3: Implement**

In `src/engines/sampler.ts`:

1. Add the rack-layout for the sampler:

```ts
  getRackLayout() {
    return {
      curatedSynth: ['tune', 'cutoff', 'decay'],
      curatedMixer: ['level', 'rev', 'dly'],
      // advanced synth (res/attack/loop/loopStart/retrig) + pan auto-fall into advanced.
      advancedMixer: ['pan'],
    };
  }

  /** A lane is a drumkit when every keymap entry sits on a GM drum note. */
  private isDrumkit(): boolean {
    return this.keymap.length > 0 && this.keymap.every((e) => padKeyForNote(e.rootNote) !== `zone${e.rootNote}`);
  }
```

2. At the TOP of `buildParamUI` (after `container.innerHTML=''; if (!ctx) return;`), branch: if a drumkit, render the rack first:

```ts
    if (this.isDrumkit()) {
      const rackHost = document.createElement('div');
      container.appendChild(rackHost);
      const voices = this.keymap.map((e) => padKeyForNote(e.rootNote));
      renderDrumVoiceRack(this, ctx, rackHost, voices);
    }
```

Add `import { renderDrumVoiceRack } from './drum-voice-rack';`. Keep the existing global knob row + keymap UI below (they still render gain/voices + the drumkit picker + file load).

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-rack.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-rack.test.ts
git commit -m "feat(sampler): drumkit lane renders the per-voice rack (reuses drum-voice-rack)"
```

---

## Task 10: Sampler buildParamUI — melodic per-zone params

**Files:**
- Modify: `src/engines/sampler.ts` (`buildParamUI` keymap rows)
- Test: `src/engines/sampler-zone-ui.test.ts`

For a non-drumkit (melodic) sampler, render the per-zone params under each keymap row using `wireEngineParams` filtered to that zone's `zone<root>.<leaf>` ids.

- [ ] **Step 1: Write the failing test**

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { sampleCache } from '../samples/sample-cache';
import type { EngineUIContext } from './engine-types';
import type { KeymapEntry } from '../samples/types';

function makeCtx(ids: string[]): EngineUIContext {
  return { laneId: 'sampler-1', registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) ids.push(k.meta.id); }, registry: new Map() } as unknown as EngineUIContext;
}

describe('SamplerEngine.buildParamUI melodic per-zone params', () => {
  it('renders zone<root> param knobs under a melodic keymap row', () => {
    const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
    const buf = ctx.createBuffer(1, 64, 44100); sampleCache.put('m', buf as unknown as AudioBuffer);
    const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination));
    const km: KeymapEntry[] = [{ sampleId: 'm', rootNote: 60, loNote: 0, hiNote: 127 }];
    e.setKeymap(km);
    const host = document.createElement('div');
    const ids: string[] = [];
    e.buildParamUI(host, makeCtx(ids));
    expect(host.querySelector('.drum-voice-rack')).toBeNull(); // not a drumkit
    expect(ids).toContain('sampler-1.zone60.tune');
    expect(ids).toContain('sampler-1.zone60.cutoff');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-zone-ui.test.ts`
Expected: FAIL — no per-zone knobs registered.

- [ ] **Step 3: Implement**

In `buildParamUI`, inside the keymap-row loop (where each `sampler-keymap-row` is built), after the root input, append a per-zone param block (only when NOT a drumkit, since the rack covers drumkits):

```ts
      if (!this.isDrumkit()) {
        const zoneKey = padKeyForNote(entry.rootNote); // zone<root>
        const params = document.createElement('div');
        params.className = 'sampler-zone-params knob-row';
        row.appendChild(params);
        wireEngineParams(this, ctx, params, {
          knobSize: 30,
          filter: (id) => id.startsWith(`${zoneKey}.`),
        });
      }
```

(`wireEngineParams` is already imported.)

- [ ] **Step 4: Run → PASS**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-zone-ui.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts src/engines/sampler-zone-ui.test.ts
git commit -m "feat(sampler): melodic per-zone param knobs under each keymap row"
```

---

## Task 11: Persistence — per-pad params + mute survive save/load + drumkit reload

**Files:**
- Modify: `src/session/session.ts` (engineState type)
- Modify: `src/session/session-engine-state.ts` (`mirrorPadParams`)
- Modify: `src/session/session-host.ts` (`applyEngineState` restore)
- Modify: `src/engines/sampler.ts` (mirror on edit; restore re-applies after a drumkit reload)
- Test: `src/engines/sampler-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { SamplerEngine } from './sampler';
import { FxBus } from '../core/fx';
import { mirrorPadParams } from '../session/session-engine-state';
import type { SessionState } from '../session/session';
import type { KeymapEntry } from '../samples/types';

const KIT: KeymapEntry[] = [{ sampleId: 'k', rootNote: 36, loNote: 36, hiNote: 36 }];
function makeEngine(): SamplerEngine {
  const ctx = new OfflineAudioContext(1, 64, 44100) as unknown as AudioContext;
  const e = new SamplerEngine(); e.setSharedFx(new FxBus(ctx, ctx.destination)); e.setKeymap(KIT);
  return e;
}

describe('sampler per-pad persistence', () => {
  it('mirrorPadParams + setPadStore restores per-pad edits keyed by note', () => {
    const state = { lanes: [{ id: 'drums-1', engineState: {} }] } as unknown as SessionState;
    const a = makeEngine();
    a.setBaseValue('kick.tune', 5);
    mirrorPadParams(state, 'drums-1', a.getPadStore());
    const saved = (state.lanes[0] as { engineState: { sampler?: { padParams?: Record<number, Record<string, number>> } } })
      .engineState.sampler!.padParams!;
    expect(saved[36].tune).toBe(5);

    const b = makeEngine();
    b.setPadStore(saved as Record<number, Record<string, number>>);
    expect(b.getBaseValue('kick.tune')).toBe(5);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-persistence.test.ts`
Expected: FAIL — `mirrorPadParams` does not exist.

- [ ] **Step 3: Add the engineState field + mirror**

In `src/session/session.ts`, extend the `sampler?` field of `engineState`:

```ts
    sampler?: { keymap: import('../samples/types').KeymapEntry[]; drumkitId?: string; padParams?: Record<number, Record<string, number>> };
```

In `src/session/session-engine-state.ts`, add:

```ts
/** Mirror the sampler's per-pad param overrides (keyed by note) so per-pad
 *  edits persist + survive a drumkit reload-by-id. */
export function mirrorPadParams(
  state: SessionState,
  laneId: string,
  padParams: Record<number, Record<string, number>>,
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  const keymap = lane.engineState.sampler?.keymap ?? [];
  lane.engineState.sampler = {
    ...lane.engineState.sampler,
    keymap,
    padParams: JSON.parse(JSON.stringify(padParams)),
  };
}
```

(`Record<number, Partial<PadParams>>` serializes to `Record<number, Record<string, number>>` — the cast in the engine's `setPadStore` accepts it.)

- [ ] **Step 4: Restore in applyEngineState**

In `src/session/session-host.ts` `applyEngineState`, after the existing drumkit-reload block, restore pad params (feature-detected so only the sampler responds):

```ts
      const padParams = lane.engineState?.sampler?.padParams;
      if (padParams && typeof (engine as { setPadStore?: unknown }).setPadStore === 'function') {
        (engine as unknown as { setPadStore(s: Record<number, Record<string, number>>): void }).setPadStore(padParams);
      }
```

(Runs AFTER the async `reloadDrumkit` is *kicked off*; the pad-param store is independent of the keymap regeneration, so restoring it here is correct regardless of when the kit's samples finish decoding.)

- [ ] **Step 5: Mirror on edit in the sampler UI**

In `src/engines/sampler.ts` `buildParamUI`, the rack/zone knobs go through `wireEngineParams`, which already calls `mirrorParamChange` (params map). But per-pad params live in `padStore`, not `engineState.params`. So after the rack/zone `wireEngineParams` calls, also mirror the pad store on change. Simplest: wrap — pass a `formatter`-free `wireEngineParams` and additionally, in the drumkit + zone branches, register a one-line change hook. Concretely, change the rack/zone rendering to follow each `wireEngineParams` block with nothing, and instead override `setBaseValue` to mirror:

In `SamplerEngine.setBaseValue`, after writing a per-pad value, if a session-mirror hook is set, call it. Add a hook the UI installs:

```ts
  private onPadEdit: (() => void) | null = null;
  setPadEditHook(fn: (() => void) | null): void { this.onPadEdit = fn; }
```
At the end of the per-pad branch of `setBaseValue` add: `this.onPadEdit?.();`

In `buildParamUI`, install the hook so any per-pad edit mirrors:

```ts
    this.setPadEditHook(ctx.sessionState ? () => mirrorPadParams(ctx.sessionState!, ctx.laneId, this.getPadStore() as Record<number, Record<string, number>>) : null);
```

Add `import { mirrorKeymapChange, mirrorDrumkitId, mirrorPadParams } from '../session/session-engine-state';` (extend the existing import).

- [ ] **Step 6: Run → PASS + tsc + build**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-persistence.test.ts`
Then `npx tsc --noEmit` and `NO_COLOR=1 npx vitest run src/session`.
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/session/session.ts src/session/session-engine-state.ts src/session/session-host.ts src/engines/sampler.ts src/engines/sampler-persistence.test.ts
git commit -m "feat(sampler): persist per-pad params (keyed by note), restore after drumkit reload"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` (run in background; read the output file) → exit 0.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit` (background; read output). Expected: green except the known pre-existing 2 failures in `src/samples/drumkit-loader.dsp.test.ts` (ENOENT on gitignored sample WAVs) — confirm those are the ONLY failures and are unrelated. Re-run once if `ERR_IPC_CHANNEL_CLOSED` teardown flake appears.

- [ ] **Step 3: Browser smoke (manual — controller)**

Build, then open the app. With a sampler lane that has a bundled drumkit loaded: confirm the 8-column rack appears with M/S; turning a pad's TUNE/CUTOFF/DECAY changes only that pad at the next hit; PAN/REV/DLY work; LOOP sustains a short pad; RETRIG=mono cuts overlapping hits; presets/reload keep the per-pad edits. With a melodic sample: per-zone knobs appear under the keymap row.

- [ ] **Step 4: Commit (if any verification fixups were needed)** — otherwise nothing to commit.

---

## Self-Review (author)

- **Spec coverage:** per-pad params (T1-T3), per-pad mixer level/pan/sends (T3-T4), loop (T5), retrigger-mono (T6), per-pad mute/solo (T7), rack reuse via engine layout (T8-T9), melodic per-zone UI (T10), persistence keyed by note surviving reload (T11). Modulation explicitly **deferred to A2** (stated in goal + spec). All A1 scope covered.
- **Placeholder scan:** every code step has concrete code; the one prose-described edit (T8 Step 3 rack loop body, T10/T11 UI hooks) names exact insertion points + the surrounding code. No TBD/TODO.
- **Type consistency:** `PadParams` leaves identical across T1 (defs), T3-T7 (voice reads), T9-T10 (rack/zone ids). `getPad/getPadStore/setPadStore/getRackLayout/getDrumVoice*/isPadAudible/setPadEditHook` names consistent across tasks. `padKeyForNote`/`noteForPadKey` used consistently.
- **Known risk:** T2 shrinks `SAMPLER_PARAMS` (removes global `pitch`/`filter.*`/`amp.*`) — any existing sampler test asserting those global ids must migrate to per-pad ids (flagged in T3 Step 4). T8 changes the synth rack's curated-split source (per-voice map → engine union list) — the existing rack/buildparamui tests guard it.
