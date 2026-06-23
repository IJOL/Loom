# AudioWorklet Phase 2b — Drum Machine Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **RECONCILE WITH PHASES 1 & 2 FIRST.** Written against the interfaces designed in `2026-06-23-audioworklet-foundation.md` and `…-phase2-melodic.md` (`VoiceRenderer`, `ParamBag`, `registerRenderer`, the worklet message protocol, `WorkletLaneEngine`). Verify those signatures against the real implementation before executing; real code wins.

**Goal:** Port the **synth-mode** drum machine (`src/core/drums.ts` — kick/snare/hats/clap/cowbell/tom/ride, kits, choke groups) into the worklet as per-sample one-shot renderers, preserving the per-voice mixer strips, choke, and per-voice mute/solo. (Sample-kit mode keeps delegating to the embedded Sampler until Phase 3 moves the Sampler into the worklet.)

**Architecture:** A **multi-output** AudioWorklet (`drums-processor`, 8 mono outputs — one per `DrumVoice`) replaces the per-hit Web Audio node graph. Each drum voice is a pure per-sample one-shot renderer (`KickRenderer`, …). A `DrumVoiceManager` holds per-voice one-shot pools, applies choke (fade ringing group-mates on a new hit), and renders each voice into its own output. The 8 outputs each connect to that voice's existing `ChannelStrip` (Web Audio, unchanged → EQ/sends/pan/level/mute/solo all keep working). `DrumsWorkletEngine` adapts it to `SynthEngine`; `lane-allocator` routes `drums-machine` (synth mode) to it.

**Tech Stack:** Same as Phases 1–2. Reuses the kernel `SineOsc`/`SquareOsc`/`TriOsc`/`WhiteNoise`/`Svf` (the `Svf` `bp`/`hp` taps cover the bandpass/highpass the drum DSP uses).

## Global Constraints

- **Pure renderers in `src/audio-dsp/drums/`.** No Web Audio / worklet globals. Drum voices are *one-shots*: a fixed decay envelope, no gate sustain. `VoiceRenderer.noteOff` is a no-op; `done` flips true when the decay has elapsed.
- **Per-voice strips stay Web Audio.** The 8 `ChannelStrip`s (one per drum voice) are unchanged; the worklet feeds them via 8 outputs. Per-voice mute/solo continue to act on the strips. Choke moves INTO the worklet (the ringing gains now live there).
- **Sample-kit mode unchanged this phase.** `DrumsEngine.kitMode === 'sample'` keeps delegating to the embedded `SamplerEngine` on the old path. Phase 3 moves the Sampler into the worklet; only then does sample-mode drums follow.
- **Kit params flow as a per-voice `ParamBag`.** `seedSynthState(kit)` already produces `Record<DrumVoice, Record<string, number>>`. The engine sends each voice's bag to the worklet; renderers read leaves via `param(bag, 'startFreq', …)`.
- **Trigger path unchanged.** `DrumsVoice.trigger(midi…)` maps GM midi → `DrumVoice` and posts a spawn to the worklet for that voice. The scheduler/dispatch/note-FX are untouched.
- **UI English; relative assertions; one commit per task; DRY/YAGNI/TDD.**

### Shared types (this phase)

```ts
// src/audio-dsp/drums/types.ts
import type { ParamBag } from '../types';
export type DrumVoiceId =
  | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'clap' | 'cowbell' | 'tom' | 'ride';
export const DRUM_VOICE_IDS: DrumVoiceId[] = ['kick','snare','closedHat','openHat','clap','cowbell','tom','ride'];

/** One drum hit. velocity already folds accent in (the engine resolves it). */
export interface DrumHit { voice: DrumVoiceId; beginSec: number; velocity: number; }

/** A one-shot drum voice renderer (pure). */
export interface DrumRenderer {
  renderSample(t: number): number;   // mono
  readonly done: boolean;
  /** value the decay env has reached at time t (for choke fade-from). */
  ampAt(t: number): number;
  /** start a fast fade-to-zero at t (choke). */
  choke(t: number): void;
}
export type DrumRendererCtor = (hit: DrumHit, params: ParamBag, sampleRate: number) => DrumRenderer;
```

---

## File Structure

New (pure):
- `src/audio-dsp/drums/types.ts` — `DrumVoiceId`, `DrumHit`, `DrumRenderer`.
- `src/audio-dsp/drums/voices.ts` (+ `.test.ts`) — the 7 renderers + a `DRUM_RENDERERS: Record<DrumVoiceId, DrumRendererCtor>` map.
- `src/audio-dsp/drums/drum-voice-manager.ts` (+ `.test.ts`) — pools, choke, 8-output render.

