# Unified Drum Kits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Drums lane (`drums-machine`) play either synthesized kits or sample kits, chosen by a single unified preset, by embedding a complete `SamplerEngine` inside `DrumsEngine` and delegating to it by `kitMode` — no engine swap, no engine selector, no DSP extraction.

**Architecture:** `DrumsEngine` becomes a façade over two internal sources: the existing synth `DrumMachine` path and an eagerly-constructed embedded `SamplerEngine` instance. A `kitMode: 'synth' | 'sample'` flag selects which one `createVoice`/`params`/`buildParamUI`/the rack/mute-solo/persistence forward to. A new curated `drum-kits.json` drives the drums-page picker; a ctx-aware orchestrator in `session-host` performs the async sample-kit decode on live picks, while the existing `drumkitId` self-heal owns the decode on load. `drums-machine.json` + the GM/MIDI path stay for back-compat.

**Tech Stack:** TypeScript, Web Audio, Vite, Vitest (`NO_COLOR=1 npx vitest run <file>`), Playwright (e2e on the built `dist/`).

**Spec:** [docs/superpowers/specs/2026-06-04-unified-drum-presets-design.md](../specs/2026-06-04-unified-drum-presets-design.md)

---

## File Structure

- **Create** `public/presets/drum-kits.json` — the curated unified preset list (synth + sample entries).
- **Create** `src/presets/drum-kits-loader.ts` — fetch + validate + cache `drum-kits.json`; `loadDrumKits()` / `getDrumKits()` / types. Own cache, NOT the `EnginePreset` cache.
- **Create** `src/presets/drum-kits-loader.test.ts` — loader validation + grouping tests.
- **Modify** `src/session/session.ts` — add `kitMode?: 'synth' | 'sample'` to `SessionLane.engineState`.
- **Modify** `src/engines/drums-engine.ts` — turn `DrumsEngine` into the façade (embed sampler, `kitMode`, forwarders, mode-aware `createVoice`/`params`/`getBaseValue`/`setBaseValue`/`buildParamUI`/`getRackLayout`, rewritten `applyPreset`).
- **Modify** `src/engines/drums-engine.test.ts` — façade routing + applyPreset tests.
- **Modify** `src/session/session-host.ts` — restore `kitMode` in `applyEngineState`; add the public ctx-aware `applyDrumPreset` orchestrator.
- **Modify** `src/polysynth/polysynth-presets.ts` — replace `mountDrumsPresetSelect` with a unified-list populator (optgroups) + a drums-specific change/Load handler that routes to the orchestrator; add `applyDrumKitPreset` to `PolySynthPresetsDeps`.
- **Modify** `src/core/randomize-ui.ts` — re-point the drums 🎲 to the unified list via the orchestrator.
- **Modify** `src/main.ts` — start `loadDrumKits()` at boot; wire `applyDrumKitPreset` (→ `sessionHost.applyDrumPreset`) into `wirePolyControls`; pass the orchestrator to `wireRandomizeUI`.

---

## Task 1: `kitMode` schema field

**Files:**
- Modify: `src/session/session.ts:50-57`
- Test: `src/session/session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/session/session.test.ts`:

