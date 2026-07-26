# Live Continuous Params Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turning a knob changes the note that is ALREADY sounding, like an analogue synth, instead of only the next trigger.

**Architecture:** A `ParamSmoother` inside `VoiceManager` keeps a second, smoothed copy of the lane's param bag that chases the real one with a ~15 ms time constant, walking only the params still in flight (empty list at rest ⇒ zero cost). Voices receive that live bag at spawn via an optional `setLiveParams` hook and read their CONTINUOUS params from it every sample, while structural params (waveform, unison size, filter model, envelope times) stay frozen at trigger as they are today. The Sampler gets the equivalent through a new per-pad params message plus a live pad table in its processor.

**Tech Stack:** TypeScript, Vitest, AudioWorklet, pure per-sample DSP kernel (`src/audio-dsp/`).

**Spec:** [2026-07-26-parametros-continuos-en-vivo-design.md](../specs/2026-07-26-parametros-continuos-en-vivo-design.md)

## What needs no task

Two spec requirements are satisfied by the architecture and must NOT get code of
their own — if you find yourself writing some, something is wrong:

- **Presets morph the sounding note.** `applyPreset` writes through
  `setBaseValue` like every other param source, so its values enter the smoother
  and ramp. It arrives as many params at once, which the in-flight list handles
  (Task 1 covers it: *"carries several params at once (a preset load)"*).
  Structural params in the preset still land on the next trigger, because
  renderers read those from the TARGET bag at construction.
- **Recorded automation moves sustained notes.** Same path
  (`commitParam` → `setBaseValue` → `setParams`). Today it silently doesn't, which
  is the same bug in a different coat; it is fixed by Task 2 with no extra work.

## Global Constraints