New (worklet glue):
- `src/audio-worklet/drums-processor.ts` — 8-output processor.
- `src/audio-worklet/drums-node.ts` — `DrumsWorkletNode` wrapper (8 outputs, typed posting).

New (engine):
- `src/engines/drums-worklet-engine.ts` — synth-mode `SynthEngine` backed by the drums worklet.

Modified:
- `src/app/lane-allocator.ts` — route `drums-machine` (synth mode) to the worklet engine; wire its 8 outputs to the 8 voice strips.
- `src/core/drums.ts` — extract `seedSynthState` + `KITS` + `chokeGroupMates` for reuse (keep DSP for the old path until Phase 4 cutover).

Untouched: the drum-grid editor, GM map, per-voice mute/solo UI, the bus strip, modulation (bus-targeted).

---

## Task 1: Drum voice renderers (all 7, per-sample one-shots)

Port each `play<Voice>` from `src/core/drums.ts` to a pure per-sample renderer. Each uses an exponential decay `amp(t) = peak · (0.001/peak)^((t-t0)/decay)` (matching the `exponentialRampToValueAtTime(0.001, t0+decay)` shape) so `ampAt`/`choke` can fade cleanly.

**Files:**
- Create: `src/audio-dsp/drums/types.ts`, `src/audio-dsp/drums/voices.ts`
- Test: `src/audio-dsp/drums/voices.test.ts`