```ts
import { cloneSessionState } from './session';

describe('engineState.kitMode persistence', () => {
  it('round-trips kitMode through cloneSessionState', () => {
    const state = {
      lanes: [{ id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: { kitMode: 'sample' as const } }],
      scenes: [],
      globalQuantize: 'immediate' as const,
    };
    const clone = cloneSessionState(state);
    expect(clone.lanes[0].engineState?.kitMode).toBe('sample');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties, and 'kitMode' does not exist in type …" (the field is not on the type yet).

- [ ] **Step 3: Add the field**

In `src/session/session.ts`, extend the `engineState` object type (currently lines 50-57). Add `kitMode` after `drumMutes`:

```ts
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
    noteFx?: import('../notefx/notefx-types').NoteFxState[];
    sampler?: { keymap: import('../samples/types').KeymapEntry[]; drumkitId?: string; padParams?: Record<number, Record<string, number>> };
    /** Per-voice drum mute flags (drums-machine). Solo is live-only, not saved. */
    drumMutes?: Record<string, boolean>;
    /** Which drum source the Drums lane plays. Absent ⇒ 'synth' (façade default). */
    kitMode?: 'synth' | 'sample';
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts src/session/session.test.ts
git commit -m "feat(drums): add engineState.kitMode schema field (synth|sample)"
```

---

## Task 2: `drum-kits.json` + its loader

**Files:**
- Create: `public/presets/drum-kits.json`
- Create: `src/presets/drum-kits-loader.ts`
- Test: `src/presets/drum-kits-loader.test.ts`
- Modify: `src/main.ts:86-87`

- [ ] **Step 1: Create the asset**

Create `public/presets/drum-kits.json` (the `kitId`/`drumkitId` values match `src/core/drums.ts` `KITS` and `public/drumkits/index.json`):

```json
{
  "presets": [
    { "name": "TR-909",            "group": "Synth",   "kind": "synth",  "kitId": "909" },
    { "name": "TR-808",            "group": "Synth",   "kind": "synth",  "kitId": "808" },
    { "name": "TR-606",            "group": "Synth",   "kind": "synth",  "kitId": "606" },
    { "name": "CR-78",             "group": "Synth",   "kind": "synth",  "kitId": "78" },
    { "name": "LinnDrum",          "group": "Synth",   "kind": "synth",  "kitId": "linn" },
    { "name": "TR-808 (samples)",  "group": "Samples", "kind": "sample", "drumkitId": "tr808" },
    { "name": "Acoustic (samples)","group": "Samples", "kind": "sample", "drumkitId": "acoustic" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `src/presets/drum-kits-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrumKits, getDrumKits, __resetDrumKitsCache, validateDrumKit } from './drum-kits-loader';

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('drum-kits-loader', () => {
  beforeEach(() => __resetDrumKitsCache());

  it('validates a synth entry and a sample entry', () => {
    expect(validateDrumKit({ name: 'A', group: 'Synth', kind: 'synth', kitId: '909' })).toBe(true);
    expect(validateDrumKit({ name: 'B', group: 'Samples', kind: 'sample', drumkitId: 'tr808' })).toBe(true);
  });

  it('rejects malformed entries', () => {
    expect(validateDrumKit({ name: 'A', group: 'Synth', kind: 'synth' })).toBe(false); // no kitId
    expect(validateDrumKit({ name: 'B', group: 'Samples', kind: 'sample' })).toBe(false); // no drumkitId
    expect(validateDrumKit({ name: '', group: 'Synth', kind: 'synth', kitId: '909' })).toBe(false); // empty name
    expect(validateDrumKit({ name: 'C', group: 'Synth', kind: 'bogus', kitId: '909' })).toBe(false); // bad kind
  });

  it('loads + caches, dropping malformed entries', async () => {
    const body = { presets: [
      { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
      { name: 'bad', group: 'Synth', kind: 'synth' },
      { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
    ] };
    const out = await loadDrumKits(fakeFetch(body));
    expect(out.map((p) => p.name)).toEqual(['TR-909', 'TR-808 (samples)']);
    expect(getDrumKits().map((p) => p.name)).toEqual(['TR-909', 'TR-808 (samples)']);
  });

  it('getDrumKits is empty before load', () => {
    expect(getDrumKits()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/presets/drum-kits-loader.test.ts`
Expected: FAIL with "Failed to resolve import './drum-kits-loader'".

- [ ] **Step 4: Implement the loader**

Create `src/presets/drum-kits-loader.ts`:

```ts
// src/presets/drum-kits-loader.ts
// Loads + validates the curated unified drum-kit preset list
// (public/presets/drum-kits.json) that drives the Drums-page picker. Each entry
// is either a synth kit (kitId → DrumMachine) or a sample kit (drumkitId →
// embedded sampler). Kept in its OWN cache, separate from the EnginePreset cache
// (its schema has no gm[]/params{} and would fail validatePresetEntry).

export interface DrumKitPreset {
  name: string;
  group: string;            // display heading, e.g. 'Synth' | 'Samples'
  kind: 'synth' | 'sample';
  kitId?: string;           // synth: a DrumMachine KIT id
  drumkitId?: string;       // sample: a bundled drumkit id (public/drumkits/<id>.json)
}

export function validateDrumKit(raw: unknown): raw is DrumKitPreset {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return false;
  if (typeof r.group !== 'string' || r.group.length === 0) return false;
  if (r.kind === 'synth') return typeof r.kitId === 'string' && r.kitId.length > 0;
  if (r.kind === 'sample') return typeof r.drumkitId === 'string' && r.drumkitId.length > 0;
  return false;
}

let cache: DrumKitPreset[] | null = null;
let inflight: Promise<DrumKitPreset[]> | null = null;

/** Fetch + validate once; idempotent (returns the cached promise on re-call). */
export function loadDrumKits(fetchFn: typeof fetch = fetch): Promise<DrumKitPreset[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetchFn('/presets/drum-kits.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { presets?: unknown[] };
      const seen = new Set<string>();
      const out: DrumKitPreset[] = [];
      for (const raw of body.presets ?? []) {
        if (!validateDrumKit(raw)) { console.warn('[drum-kits] dropping malformed entry', raw); continue; }
        if (seen.has(raw.name)) { console.warn(`[drum-kits] duplicate name "${raw.name}" — dropping`); continue; }
        seen.add(raw.name);
        out.push(raw);
      }
      cache = out;
      return out;
    } catch (err) {
      console.warn('[drum-kits] failed to load drum-kits.json:', err);
      cache = [];
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous cache read — empty until loadDrumKits resolves. */
export function getDrumKits(): DrumKitPreset[] {
  return cache ?? [];
}

/** Look up one unified entry by display name. */
export function findDrumKit(name: string): DrumKitPreset | undefined {
  return getDrumKits().find((p) => p.name === name);
}

/** Test-only — reset module state between cases. */
export function __resetDrumKitsCache(): void {
  cache = null;
  inflight = null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/presets/drum-kits-loader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the loader at boot**

In `src/main.ts`, find line 87 (`const presetsLoaded = loadAllPresets(ENGINE_IDS_FOR_PRESETS);`). Add the import near the other preset import (line 54 imports from `./presets/preset-loader`) and kick off the load right after line 87:

```ts
import { loadDrumKits } from './presets/drum-kits-loader';
```

```ts
const presetsLoaded = loadAllPresets(ENGINE_IDS_FOR_PRESETS);
// Unified Drums picker list (synth + sample kits). Fire-and-forget; the drums
// populator re-renders when this resolves (see mountDrumsPresetSelect).
void loadDrumKits();
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add public/presets/drum-kits.json src/presets/drum-kits-loader.ts src/presets/drum-kits-loader.test.ts src/main.ts
git commit -m "feat(drums): unified drum-kits.json + loader, started at boot"
```

---

## Task 3: DrumsEngine façade — embed sampler, kitMode, forwarders

This task adds the embedded sampler, the `kitMode` flag, the `setSharedFx` forward, the keymap/padStore forwarders the load path feature-detects, and routes mute/solo through the active source. (createVoice/params/buildParamUI mode-switching is Task 4; applyPreset is Task 5 — leave them as-is for now.)

**Files:**
- Modify: `src/engines/drums-engine.ts`
- Test: `src/engines/drums-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/engines/drums-engine.test.ts`:

```ts
import { DrumsEngine } from './drums-engine';

describe('DrumsEngine façade — kitMode + forwarders', () => {
  it('defaults to synth mode', () => {
    const e = new DrumsEngine();
    expect(e.getKitMode()).toBe('synth');
  });

  it('setKitMode flips the mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    expect(e.getKitMode()).toBe('sample');
  });

  it('forwards setKeymap/getKeymap/setPadStore/getPadStore to the embedded sampler', () => {
    const e = new DrumsEngine();
    const km = [{ sampleId: 's1', rootNote: 36, loNote: 36, hiNote: 36 }];
    e.setKeymap(km);
    expect(e.getKeymap()).toEqual(km);
    e.setPadStore({ 36: { tune: 3 } });
    expect(e.getPadStore()[36]).toEqual({ tune: 3 });
  });

  it('routes drum-voice mutes to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    e.setDrumVoiceMutes({ kick: true });
    expect(e.getDrumVoiceMutes()).toEqual({ kick: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: FAIL — `e.getKitMode is not a function` (and the others).

- [ ] **Step 3: Add the embedded sampler + kitMode + forwarders**

In `src/engines/drums-engine.ts`:

(a) Add the import near the top (after the `DrumMachine` import at line 13):

```ts
import { SamplerEngine } from './sampler';
import type { KeymapEntry } from '../samples/types';
import type { PadParams } from './sampler-pad-params';
```

(b) Inside `class DrumsEngine`, add fields + accessors. Put them right after `private lastInstance: DrumMachine | null = null;` (line 224):

```ts
  /** Embedded, complete Sampler instance — the sample-kit source. Eager so
   *  host-wiring (setSharedFx) reaches it before its first createVoice. */
  private sampler = new SamplerEngine();
  private kitMode: 'synth' | 'sample' = 'synth';

  getKitMode(): 'synth' | 'sample' { return this.kitMode; }
  setKitMode(m: 'synth' | 'sample'): void { this.kitMode = m; }

  /** Keymap + pad-store forwarders to the embedded sampler. The session load
   *  path (applyEngineState) feature-detects these on the LANE engine (this
   *  façade), so they must exist here; they target the embedded sampler in
   *  both modes (inert for a synth lane that has no engineState.sampler). */
  setKeymap(km: KeymapEntry[]): void { this.sampler.setKeymap(km); }
  getKeymap(): KeymapEntry[] { return this.sampler.getKeymap(); }
  setPadStore(s: Record<number, Partial<PadParams>>): void { this.sampler.setPadStore(s); }
  getPadStore(): Record<number, Partial<PadParams>> { return this.sampler.getPadStore(); }
```

(c) Forward `setSharedFx` to the embedded sampler. Replace the existing setter (line 241):

```ts
  setSharedFx(fx: FxBus): void { this.sharedFx = fx; this.sampler.setSharedFx(fx); }
```

(d) Route the per-voice mute/solo delegation through the active source. Replace the block at lines 261-267:

```ts
  // ── Per-voice mute/solo (delegates to the active source) ─────────────────
  private muteTarget(): { getDrumVoiceMute(v: string): boolean; setDrumVoiceMute(v: string, m: boolean): void; getDrumVoiceSolo(v: string): boolean; toggleDrumVoiceSolo(v: string): void; getDrumVoiceMutes(): Record<string, boolean>; setDrumVoiceMutes(m: Record<string, boolean>): void } | null {
    if (this.kitMode === 'sample') return this.sampler;
    return this.lastInstance
      ? {
          getDrumVoiceMute: (v) => this.lastInstance!.getVoiceMute(v as DrumVoice),
          setDrumVoiceMute: (v, m) => this.lastInstance!.setVoiceMute(v as DrumVoice, m),
          getDrumVoiceSolo: (v) => this.lastInstance!.getVoiceSolo(v as DrumVoice),
          toggleDrumVoiceSolo: (v) => this.lastInstance!.toggleVoiceSolo(v as DrumVoice),
          getDrumVoiceMutes: () => this.lastInstance!.getVoiceMutes(),
          setDrumVoiceMutes: (m) => this.lastInstance!.setVoiceMutes(m),
        }
      : null;
  }
  getDrumVoiceMute(voice: DrumVoice): boolean { return this.muteTarget()?.getDrumVoiceMute(voice) ?? false; }
  setDrumVoiceMute(voice: DrumVoice, muted: boolean): void { this.muteTarget()?.setDrumVoiceMute(voice, muted); }
  getDrumVoiceSolo(voice: DrumVoice): boolean { return this.muteTarget()?.getDrumVoiceSolo(voice) ?? false; }
  toggleDrumVoiceSolo(voice: DrumVoice): void { this.muteTarget()?.toggleDrumVoiceSolo(voice); }
  /** Full mute map for persistence (solo is live-only). */
  getDrumVoiceMutes(): Record<string, boolean> { return this.muteTarget()?.getDrumVoiceMutes() ?? {}; }
  setDrumVoiceMutes(mutes: Record<string, boolean>): void { this.muteTarget()?.setDrumVoiceMutes(mutes); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS (new tests + existing ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-engine.test.ts
git commit -m "feat(drums): embed SamplerEngine + kitMode + keymap/padStore/mute forwarders"
```

---

## Task 4: DrumsEngine façade — mode-aware createVoice, params, buildParamUI, rack

**Files:**
- Modify: `src/engines/drums-engine.ts`
- Test: `src/engines/drums-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/engines/drums-engine.test.ts`:

```ts
import { GM_DRUM_MAP } from './drum-gm-map';

describe('DrumsEngine façade — mode-aware surface', () => {
  it('params forward to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    const synthParamCount = e.params.length;
    e.setKitMode('sample');
    e.setKeymap([{ sampleId: 's', rootNote: 36, loNote: 36, hiNote: 36 }]);
    // Sampler params are dynamic: globals (gain, poly.voices) + one set per pad.
    expect(e.params.some((p) => p.id === 'gain')).toBe(true);
    expect(e.params.some((p) => p.id === 'kick.tune')).toBe(true);
    expect(e.params.length).not.toBe(synthParamCount);
  });

  it('getRackLayout forwards to the embedded sampler in sample mode', () => {
    const e = new DrumsEngine();
    e.setKitMode('sample');
    expect(e.getRackLayout().curatedSynth).toEqual(['tune', 'cutoff', 'decay']);
  });

  it('createVoice in sample mode triggers the embedded sampler', () => {
    const ctx = new AudioContext();
    const e = new DrumsEngine();
    e.setSharedFx({ reverbInput: ctx.createGain(), delayInput: ctx.createGain() } as unknown as import('../core/fx').FxBus);
    e.setKitMode('sample');
    // a kick pad with no decoded buffer just no-ops in the voice; we only assert
    // delegation produced a Voice with a trigger method.
    e.setKeymap([{ sampleId: 'missing', rootNote: 36, loNote: 36, hiNote: 36 }]);
    const v = e.createVoice(ctx, ctx.destination);
    expect(typeof v.trigger).toBe('function');
    expect(() => v.trigger(GM_DRUM_MAP[36] ? 36 : 36, ctx.currentTime, { gateDuration: 0.1, accent: false } as never)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: FAIL — sample-mode `params`/`getRackLayout` still return the synth set; createVoice always builds a `DrumMachine`.

- [ ] **Step 3: Make `params` mode-aware**

In `src/engines/drums-engine.ts`, `readonly params = DRUM_PARAMS;` (line 220) is a fixed field. Replace it with a getter:

```ts
  get params(): EngineParamSpec[] {
    return this.kitMode === 'sample' ? this.sampler.params : DRUM_PARAMS;
  }
```

- [ ] **Step 4: Make `getBaseValue`/`setBaseValue` mode-aware**

At the top of `getBaseValue` (line 283) add:

```ts
  getBaseValue(id: string): number {
    if (this.kitMode === 'sample') return this.sampler.getBaseValue(id);
    // …existing synth body unchanged…
```

At the top of `setBaseValue` (line 299) add:

```ts
  setBaseValue(id: string, v: number): void {
    if (this.kitMode === 'sample') { this.sampler.setBaseValue(id, v); return; }
    // …existing synth body unchanged…
```

- [ ] **Step 5: Make `getRackLayout` mode-aware**

Replace `getRackLayout()` (lines 440-457) — keep the synth layout, add the sample branch up top:

```ts
  getRackLayout() {
    if (this.kitMode === 'sample') return this.sampler.getRackLayout();
    return {
      curatedSynth: ['tune', 'attack', 'decay', 'tone', 'snap'],
      curatedMixer: ['level', 'rev', 'dly'],
      advancedMixer: ['pan', 'eq.low', 'eq.mid', 'eq.high'],
    };
  }
```

- [ ] **Step 6: Make `buildParamUI` mode-aware**

At the top of `buildParamUI` (line 384), before `container.innerHTML = '';`, add the sample-mode delegation:

```ts
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (this.kitMode === 'sample') { this.sampler.buildParamUI(container, ctx); return; }
    container.innerHTML = '';
    if (!ctx) return;
    // …existing synth body unchanged…
```

- [ ] **Step 7: Make `createVoice` mode-aware (delegate to the sampler, keep bus modulators)**

Replace `createVoice` (lines 339-378). Keep the synth path verbatim; add the sample branch that delegates to the embedded sampler and keeps the bus-modulator binding alive via a wrapper:

```ts
  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    const routingTarget = this.outputTarget ?? output;

    if (this.kitMode === 'sample') {
      const inner = this.sampler.createVoice(ctx, routingTarget);
      // Keep the bus-level LFO/ADSR (which target the shared bus strip) bound
      // in sample mode too — bind on create, tear down on dispose, mirroring
      // the synth DrumsVoice lifecycle.
      if (!this.engineModVoices) this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
      const laneId = getCurrentLaneForVoice();
      let binder: ConnectionBinder | null = null;
      if (laneId) {
        binder = bindEngineModulators({ laneId, engine: this, voiceMods: this.engineModVoices, ctx });
        this.currentLaneId = laneId;
      }
      return {
        trigger: (m, t, o) => inner.trigger(m, t, o),
        release: (t) => inner.release(t),
        connect: (d) => inner.connect(d),
        getAudioParams: () => inner.getAudioParams(),
        getAudioParamRange: (id) => inner.getAudioParamRange?.(id),
        dispose: () => {
          inner.dispose();
          if (binder) binder.disposeAll();
          if (laneId) disposeLaneModulations(laneId);
        },
      };
    }

    // ── synth path (unchanged) ──
    let dm = this.instances.get(routingTarget);
    if (!dm) {
      if (!this.sharedFx) {
        throw new Error('DrumsEngine: setSharedFx must be called before createVoice');
      }
      dm = new DrumMachine(ctx, this.sharedFx, routingTarget);
      this.instances.set(routingTarget, dm);
    }
    this.lastInstance = dm;
    const drumVoice = new DrumsVoice(dm, this.busStrip);
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
    }
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      drumVoice.laneId = laneId;
      drumVoice.binder = bindEngineModulators({
        laneId, engine: this, voiceMods: this.engineModVoices, ctx,
      });
      this.currentLaneId = laneId;
    }
    return drumVoice;
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-engine.test.ts
git commit -m "feat(drums): mode-aware createVoice/params/buildParamUI/rack — delegate to embedded sampler"
```

---

## Task 5: DrumsEngine.applyPreset — unified list, kitMode-first, no early-return, back-compat

**Files:**
- Modify: `src/engines/drums-engine.ts:419-438`
- Test: `src/engines/drums-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/engines/drums-engine.test.ts`. The loader cache is seeded directly (no fetch):

```ts
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';
import { __seedPresetCache, __resetPresetCache } from '../presets/preset-loader';

async function seedDrumKits() {
  __resetDrumKitsCache();
  await loadDrumKits((async () => ({ ok: true, json: async () => ({ presets: [
    { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
    { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
  ] }) })) as unknown as typeof fetch);
}

describe('DrumsEngine.applyPreset — unified + back-compat', () => {
  beforeEach(async () => { await seedDrumKits(); });

  it('sets kitMode=sample + mirrors nothing-to-decode (no early-return without an instance)', () => {
    const e = new DrumsEngine();              // NO createVoice → lastInstance is null
    e.applyPreset('TR-808 (samples)');
    expect(e.getKitMode()).toBe('sample');
  });

  it('sets kitMode=synth for a unified synth kit', () => {
    const e = new DrumsEngine();
    e.applyPreset('TR-909');
    expect(e.getKitMode()).toBe('synth');
  });

  it('back-compat: a legacy GM-tagged KIT name still resolves to a synth kit', () => {
    __resetPresetCache();
    __seedPresetCache('drums-machine', [
      { name: 'KIT Power', gm: [16], params: { kitId: '909' } } as never,
    ]);
    const e = new DrumsEngine();
    const ctx = new AudioContext();
    e.setSharedFx({ reverbInput: ctx.createGain(), delayInput: ctx.createGain() } as never);
    setCurrentLaneForVoice('drums-1');
    e.createVoice(ctx, ctx.destination);      // builds lastInstance
    setCurrentLaneForVoice(null);
    e.applyPreset('KIT Power');
    expect(e.getKitMode()).toBe('synth');
    expect(e.getInstance()?.kitId).toBe('909');
  });
});
```

Add the import for `setCurrentLaneForVoice` at the top of the test file if not present:

```ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: FAIL — the current `applyPreset` early-returns on `!lastInstance` and never sets `kitMode`.

- [ ] **Step 3: Rewrite `applyPreset`**

Add the import near the top of `drums-engine.ts` (after the SamplerEngine import from Task 3):

```ts
import { findDrumKit } from '../presets/drum-kits-loader';
```

`applyPreset` is sync + ctx-less and the engine holds no `SessionState`, so it must NOT decode or mirror — it only sets `kitMode` (and loads a synth kit when an instance exists). The decode + `engineState.sampler` mirror are owned by the session-host orchestrator (live pick, Task 7) and the `drumkitId` self-heal (load). Replace `applyPreset` (lines 419-438):

```ts
  applyPreset(name: string): void {
    // 1) Unified drum-kits.json entry (the drums-page picker vocabulary).
    const unified = findDrumKit(name);
    if (unified) {
      this.kitMode = unified.kind;
      if (unified.kind === 'synth' && unified.kitId && this.lastInstance) {
        this.lastInstance.loadKitDefaults(unified.kitId);
      }
      // sample kit: kitMode is set; the async decode + engineState mirror is
      // owned by the orchestrator (live) / the drumkitId self-heal (load).
      // applyPreset is sync + ctx-less, so it does NOT fetch/decode here.
      return;
    }
    // 2) Legacy back-compat: a GM-tagged drums-machine.json preset ("KIT *",
    //    used by MIDI import / demos / drumFallback) → kitId → synth kit.
    this.kitMode = 'synth';
    const preset = this.presets.find((p) => p.name === name);
    let kitId: string | undefined;
    let overrides: Array<[string, number]> = [];
    if (preset) {
      const params = preset.params as Record<string, number | string>;
      if (typeof params.kitId === 'string') kitId = params.kitId;
      overrides = Object.entries(params)
        .filter(([k, v]) => k !== 'kitId' && typeof v === 'number') as Array<[string, number]>;
    }
    // 3) Bare kit *name* fallback (direct DrumMachine kit selection).
    if (!kitId && this.lastInstance) {
      kitId = this.lastInstance.listKits().find((k) => k.name === name)?.id;
    }
    if (kitId && this.lastInstance) this.lastInstance.loadKitDefaults(kitId);
    for (const [id, v] of overrides) this.setBaseValue(id, v);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing drums preset/persistence suites (regression)**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-preset-apply.test.ts src/engines/drums-persistence.test.ts`
Expected: PASS (back-compat preserved).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-engine.test.ts
git commit -m "feat(drums): applyPreset resolves unified list then legacy GM names; sets kitMode first, no early-return"
```

---

## Task 6: Persistence load — restore kitMode in applyEngineState

**Files:**
- Modify: `src/session/session-host.ts:301-345`
- Test: `src/session/session-host.test.ts` (or the nearest existing session-host test file — search for `applyEngineState`)

- [ ] **Step 1: Write the failing test**

Find the existing session-host test that drives `applyEngineState` (search: `NO_COLOR=1 npx vitest run -t "applyEngineState"` to find the file, e.g. `src/session/session-host.test.ts`). Append a test that a lane whose `engineState.kitMode='sample'` has `setKitMode('sample')` called on its façade engine. Use a stub engine recording the call:

```ts
describe('applyEngineState restores kitMode', () => {
  it('calls setKitMode on the lane engine from engineState.kitMode', () => {
    const calls: string[] = [];
    const stubEngine = {
      id: 'drums-machine',
      params: [],
      setBaseValue() {}, getBaseValue() { return 0; },
      setKitMode(m: string) { calls.push(m); },
      modulators: { deserialize() {}, serialize() { return []; } },
    };
    // Build a SessionHost wired with a laneResources stub returning stubEngine
    // for lane 'drums-1' (follow the existing test harness in this file).
    const host = makeHostWithEngine('drums-1', stubEngine); // helper per this file's pattern
    host.loadState({
      lanes: [{ id: 'drums-1', engineId: 'drums-machine', clips: [], engineState: { kitMode: 'sample' } }],
      scenes: [], globalQuantize: 'immediate',
    });
    expect(calls).toContain('sample');
  });
});
```

> If the test file has no reusable harness for `applyEngineState`, model the stub/host wiring on the closest existing test in that file (the controller will provide the exact harness shape when dispatching this task).

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host.test.ts`
Expected: FAIL — `setKitMode` is never called (applyEngineState doesn't restore kitMode yet).

- [ ] **Step 3: Restore kitMode in applyEngineState**

In `src/session/session-host.ts`, inside `applyEngineState()` (line 301), right after `if (!engine) continue;` (line 304) add:

```ts
      // Restore which drum source the Drums lane plays BEFORE keymap/padStore/
      // mute restore, so the façade's active() points at the right source.
      const kitMode = lane.engineState?.kitMode;
      if (kitMode && typeof (engine as { setKitMode?: unknown }).setKitMode === 'function') {
        (engine as unknown as { setKitMode(m: 'synth' | 'sample'): void }).setKitMode(kitMode);
      }
```

The existing keymap (line 323), drumkit self-heal (line 331), padStore (line 337), and drumMutes (line 342) restores now reach the embedded sampler because the façade forwards `setKeymap`/`setPadStore`/`setDrumVoiceMutes` (Task 3). No further change is needed: the `drumkitId` self-heal (`reloadDrumkit`) remains the single load-time decoder; `applyPreset` (Task 5) deliberately does not decode.

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-host.ts src/session/session-host.test.ts
git commit -m "feat(drums): restore engineState.kitMode on load (before keymap/padStore/mute restore)"
```

---

## Task 7: Interactive orchestrator + unified drums dropdown

This wires the live pick: a ctx-aware `SessionHost.applyDrumPreset` that decodes sample kits, mirrors state, and rebuilds the inspector body; a unified populator with `<optgroup>`s; and the dep plumbing.

**Files:**
- Modify: `src/session/session-host.ts` (add `applyDrumPreset`)
- Modify: `src/polysynth/polysynth-presets.ts` (unified `mountDrumsPresetSelect` + `applyDrumKitPreset` dep)
- Modify: `src/main.ts` (wire `applyDrumKitPreset` → `sessionHost.applyDrumPreset`)
- Test: `src/session/session-host.test.ts`

- [ ] **Step 1: Write the failing test (orchestrator, synth branch)**

Append to `src/session/session-host.test.ts` a test that `applyDrumPreset(laneId, 'TR-909')` calls the engine's `applyPreset` and persists `kitMode`/`enginePresetName`. Seed the drum-kits cache (as in Task 5). Use a stub engine recording `applyPreset` + `setKitMode`:

```ts
describe('SessionHost.applyDrumPreset', () => {
  beforeEach(async () => { await seedDrumKits(); }); // helper from Task 5 pattern

  it('synth pick: applies preset + persists kitMode/enginePresetName', async () => {
    const calls: string[] = [];
    const stub = { id: 'drums-machine', params: [], getBaseValue: () => 0, setBaseValue() {},
      applyPreset(n: string) { calls.push(`apply:${n}`); }, setKitMode() {}, modulators: { serialize: () => [], deserialize() {} } };
    const host = makeHostWithEngine('drums-1', stub);
    host.loadState({ lanes: [{ id: 'drums-1', engineId: 'drums-machine', clips: [] }], scenes: [], globalQuantize: 'immediate' });
    await host.applyDrumPreset('drums-1', 'TR-909');
    expect(calls).toContain('apply:TR-909');
    const lane = host.state.lanes.find((l) => l.id === 'drums-1')!;
    expect(lane.engineState?.kitMode).toBe('synth');
    expect(lane.enginePresetName).toBe('engine:TR-909');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-host.test.ts`
Expected: FAIL — `host.applyDrumPreset is not a function`.

- [ ] **Step 3: Add `applyDrumPreset` to SessionHost**

In `src/session/session-host.ts`, ensure these imports exist (the file already imports `fetchDrumkitManifest`/`loadDrumkit` for `reloadDrumkit`, and `mirrorKeymapChange`; add `mirrorDrumkitId` + `findDrumKit` if absent):

```ts
import { mirrorKeymapChange, mirrorDrumkitId, syncNoteFx } from './session-engine-state';
import { findDrumKit } from '../presets/drum-kits-loader';
```

Add a public method (place it just after `reloadDrumkit`, around line 365):

```ts
  /** Live drums-page preset pick (ctx-aware). Synth kits go through the engine's
   *  sync applyPreset; sample kits decode the bundled drumkit into the embedded
   *  sampler here (we hold the AudioContext), mirror the sub-state, then rebuild
   *  the inspector engine-body so the panel swaps. */
  async applyDrumPreset(laneId: string, name: string): Promise<void> {
    const entry = findDrumKit(name);
    const engine = this.deps.laneResources?.get(laneId)?.engine as unknown as {
      applyPreset(n: string): void;
      setKitMode(m: 'synth' | 'sample'): void;
      setKeymap(k: KeymapEntry[]): void;
    } | undefined;
    if (!entry || !engine) return;

    engine.applyPreset(name);        // sets kitMode (+ synth loadKitDefaults)
    if (entry.kind === 'sample' && entry.drumkitId) {
      engine.setKitMode('sample');   // belt-and-suspenders before the async decode
      try {
        const manifest = await fetchDrumkitManifest(entry.drumkitId);
        const km = await loadDrumkit(manifest, this.deps.ctx);
        engine.setKeymap(km);
        mirrorKeymapChange(this.state, laneId, km);
        mirrorDrumkitId(this.state, laneId, entry.drumkitId);
      } catch (err) {
        console.warn(`[drumkit] failed to load '${entry.drumkitId}' for ${laneId}:`, err);
      }
    } else {
      // Synth kit: drop any stale drumkit sub-state so a later load doesn't
      // re-trigger the sample self-heal.
      mirrorDrumkitId(this.state, laneId, undefined);
    }

    const lane = this.state.lanes.find((l) => l.id === laneId);
    if (lane) {
      if (!lane.engineState) lane.engineState = {};
      lane.engineState.kitMode = entry.kind;
      lane.enginePresetName = `engine:${name}`;
    }

    // Rebuild the inspector engine-body so the synth rack ↔ sampler panel swaps
    // immediately (refreshLaneKnobs does NOT rebuild the body).
    if (this.activeEditLane === laneId) this.injectEngineModulatorPanel(laneId, 'drums');
    const inst = this.deps.laneResources?.get(laneId)?.engine;
    if (inst) this.deps.refreshLaneKnobs?.(laneId, inst);
  }
```

> Note: confirm `this.deps.refreshLaneKnobs` exists on `SessionHostDeps`; if not, use the same refresh seam the load path uses (`applyPresetForLane` calls `refreshLaneKnobs` in main.ts). If `refreshLaneKnobs` is not a session-host dep, omit the final refresh call — `injectEngineModulatorPanel` already re-renders the body with current values.

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/session/session-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `mountDrumsPresetSelect` with the unified populator + wiring**

In `src/polysynth/polysynth-presets.ts`:

(a) Add the import at the top:

```ts
import { getDrumKits, loadDrumKits } from '../presets/drum-kits-loader';
```

(b) Add a dep to `PolySynthPresetsDeps` (after `refreshLaneKnobs`, line 73):

```ts
  /** Apply a unified drum-kit preset (synth or sample) to a drums lane — the
   *  ctx-aware orchestrator (session-host.applyDrumPreset). */
  applyDrumKitPreset?: (laneId: string, name: string) => void;
```

(c) Replace `mountDrumsPresetSelect` (lines 380-385) with the unified version:

```ts
/** Called by injectEngineModulatorPanel when the drums page is activated.
 *  Populates the drums preset <select> from the unified drum-kits.json list
 *  (grouped Synth / Samples) and wires change/Load to the ctx-aware
 *  orchestrator. Option values keep the `engine:<name>` vocabulary so
 *  pagePresetName / refresh helpers keep working. */
export function mountDrumsPresetSelect(laneId: string): void {
  populateDrumKitsSelect(laneId);
  wireDrumKitsSelect('drums-preset-select', 'drums-preset-load');
}

function populateDrumKitsSelect(laneId: string): void {
  const sel = document.getElementById('drums-preset-select') as HTMLSelectElement | null;
  if (!sel) return;

  let holder = pageSelectActiveLane.get('drums-preset-select');
  if (!holder) { holder = { laneId }; pageSelectActiveLane.set('drums-preset-select', holder); }
  else holder.laneId = laneId;

  const render = () => {
    sel.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = '(custom — no preset)';
    sel.appendChild(custom);

    const groups = new Map<string, typeof kits>();
    const kits = getDrumKits();
    for (const k of kits) {
      const arr = groups.get(k.group) ?? [];
      arr.push(k);
      groups.set(k.group, arr);
    }
    for (const [group, entries] of groups) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const k of entries) {
        const opt = document.createElement('option');
        opt.value = `engine:${k.name}`;
        opt.textContent = k.name;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    const prev = pagePresetName.get(laneId);
    sel.value = prev ?? '__custom__';
  };

  render();
  // If the loader hasn't resolved yet, re-render when it does (boot race).
  if (getDrumKits().length === 0) void loadDrumKits().then(render);
}

function wireDrumKitsSelect(selectId: string, loadBtnId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  if (sel.dataset.presetWired === '1') return;
  sel.dataset.presetWired = '1';

  const applySelected = () => {
    const holder = pageSelectActiveLane.get(selectId);
    if (!holder) return;
    const val = sel.value;
    if (!val || val === '__custom__') return;
    if (!val.startsWith('engine:')) return;
    const name = val.slice('engine:'.length);
    _deps?.applyDrumKitPreset?.(holder.laneId, name);
    pagePresetName.set(holder.laneId, val);
  };

  sel.addEventListener('change', () => {
    if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
    else applySelected();
  });
  const loadBtn = document.getElementById(loadBtnId) as HTMLButtonElement | null;
  loadBtn?.addEventListener('click', () => {
    if (_deps?.historyDeps) withUndo(_deps.historyDeps, applySelected);
    else applySelected();
  });
}
```

- [ ] **Step 6: Wire `applyDrumKitPreset` in main.ts**

In `src/main.ts`, find where `wirePolyControls(polySynthPresetsDeps)` is called (line 585) and where `polySynthPresetsDeps` is built. Add to that deps object:

```ts
  applyDrumKitPreset: (laneId, name) => { void sessionHost.applyDrumPreset(laneId, name); },
```

(`sessionHost` is in scope by then — it is created at ~line 380 and `wirePolyControls` runs at 585.)

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the polysynth-presets + session-host suites**

Run: `NO_COLOR=1 npx vitest run src/polysynth/polysynth-presets.test.ts src/session/session-host.test.ts`
Expected: PASS (if `polysynth-presets.test.ts` asserts the OLD `mountDrumsPresetSelect` populating from `drums-machine.json`, migrate those assertions to the unified list — update the expected option labels to `TR-909`/`TR-808 (samples)` etc.).

- [ ] **Step 9: Commit**

```bash
git add src/session/session-host.ts src/polysynth/polysynth-presets.ts src/main.ts src/session/session-host.test.ts src/polysynth/polysynth-presets.test.ts
git commit -m "feat(drums): ctx-aware applyDrumPreset orchestrator + unified optgroup picker wired to it"
```

---

## Task 8: Re-point the drums 🎲 to the unified list

**Files:**
- Modify: `src/core/randomize-ui.ts:11-42`
- Modify: `src/main.ts:739-752` (pass the orchestrator)
- Test: `src/core/randomize-ui.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/core/randomize-ui.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDrumKits, __resetDrumKitsCache } from '../presets/drum-kits-loader';
import { pickRandomDrumKit } from './randomize-ui';

describe('pickRandomDrumKit', () => {
  beforeEach(async () => {
    __resetDrumKitsCache();
    await loadDrumKits((async () => ({ ok: true, json: async () => ({ presets: [
      { name: 'TR-909', group: 'Synth', kind: 'synth', kitId: '909' },
      { name: 'TR-808 (samples)', group: 'Samples', kind: 'sample', drumkitId: 'tr808' },
    ] }) })) as unknown as typeof fetch);
  });

  it('returns a unified entry name (can be a sample kit)', () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) { const n = pickRandomDrumKit(() => Math.random()); if (n) names.add(n); }
    for (const n of names) expect(['TR-909', 'TR-808 (samples)']).toContain(n);
    expect(names.size).toBeGreaterThan(0);
  });

  it('returns null when the list is empty', () => {
    __resetDrumKitsCache();
    expect(pickRandomDrumKit(() => 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/randomize-ui.test.ts`
Expected: FAIL — `pickRandomDrumKit` is not exported.

- [ ] **Step 3: Rewrite the drums randomize path**

In `src/core/randomize-ui.ts`:

(a) Add the import:

```ts
import { getDrumKits } from '../presets/drum-kits-loader';
```

(b) Add a dep to `RandomizeUIDeps` (after `getDrumsLaneId`, line 18):

```ts
  /** Apply a unified drum-kit preset by name (session-host.applyDrumPreset). */
  applyDrumKitPreset?: (laneId: string, name: string) => void;
```

(c) Add the exported pure picker + rewrite `randomizeDrumsSound` (replace lines 33-42):

```ts
/** Pick a random unified drum-kit name (synth or sample). Null if none loaded. */
export function pickRandomDrumKit(rng: () => number = Math.random): string | null {
  const kits = getDrumKits();
  if (kits.length === 0) return null;
  return kits[Math.floor(rng() * kits.length)].name;
}

function randomizeDrumsSound(deps: RandomizeUIDeps): void {
  const name = pickRandomDrumKit();
  if (!name) return;
  deps.applyDrumKitPreset?.(deps.getDrumsLaneId(), name);
}
```

(The `applyDrumKitPreset` orchestrator already updates the dropdown selection + persistence + body rebuild, so the old `markPagePresetCustom` + `refreshDrumsRack` calls are no longer needed here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/randomize-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the orchestrator into `wireRandomizeUI` in main.ts**

In `src/main.ts`, in the `wireRandomizeUI({ … })` call (line 739), add:

```ts
  applyDrumKitPreset: (laneId, name) => { void sessionHost.applyDrumPreset(laneId, name); },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/randomize-ui.ts src/main.ts src/core/randomize-ui.test.ts
git commit -m "feat(drums): randomize 🎲 picks from the unified list (synth or sample) via the orchestrator"
```

---

## Task 9: Full suite, build, and browser smoke

**Files:** none new — integration verification.

- [ ] **Step 1: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* all tests pass, that is the known flaky teardown — re-run to confirm green.)

- [ ] **Step 2: Build (typecheck + bundle — required before e2e)**

Run: `npm run build`
Expected: `tsc` clean + Vite bundle to `dist/` with no errors.

- [ ] **Step 3: Run the DSP renders (drums + sampler unaffected)**

Run: `npm run test:dsp`
Expected: PASS (the synth `DrumMachine` path is byte-for-byte unchanged; the sampler DSP is unchanged).

- [ ] **Step 4: Browser smoke (manual, controller checks)**

Start the dev server (`npm run dev`) and, on the Drums page:
1. Pick **"TR-808 (samples)"** → the inspector engine-body swaps to the full sampler panel (rack + keymap + drumkit picker); pressing play makes the grid play the sampled kit.
2. Tweak a pad's TUNE/DECAY in the rack → audible per-pad change.
3. Click **🎲** a few times → it can land on a sample kit or a synth kit; the panel swaps accordingly.
4. Pick **"TR-909"** → the panel swaps back to the synth rack; the kit synthesizes.
5. Save (the app autosaves session state) and reload the page → the Drums lane comes back on the last kit (sample kit re-decodes by id; per-pad edits restored).

- [ ] **Step 5: Commit any fixups, then finish the branch**

```bash
git add -A
git commit -m "test(drums): full suite + build green for unified drum kits"
```

Then follow **superpowers:finishing-a-development-branch**: `git rebase main`, `git merge --ff-only` onto `main`, `ExitWorktree`.

---

## Notes for the implementer

- **Do not touch the synth `DrumMachine` DSP** (`src/core/drums.ts` `play*` methods). The façade only adds a `kitMode` branch in `DrumsEngine`; the synth path must stay byte-for-byte so the DSP battery and golden WAVs are unaffected.
- **`drums-machine.json` stays** — `preset-sanity.test.ts` requires ≥ 8 entries, and MIDI import / `gm-lookup.ts` / the bundled demos resolve GM-tagged `KIT *` names through it. `applyPreset` (Task 5) resolves the unified list first, then falls back to these legacy names.
- **Single decode owner on load:** `applyPreset` never fetches/decodes; the `engineState.sampler.drumkitId → reloadDrumkit` self-heal (already in `applyEngineState`) is the sole load-time decoder. The live pick decodes inside `applyDrumPreset` (Task 7).
- **`EngineUIContext.audioContext`** is already threaded by `injectEngineModulatorPanel` (session-host.ts:709), so the embedded sampler's `buildParamUI` (drumkit picker + file drop) works unchanged when delegated.
- **Two sampler instances of one class** (the Poly-lane standalone sampler + the drums-embedded one) are independent; the only shared singletons are the global sample store/cache, which are intentionally shared.