- **Worktree first.** This is implementation work: create an isolated worktree on a feature branch BEFORE touching files (`EnterWorktree`). Never implement in the primary checkout. Rebase onto `main` around every commit; finish with `git rebase main` + `git merge --ff-only`, then `ExitWorktree`.
- **No linter is configured.** Typecheck with `npx tsc --noEmit`.
- **Test colour convention:** run single files as `NO_COLOR=1 npx vitest run path/to/file.test.ts`. Do NOT add `--reporter=...`.
- **Assertions are always RELATIVE** — ratios (`>`, `<`, `> * 2`), never absolute magnitudes. If an absolute threshold is unavoidable, justify it in a comment.
- **File size:** target 300 lines of CODE (comments and blanks don't count), hard cap 500.
- **Nothing may allocate on the audio thread.** No object/array literals, no `map`/`filter`/`Object.keys` inside `renderSample` or `tick`. Mutate pooled structures in place.
- **Zero cost at rest is a requirement, not a nice-to-have.** With no knob moving, the render path must do no extra per-sample work beyond one integer check.
- **Excluded from "continuous" by design** (see spec): envelope times (`amp.attack/decay/sustain/release`, `filter.attack/…`, `contour.*`) and every `kind: 'discrete'` param. Do not make them live.
- **UI text is English.** No UI in this plan, but any new comment/identifier is English too.
- **Commit messages** end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  Write them with a bash heredoc, never a PowerShell here-string.

---

### Task 1: `ParamSmoother` — the pure piece

The whole feature rests on this class, and it is testable with no audio at all. Build it first and alone.

**Files:**
- Create: `src/audio-dsp/param-smoother.ts`
- Test: `src/audio-dsp/param-smoother.test.ts`

**Interfaces:**
- Consumes: `ParamBag` from `src/audio-dsp/types.ts` (`Record<string, number>`).
- Produces:
  - `class ParamSmoother`
  - `constructor(sr: number, timeConstantSec?: number)` — default `0.015`
  - `readonly values: ParamBag` — the smoothed bag, **mutated in place**; consumers hold this exact object reference
  - `reset(patch: ParamBag): void` — seed with no ramp
  - `setTargets(patch: ParamBag): void` — new destinations; ids never seen before land instantly
  - `tick(): boolean` — advance one sample, returns `true` if anything moved
  - `get moving(): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/audio-dsp/param-smoother.test.ts`:

```ts
// src/audio-dsp/param-smoother.test.ts
// The per-sample knob slew that lets a live param change reach a sounding note
// without a step discontinuity (a click). Pure: no audio, no AudioContext.
import { describe, it, expect } from 'vitest';
import { ParamSmoother } from './param-smoother';

const SR = 48000;

describe('ParamSmoother', () => {
  it('reset seeds values with no ramp and nothing in flight', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.4 });
    expect(s.values['filter.cutoff']).toBe(0.4);
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(false);
  });

  it('a param seen for the FIRST time lands instantly (boot must not ramp from zero)', () => {
    const s = new ParamSmoother(SR);
    s.setTargets({ 'filter.cutoff': 0.8 });
    expect(s.values['filter.cutoff']).toBe(0.8);
    expect(s.moving).toBe(false);
  });

  it('a change to a KNOWN param ramps instead of jumping', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.2 });
    s.setTargets({ 'filter.cutoff': 0.9 });
    s.tick();
    const afterOne = s.values['filter.cutoff'];
    // Moved toward the target, but nowhere near it after a single sample.
    expect(afterOne).toBeGreaterThan(0.2);
    expect(afterOne).toBeLessThan(0.25);
  });

  it('converges exactly onto the target and leaves the in-flight list', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'filter.cutoff': 0.2 });
    s.setTargets({ 'filter.cutoff': 0.9 });
    // 0.1 s is ~6.7 time constants — comfortably converged.
    for (let i = 0; i < SR * 0.1; i++) s.tick();
    expect(s.values['filter.cutoff']).toBe(0.9);
    expect(s.moving).toBe(false);
    expect(s.tick()).toBe(false);
  });

  it('is monotonic across the ramp — no overshoot to click on', () => {
    const s = new ParamSmoother(SR);
    s.reset({ 'amp.level': 1 });
    s.setTargets({ 'amp.level': 0 });
    let prev = 1;
    for (let i = 0; i < SR * 0.1; i++) {
      s.tick();
      const v = s.values['amp.level'];
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(0);
  });

  it('carries several params at once (a preset load) and drops each as it arrives', () => {
    const s = new ParamSmoother(SR);
    s.reset({ a: 0, b: 0, c: 0 });
    s.setTargets({ a: 1, b: 1 });
    expect(s.moving).toBe(true);
    for (let i = 0; i < SR * 0.1; i++) s.tick();
    expect(s.values.a).toBe(1);
    expect(s.values.b).toBe(1);
    expect(s.values.c).toBe(0);
    expect(s.moving).toBe(false);
  });

  it('re-targeting mid-ramp retargets from where it is, without restarting', () => {
    const s = new ParamSmoother(SR);
    s.reset({ x: 0 });
    s.setTargets({ x: 1 });
    for (let i = 0; i < 200; i++) s.tick();
    const mid = s.values.x;
    s.setTargets({ x: 0 });
    s.tick();
    // Turned around from `mid`, it did not jump back to 0 or restart at 1.
    expect(s.values.x).toBeLessThan(mid);
    expect(s.values.x).toBeGreaterThan(0);
  });

  it('setting the SAME value adds no work', () => {
    const s = new ParamSmoother(SR);
    s.reset({ x: 0.5 });
    s.setTargets({ x: 0.5 });
    expect(s.moving).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/param-smoother.test.ts`
Expected: FAIL — `Failed to resolve import "./param-smoother"`.

- [ ] **Step 3: Write the implementation**

Create `src/audio-dsp/param-smoother.ts`:

```ts
// src/audio-dsp/param-smoother.ts
// Per-sample knob slew for LIVE param changes.
//
// A lane's params used to be read once, at trigger: turning the cutoff did
// nothing to a note already sounding. This class keeps a SECOND copy of the bag
// that chases the real one, so a voice can read its continuous params every
// sample and hear the knob under your hand.
//
// The slew is not decoration. Knob messages arrive in ~16 ms steps; on an
// amplitude param a step IS a signal discontinuity, i.e. an audible click. A
// one-pole ramp removes it, and turns a preset load into a sweep instead of a cut.
//
// Cost: only the params still in flight are walked. At rest the list is empty and
// tick() is one integer compare — the render path pays exactly what it paid before.
import type { ParamBag } from './types';

/** ~15 ms: long enough to kill the step, short enough that the knob still feels
 *  attached to your hand. */
const DEFAULT_TIME_CONSTANT_SEC = 0.015;

export class ParamSmoother {
  /** The smoothed bag. Mutated IN PLACE — consumers keep this object reference
   *  and read through it; it is never reassigned. */
  readonly values: ParamBag = {};
  private readonly targets: ParamBag = {};
  /** Ids still travelling toward their target. Empty ⇒ nothing to do. */
  private readonly active: string[] = [];
  private readonly coeff: number;

  constructor(sr: number, timeConstantSec: number = DEFAULT_TIME_CONSTANT_SEC) {
    this.coeff = Math.exp(-1 / Math.max(1, timeConstantSec * sr));
  }

  get moving(): boolean { return this.active.length > 0; }

  /** Seed the bag: every id lands on its value at once, no ramp. Boot and lane
   *  construction go through here — a ramp from nothing would be a fade-in. */
  reset(patch: ParamBag): void {
    for (const id in patch) {
      this.values[id] = patch[id];
      this.targets[id] = patch[id];
    }
    this.active.length = 0;
  }

  /** Point one or more params at a new value. An id never seen before lands
   *  instantly (it has no previous value to ramp FROM); a known id starts a ramp. */
  setTargets(patch: ParamBag): void {
    for (const id in patch) {
      const v = patch[id];
      this.targets[id] = v;
      if (!(id in this.values)) { this.values[id] = v; continue; }
      if (this.values[id] === v) continue;
      if (this.active.indexOf(id) < 0) this.active.push(id);
    }
  }

  /** Advance every in-flight param one sample. Returns true when at least one
   *  moved, so callers can invalidate derived caches only when they must. */
  tick(): boolean {
    const n = this.active.length;
    if (n === 0) return false;
    // Walk backwards so splicing a converged id doesn't skip its neighbour.
    for (let i = n - 1; i >= 0; i--) {
      const id = this.active[i];
      const target = this.targets[id];
      const next = target + (this.values[id] - target) * this.coeff;
      // An exponential approach never arrives, so land it once the remaining
      // distance stops mattering — otherwise the id never leaves `active` and the
      // "zero cost at rest" guarantee is lost.
      if (Math.abs(target - next) <= Math.abs(target) * 1e-5 + 1e-7) {
        this.values[id] = target;
        this.active.splice(i, 1);
      } else {
        this.values[id] = next;
      }
    }
    return true;
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/param-smoother.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/param-smoother.ts src/audio-dsp/param-smoother.test.ts
git commit -m "$(cat <<'EOF'
feat(dsp): a knob slew that walks only the params still in flight

The per-sample piece live params need. At rest its in-flight list is empty and
tick() is one integer compare, so the render path pays nothing until a knob
actually moves.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `VoiceManager` hands voices the live bag

Wire the smoother in and open the channel to the voices. No renderer reads it yet, so behaviour must be **bit-identical** after this task — that is what the test asserts.

**Files:**
- Modify: `src/audio-dsp/types.ts` (add the optional hook to `VoiceRenderer`)
- Modify: `src/audio-dsp/voice-manager.ts:37-45` (constructor + `setParams`), `:93-102` (`spawn`), `:177-197` (`renderSample`)
- Test: `src/audio-dsp/live-params.dsp.test.ts` (new; grows in Tasks 3-5)

**Interfaces:**
- Consumes: `ParamSmoother` from Task 1.
- Produces:
  - `VoiceRenderer.setLiveParams?(live: ParamBag): void` — optional; the VoiceManager calls it once per voice right after `createRenderer`, handing over `smoother.values`.
  - `VoiceManager.liveParams: ParamBag` (getter) — the smoothed bag, for tests and for the subtractive path in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/audio-dsp/live-params.dsp.test.ts`:

```ts
// src/audio-dsp/live-params.dsp.test.ts
// Live continuous params: turning a knob must change the note ALREADY sounding,
// like an analogue synth — not just the next trigger. Drives the REAL path
// (VoiceManager → smoother → renderer) sample by sample, no AudioContext.
//
// Every "it changed" test carries a negative control, because a brightness
// measurement drifts on its own as an envelope decays: without the control, a
// test can pass while the knob does nothing.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import type { NoteSpec, ParamBag, VoiceRenderer } from './types';
import { registerRenderer } from './renderer-registry';
// Side-effect imports: register the real renderers.
import './tb303-renderer';

const SR = 48000;

const note = (o: Partial<NoteSpec> = {}): NoteSpec =>
  ({ midi: 45, beginSec: 0, durationSec: 2, velocity: 0.9, accent: false, slide: false, ...o });

/** Render one sustained note, optionally turning a knob part-way through.
 *  `turnAtSec` null ⇒ the negative control: same note, nobody touches anything. */
export function renderWithTurn(
  engineId: string, params: ParamBag, seconds: number,
  turnAtSec: number | null, patch: ParamBag | null,
): number[] {
  const vm = new VoiceManager(SR, engineId, params);
  vm.spawn(note({ durationSec: seconds }));
  const total = Math.floor(SR * seconds);
  const turnSample = turnAtSec == null ? -1 : Math.floor(turnAtSec * SR);
  const out: number[] = new Array(total);
  for (let i = 0; i < total; i++) {
    if (i === turnSample && patch) vm.setParams(patch);
    out[i] = vm.renderSample(i / SR);
  }
  return out;
}

describe('VoiceManager live param bag', () => {
  it('hands each voice the SAME bag object it keeps smoothing', () => {
    const seen: ParamBag[] = [];
    registerRenderer('probe-live', (): VoiceRenderer => ({
      done: false,
      noteOff() {},
      renderSample() { return 0; },
      setLiveParams(live: ParamBag) { seen.push(live); },
    }));
    const vm = new VoiceManager(SR, 'probe-live', { 'filter.cutoff': 0.3 });
    vm.spawn(note());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(vm.liveParams);
    expect(seen[0]['filter.cutoff']).toBe(0.3);
  });

  it('seeds the live bag from the constructor params without a ramp', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.7 });
    expect(vm.liveParams['filter.cutoff']).toBe(0.7);
  });

  it('setParams moves the live bag toward the new value over time', () => {
    const vm = new VoiceManager(SR, 'tb303', { 'filter.cutoff': 0.2 });
    vm.spawn(note());
    vm.setParams({ 'filter.cutoff': 0.9 });
    // Not there yet after one sample...
    vm.renderSample(0);
    expect(vm.liveParams['filter.cutoff']).toBeLessThan(0.3);
    // ...and exactly there after the ramp.
    for (let i = 1; i < SR * 0.1; i++) vm.renderSample(i / SR);
    expect(vm.liveParams['filter.cutoff']).toBe(0.9);
  });

  it('AT REST nothing changes: an untouched render is identical to today', () => {
    const params = { 'filter.cutoff': 0.4, 'env.amount': 0.3 };
    const a = renderWithTurn('tb303', params, 0.3, null, null);
    // Re-setting a param to the value it already holds must not start a ramp,
    // so this render has to match the untouched one sample for sample.
    const b = renderWithTurn('tb303', params, 0.3, 0.1, { 'filter.cutoff': 0.4 });
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts`
Expected: FAIL — `vm.liveParams` is undefined, and the probe's `setLiveParams` is never called.

- [ ] **Step 3: Add the optional hook to the renderer contract**

In `src/audio-dsp/types.ts`, inside `interface VoiceRenderer` (after `noteOff`, before `done`):

```ts
  /** Receive the lane's LIVE param bag — the smoothed copy the VoiceManager
   *  mutates in place as knobs move. A voice that implements this reads its
   *  CONTINUOUS params from here each sample, so a knob turn reaches a note that
   *  is already sounding (an analogue filter is always in the signal path; ours
   *  used to be a photograph taken at trigger).
   *
   *  STRUCTURAL params must NOT be read from here: waveform, unison size, filter
   *  model/type and envelope TIMES stay frozen at trigger. Envelope times are
   *  excluded on purpose — our envelopes are a closed-form function of elapsed
   *  time, not a charging capacitor, so re-reading the attack mid-note makes the
   *  amplitude jump. See the design spec.
   *
   *  Optional: a renderer without it keeps the trigger-time snapshot behaviour. */
  setLiveParams?(live: ParamBag): void;
```

- [ ] **Step 4: Wire the smoother into `VoiceManager`**

In `src/audio-dsp/voice-manager.ts`:

Add the import beside the existing ones:

```ts
import { ParamSmoother } from './param-smoother';
```

Add the field next to `private params: ParamBag;`:

```ts
  /** The lane's LIVE param bag: the smoothed copy voices read every sample.
   *  `params` stays the TARGET bag — what a renderer's constructor reads for its
   *  structural, trigger-time decisions. */
  private readonly smoother: ParamSmoother;
```

In the constructor, after `this.params = { ...params };`:

```ts
    this.smoother = new ParamSmoother(sr);
    this.smoother.reset(this.params);
```

Add the getter next to `activeCount`:

```ts
  /** The smoothed bag handed to every voice. Read-only by convention: write
   *  through setParams so the values ramp instead of stepping. */
  get liveParams(): ParamBag { return this.smoother.values; }
```

Replace `setParams`:

```ts
  setParams(patch: ParamBag): void {
    Object.assign(this.params, patch);
    this.smoother.setTargets(patch);
  }
```

In `spawn`, right after the `createRenderer` line and BEFORE the `setModEnvelopes` block:

```ts
    // Hand this voice the lane's live bag so its continuous params track the
    // knobs. Its constructor already took the structural snapshot from `params`.
    (v as { setLiveParams?(l: ParamBag): void }).setLiveParams?.(this.smoother.values);
```

In `renderSample`, as the FIRST statement after `this.lastT = t;`:

```ts
    // Advance any knob still travelling. At rest this is one integer compare.
    this.smoother.tick();
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole unit suite — nothing may have changed**

Run: `NO_COLOR=1 npm run test:unit`
Expected: PASS. (If it exits non-zero with `ERR_IPC_CHANNEL_CLOSED` *after* all tests pass, that is the known flaky teardown — re-run to confirm.)

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/audio-dsp/types.ts src/audio-dsp/voice-manager.ts src/audio-dsp/live-params.dsp.test.ts
git commit -m "$(cat <<'EOF'
feat(dsp): the lane keeps a live param bag and offers it to every voice

VoiceManager now holds a smoothed copy of its params and hands the same object
to each voice at spawn. No renderer reads it yet, so this commit is audibly a
no-op — the test asserts an untouched render stays identical sample for sample.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: TB-303 reads its knobs live

The pilot engine — the one from the original complaint. It also establishes the measurement helpers the remaining engines reuse.

**Files:**
- Modify: `src/audio-dsp/tb303-renderer.ts:33-98` (fields + constructor), `:148-162` (the filter block in `renderSample`)
- Test: `src/audio-dsp/live-params.dsp.test.ts` (extend)

**Interfaces:**
- Consumes: `VoiceRenderer.setLiveParams` and `VoiceManager.liveParams` from Task 2; `renderWithTurn` from the same test file.
- Produces: exported test helpers `brightness(buf, from, to)` and `maxStep(buf, from, to)`, reused by Tasks 4-6.

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/live-params.dsp.test.ts` (and add `import './wavetable-renderer';` to the side-effect imports at the top of the file — Step 5 needs it):

```ts
/** Spectral brightness proxy: energy of the first difference over total energy.
 *  Opening a lowpass passes more high frequency, so consecutive samples differ
 *  more relative to the signal's own energy. Relative by construction, and no FFT.
 *  Exported: Tasks 4-6 measure their engines the same way. */
export function brightness(buf: number[], from: number, to: number): number {
  let d = 0, e = 0;
  for (let i = from + 1; i < to; i++) {
    const df = buf[i] - buf[i - 1];
    d += df * df;
    e += buf[i] * buf[i];
  }
  return e > 1e-12 ? d / e : 0;
}

/** Largest jump between consecutive samples in a window — a click detector. */
export function maxStep(buf: number[], from: number, to: number): number {
  let m = 0;
  for (let i = from + 1; i < to; i++) {
    const s = Math.abs(buf[i] - buf[i - 1]);
    if (s > m) m = s;
  }
  return m;
}

describe('TB-303 continuous params', () => {
  // env.amount 0 switches OFF the 303's own filter envelope, so the KNOB is the
  // only thing driving the cutoff. At its default the decaying envelope dominates
  // the first half and would mask the gesture under test.
  const BASE: ParamBag = { 'filter.cutoff': 0.2, 'env.amount': 0, 'filter.resonance': 0.3 };
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  // Skip the 15 ms slew itself when measuring the second half, so the numbers
  // describe the settled sound rather than the ramp.
  const AFTER = HALF + Math.floor(SR * 0.05);

  it('opening the cutoff mid-note brightens the note ALREADY sounding', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeGreaterThan(before * 2);
  });

  it('negative control: untouched, both halves sound the same', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, null, null);
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 1.5);
    expect(after).toBeGreaterThan(before * 0.67);
  });

  it('closing the cutoff mid-note darkens it — the gesture works both ways', () => {
    const open: ParamBag = { ...BASE, 'filter.cutoff': 0.95 };
    const buf = renderWithTurn('tb303', open, SECONDS, 0.5, { 'filter.cutoff': 0.2 });
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 0.5);
  });

  it('resonance is live too', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.resonance': 0.95 });
    const ctl = renderWithTurn('tb303', BASE, SECONDS, null, null);
    // Same window, one with the res turn and one without: the sound must differ.
    let diff = 0, energy = 0;
    for (let i = AFTER; i < END; i++) { diff += Math.abs(buf[i] - ctl[i]); energy += Math.abs(ctl[i]); }
    expect(diff / Math.max(energy, 1e-9)).toBeGreaterThan(0.1);
  });

  it('the change does not click', () => {
    const buf = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    // The waveform's own steepest slope, measured where the knob is settled and
    // the filter is fully open — the loudest, brightest part of the render.
    const reference = maxStep(buf, END - Math.floor(SR * 0.2), END);
    // Across the turn there must be no jump bigger than the signal already makes.
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });

  it('the waveform is STRUCTURAL: switching it mid-note leaves the note alone', () => {
    const withSwitch = renderWithTurn('tb303', BASE, SECONDS, 0.5, { 'osc.wave': 1 });
    const control = renderWithTurn('tb303', BASE, SECONDS, null, null);
    expect(withSwitch).toEqual(control);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts -t 'TB-303 continuous'`
Expected: FAIL. The brightening test fails (`after` ≈ `before` — the knob does nothing today); the negative-control, no-click and structural tests already pass.

- [ ] **Step 3: Make the TB-303 renderer read live**

In `src/audio-dsp/tb303-renderer.ts`:

Add to the imports (it already imports `param`):

```ts
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
```
(unchanged — `ParamBag` is already imported.)

Replace the "Saved knob bases" field block (currently `cutoffBase`/`envAmountHz`/`accentBoost`/`envModBase`/`decayBase`) with:

```ts
  // Trigger-time knob snapshot. Used as the fallback when no live bag is attached
  // (the offline kernel builds renderers directly) and as the base the modulation
  // offsets are added to.
  private cutoffBase: number;
  private resBase: number;
  private envModBase: number;
  private decayBase: number;
  private accentBoost: number;
  private accent: boolean;
  /** The lane's live (smoothed) knob bag, or null when this voice runs standalone. */
  private live: ParamBag | null = null;
  // Cached expensive conversions, refreshed only when their raw input moves.
  // 80·100^x and the Q→ladder curve are per-sample costs we refuse to pay while
  // nothing is turning.
  private cutRaw = NaN;
  private cutHz = 0;
  private resRaw = NaN;
  private resLadder = 0;
```

Delete the now-unused `baseCutHz`, `peakCutHz`, `decaySec`, `ladderRes` and `envAmountHz` fields from the class.

In the constructor, replace the block from `this.baseCutHz = …` down to `this.ladderRes = qToLadderRes(biquadQ);` with:

```ts
    this.cutoffBase = cutoff;
    this.resBase = resonance;
    this.envModBase = envMod;
    this.decayBase = decay;
    this.accent = note.accent;
    this.accentBoost = note.accent ? accentAmt : 0;
```

(The local `const decay`, `const cutoff`, `const resonance`, `const envMod`, `const accentAmt` reads stay exactly as they are. Delete the two lines `this.decaySec = 0.05 + decay * 1.2;` and `if (note.accent) this.decaySec *= 0.6;` — the decay is now derived per sample below.)

Add the hook next to `setModEnvelopes`:

```ts
  setLiveParams(live: ParamBag): void { this.live = live; }
```

In `renderSample`, replace the whole filter block (from the `// Filter cutoff envelope:` comment down to and including the `const res = …` line) with:

```ts
    // Filter contour. The knob values come from the lane's LIVE bag, so turning
    // cutoff/res/env moves THIS note; modulation offsets are added on top exactly
    // as before, which is why a hand on the knob and an LFO simply sum.
    const L = this.live;
    const cutKnob = L ? param(L, 'filter.cutoff', this.cutoffBase) : this.cutoffBase;
    const resKnob = L ? param(L, 'filter.resonance', this.resBase) : this.resBase;
    const envKnob = L ? param(L, 'env.amount', this.envModBase) : this.envModBase;
    const decKnob = L ? param(L, 'env.decay', this.decayBase) : this.decayBase;

    const cutoff01 = mo?.['filter.cutoff'] ? clamp01(cutKnob + mo['filter.cutoff']) : cutKnob;
    if (cutoff01 !== this.cutRaw) { this.cutRaw = cutoff01; this.cutHz = 80 * Math.pow(100, cutoff01); }
    const baseCutHz = this.cutHz;

    const envMod01 = mo?.['env.amount'] ? clamp01(envKnob + mo['env.amount']) : envKnob;
    const peakCutHz = Math.min(baseCutHz + envMod01 * 6000 * (1 + this.accentBoost), 18000);

    // env.decay = how fast the cutoff closes; accent shortens it, as on the real synth.
    const decay01 = mo?.['env.decay'] ? clamp01(decKnob + mo['env.decay']) : decKnob;
    const decaySec = (0.05 + decay01 * 1.2) * (this.accent ? 0.6 : 1);
    const cutoffHz = baseCutHz + (peakCutHz - baseCutHz) * Math.exp(-dt / decaySec);

    // Biquad Q from the legacy synth (1 + res*25 + accent*6) mapped onto the
    // ladder's 0..1. Cached: the pow in qToLadderRes is not a per-sample cost.
    if (resKnob !== this.resRaw) {
      this.resRaw = resKnob;
      this.resLadder = qToLadderRes(1 + resKnob * 25 + this.accentBoost * 6);
    }
    const res = mo?.['filter.resonance'] ? clamp01(this.resLadder + mo['filter.resonance']) : this.resLadder;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the TB-303 and modulation suites — no regression**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/tb303-renderer.test.ts src/audio-dsp/modulation-pipeline.test.ts src/audio-dsp/velocity-response.test.ts`
Expected: PASS. These cover the 303's accent/velocity behaviour and that an LFO still reaches its cutoff — the two things this refactor could plausibly break.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/audio-dsp/tb303-renderer.ts src/audio-dsp/live-params.dsp.test.ts
git commit -m "$(cat <<'EOF'
feat(dsp): the 303's filter follows your hand, not just the next note

Cutoff, resonance, env amount and decay now come from the lane's live bag every
sample instead of a snapshot taken at trigger. Modulation offsets still add on
top, so an LFO and a hand on the knob sum the way they do on the real thing.
The two expensive conversions (80*100^x and the Q curve) are cached against
their raw input, so a settled knob costs a float compare.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Subtractive — one live snapshot per lane, not per voice

The only engine that reads a TYPED structure instead of the dot-id bag. Converting it per voice per sample would be absurd, so the lane owns one and refreshes it only when something moves.

**Files:**
- Modify: `src/audio-dsp/subtractive-renderer.ts:21-39` (`subParamsFromBag` → in-place variant), `:60-149` (fields + constructor), `:227-338` (`renderSample`)
- Modify: `src/audio-dsp/voice-manager.ts` (the subtractive live snapshot)
- Modify: `src/audio-dsp/types.ts` (`setLiveSubParams`)
- Test: `src/audio-dsp/live-params.dsp.test.ts` (extend)

**Interfaces:**
- Consumes: `ParamSmoother`, `VoiceManager.liveParams`, the test helpers from Task 3.
- Produces:
  - `export function subParamsInto(b: ParamBag, out: SubParams): SubParams` in `subtractive-renderer.ts`
  - `VoiceRenderer.setLiveSubParams?(live: SubParams): void`

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/live-params.dsp.test.ts` (add `import './subtractive-renderer';` to the side-effect imports):

```ts
describe('Subtractive continuous params', () => {
  const BASE: ParamBag = {
    'filter.cutoff': 0.2, 'filter.resonance': 0.2, 'filter.envAmount': 0,
    'amp.builtinEnv': 1, 'amp.attack': 0.005, 'amp.decay': 0.5, 'amp.sustain': 1, 'amp.release': 0.2,
    'osc1.level': 0.6, 'osc2.level': 0.4,
  };
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  const AFTER = HALF + Math.floor(SR * 0.05);

  it('opening the cutoff mid-note brightens the sounding note', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'filter.cutoff': 0.95 });
    expect(brightness(buf, AFTER, END)).toBeGreaterThan(brightness(buf, 0, HALF) * 2);
  });

  it('negative control: untouched, both halves match', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, null, null);
    const before = brightness(buf, 0, HALF);
    const after = brightness(buf, AFTER, END);
    expect(after).toBeLessThan(before * 1.5);
    expect(after).toBeGreaterThan(before * 0.67);
  });

  it('an oscillator level is live', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'osc1.level': 0 });
    const ctl = renderWithTurn('subtractive', BASE, SECONDS, null, null);
    const rms = (b: number[]) => {
      let s = 0;
      for (let i = AFTER; i < END; i++) s += b[i] * b[i];
      return Math.sqrt(s / (END - AFTER));
    };
    expect(rms(buf)).toBeLessThan(rms(ctl) * 0.8);
  });

  it('dropping a level to zero does not click', () => {
    const buf = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'osc1.level': 0 });
    const reference = maxStep(buf, Math.floor(SR * 0.2), HALF - 32);
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });

  it('the ENVELOPE times stay frozen: shortening the attack mid-note changes nothing', () => {
    // Excluded by design — our envelopes are closed-form over elapsed time, so
    // re-reading the attack mid-note would step the amplitude. See the spec.
    const slow: ParamBag = { ...BASE, 'amp.attack': 0.8 };
    const withTurn = renderWithTurn('subtractive', slow, SECONDS, 0.2, { 'amp.attack': 0.001 });
    const control = renderWithTurn('subtractive', slow, SECONDS, null, null);
    expect(withTurn).toEqual(control);
  });

  it('the filter MODEL stays frozen: swapping it mid-note changes nothing', () => {
    const withTurn = renderWithTurn('subtractive', BASE, SECONDS, 0.5, { 'filter.model': 1 });
    const control = renderWithTurn('subtractive', BASE, SECONDS, null, null);
    expect(withTurn).toEqual(control);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts -t 'Subtractive continuous'`
Expected: FAIL on the brightening and level tests; the frozen and control tests pass.

- [ ] **Step 3: Add the in-place converter**

In `src/audio-dsp/subtractive-renderer.ts`, replace `subParamsFromBag` with the pair:

```ts
/** Read a dot-id ParamBag into an EXISTING SubParams — no allocation, so the
 *  lane can refresh its live snapshot on the audio thread. Defaults match
 *  subtractive-params.ts / defaultSubParams(). */
export function subParamsInto(b: ParamBag, out: SubParams): SubParams {
  out.masterTune = param(b, 'master.tune', 0);
  out.unisonVoices = param(b, 'master.unison', 1);
  out.unisonDetune = param(b, 'master.detune', 25);
  out.unisonDrift = param(b, 'master.drift', 0);
  out.osc1Wave = param(b, 'osc1.wave', 0);
  out.osc1Level = param(b, 'osc1.level', 0.6);
  out.osc1Detune = param(b, 'osc1.detune', 0);
  out.osc1Pw = param(b, 'osc1.pw', 0.5);
  out.osc2Pw = param(b, 'osc2.pw', 0.5);
  out.osc1Sync = param(b, 'osc1.sync', 2);
  out.osc2Sync = param(b, 'osc2.sync', 2);
  out.osc2Wave = param(b, 'osc2.wave', 1);
  out.osc2Level = param(b, 'osc2.level', 0.4);
  out.osc2Detune = param(b, 'osc2.detune', 7);
  out.subLevel = param(b, 'sub.level', 0.3);
  out.noiseLevel = param(b, 'noise.level', 0);
  out.noiseColor = param(b, 'noise.color', 0.6);
  out.filterCutoff = param(b, 'filter.cutoff', 0.55);
  out.filterResonance = param(b, 'filter.resonance', 0.25);
  out.filterEnvAmount = param(b, 'filter.envAmount', 0.45);
  out.filterModel = param(b, 'filter.model', 0);
  out.filterType = param(b, 'filter.type', 0);
  out.filterDrive = param(b, 'filter.drive', 0);
  out.filterKeyTrack = param(b, 'filter.keyTrack', 0);
  out.filterBuiltinEnv = param(b, 'filter.builtinEnv', 1);
  out.filterAttack = param(b, 'filter.attack', 0.01);
  out.filterDecay = param(b, 'filter.decay', 0.3);
  out.filterSustain = param(b, 'filter.sustain', 0.4);
  out.filterRelease = param(b, 'filter.release', 0.35);
  out.ampBuiltinEnv = param(b, 'amp.builtinEnv', 1);
  out.ampAttack = param(b, 'amp.attack', 0.01);
  out.ampDecay = param(b, 'amp.decay', 0.2);
  out.ampSustain = param(b, 'amp.sustain', 0.7);
  out.ampRelease = param(b, 'amp.release', 0.3);
  return out;
}

/** Allocating form — for a renderer's own trigger-time snapshot. */
export function subParamsFromBag(b: ParamBag): SubParams {
  return subParamsInto(b, {} as SubParams);
}
```

- [ ] **Step 4: Let the lane own one live SubParams**

In `src/audio-dsp/types.ts`, add to `interface VoiceRenderer` right after `setLiveParams`:

```ts
  /** Subtractive-only: it reads a TYPED SubParams, not the dot-id bag, so the lane
   *  keeps ONE live snapshot and every voice reads through it — refreshed once per
   *  lane per sample, never once per voice. (The engineId special-case mirrors the
   *  one fillOffsets already makes for the same reason.) */
  setLiveSubParams?(live: SubParams): void;
```

Add `SubParams` to that file's type exports if it is not already visible there — it is declared at the top of `types.ts`, so no import is needed.

In `src/audio-dsp/voice-manager.ts`, add the import:

```ts
import { subParamsInto, subParamsFromBag } from './subtractive-renderer';
```

Add the field next to `smoother`:

```ts
  /** The lane's live SubParams (subtractive only), refreshed from the smoothed bag
   *  whenever a knob moves. Built on first spawn: a non-subtractive lane never
   *  allocates it. */
  private liveSub: SubParams | null = null;
```

Add `SubParams` to the type import at the top of the file:

```ts
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets, SubParams } from './types';
```

In `spawn`, right after the `setLiveParams` line added in Task 2:

```ts
    if (this.engineId === 'subtractive') {
      if (!this.liveSub) this.liveSub = subParamsFromBag(this.smoother.values);
      (v as { setLiveSubParams?(l: SubParams): void }).setLiveSubParams?.(this.liveSub);
    }
```

In `renderSample`, replace the `this.smoother.tick();` line from Task 2 with:

```ts
    // Advance any knob still travelling. At rest this is one integer compare.
    // Subtractive reads a typed snapshot, so refresh the lane's ONE copy — only
    // when something actually moved.
    if (this.smoother.tick() && this.liveSub) subParamsInto(this.smoother.values, this.liveSub);
```

- [ ] **Step 5: Freeze the structural fields in the subtractive renderer**

In `src/audio-dsp/subtractive-renderer.ts`, add these fields to the class:

```ts
  // Trigger-time frozen structure. `this.p` becomes the LANE's live snapshot once
  // setLiveSubParams runs, so anything that must NOT change mid-note is copied
  // here at spawn: the two oscillator waves (a Sync wave reinterprets its second
  // argument), the two envelope switches and all eight envelope TIMES.
  private readonly osc1WaveFrozen: number;
  private readonly osc2WaveFrozen: number;
  private readonly ampBuiltinFrozen: number;
  private readonly filterBuiltinFrozen: number;
  private readonly ampA: number; private readonly ampD: number;
  private readonly ampS: number; private readonly ampR: number;
  private readonly filtA: number; private readonly filtD: number;
  private readonly filtS: number; private readonly filtR: number;
  /** Cached cutoff conversion: 60·220^x is not a per-sample cost while nothing moves. */
  private cutRaw = NaN;
  private cutHzCached = 0;
  /** Cached master-tune conversion (the note's base frequency). */
  private tuneRaw = NaN;
  private baseFreqCached = 0;
  private readonly noteHz: number;
```

In the constructor, after `const p = subParamsFromBag(params); this.p = p;`:

```ts
    this.osc1WaveFrozen = p.osc1Wave;
    this.osc2WaveFrozen = p.osc2Wave;
    this.ampBuiltinFrozen = p.ampBuiltinEnv;
    this.filterBuiltinFrozen = p.filterBuiltinEnv;
    this.ampA = p.ampAttack; this.ampD = p.ampDecay; this.ampS = p.ampSustain; this.ampR = p.ampRelease;
    this.filtA = p.filterAttack; this.filtD = p.filterDecay; this.filtS = p.filterSustain; this.filtR = p.filterRelease;
    this.noteHz = midiToFreq(note.midi);
```

Add the hook next to `setModEnvelopes`:

```ts
  /** Swap this voice's param source for the lane's LIVE snapshot. Everything
   *  structural was already copied out in the constructor. */
  setLiveSubParams(live: SubParams): void { this.p = live; }
```

(`this.p` must lose any `readonly` modifier for this to compile.)

- [ ] **Step 6: Make `renderSample` use the frozen fields and the live cutoff**

In `renderSample`:

Replace the two `p.osc1Wave === WAVE_SYNC` / `p.osc2Wave === WAVE_SYNC` tests with `this.osc1WaveFrozen === WAVE_SYNC` and `this.osc2WaveFrozen === WAVE_SYNC`.

Replace the frequency line:

```ts
    // Master tune is continuous, so it moves the sounding note. Cached: the pow
    // only re-runs when the tune knob actually changes.
    if (p.masterTune !== this.tuneRaw) {
      this.tuneRaw = p.masterTune;
      this.baseFreqCached = this.noteHz * Math.pow(2, p.masterTune / 12);
    }
    const baseFreq = this.baseFreqCached;
    const f = mo?.masterTune ? baseFreq * Math.pow(2, mo.masterTune * MOD_TUNE_SEMIS / 12) : baseFreq;
```

(and delete the `this.baseFreq` field and its constructor assignment, replacing every other use of `this.baseFreq` with `baseFreq`.)

Replace the `baseCutoffHz` / `keyTrackHz` / `envRangeHz` block with:

```ts
    // Filter cutoff = base + keytrack + envelope contribution. The base is LIVE
    // (the knob under your hand), and modulation adds on top of it. keytrack and
    // env range scale with the base, so they follow it.
    const cut01 = mo?.filterCutoff ? clamp01(p.filterCutoff + mo.filterCutoff) : p.filterCutoff;
    if (cut01 !== this.cutRaw) {
      this.cutRaw = cut01;
      this.cutHzCached = Math.min(60 * Math.pow(220, cut01), 18000);
    }
    const baseCutoffHz = this.cutHzCached;
    const kt = mo?.filterKeyTrack ? clamp01(p.filterKeyTrack + mo.filterKeyTrack) : p.filterKeyTrack;
    const keyTrackHz = this.keySemiDelta * baseCutoffHz * (Math.pow(2, 1 / 12) - 1) * kt;
    const envAmt = mo?.filterEnvAmount ? clamp01(p.filterEnvAmount + mo.filterEnvAmount) : p.filterEnvAmount;
    const envRangeHz = Math.min(baseCutoffHz * 7, 16000) * envAmt * this.accentMul;
```

(and delete the `baseCutoffHz`, `keyTrackHz` and `envRangeHz` fields plus their constructor assignments.)

Replace the four envelope reads with the frozen fields:

```ts
    if (this.filterBuiltinFrozen >= 0.5) {
      fe = this.filtEnv.update(t, gate, this.filtA, this.filtD, this.filtS, this.filtR);
```

```ts
    if (this.ampBuiltinFrozen >= 0.5) {
      ae = this.ampEnv.update(t, gate, this.ampA, this.ampD, this.ampS, this.ampR);
```

```ts
    const ampOff = this.ampBuiltinFrozen >= 0.5 ? this.ampEnv.isOff
      : this.ampEnvAdsr ? this.ampEnvAdsr.isOff : true;
```

- [ ] **Step 7: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts src/audio-dsp/subtractive-renderer.test.ts src/audio-dsp/modulation-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the whole unit suite**

Run: `NO_COLOR=1 npm run test:unit`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/audio-dsp/subtractive-renderer.ts src/audio-dsp/voice-manager.ts src/audio-dsp/types.ts src/audio-dsp/live-params.dsp.test.ts
git commit -m "$(cat <<'EOF'
feat(dsp): subtractive voices read the lane's live snapshot

Subtractive is the one engine reading a typed SubParams instead of the dot-id
bag, so the LANE now owns a single live copy refreshed only when a knob moves,
and every voice points at it. Waves, filter model and all eight envelope times
are copied out at trigger and stay frozen, which is what keeps a mid-note attack
change from stepping the amplitude.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: FM, Wavetable, Karplus and Westcoast

Four engines, same shape as the 303: keep the trigger snapshot as the fallback, read the continuous ids from the live bag, cache the expensive conversions.

**Files:**
- Modify: `src/audio-dsp/fm-renderer.ts` (fields + `renderSample`)
- Modify: `src/audio-dsp/wavetable-renderer.ts:61-90` + `renderSample`
- Modify: `src/audio-dsp/karplus-renderer.ts:123-145` + `renderSample`
- Modify: `src/audio-dsp/westcoast-renderer.ts:193-265` + `renderSample`
- Test: `src/audio-dsp/live-params.dsp.test.ts` (extend)

**Interfaces:**
- Consumes: `setLiveParams` (Task 2), `brightness`/`maxStep`/`renderWithTurn` (Task 3).
- Produces: nothing new — each renderer gains a private `live: ParamBag | null` and a `setLiveParams` method exactly like `TB303Renderer`.

**Per-engine split — LIVE vs FROZEN:**

| Engine | Live (read every sample) | Frozen at trigger |
|---|---|---|
| FM | `op1..4.level`, `op1..4.ratio`, `op1..4.detune`, `feedback`, `amp.mix`, `output.trim` | `algorithm`, `op*.attack/decay/sustain/release` |
| Wavetable | `osc.morph`, `osc.detune`, `filter.cutoff`, `filter.resonance` | `osc.waveA`, `osc.waveB`, `amp.attack/decay/sustain/release`, `amp.builtinEnv` |
| Karplus | `amp.level`, `string.damping`, `string.brightness`, `output.trim` | `excite.time`, `excite.tone`, `amp.attack`, `amp.release`, `amp.builtinEnv` (the excitation is already over) |
| Westcoast | `osc.fmIndex`, `osc.ratio`, `osc.detune`, `osc.ring`, `osc.subLevel`, `timbre.fold`, `timbre.symmetry`, `lpg.cutoff`, `lpg.resonance`, `amp.level`, `master.tune` | `osc.mainWave`, `osc.modWave`, `osc.subDiv`, `lpg.mode`, `contour.*` |

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/live-params.dsp.test.ts` (add the four side-effect imports at the top: `./fm-renderer`, `./karplus-renderer`, `./westcoast-renderer`; `./wavetable-renderer` was added in Task 3):

```ts
// One row per engine: a continuous param that AUDIBLY moves, and the direction
// the measurement should go. Each row gets its own gesture test AND its own
// negative control — no `(or …)` alternatives, so a dead path cannot hide behind
// a live one.
const ENGINE_CASES: Array<{
  id: string; base: ParamBag; patch: ParamBag; expect: 'brighter' | 'quieter';
}> = [
  { id: 'wavetable', base: { 'filter.cutoff': 0.2, 'osc.waveA': 3, 'osc.waveB': 3, 'amp.sustain': 1 },
    patch: { 'filter.cutoff': 0.95 }, expect: 'brighter' },
  { id: 'fm', base: { algorithm: 0, 'op1.level': 0.6, 'op2.level': 0.5, 'op1.sustain': 1, 'op2.sustain': 1 },
    patch: { 'op2.level': 0 }, expect: 'quieter' },
  { id: 'karplus', base: {}, patch: { 'amp.level': 0.1 }, expect: 'quieter' },
  { id: 'westcoast', base: { 'lpg.cutoff': 0.2, 'lpg.mode': 0, 'contour.decay': 4, 'contour.amount': 0 },
    patch: { 'lpg.cutoff': 0.95 }, expect: 'brighter' },
];

describe.each(ENGINE_CASES)('$id continuous params', ({ id, base, patch, expect: dir }) => {
  const SECONDS = 1;
  const HALF = Math.floor(SR * SECONDS / 2);
  const END = Math.floor(SR * SECONDS);
  const AFTER = HALF + Math.floor(SR * 0.05);
  const rms = (b: number[], from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += b[i] * b[i];
    return Math.sqrt(s / Math.max(1, to - from));
  };

  it('the knob moves the note already sounding', () => {
    const buf = renderWithTurn(id, base, SECONDS, 0.5, patch);
    if (dir === 'brighter') {
      expect(brightness(buf, AFTER, END)).toBeGreaterThan(brightness(buf, 0, HALF) * 1.8);
    } else {
      expect(rms(buf, AFTER, END)).toBeLessThan(rms(buf, 0, HALF) * 0.7);
    }
  });

  it('negative control: untouched, the same measurement barely moves', () => {
    const buf = renderWithTurn(id, base, SECONDS, null, null);
    if (dir === 'brighter') {
      expect(brightness(buf, AFTER, END)).toBeLessThan(brightness(buf, 0, HALF) * 1.8);
    } else {
      expect(rms(buf, AFTER, END)).toBeGreaterThan(rms(buf, 0, HALF) * 0.7);
    }
  });

  it('the change does not click', () => {
    const buf = renderWithTurn(id, base, SECONDS, 0.5, patch);
    // The reference window must be the LOUDEST/BRIGHTEST side of the gesture,
    // because that is where the waveform's own steepest slope lives. Measuring a
    // 'brighter' turn against its dull first half would compare the sweep to
    // silence and fail on a perfectly clean render.
    const reference = dir === 'brighter'
      ? maxStep(buf, END - Math.floor(SR * 0.2), END)
      : maxStep(buf, Math.floor(SR * 0.2), HALF - 32);
    const across = maxStep(buf, HALF - 32, HALF + Math.floor(SR * 0.03));
    expect(across).toBeLessThanOrEqual(reference);
  });
});

it('wavetable: the WAVE choice is structural and stays frozen mid-note', () => {
  const base: ParamBag = { 'osc.waveA': 0, 'osc.waveB': 0, 'amp.sustain': 1 };
  const withTurn = renderWithTurn('wavetable', base, 1, 0.5, { 'osc.waveA': 3 });
  const control = renderWithTurn('wavetable', base, 1, null, null);
  expect(withTurn).toEqual(control);
});

it('wavetable: the ENVELOPE times stay frozen mid-note', () => {
  const base: ParamBag = { 'amp.attack': 0.8, 'amp.sustain': 1, 'osc.waveA': 3, 'osc.waveB': 3 };
  const withTurn = renderWithTurn('wavetable', base, 1, 0.2, { 'amp.attack': 0.001 });
  const control = renderWithTurn('wavetable', base, 1, null, null);
  expect(withTurn).toEqual(control);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts`
Expected: FAIL — the four "the knob moves the note already sounding" cases fail; controls, click and frozen tests pass.

- [ ] **Step 3: Give every renderer the live hook**

In EACH of `fm-renderer.ts`, `wavetable-renderer.ts`, `karplus-renderer.ts` and
`westcoast-renderer.ts`:

1. Add the field and hook:

```ts
  /** The lane's live (smoothed) knob bag, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). */
  private live: ParamBag | null = null;

  setLiveParams(l: ParamBag): void { this.live = l; }
```

2. At the top of `renderSample`, read the live knobs with the trigger snapshot as the fallback. For wavetable:

```ts
    // Live knobs: turning these moves THIS note. The trigger snapshot is the
    // fallback when no lane bag is attached.
    const L = this.live;
    const morphKnob = L ? param(L, 'osc.morph', this.morphBase) : this.morphBase;
    const detuneKnob = L ? param(L, 'osc.detune', this.detuneBase) : this.detuneBase;
    const cutoffKnob = L ? param(L, 'filter.cutoff', this.cutoffBase) : this.cutoffBase;
    const qKnob = L ? clamp01(param(L, 'filter.resonance', this.qBase)) : this.qBase;
```

3. Replace every use of the old `this.morphBase` / `this.detuneBase` / `this.cutoffBase` / `this.qBase` **inside `renderSample`** with the local `*Knob` values, leaving the modulation arithmetic (`mo?.[…] ? clamp01(base + mo[…]) : base`) exactly as it is — just fed from the live value instead of the snapshot.

4. Cache any exponential conversion of a live value against its raw input, as the 303 does:

```ts
  private cutRaw = NaN;
  private cutHz = 0;
```
```ts
    if (cutoff01 !== this.cutRaw) { this.cutRaw = cutoff01; this.cutHz = <the engine's existing conversion>; }
```

- [ ] **Step 3b: Per-engine specifics**

The four differ in which fields hold the snapshot. Verified field names:

**Wavetable** (`wavetable-renderer.ts:61-90`) — snapshot fields are `morphBase`,
`detuneBase`, `cutoffBase`, `qBase`; those four become live (code above). Leave
`aA`/`aD`/`aS`/`aR`/`ampOn` and the two resolved wave tables alone: envelope
times and wave CHOICE are frozen.

**FM** (`fm-renderer.ts:85-120`) — `this.lvl[i]` (per-operator level),
`this.feedback`, `this.mix`, `this.outputTrim` become live, plus each operator's
ratio and detune. Read them inside the operator loop in `renderSample`:

```ts
    const L = this.live;
    const feedback = L ? param(L, 'feedback', this.feedback) : this.feedback;
    const mix = L ? param(L, 'amp.mix', this.mix) : this.mix;
```
and per operator `i` (1-based id, 0-based array index):
```ts
      const lvl = L ? param(L, `op${i + 1}.level`, this.lvl[i]) : this.lvl[i];
```
Leave `this.algoIdx` and the four `opA`/`opD`/`opS`/`opR` arrays frozen —
algorithm is a topology, and those are envelope times.

**Karplus** (`karplus-renderer.ts:123-145`) — `this.level`, `this.trim` and the
string's `damping` / `brightness` become live; they are already fed into the
delay line every sample, so only their SOURCE changes. Do NOT touch `exciteDur`
/ `noiseTone` / `atk` / `rel` / `ampEnvOn`: the excitation burst is over by the
time anyone turns a knob, and re-reading it would restart the pluck.

**Westcoast** (`westcoast-renderer.ts:193-265`) — it already keeps `lpgResBase`
as a modulation base, so follow that precedent for the rest: `lpg.cutoff`,
`lpg.resonance`, `timbre.fold`, `timbre.symmetry`, `osc.fmIndex`, `osc.ring`,
`osc.subLevel`, `osc.ratio`, `osc.detune`, `master.tune` and `amp.level` become
live. `this.subDiv` is a resolved index — frozen — and so are the wave choices,
`lpg.mode` and every `contour.*`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/live-params.dsp.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 5: Run each engine's own suite plus the modulation pipeline**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fm-renderer.test.ts src/audio-dsp/wavetable-renderer.test.ts src/audio-dsp/karplus-renderer.test.ts src/audio-dsp/westcoast-renderer.test.ts src/audio-dsp/modulation-pipeline.test.ts src/audio-dsp/fm-presets.test.ts src/audio-dsp/output-trim.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/audio-dsp/fm-renderer.ts src/audio-dsp/wavetable-renderer.ts src/audio-dsp/karplus-renderer.ts src/audio-dsp/westcoast-renderer.ts src/audio-dsp/live-params.dsp.test.ts
git commit -m "$(cat <<'EOF'
feat(dsp): FM, wavetable, karplus and westcoast follow their knobs live

Same shape as the 303: continuous params come from the lane's live bag every
sample, structure stays frozen at trigger. Karplus keeps its excitation frozen
on purpose — the pluck is over before anyone can turn anything, and re-reading
it would restart the burst.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sampler — a live pad table

The Sampler's renderer already reads cutoff, res, level, pan and sends every sample; the only frozen thing is the object it reads them FROM. It has no params message at all, so this task adds one.

**Files:**
- Modify: `src/audio-worklet/sampler-node.ts:21-26` (message union), `:39-42` (builder), `:101-109` (class method)
- Modify: `src/audio-worklet/sampler-processor.ts:30-38` (message type), `:58-85` (handler), `:99-114` (spawn)
- Modify: `src/audio-dsp/sample/sampler-renderer.ts:21-51` (live table), `:64-117` (reads)
- Modify: `src/engines/sampler-worklet-engine.ts` (post pad params on change)
- Test: `src/audio-dsp/sample/sampler-renderer.test.ts` (extend)

**Interfaces:**
- Consumes: `SampleSpawn`, `PadParams` (unchanged shapes).
- Produces:
  - `type LivePadParams = { cutoff: number; res: number; level: number; pan: number; rev: number; dly: number }`
    exported from `src/audio-dsp/sample/types.ts`
  - `SamplerMsg` gains `{ type: 'padParams'; padNote: number; params: LivePadParams }`
  - `samplerPadParamsMessage(padNote: number, params: LivePadParams): [SamplerMsg]` in `sampler-node.ts`
  - `SamplerWorkletNode.setPadParams(padNote: number, params: LivePadParams): void`
  - `SamplerRenderer.setLivePad(live: LivePadParams): void`

Note the deliberate omission: `attack` and `decay` are NOT in `LivePadParams` — they are envelope times, excluded by the spec. Neither are `rate`, `offsetSec`, `loop*` or the choke fields: those describe the TRIGGER, not the knob.

- [ ] **Step 1: Write the failing test**

Append to `src/audio-dsp/sample/sampler-renderer.test.ts`:

```ts
describe('SamplerRenderer live pad params', () => {
  it('reads cutoff from the live pad table instead of the frozen spawn', () => {
    // A bright noise buffer so a cutoff change is measurable.
    const sr = 48000;
    const n = sr;
    const data = new Float32Array(n);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
    const bank = new SampleBank();
    bank.set('s', { channels: [data], sampleRate: sr });

    const spawn = { ...baseSpawn(), sampleId: 's', gateSec: 0.5, cutoff: 0.2, res: 0 };
    const live = { cutoff: 0.2, res: 0, level: spawn.level, pan: spawn.pan, rev: spawn.rev, dly: spawn.dly };
    const r = new SamplerRenderer(spawn, bank, sr);
    r.setLivePad(live);

    const out: number[] = [];
    for (let i = 0; i < sr * 0.4; i++) {
      // Open the filter half-way through by writing the LIVE table, exactly as a
      // knob turn does — the spawn is never touched.
      if (i === Math.floor(sr * 0.2)) live.cutoff = 1;
      out.push(r.renderSample(i / sr));
    }
    const energy = (from: number, to: number) => {
      let d = 0, e = 0;
      for (let i = from + 1; i < to; i++) { const df = out[i] - out[i - 1]; d += df * df; e += out[i] * out[i]; }
      return e > 1e-12 ? d / e : 0;
    };
    const before = energy(Math.floor(sr * 0.05), Math.floor(sr * 0.2));
    const after = energy(Math.floor(sr * 0.25), Math.floor(sr * 0.4));
    expect(after).toBeGreaterThan(before * 2);
  });

  it('without a live table it still plays from the spawn (offline path)', () => {
    const sr = 48000;
    const data = new Float32Array(sr).fill(0.5);
    const bank = new SampleBank();
    bank.set('s', { channels: [data], sampleRate: sr });
    const r = new SamplerRenderer({ ...baseSpawn(), sampleId: 's' }, bank, sr);
    let peak = 0;
    for (let i = 0; i < 1000; i++) peak = Math.max(peak, Math.abs(r.renderSample(i / sr)));
    expect(peak).toBeGreaterThan(0);
  });
});
```

Reuse whatever `baseSpawn()` helper and `SampleBank` import the existing file already has; if it builds spawn literals inline, factor a local `baseSpawn()` returning the same literal and use it in the new tests only.

- [ ] **Step 2: Run the test and verify it fails**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/sample/sampler-renderer.test.ts`
Expected: FAIL — `r.setLivePad is not a function`.

- [ ] **Step 3: Add the type and the renderer hook**

In `src/audio-dsp/sample/types.ts`, append:

```ts
/** The per-pad values a knob can move WHILE a voice sounds. Deliberately smaller
 *  than PadParams: attack/decay are envelope times (excluded — our envelopes are
 *  closed-form over elapsed time), and rate/offset/loop/choke describe the
 *  trigger, not the knob. */
export interface LivePadParams {
  cutoff: number;
  res: number;
  level: number;
  pan: number;
  rev: number;
  dly: number;
}
```

In `src/audio-dsp/sample/sampler-renderer.ts`, add the field, the hook and the reads:

```ts
  /** The pad's LIVE knob values, shared with the processor's pad table and
   *  mutated in place there. Null ⇒ read the frozen spawn (offline path). */
  private livePad: LivePadParams | null = null;
```
```ts
  /** Point this voice at its pad's live knob values, so turning CUTOFF moves the
   *  sample that is already playing. */
  setLivePad(live: LivePadParams): void { this.livePad = live; }
```

In `renderStereo`, replace the reads of `this.s.cutoff`, `this.s.res`, `this.s.level` and `this.s.pan`:

```ts
    const lp = this.livePad;
    const cutoffKnob = lp ? lp.cutoff : this.s.cutoff;
    const resKnob = lp ? lp.res : this.s.res;
    const levelKnob = lp ? lp.level : this.s.level;
    const panKnob = lp ? lp.pan : this.s.pan;
    const cutoffHz = Math.min(this.sr * 0.45, 60 * Math.pow(300, cutoffKnob));
    const res = clamp01(resKnob);
```

and use `levelKnob` in `const g = amp * levelKnob * this.s.gain;` and `panKnob` in place of `const pan = this.s.pan;`.

In the four send getters, read the live table too:

```ts
  sendRevL(): number { return this.outL * (this.livePad ? this.livePad.rev : this.s.rev); }
  sendRevR(): number { return this.outR * (this.livePad ? this.livePad.rev : this.s.rev); }
  sendDlyL(): number { return this.outL * (this.livePad ? this.livePad.dly : this.s.dly); }
  sendDlyR(): number { return this.outR * (this.livePad ? this.livePad.dly : this.s.dly); }
```

Add `LivePadParams` to the existing type import from `./types`.

- [ ] **Step 4: Run the renderer test and verify it passes**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/sample/sampler-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry the values across the message boundary**

In `src/audio-worklet/sampler-node.ts`:

```ts
import type { SampleSpawn, LivePadParams } from '../audio-dsp/sample/types';
```

Add to the `SamplerMsg` union:

```ts
  // Live per-pad knob values. Unlike `spawn` (which freezes the trigger), this
  // updates the pad table the SOUNDING voices read, so a knob turn is audible on
  // a note already playing.
  | { type: 'padParams'; padNote: number; params: LivePadParams }
```

Add the builder next to `samplerSpawnMessage`:

```ts
/** Build a live pad-params message (small POD, no transferables). */
export function samplerPadParamsMessage(padNote: number, params: LivePadParams): [SamplerMsg] {
  return [{ type: 'padParams', padNote, params }];
}
```

Add the method to `SamplerWorkletNode` next to `spawn`:

```ts
  /** Update one pad's live knob values — heard by the voices already sounding. */
  setPadParams(padNote: number, params: LivePadParams): void {
    this.node.port.postMessage(...samplerPadParamsMessage(padNote, params));
  }
```

In `src/audio-worklet/sampler-processor.ts`, mirror the union member, then add the table and handler:

```ts
  /** padNote → its live knob values. Mutated in place so the voices holding a
   *  reference see the change on their next sample. */
  private padParams = new Map<number, LivePadParams>();
```
```ts
      } else if (m.type === 'padParams') {
        const cur = this.padParams.get(m.padNote);
        // Mutate in place: live voices hold this exact object.
        if (cur) Object.assign(cur, m.params);
        else this.padParams.set(m.padNote, { ...m.params });
      }
```

and in the spawn drain, after building a `SamplerRenderer`:

```ts
        if (kind === 'sampler' && padNote >= 0) {
          let live = this.padParams.get(padNote);
          if (!live) {
            // First hit of this pad before any knob moved: seed the table from the
            // spawn so the voice and the table agree.
            live = { cutoff: spawn.cutoff, res: spawn.res, level: spawn.level, pan: spawn.pan, rev: spawn.rev, dly: spawn.dly };
            this.padParams.set(padNote, live);
          }
          (r as SamplerRenderer).setLivePad(live);
        }
```

Add the `LivePadParams` type import to the processor.

- [ ] **Step 6: Post pad params from the engine**

In `src/engines/sampler-worklet-engine.ts`, `setBaseValue` is the single pad write
path: after resolving `key`/`leaf` it stores into `this.padStore[note][leaf]`
(around line 292). The `SamplerWorkletNode` lives in `this.node`, which is null
until `ensureNode` has run.

Replace the last two lines of `setBaseValue`:

```ts
    (this.padStore[note] ??= {})[leaf] = v;
    this.onPadEdit?.();
```

with:

```ts
    (this.padStore[note] ??= {})[leaf] = v;
    // Push the pad's continuous values so the voices ALREADY sounding hear the
    // change — the spawn only froze the trigger. getPad merges the store over the
    // defaults, so this always sends a complete set. `node` is null before the
    // first sound, and then there is nothing sounding to update.
    if (this.node) {
      const pad = this.getPad(note);
      this.node.setPadParams(note, {
        cutoff: pad.cutoff, res: pad.res, level: pad.level,
        pan: pad.pan, rev: pad.rev, dly: pad.dly,
      });
    }
    this.onPadEdit?.();
```

- [ ] **Step 7: Run the sampler suites**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/sample/ src/audio-worklet/sampler-node.test.ts src/engines/sampler-worklet-engine.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/audio-dsp/sample/types.ts src/audio-dsp/sample/sampler-renderer.ts src/audio-worklet/sampler-node.ts src/audio-worklet/sampler-processor.ts src/engines/sampler-worklet-engine.ts src/audio-dsp/sample/sampler-renderer.test.ts
git commit -m "$(cat <<'EOF'
feat(sampler): pads keep a live knob table the sounding voices read

The sampler renderer already read cutoff/res/level/pan/sends every sample — the
only frozen thing was the spawn object it read them from. A new padParams
message keeps a per-pad table the processor mutates in place, so turning a pad
knob is audible on the note already playing. Attack/decay stay out: they are
envelope times.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Whole-system verification

The spec names two things automated tests cannot confirm on their own: that the offline export still matches what you hear, and that the gesture actually feels right.

**Files:**
- Modify: `CLAUDE.md` (the "Live param tweaks apply to the *next* trigger" gotcha is now false)
- Test: whole suite

- [ ] **Step 1: Build and run the full suite**

Run: `npm run build`
Expected: typecheck + bundle clean.

Run: `NO_COLOR=1 npm test`
Expected: PASS. (`test:e2e` serves `dist/` with NO build step, which is why the build goes first.)

- [ ] **Step 2: Confirm the offline render still matches the live path**

The offline scene render drives the same `VoiceManager`, so the smoother comes along for free — but "should" is not "does".

Run: `NO_COLOR=1 npx vitest run src/export/`
Expected: PASS.

Then check by reading that the offline path constructs its `VoiceManager` (not renderers directly): grep `new VoiceManager` under `src/export/`. If any export path builds a `VoiceRenderer` directly, it never calls `setLiveParams` and therefore uses the trigger snapshot — correct behaviour for a render with no live knob, and worth a one-line comment saying so.

- [ ] **Step 3: Fix the now-false gotcha in CLAUDE.md**

In `CLAUDE.md`, under "Gotchas", replace:

```markdown
- **Live param tweaks apply to the *next* trigger, not the held note** — engine params are read at trigger time.
```

with:

```markdown
- **Live param tweaks reach the note already sounding** — continuous engine params are read every sample from the lane's smoothed bag (`ParamSmoother` in `VoiceManager`). STRUCTURAL params still apply to the next trigger only: waveform, filter model, unison size, and every envelope TIME (our envelopes are closed-form over elapsed time, so re-reading an attack mid-note would step the amplitude). Drums is out of scope.
```

- [ ] **Step 4: Listen to it — in real Chrome, not the VS Code browser**

Run `npm run dev` inside the worktree and open <http://localhost:5173>.

Three checks, each a distinct user path:

1. **TB-303 sweep.** Add a TB-303 lane, draw one long note in a clip, launch the scene, and turn CUTOFF while it sustains. The filter must sweep under your hand, with no clicks or zipper.
2. **Preset morph.** With notes sustaining on a Subtractive lane, load a different preset. It must sweep into the new sound, not cut.
3. **Sampler pad.** Load a sustained sample, hold it, and turn the pad CUTOFF. Same result.

Report what you heard. If any of the three clicks, the slew time constant in `param-smoother.ts` is the dial — but investigate WHICH param stepped before changing it.

- [ ] **Step 5: Commit the doc fix**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: the trigger-time param gotcha is no longer true

Continuous params now reach the sounding note. Records what stayed frozen and
why, so the envelope-times exclusion is not quietly undone later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Rebase and finish**

```bash
git rebase main
NO_COLOR=1 npm run test:unit
git checkout main
git merge --ff-only <feature-branch>
```

Then `ExitWorktree`. Do NOT merge to `main` without asking Nacho first.