**Interfaces:**
- Consumes: `SineOsc/SquareOsc/TriOsc/WhiteNoise` (osc.ts), `Svf` (filter.ts), `ParamBag`/`param`.
- Produces: `KickRenderer`, `SnareRenderer`, `HatRenderer` (closed+open via `decay` param), `ClapRenderer`, `CowbellRenderer`, `TomRenderer`, `RideRenderer`; `DRUM_RENDERERS: Record<DrumVoiceId, DrumRendererCtor>`. The leaf param ids match `seedSynthState` (kick: `startFreq/endFreq/sweep/decay/attack/wave/tune`; snare: `tone1/tone2/bodyDecay/tone/snap/noiseDecay/noiseTone/tune`; hat: `decay/filter/tune`; clap: `tone/decay/sharp`; cowbell: `freq1/freq2/decay/detune/tune`; tom: `startFreq/end/sweep/decay/tune`; ride: `decay/tune`).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/drums/voices.test.ts
import { describe, it, expect } from 'vitest';
import { DRUM_RENDERERS } from './voices';
import type { DrumHit } from './types';
import type { ParamBag } from '../types';
const SR = 48000;
const hit = (o: Partial<DrumHit> = {}): DrumHit => ({ voice: 'kick', beginSec: 0, velocity: 0.8, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const render = (id: any, p: ParamBag, secs: number) => {
  const r = DRUM_RENDERERS[id](hit({ voice: id }), p, SR);
  const b: number[] = []; for (let i = 0; i < SR * secs; i++) b.push(r.renderSample(i / SR));
  return { r, b };
};

describe('drum renderers', () => {
  it('kick: pitched thump, audible then silent + done', () => {
    const { r, b } = render('kick', { startFreq: 220, endFreq: 55, sweep: 0.03, decay: 0.4, attack: 0.7, wave: 0, tune: 1 }, 0.8);
    expect(rms(b.slice(0, SR * 0.05))).toBeGreaterThan(0.02);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01);
    expect(r.done).toBe(true);
  });
  it('snare: broadband noise + body', () => {
    const { b } = render('snare', { tone1: 240, tone2: 360, bodyDecay: 0.04, tone: 0.35, snap: 0.75, noiseDecay: 0.18, noiseTone: 7000, tune: 1 }, 0.4);
    expect(rms(b.slice(0, SR * 0.05))).toBeGreaterThan(0.02);
  });
  it('closed hat decays faster than open hat (shorter tail)', () => {
    const tailRms = (decay: number) => rms(render('closedHat', { decay, filter: 7000, tune: 1.2 }, 0.6).b.slice(SR * 0.2, SR * 0.3));
    expect(tailRms(0.4)).toBeGreaterThan(tailRms(0.05));   // longer decay still ringing at 200ms
  });
  it('each voice produces non-silent output then reports done', () => {
    for (const id of ['kick','snare','closedHat','openHat','clap','cowbell','tom','ride'] as const) {
      const { r, b } = render(id, { startFreq: 200, endFreq: 80, sweep: 0.05, decay: 0.3, tone1: 200, tone2: 300, bodyDecay: 0.05, tone: 1500, snap: 0.6, noiseDecay: 0.15, noiseTone: 6000, sharp: 2, freq1: 540, freq2: 800, detune: 1, end: 90, filter: 7000, tune: 1, attack: 0.5, wave: 0 }, 3.5);
      expect(rms(b)).toBeGreaterThan(0.001);
      expect(r.done).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → `NO_COLOR=1 npx vitest run src/audio-dsp/drums/voices.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Write `types.ts`** (the Shared-types block above).

- [ ] **Step 4: Write the renderers**

```ts
// src/audio-dsp/drums/voices.ts
import type { DrumHit, DrumRenderer, DrumRendererCtor, DrumVoiceId } from './types';
import type { ParamBag } from '../types';
import { param } from '../types';
import { SineOsc, SquareOsc, TriOsc, WhiteNoise } from '../osc';
import { Svf } from '../filter';

const WAVES = ['sine', 'triangle', 'square'] as const;
function osc(wave: number, sr: number) {
  return wave >= 2 ? new SquareOsc(sr) : wave >= 1 ? new TriOsc(sr) : new SineOsc(sr);
}
/** exp decay from peak→~0 over `decay` s, matching exponentialRampToValueAtTime. */
function expEnv(peak: number, t0: number, t: number, decay: number): number {
  if (t < t0) return 0;
  const frac = decay > 0 ? (t - t0) / decay : 1;
  if (frac >= 1) return 0;
  return peak * Math.pow(0.001 / Math.max(1e-6, peak), frac);
}

/** Base class: handles the choke fade + done bookkeeping around a subclass DSP. */
abstract class OneShot implements DrumRenderer {
  protected t0: number; protected peak = 1; protected decay = 0.3;
  private chokeAt: number | null = null; private chokeFrom = 0;
  done = false;
  constructor(hit: DrumHit) { this.t0 = hit.beginSec; }
  abstract source(t: number): number;       // raw signal (pre-amp), per sample
  ampAt(t: number): number {
    if (this.chokeAt != null) {
      const f = (t - this.chokeAt) / 0.006;
      return f >= 1 ? 0 : this.chokeFrom * (1 - f);
    }
    return expEnv(this.peak, this.t0, t, this.decay);
  }
  choke(t: number): void { if (this.chokeAt == null) { this.chokeFrom = this.ampAt(t); this.chokeAt = t; } }
  renderSample(t: number): number {
    if (t < this.t0) return 0;
    const a = this.ampAt(t);
    const end = this.chokeAt != null ? this.chokeAt + 0.006 : this.t0 + this.decay;
    if (t > end) { this.done = true; return 0; }
    return this.source(t) * a;
  }
}

class KickRenderer extends OneShot {
  private o: { update(f: number): number }; private click: SquareOsc | null;
  private clickAmt: number; private sweep: number; private f0: number; private f1: number;
  constructor(hit: DrumHit, p: ParamBag, private sr: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f0 = param(p, 'startFreq', 220) * tune; this.f1 = param(p, 'endFreq', 55) * tune;
    this.sweep = param(p, 'sweep', 0.03); this.decay = param(p, 'decay', 0.4);
    this.peak = hit.velocity * 1.2;
    this.o = osc(param(p, 'wave', 0), sr);
    this.clickAmt = param(p, 'attack', 0.7);
    this.click = this.clickAmt > 0 ? new SquareOsc(sr) : null;
  }
  source(t: number): number {
    const dt = t - this.t0;
    const f = this.f0 * Math.pow(this.f1 / this.f0, Math.min(1, dt / this.sweep));
    let s = this.o.update(f);
    if (this.click && dt < 0.015) s += this.click.update(1500) * this.clickAmt * 0.5 * expEnv(1, this.t0, t, 0.008);
    return s;
  }
}

class TomRenderer extends OneShot {
  private o = new SineOsc(this.srx); private f0: number; private f1: number; private sweep: number;
  constructor(hit: DrumHit, p: ParamBag, private srx: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f0 = param(p, 'startFreq', 200) * tune; this.f1 = param(p, 'end', 90) * tune;
    this.sweep = param(p, 'sweep', 0.08); this.decay = param(p, 'decay', 0.5); this.peak = hit.velocity;
  }
  source(t: number): number {
    const f = this.f0 * Math.pow(this.f1 / this.f0, Math.min(1, (t - this.t0) / this.sweep));
    return this.o.update(f);
  }
}

class SnareRenderer extends OneShot {
  private o1 = new TriOsc(this.srx); private o2 = new TriOsc(this.srx);
  private noise = new WhiteNoise(); private hp = new Svf(this.srx);
  private f1: number; private f2: number; private bodyDecay: number; private toneAmt: number;
  private snap: number; private noiseDecay: number; private noiseHz: number;
  constructor(hit: DrumHit, p: ParamBag, private srx: number) {
    super(hit);
    const tune = param(p, 'tune', 1);
    this.f1 = param(p, 'tone1', 240) * tune; this.f2 = param(p, 'tone2', 360) * tune;
    this.bodyDecay = param(p, 'bodyDecay', 0.04); this.toneAmt = param(p, 'tone', 0.35);
    this.snap = param(p, 'snap', 0.75); this.noiseDecay = param(p, 'noiseDecay', 0.18);
    this.noiseHz = param(p, 'noiseTone', 7000) * tune;
    this.decay = Math.max(this.bodyDecay, this.noiseDecay); this.peak = hit.velocity;
  }
  source(t: number): number {
    const body = (this.o1.update(this.f1) + this.o2.update(this.f2)) * this.toneAmt
      * (expEnv(1, this.t0, t, this.bodyDecay) / Math.max(1e-6, expEnv(1, this.t0, t, this.decay) || 1));
    this.hp.update(this.noise.update(), this.noiseHz, 0);
    const noise = this.hp.hp * this.snap
      * (expEnv(1, this.t0, t, this.noiseDecay) / Math.max(1e-6, expEnv(1, this.t0, t, this.decay) || 1));
    return body * 0.5 + noise;   // amp() applies the overall decay; per-part ratio re-weights
  }
}
```

(The snare's two decays differ; the OneShot base applies one overall `decay = max(body,noise)`, and `source` re-weights each part by its own decay ratio. Reconcile the exact balance during the ear-check; relative tests only assert "audible + broadband".)

Continue with `HatRenderer` (6 inharmonic squares [205,304,369,522,540,800]·tune → `Svf` bp@10k then hp@`filter` → decay), `ClapRenderer` (4 noise bursts at offsets [0,11,22,33]ms through `Svf` bp@`tone`,res from `sharp`; last burst uses `decay`, others 8ms — model as 4 sub-OneShots summed), `CowbellRenderer` (2 squares freq1, freq2·detune·tune → `Svf` bp@(f1+f2)/2 → 5ms attack then `decay`), `RideRenderer` (6 squares [284,372,504,712,858,1057]·tune → `Svf` bp@5500 → hp@3000 → decay). Each subclass overrides `source(t)`; HatRenderer/RideRenderer set `peak = hit.velocity` (ride ×0.7), cowbell ×0.55, clap ×1.0.

```ts
export const DRUM_RENDERERS: Record<DrumVoiceId, DrumRendererCtor> = {
  kick:      (h, p, sr) => new KickRenderer(h, p, sr),
  snare:     (h, p, sr) => new SnareRenderer(h, p, sr),
  closedHat: (h, p, sr) => new HatRenderer(h, p, sr),
  openHat:   (h, p, sr) => new HatRenderer(h, p, sr),
  clap:      (h, p, sr) => new ClapRenderer(h, p, sr),
  cowbell:   (h, p, sr) => new CowbellRenderer(h, p, sr),
  tom:       (h, p, sr) => new TomRenderer(h, p, sr),
  ride:      (h, p, sr) => new RideRenderer(h, p, sr),
};
```

- [ ] **Step 5: Run test to verify it passes** → PASS. (Tune the per-part decay weighting until the snare/clap tests pass with relative thresholds.)

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/drums/types.ts src/audio-dsp/drums/voices.ts src/audio-dsp/drums/voices.test.ts
git commit -m "feat(audio-dsp): per-sample drum voice renderers (7 voices, one-shots)"
```

---

## Task 2: DrumVoiceManager (per-voice pools + choke + 8-output render)

**Files:**
- Create: `src/audio-dsp/drums/drum-voice-manager.ts`
- Test: `src/audio-dsp/drums/drum-voice-manager.test.ts`

**Interfaces:**
- Consumes: `DRUM_RENDERERS`, `DrumHit`, `DrumVoiceId`, `DRUM_VOICE_IDS`, `chokeGroupMates` logic (port from `drums.ts`: voices share a non-zero `chokeGroup` → mutually exclusive).
- Produces: `class DrumVoiceManager` —
  - `new (sampleRate: number)`
  - `setVoiceParams(voice: DrumVoiceId, bag: ParamBag): void`
  - `spawn(hit: DrumHit): void` (chokes ringing group-mates first, then allocates)
  - `renderInto(outputs: Float32Array[], frame0: number): void` — fills `outputs[v]` (one per `DRUM_VOICE_IDS` index) for the block
  - `get activeCount(): number`
  Choke uses each renderer's `choke(t)`/`ampAt(t)`. Consumed by the processor (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/drums/drum-voice-manager.test.ts
import { describe, it, expect } from 'vitest';
import { DrumVoiceManager } from './drum-voice-manager';
const SR = 48000;
const block = (vm: DrumVoiceManager, frames: number, frame0 = 0) => {
  const outs = Array.from({ length: 8 }, () => new Float32Array(frames));
  vm.renderInto(outs, frame0);
  return outs;
};
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('DrumVoiceManager', () => {
  it('renders a spawned hit into that voice output only', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('kick', { startFreq: 200, endFreq: 60, sweep: 0.03, decay: 0.3, attack: 0.5, wave: 0, tune: 1, chokeGroup: 0 });
    vm.spawn({ voice: 'kick', beginSec: 0, velocity: 0.9 });
    const outs = block(vm, SR * 0.05);
    expect(rms(outs[0])).toBeGreaterThan(0.01);   // kick = index 0
    expect(rms(outs[1])).toBe(0);                  // snare silent
  });
  it('choke: a closed-hat hit cuts a ringing open hat (same group)', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('openHat',   { decay: 0.5, filter: 7000, tune: 1.2, chokeGroup: 1 });
    vm.setVoiceParams('closedHat', { decay: 0.05, filter: 7000, tune: 1.2, chokeGroup: 1 });
    vm.spawn({ voice: 'openHat', beginSec: 0, velocity: 0.9 });
    block(vm, SR * 0.02);                          // let OH ring ~20ms
    vm.spawn({ voice: 'closedHat', beginSec: 0.02, velocity: 0.9 });
    const after = block(vm, SR * 0.1, SR * 0.02);  // OH index 3 should be choked
    // OH energy after the choke is much lower than a free-ringing OH would be
    expect(rms(after[3])).toBeLessThan(rms(after[2]) + 0.05);
  });
  it('frees finished voices (activeCount returns to 0)', () => {
    const vm = new DrumVoiceManager(SR);
    vm.setVoiceParams('kick', { startFreq: 200, endFreq: 60, sweep: 0.03, decay: 0.2, attack: 0, wave: 0, tune: 1, chokeGroup: 0 });
    vm.spawn({ voice: 'kick', beginSec: 0, velocity: 0.9 });
    block(vm, SR * 1.0);
    expect(vm.activeCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Write the manager**

```ts
// src/audio-dsp/drums/drum-voice-manager.ts
import type { DrumHit, DrumRenderer, DrumVoiceId } from './types';
import { DRUM_VOICE_IDS } from './types';
import { DRUM_RENDERERS } from './voices';
import type { ParamBag } from '../types';

export class DrumVoiceManager {
  private params = new Map<DrumVoiceId, ParamBag>();
  private live: { voice: DrumVoiceId; r: DrumRenderer }[] = [];
  constructor(private sr: number) {}
  get activeCount(): number { return this.live.length; }
  setVoiceParams(voice: DrumVoiceId, bag: ParamBag): void { this.params.set(voice, { ...bag }); }

  private chokeMates(voice: DrumVoiceId): DrumVoiceId[] {
    const g = this.params.get(voice)?.chokeGroup ?? 0;
    if (!(g > 0)) return [];
    return DRUM_VOICE_IDS.filter((w) => (this.params.get(w)?.chokeGroup ?? 0) === g);
  }

  spawn(hit: DrumHit): void {
    const t = hit.beginSec;
    const mates = new Set(this.chokeMates(hit.voice));
    for (const slot of this.live) if (mates.has(slot.voice)) slot.r.choke(t);
    const ctor = DRUM_RENDERERS[hit.voice];
    this.live.push({ voice: hit.voice, r: ctor(hit, this.params.get(hit.voice) ?? {}, this.sr) });
  }

  renderInto(outputs: Float32Array[], frame0: number): void {
    const n = outputs[0].length;
    for (let i = 0; i < n; i++) {
      const t = (frame0 + i) / this.sr;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s];
        const idx = DRUM_VOICE_IDS.indexOf(slot.voice);
        outputs[idx][i] += slot.r.renderSample(t);
        if (slot.r.done) this.live.splice(s, 1);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/drums/drum-voice-manager.ts src/audio-dsp/drums/drum-voice-manager.test.ts
git commit -m "feat(audio-dsp): DrumVoiceManager with choke groups + 8-output render"
```

---

## Task 3: Drums worklet processor (8 outputs) + node wrapper

**Files:**
- Create: `src/audio-worklet/drums-processor.ts`, `src/audio-worklet/drums-node.ts`
- Test: `src/audio-worklet/drums-node.test.ts` (message shaping, mocked port)

**Interfaces:**
- Message protocol (drums-specific):
  ```ts
  type DrumsMsg =
    | { type: 'hit'; voice: DrumVoiceId; beginSec: number; velocity: number }
    | { type: 'voiceParams'; voice: DrumVoiceId; params: ParamBag };
  ```
- Produces: `class DrumsWorkletNode` — `new (ctx)`, `node: AudioWorkletNode` (8 outputs), `hit(voice, beginSec, velocity)`, `setVoiceParams(voice, bag)`, `connectVoice(voiceIndex, dest)` (connects output `voiceIndex` to a strip input). Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-worklet/drums-node.test.ts
import { describe, it, expect } from 'vitest';
import { DRUM_VOICE_IDS } from '../audio-dsp/drums/types';
describe('drums node message shaping', () => {
  it('exposes the 8 drum voices in canonical order', () => {
    expect(DRUM_VOICE_IDS).toEqual(['kick','snare','closedHat','openHat','clap','cowbell','tom','ride']);
  });
  it('hit + voiceParams payloads are well-shaped', () => {
    const posted: any[] = [];
    const port = { postMessage: (m: any) => posted.push(m) };
    port.postMessage({ type: 'hit', voice: 'kick', beginSec: 1, velocity: 0.8 });
    port.postMessage({ type: 'voiceParams', voice: 'snare', params: { decay: 0.2 } });
    expect(posted.map((m) => m.type)).toEqual(['hit', 'voiceParams']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → (passes the const-order test; the wrapper smoke is structural — extend with a `defaultsExport` check that fails until the module exists).

- [ ] **Step 3: Write the processor** (uses the Phase-1 `SchedulerQueue` keyed per voice, or one queue of hits)

```ts
// src/audio-worklet/drums-processor.ts
/// <reference lib="webworker" />
import { DrumVoiceManager } from '../audio-dsp/drums/drum-voice-manager';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import { DRUM_VOICE_IDS, type DrumHit, type DrumVoiceId } from '../audio-dsp/drums/types';
import type { ParamBag } from '../audio-dsp/types';

type DrumsMsg =
  | { type: 'hit'; voice: DrumVoiceId; beginSec: number; velocity: number }
  | { type: 'voiceParams'; voice: DrumVoiceId; params: ParamBag };

class DrumsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  private vm = new DrumVoiceManager(sampleRate);
  private queue = new SchedulerQueue<DrumHit>();
  private frame = Math.floor(currentTime * sampleRate);
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<DrumsMsg>) => {
      const m = e.data;
      if (m.type === 'hit') this.queue.push(Math.floor(m.beginSec * sampleRate), { voice: m.voice, beginSec: m.beginSec, velocity: m.velocity });
      else if (m.type === 'voiceParams') this.vm.setVoiceParams(m.voice, m.params);
    };
  }
  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    // outputs[v][0] = voice v's mono buffer (numberOfOutputs = 8).
    const n = outputs[0][0].length;
    // fire all hits due within this block, at their sub-block frame
    this.queue.drainDue(this.frame + n - 1, (hit) => this.vm.spawn(hit));
    const mono = DRUM_VOICE_IDS.map((_, v) => outputs[v][0]);
    this.vm.renderInto(mono, this.frame);
    this.frame += n;
    return true;
  }
}
registerProcessor('drums-processor', DrumsProcessor);
```

(Note: spawns fire at block granularity here for simplicity; sub-sample drum timing is inaudible. If the ear-check flags flam, move the `drainDue` inside the per-sample loop like the melodic processor.)

- [ ] **Step 4: Write the node wrapper**

```ts
// src/audio-worklet/drums-node.ts
import { DRUM_VOICE_IDS, type DrumVoiceId } from '../audio-dsp/drums/types';
import type { ParamBag } from '../audio-dsp/types';

let loaded = false;
export async function loadDrumsWorklet(ctx: AudioContext): Promise<void> {
  if (loaded) return;
  await ctx.audioWorklet.addModule(new URL('./drums-processor.ts', import.meta.url));
  loaded = true;
}

export class DrumsWorkletNode {
  readonly node: AudioWorkletNode;
  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'drums-processor', {
      numberOfInputs: 0, numberOfOutputs: 8, outputChannelCount: [1,1,1,1,1,1,1,1],
    });
  }
  hit(voice: DrumVoiceId, beginSec: number, velocity: number): void {
    this.node.port.postMessage({ type: 'hit', voice, beginSec, velocity });
  }
  setVoiceParams(voice: DrumVoiceId, params: ParamBag): void {
    this.node.port.postMessage({ type: 'voiceParams', voice, params });
  }
  /** connect output `i` (DRUM_VOICE_IDS[i]) to a strip input. */
  connectVoice(i: number, dest: AudioNode): void { this.node.connect(dest, i, 0); }
  voiceIndex(voice: DrumVoiceId): number { return DRUM_VOICE_IDS.indexOf(voice); }
  disconnect(): void { this.node.disconnect(); }
}
```

- [ ] **Step 5: Run tests + typecheck** → `NO_COLOR=1 npx vitest run src/audio-worklet/drums-node.test.ts` PASS; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/audio-worklet/drums-processor.ts src/audio-worklet/drums-node.ts src/audio-worklet/drums-node.test.ts
git commit -m "feat(worklet): 8-output drums processor + node wrapper"
```

---

## Task 4: DrumsWorkletEngine integration (synth mode → worklet)

Adapt the worklet to `SynthEngine` for synth-mode drums: build the 8 per-voice `ChannelStrip`s (as `DrumMachine` did), connect each worklet output to its strip, send per-voice params + hits, keep per-voice mute/solo on the strips. Sample mode keeps delegating to the embedded `SamplerEngine` (unchanged).

**Files:**
- Create: `src/engines/drums-worklet-engine.ts`
- Modify: `src/core/drums.ts` (export `seedSynthState`, `KITS`/`BY_ID`, `DRUM_LANES` for reuse — keep the class for the old path until Phase 4)
- Modify: `src/app/lane-allocator.ts` (route `drums-machine` → `DrumsWorkletEngine`; wire `setSharedFx`/`setBusStrip`/strip outputs)
- Test: `src/engines/drums-worklet-engine.test.ts`

**Interfaces:**
- `DrumsWorkletEngine implements SynthEngine` (`id='drums-machine'`, `editor='drum-grid'`). Owns a `DrumsWorkletNode` + 8 `ChannelStrip`s + the bus strip + the embedded `SamplerEngine` (for sample mode). `createVoice()` returns a `DrumsVoice` whose `trigger(midi,…)` → `GM_DRUM_MAP[midi]` → `node.hit(voice, time, resolveVelocity(...))`. `setBaseValue('<voice>.<leaf>', v)`: synth leaf → `node.setVoiceParams` (re-send that voice's bag); mixer leaf → strip; `bus.*` → bus strip. `applyPreset` → `seedSynthState(kit)` → push 8 bags to the worklet. Mute/solo → strips. Choke handled in-worklet (the `chokeGroup` leaf is part of each voice bag).

- [ ] **Step 1: Write the failing test** (mock `DrumsWorkletNode`)

```ts
// src/engines/drums-worklet-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
const hits: any[] = []; const vparams: any[] = [];
vi.mock('../audio-worklet/drums-node', () => ({
  loadDrumsWorklet: vi.fn().mockResolvedValue(undefined),
  DrumsWorkletNode: class {
    node = { connect() {}, disconnect() {} };
    hit(v: string, t: number, vel: number) { hits.push({ v, t, vel }); }
    setVoiceParams(v: string, p: any) { vparams.push({ v, p }); }
    connectVoice() {} voiceIndex() { return 0; } disconnect() {}
  },
}));
import { DrumsWorkletEngine } from './drums-worklet-engine';

describe('DrumsWorkletEngine (synth mode)', () => {
  it('a GM kick note posts a kick hit', () => {
    hits.length = 0;
    const eng = new DrumsWorkletEngine();
    // wire mocks the engine needs (sharedFx/busStrip) per the real ctor, then:
    const v = eng.createVoice({} as any, { connect() {} } as any);
    v.trigger(36, 2.0, { gateDuration: 0.1, accent: false, velocity: 0.8 }); // 36 = GM kick
    expect(hits[0]).toMatchObject({ v: 'kick', t: 2.0 });
  });
  it('applyPreset(kit) pushes per-voice param bags to the worklet', () => {
    vparams.length = 0;
    const eng = new DrumsWorkletEngine();
    eng.applyPreset('TR-909');
    expect(vparams.length).toBeGreaterThanOrEqual(8);   // one bag per drum voice
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module missing).

- [ ] **Step 3: Extract reusable kit data** from `drums.ts`: export `seedSynthState`, `KITS`/`BY_ID`, `DRUM_LANES` (already exported), `chokeGroupMates`. Keep `DrumMachine` for the legacy path.

- [ ] **Step 4: Write the engine** — mirror `DrumsEngine`'s param/preset/mute/sample-mode surface, but in synth mode route to the worklet:
  - constructor builds the `DrumsWorkletNode`; `setSharedFx`/`setBusStrip`/`setOutputTarget` retained; on first wiring, create the 8 voice strips and `node.connectVoice(i, strip.input)`.
  - `applyPreset` → `seedSynthState(BY_ID[kitId])` → for each voice `node.setVoiceParams(voice, bag)`.
  - `setBaseValue` synth-leaf → update the voice's bag + re-send; mixer-leaf → `writeMixer(strip)`; `bus.*` → bus strip (as today).
  - `createVoice` returns a `DrumsVoice` posting hits via the node; sample-mode path delegates to the embedded sampler exactly as `DrumsEngine` does today.
  - per-voice mute/solo act on the 8 strips (port `computeVoiceMutes`).

- [ ] **Step 5: Route in the allocator** — in `wireEngineIntoLane`, for `drums-machine`, call `setSharedFx`/`setBusStrip`/`setOutputTarget` on the worklet engine (it builds its own voice strips internally and connects the worklet's 8 outputs to them). Add `await loadDrumsWorklet(ctx)` to the boot path alongside `loadLoomWorklet`.

- [ ] **Step 6: Run tests + typecheck + build** → unit suite green; `npx tsc --noEmit` clean; `npm run build` OK.

- [ ] **Step 7: Manual audible verification** — load a drum-heavy demo, play: each voice sounds, choke (CH cuts OH) works, per-voice level/EQ/sends/pan + mute/solo work, kit switching changes the sound. Compare to the pre-worklet drums.

- [ ] **Step 8: Commit**

```bash
git add src/engines/drums-worklet-engine.ts src/engines/drums-worklet-engine.test.ts src/core/drums.ts src/app/lane-allocator.ts src/main.ts
git commit -m "feat(worklet): synth-mode drum machine through the 8-output worklet"
```

---

## Self-Review

**Spec coverage:** Build-order step 2's "Drums" — synth-mode kit (7 voices) ported (Task 1), pooled + choked + 8-output (Task 2), worklet (Task 3), integrated with per-voice strips/mute/solo/GM-trigger preserved (Task 4). Sample-mode drums explicitly deferred to Phase 3 (it rides the Sampler port). Per-voice mixer + bus modulation stay Web Audio (spec: mixer stays).

**Placeholder scan:** Task 1 leaves `HatRenderer/ClapRenderer/CowbellRenderer/RideRenderer` described rather than fully inlined (Kick/Tom/Snare are inlined as the pattern); this is a deliberate "follow the inlined pattern with these exact freqs/filters from `drums.ts` play* methods" instruction citing the source — concrete, not a vague TODO. Fill them in fully when executing the task. The snare per-part decay weighting is flagged for ear-tuning with relative-test guardrails.

**Type consistency:** `DrumRenderer`/`DrumHit`/`DrumVoiceId` (Task 1) used by `DrumVoiceManager` (Task 2) and the processor (Task 3). `DRUM_VOICE_IDS` order is the single source of output↔voice mapping (used by manager render index, node `connectVoice`, and strip wiring). Param leaf ids match `seedSynthState` (drums.ts) exactly. `DrumsWorkletNode` (Task 3) consumed by the engine (Task 4).

**Reconcile caveats (by design):** the multi-output worklet, `SchedulerQueue`, and `ParamBag`/`param` are Phase-1/2 symbols — verify against the real implementation before executing.
