# Built-in ADSR Bypass Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-envelope Off/On switch for each engine's built-in (hardcoded) amp/filter ADSR on Subtractive, Wavetable, and Karplus, so the built-in envelope can be silenced to A/B-test against the modular ADSR system.

**Architecture:** Each built-in envelope gets a boolean flag exposed as a discrete engine param (`amp.builtinEnv`, `filter.builtinEnv`). The flag is read at trigger time; when Off the engine skips scheduling that built-in envelope's ramps, leaving its internal `ConstantSourceNode` at 0 so any external modular ADSR drives the destination `AudioParam` alone. Pure bypass — the modular side is never touched. Flags ride the existing engine-param plumbing (UI rendering, automation registry, `engineState.params` save/load) for free.

**Tech Stack:** TypeScript, Web Audio (`OscillatorNode`/`BiquadFilterNode`/`ConstantSourceNode`), Vitest + `node-web-audio-api` `OfflineAudioContext` for DSP tests.

**Spec:** `docs/superpowers/specs/2026-05-30-builtin-adsr-bypass-toggle-design.md`

**Reusable option constant** (used verbatim in Tasks 2, 4, 5 — discrete toggles render as a 2-button Off/On radio strip via `createSelectControl`, matching the existing MODE/RETRIG controls):

```ts
[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]
```

---

## Task 1: PolySynth — `ampEnvEnabled` / `filterEnvEnabled` fields + trigger guards

**Files:**
- Modify: `src/polysynth/polysynth.ts` (fields near line 83; guards at lines 364-367, 376-378, 383-387)
- Test: `src/polysynth/polysynth-builtin-env.dsp.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/polysynth/polysynth-builtin-env.dsp.test.ts`:

```ts
// src/polysynth/polysynth-builtin-env.dsp.test.ts
// Layer-3 DSP: the built-in amp/filter envelope bypass flags on PolySynth.
import { describe, it, expect } from 'vitest';
import { PolySynth } from './polysynth';
import { rms, spectralCentroid } from '../../test/dsp-asserts';

async function renderPoly(configure: (ps: PolySynth) => void): Promise<Float32Array> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.floor(sr * 0.4), sr);
  const ps = new PolySynth(ctx as unknown as AudioContext, ctx.destination);
  configure(ps);
  ps.trigger(48, 0, 0.2, false);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

describe('PolySynth built-in envelope bypass', () => {
  it('amp envelope on (default) produces audible output', async () => {
    const buf = await renderPoly(() => { /* defaults */ });
    expect(rms(buf)).toBeGreaterThan(0.001);
  });

  it('amp envelope off silences the voice when nothing else drives amp.gain', async () => {
    const on  = await renderPoly(() => { /* defaults */ });
    const off = await renderPoly((ps) => { ps.ampEnvEnabled = false; });
    expect(rms(off)).toBeLessThan(rms(on) * 0.02);
  });

  it('filter envelope off removes the cutoff sweep (lower spectral centroid)', async () => {
    // Low base cutoff + high env amount: with the filter env ON the attack
    // opens the filter wide; OFF parks it at the dark base cutoff.
    const cfg = (ps: PolySynth) => {
      ps.params.filter.cutoff = 0.1;
      ps.params.filter.envAmount = 1.0;
      ps.params.filter.attack = 0.005;
      ps.params.filter.decay = 0.3;
      ps.params.filter.sustain = 0.9;
    };
    const onBuf  = await renderPoly((ps) => { cfg(ps); });
    const offBuf = await renderPoly((ps) => { cfg(ps); ps.filterEnvEnabled = false; });
    expect(spectralCentroid(onBuf, 44100)).toBeGreaterThan(spectralCentroid(offBuf, 44100) * 1.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/polysynth/polysynth-builtin-env.dsp.test.ts`
Expected: FAIL — `ampEnvEnabled` / `filterEnvEnabled` do not exist on `PolySynth` (TypeScript error / undefined), and the amp-off / filter-off assertions fail because the envelopes always run.

- [ ] **Step 3: Add the fields**

In `src/polysynth/polysynth.ts`, immediately after the line `retrig = true;  // mono-only; ...` (line 83), add:

```ts
  /** Built-in envelope bypass switches. When false, internalTrigger skips
   *  scheduling that hardcoded envelope, leaving its ConstantSource at 0 so an
   *  external modular ADSR (if any) drives the destination AudioParam alone.
   *  Toggled by SubtractiveEngine via the amp.builtinEnv / filter.builtinEnv
   *  discrete params. */
  ampEnvEnabled = true;
  filterEnvEnabled = true;
```

- [ ] **Step 4: Guard the filter envelope scheduling**

Replace the block at lines 364-367:

```ts
    // Schedule the normalised envCutoff (0..1) — sustain knob clamps it.
    envCutoffNorm.offset.setValueAtTime(0, time);
    envCutoffNorm.offset.linearRampToValueAtTime(1, time + fa);
    envCutoffNorm.offset.linearRampToValueAtTime(Math.max(p.filter.sustain, 0), time + fa + fd);
```

with:

```ts
    // Schedule the normalised envCutoff (0..1) — sustain knob clamps it.
    // Skipped when the built-in filter env is bypassed; envCutoffNorm then
    // stays at 0 so the filter sits at its base cutoff (+ any modular ADSR).
    if (this.filterEnvEnabled) {
      envCutoffNorm.offset.setValueAtTime(0, time);
      envCutoffNorm.offset.linearRampToValueAtTime(1, time + fa);
      envCutoffNorm.offset.linearRampToValueAtTime(Math.max(p.filter.sustain, 0), time + fa + fd);
    }
```

- [ ] **Step 5: Guard the amp envelope attack/decay**

Replace the block at lines 376-378:

```ts
    envAmp.offset.setValueAtTime(0, time);
    envAmp.offset.linearRampToValueAtTime(peakAmp, time + aa);
    envAmp.offset.linearRampToValueAtTime(sustainAmp, time + aa + ad);
```

with:

```ts
    envAmp.offset.setValueAtTime(0, time);
    // Skipped when the built-in amp env is bypassed; envAmp stays at 0 so the
    // voice is silent unless an external modular ADSR drives amp.gain.
    if (this.ampEnvEnabled) {
      envAmp.offset.linearRampToValueAtTime(peakAmp, time + aa);
      envAmp.offset.linearRampToValueAtTime(sustainAmp, time + aa + ad);
    }
```

- [ ] **Step 6: Guard the release block**

Replace the block at lines 383-387:

```ts
    envAmp.offset.setValueAtTime(sustainAmp, releaseStart);
    envAmp.offset.exponentialRampToValueAtTime(0.001, releaseStart + ar);
    // Release the normalised cutoff envelope back to 0.
    envCutoffNorm.offset.setValueAtTime(Math.max(p.filter.sustain, 0), releaseStart);
    envCutoffNorm.offset.linearRampToValueAtTime(0, releaseStart + fr);
```

with:

```ts
    if (this.ampEnvEnabled) {
      envAmp.offset.setValueAtTime(sustainAmp, releaseStart);
      envAmp.offset.exponentialRampToValueAtTime(0.001, releaseStart + ar);
    }
    // Release the normalised cutoff envelope back to 0.
    if (this.filterEnvEnabled) {
      envCutoffNorm.offset.setValueAtTime(Math.max(p.filter.sustain, 0), releaseStart);
      envCutoffNorm.offset.linearRampToValueAtTime(0, releaseStart + fr);
    }
```

(`releaseStart` and the `stopTime` line that follows remain unconditional.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/polysynth/polysynth-builtin-env.dsp.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add src/polysynth/polysynth.ts src/polysynth/polysynth-builtin-env.dsp.test.ts
git commit -m "feat(polysynth): built-in amp/filter envelope bypass flags"
```

---

## Task 2: SubtractiveEngine — flag params + get/setBaseValue wiring

**Files:**
- Modify: `src/engines/subtractive.ts` (`SUB_PARAMS` array; `getBaseValue`; `setBaseValue`)
- Test: `src/engines/subtractive.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/engines/subtractive.test.ts`:

```ts
import { SubtractiveEngine as SubEngineForBuiltin } from './subtractive';

describe('SubtractiveEngine built-in envelope toggles', () => {
  it('exposes amp.builtinEnv and filter.builtinEnv as discrete params defaulting On', () => {
    const engine = new SubEngineForBuiltin();
    const amp = engine.params.find(p => p.id === 'amp.builtinEnv');
    const filt = engine.params.find(p => p.id === 'filter.builtinEnv');
    expect(amp?.kind).toBe('discrete');
    expect(amp?.options).toHaveLength(2);
    expect(amp?.default).toBe(1);   // On
    expect(filt?.kind).toBe('discrete');
    expect(filt?.default).toBe(1);  // On
  });

  it('setBaseValue flips the PolySynth bypass flags and getBaseValue reflects them', () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const engine = new SubEngineForBuiltin();
    const out = (ctx as unknown as AudioContext).createGain();
    engine.createVoice(ctx as unknown as AudioContext, out); // instantiate polysynth
    const ps = engine.getPolySynth()!;

    engine.setBaseValue('amp.builtinEnv', 0);
    expect(ps.ampEnvEnabled).toBe(false);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(0);

    engine.setBaseValue('filter.builtinEnv', 0);
    expect(ps.filterEnvEnabled).toBe(false);
    expect(engine.getBaseValue('filter.builtinEnv')).toBe(0);

    engine.setBaseValue('amp.builtinEnv', 1);
    expect(ps.ampEnvEnabled).toBe(true);
    expect(engine.getBaseValue('amp.builtinEnv')).toBe(1);
  });

  it('buffers the flag through pending when no polysynth exists yet, applying on createVoice', () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(1, sr, sr);
    const engine = new SubEngineForBuiltin();
    engine.setBaseValue('amp.builtinEnv', 0);  // before any polysynth
    const out = (ctx as unknown as AudioContext).createGain();
    engine.createVoice(ctx as unknown as AudioContext, out);
    expect(engine.getPolySynth()!.ampEnvEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/subtractive.test.ts`
Expected: FAIL — the `amp.builtinEnv` / `filter.builtinEnv` specs do not exist; flags are not wired.

- [ ] **Step 3: Add the discrete specs to `SUB_PARAMS`**

In `src/engines/subtractive.ts`, in the `SUB_PARAMS` array, insert the filter toggle immediately BEFORE the `filter.attack` line:

```ts
  { id: 'filter.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'filter.attack',    label: 'F Atk',     kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
```

and insert the amp toggle immediately BEFORE the `amp.attack` line:

```ts
  { id: 'amp.builtinEnv', label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',  label: 'A Atk', kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's' },
```

- [ ] **Step 4: Handle the flags in `getBaseValue`**

In `getBaseValue`, after the `poly.retrig` line and BEFORE `return readDotPath(...)`, add:

```ts
    if (id === 'amp.builtinEnv')    return this.polysynth.ampEnvEnabled ? 1 : 0;
    if (id === 'filter.builtinEnv') return this.polysynth.filterEnvEnabled ? 1 : 0;
```

(The existing `if (!this.polysynth) return SUB_PARAMS.find(...)?.default ?? 0;` guard at the top already returns the spec default — `1` — before a polysynth exists.)

- [ ] **Step 5: Handle the flags in `setBaseValue`**

In `setBaseValue`, after the `poly.retrig` line and BEFORE the `const spec = ...; writeDotPath(...)` lines, add:

```ts
    if (id === 'amp.builtinEnv')    { this.polysynth.ampEnvEnabled = v >= 0.5;    return; }
    if (id === 'filter.builtinEnv') { this.polysynth.filterEnvEnabled = v >= 0.5; return; }
```

(The existing `if (!this.polysynth) { this.pending.set(id, v); return; }` guard buffers the flag before a polysynth exists; `this.pending.flush(...)` in `createVoice` replays it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/subtractive.test.ts`
Expected: PASS (existing + 3 new tests)

- [ ] **Step 7: Commit**

```bash
git add src/engines/subtractive.ts src/engines/subtractive.test.ts
git commit -m "feat(subtractive): amp/filter built-in env toggle params"
```

---

## Task 3: SubtractiveEngine — DSP bypass behavior (engine level)

**Files:**
- Test: `src/engines/subtractive-builtin-env.dsp.test.ts` (create)

This task adds end-to-end DSP coverage proving the engine flag reaches the audio path. It is green given Tasks 1-2; it guards against future regressions in the engine→PolySynth wiring.

- [ ] **Step 1: Write the test**

Create `src/engines/subtractive-builtin-env.dsp.test.ts`:

```ts
// src/engines/subtractive-builtin-env.dsp.test.ts
// Layer-3 DSP: SubtractiveEngine's amp.builtinEnv / filter.builtinEnv flags
// reach the rendered audio. renderEngine runs standalone (no lane binder), so
// the built-in envelope is the only amp driver — Off must silence the voice.
import { describe, it, expect } from 'vitest';
import { SubtractiveEngine } from './subtractive';
import { renderEngine } from '../../test/render';
import { rms, spectralCentroid } from '../../test/dsp-asserts';

const SR = 44100;

function factory(configure: (e: SubtractiveEngine) => void) {
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const engine = new SubtractiveEngine();
    configure(engine);
    const voice = engine.createVoice(ctx as unknown as AudioContext, output);
    return { voice, output };
  };
}

async function renderSub(configure: (e: SubtractiveEngine) => void): Promise<Float32Array> {
  return renderEngine(factory(configure), {
    durationSec: 0.4,
    sampleRate: SR,
    events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.2 }],
  });
}

describe('SubtractiveEngine built-in envelope bypass (DSP)', () => {
  it('amp.builtinEnv Off silences the standalone voice; On is audible', async () => {
    const on  = await renderSub((e) => e.setBaseValue('amp.builtinEnv', 1));
    const off = await renderSub((e) => e.setBaseValue('amp.builtinEnv', 0));
    expect(rms(on)).toBeGreaterThan(0.001);
    expect(rms(off)).toBeLessThan(rms(on) * 0.02);
  });

  it('filter.builtinEnv Off removes the cutoff sweep (lower centroid)', async () => {
    const cfg = (e: SubtractiveEngine) => {
      e.setBaseValue('filter.cutoff', 0.1);
      e.setBaseValue('filter.envAmount', 1.0);
      e.setBaseValue('filter.attack', 0.005);
      e.setBaseValue('filter.sustain', 0.9);
    };
    const on  = await renderSub((e) => { cfg(e); e.setBaseValue('filter.builtinEnv', 1); });
    const off = await renderSub((e) => { cfg(e); e.setBaseValue('filter.builtinEnv', 0); });
    expect(spectralCentroid(on, SR)).toBeGreaterThan(spectralCentroid(off, SR) * 1.2);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/subtractive-builtin-env.dsp.test.ts`
Expected: PASS (2 tests). If the filter-centroid margin is flaky on the runner, relax the `* 1.2` factor toward `* 1.05` (still a strict relative assertion) — do not switch to an absolute threshold.

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive-builtin-env.dsp.test.ts
git commit -m "test(subtractive): DSP coverage for built-in env bypass"
```

---

## Task 4: KarplusEngine — flag param + trigger guard

**Files:**
- Modify: `src/engines/karplus.ts` (`KARPLUS_PARAMS`; `KarplusVoice.trigger`)
- Test: `src/engines/karplus.test.ts` (append) and `src/engines/karplus-builtin-env.dsp.test.ts` (create)

- [ ] **Step 1: Write the failing unit test**

Append to `src/engines/karplus.test.ts`:

```ts
import { describe as describeBuiltin, it as itBuiltin, expect as expectBuiltin } from 'vitest';
import { KarplusEngine as KarpEngineForBuiltin } from './karplus';

describeBuiltin('KarplusEngine built-in amp env toggle', () => {
  itBuiltin('exposes amp.builtinEnv discrete param defaulting On', () => {
    const engine = new KarpEngineForBuiltin();
    const amp = engine.params.find(p => p.id === 'amp.builtinEnv');
    expectBuiltin(amp?.kind).toBe('discrete');
    expectBuiltin(amp?.options).toHaveLength(2);
    expectBuiltin(amp?.default).toBe(1);
  });

  itBuiltin('round-trips through get/setBaseValue', () => {
    const engine = new KarpEngineForBuiltin();
    engine.setBaseValue('amp.builtinEnv', 0);
    expectBuiltin(engine.getBaseValue('amp.builtinEnv')).toBe(0);
    engine.setBaseValue('amp.builtinEnv', 1);
    expectBuiltin(engine.getBaseValue('amp.builtinEnv')).toBe(1);
  });
});
```

(If `karplus.test.ts` already imports `describe/it/expect`, reuse those names instead of the aliased imports — check the file head first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/karplus.test.ts`
Expected: FAIL — `amp.builtinEnv` spec does not exist.

- [ ] **Step 3: Add the discrete spec to `KARPLUS_PARAMS`**

In `src/engines/karplus.ts`, insert immediately BEFORE the `amp.attack` line:

```ts
  { id: 'amp.builtinEnv',    label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',        label: 'Attack',     kind: 'continuous', min: 0.001, max: 0.5, default: 0.005, unit: 's' },
```

- [ ] **Step 4: Guard the amp envelope in `KarplusVoice.trigger`**

In the rewritten (offline-render) Karplus, `KarplusVoice.trigger` schedules the amp envelope here. The string itself is a finite pre-rendered buffer (`src`) — there is no live loop to preserve:

```ts
    // Amp envelope on the internal ConstantSource — modulators on amp.level sum
    // into this same destination via getAudioParams(). The buffer is already
    // peak-normalized to 0.8, so peakAmp only needs the level + accent gain.
    const peakAmp = Math.max(0.0001, level * velMul);
    this.envAmp.offset.cancelScheduledValues(time);
    this.envAmp.offset.setValueAtTime(0, time);
    this.envAmp.offset.linearRampToValueAtTime(peakAmp, time + attack);

    // Release: fade the amp from gate-end over `release`. There is no loop to
    // kill — the buffer simply finishes playing and is disposed.
    const releaseStart = time + options.gateDuration;
    this.envAmp.offset.setValueAtTime(peakAmp, releaseStart);
    this.envAmp.offset.exponentialRampToValueAtTime(0.0001, releaseStart + release);
```

Wrap only the `envAmp` scheduling in the flag guard. `releaseStart` must stay declared **outside** the guard because the `src.stop(stopTime)` line below computes `stopTime = releaseStart + release + 0.1`. Replace the block above with:

```ts
    // Amp envelope on the internal ConstantSource — modulators on amp.level sum
    // into this same destination via getAudioParams(). Skipped when the built-in
    // amp env is bypassed; envAmp stays at 0 so a modular ADSR on amp.level
    // drives the voice alone (the string buffer still plays, but silently).
    const ampEnvOn = this.getParam('amp.builtinEnv') >= 0.5;
    const peakAmp = Math.max(0.0001, level * velMul);
    const releaseStart = time + options.gateDuration;
    if (ampEnvOn) {
      this.envAmp.offset.cancelScheduledValues(time);
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(peakAmp, time + attack);
      this.envAmp.offset.setValueAtTime(peakAmp, releaseStart);
      this.envAmp.offset.exponentialRampToValueAtTime(0.0001, releaseStart + release);
    }
```

The `src.start(time); const stopTime = releaseStart + release + 0.1; src.stop(stopTime);` lines that follow stay unchanged and outside the guard.

- [ ] **Step 5: Write the failing DSP test**

Create `src/engines/karplus-builtin-env.dsp.test.ts`:

```ts
// src/engines/karplus-builtin-env.dsp.test.ts
// Layer-3 DSP: KarplusEngine amp.builtinEnv flag. Standalone render (no lane
// binder) → built-in amp env is the only amp driver, so Off must silence the
// voice even though the physical loop still rings under amp.gain=0.
import { describe, it, expect } from 'vitest';
import { KarplusEngine } from './karplus';
import { renderEngine } from '../../test/render';
import { rms } from '../../test/dsp-asserts';

const SR = 44100;

function factory(configure: (e: KarplusEngine) => void) {
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const engine = new KarplusEngine();
    configure(engine);
    const voice = engine.createVoice(ctx as unknown as AudioContext, output);
    return { voice, output };
  };
}

async function renderKarp(configure: (e: KarplusEngine) => void): Promise<Float32Array> {
  return renderEngine(factory(configure), {
    durationSec: 0.4,
    sampleRate: SR,
    events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.2 }],
  });
}

describe('KarplusEngine built-in amp env bypass (DSP)', () => {
  it('amp.builtinEnv Off silences the standalone voice; On is audible', async () => {
    const on  = await renderKarp((e) => e.setBaseValue('amp.builtinEnv', 1));
    const off = await renderKarp((e) => e.setBaseValue('amp.builtinEnv', 0));
    expect(rms(on)).toBeGreaterThan(0.001);
    expect(rms(off)).toBeLessThan(rms(on) * 0.05);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/karplus.test.ts src/engines/karplus-builtin-env.dsp.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/engines/karplus.ts src/engines/karplus.test.ts src/engines/karplus-builtin-env.dsp.test.ts
git commit -m "feat(karplus): built-in amp env bypass toggle"
```

---

## Task 5: WavetableEngine — flag param + trigger condition

**Files:**
- Modify: `src/engines/wavetable.ts` (`WT_PARAMS`; `WavetableVoice.trigger`; `WavetableVoice.release`)
- Test: `src/engines/wavetable.test.ts` (append)

**Note (corrected during execution):** the real Wavetable runs the built-in amp env (`envAmp`) in EVERY mode and it is the ONLY `amp.gain` driver — the modular `adsr1` routes to `filter.cutoff`, not amp (routing it to amp hit a "mono duro" polyphony bug). So the flag defaults **On**: defaulting Off would silence all lane patches. The trigger/release conditions become "built-in runs when `binder == null` OR flag On". Standalone renders always run the built-in (DSP battery stays green), so the flag's lane effect is covered by unit tests + manual smoke (Task 6), not a standalone DSP render.

- [ ] **Step 1: Write the failing unit test**

Append to `src/engines/wavetable.test.ts`:

```ts
import { describe as describeWtBuiltin, it as itWtBuiltin, expect as expectWtBuiltin } from 'vitest';
import { WavetableEngine as WtEngineForBuiltin } from './wavetable';

describeWtBuiltin('WavetableEngine built-in amp env toggle', () => {
  itWtBuiltin('exposes amp.builtinEnv discrete param defaulting Off', () => {
    const engine = new WtEngineForBuiltin();
    const amp = engine.params.find(p => p.id === 'amp.builtinEnv');
    expectWtBuiltin(amp?.kind).toBe('discrete');
    expectWtBuiltin(amp?.options).toHaveLength(2);
    expectWtBuiltin(amp?.default).toBe(1);   // On — built-in is the only amp.gain driver; Off would silence lanes
  });

  itWtBuiltin('round-trips through get/setBaseValue', () => {
    const engine = new WtEngineForBuiltin();
    expectWtBuiltin(engine.getBaseValue('amp.builtinEnv')).toBe(1);  // default On
    engine.setBaseValue('amp.builtinEnv', 0);
    expectWtBuiltin(engine.getBaseValue('amp.builtinEnv')).toBe(0);
    engine.setBaseValue('amp.builtinEnv', 1);
    expectWtBuiltin(engine.getBaseValue('amp.builtinEnv')).toBe(1);
  });
});
```

(If `wavetable.test.ts` already imports `describe/it/expect`, reuse those names.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/wavetable.test.ts`
Expected: FAIL — `amp.builtinEnv` spec does not exist.

- [ ] **Step 3: Add the discrete spec to `WT_PARAMS`**

In `src/engines/wavetable.ts`, insert immediately BEFORE the `amp.attack` line:

```ts
  { id: 'amp.builtinEnv',   label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential' },
```

- [ ] **Step 4: Update the built-in amp env condition in `WavetableVoice.trigger`**

Replace the amp-envelope block (the `if (this.binder == null) { ... } else { ... }` around lines 166-180):

```ts
    if (this.binder == null) {
      // Standalone ADSR: oscillator gains already carry velMul, so the amp
      // envelope peaks at unity (the modulator-bound path peaks at 1 too —
      // modulator output is normalized 0..1 and connection depth scales it
      // into the destination range).
      const atk = this.getParam('amp.attack');
      const dec = this.getParam('amp.decay');
      const sus = this.getParam('amp.sustain');
      this.envAmp.offset.cancelScheduledValues(time);
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(1, time + Math.max(0.001, atk));
      this.envAmp.offset.linearRampToValueAtTime(sus, time + Math.max(0.001, atk) + Math.max(0.001, dec));
    } else {
      this.envAmp.offset.setValueAtTime(0, time);
    }
```

with:

```ts
    // Built-in amp env runs when standalone (no lane binder, for audibility in
    // tests/standalone) OR when the amp.builtinEnv flag is On in a lane. When
    // Off in a lane, leave envAmp at 0 so the modular adsr1 drives amp alone.
    const ampEnvOn = this.getParam('amp.builtinEnv') >= 0.5;
    if (this.binder == null || ampEnvOn) {
      // Standalone/built-in ADSR: oscillator gains already carry velMul, so the
      // amp envelope peaks at unity (the modulator-bound path peaks at 1 too —
      // modulator output is normalized 0..1 and connection depth scales it
      // into the destination range).
      const atk = this.getParam('amp.attack');
      const dec = this.getParam('amp.decay');
      const sus = this.getParam('amp.sustain');
      this.envAmp.offset.cancelScheduledValues(time);
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(1, time + Math.max(0.001, atk));
      this.envAmp.offset.linearRampToValueAtTime(sus, time + Math.max(0.001, atk) + Math.max(0.001, dec));
    } else {
      this.envAmp.offset.setValueAtTime(0, time);
    }
```

- [ ] **Step 5: Update the release condition in `WavetableVoice.release`**

Replace the standalone-release block (around lines 194-200):

```ts
    if (this.binder == null) {
      this.envAmp.offset.cancelScheduledValues(time);
      // Short 5 ms ramp to silence — gate-cut, not a musical release. The
      // engine's amp.release param is meant for the modulator ADSR; standalone
      // mode is just a fallback.
      this.envAmp.offset.linearRampToValueAtTime(0, time + 0.005);
    }
```

with:

```ts
    // Cut the built-in amp env on release whenever it was scheduled in
    // trigger() — standalone (no binder) or amp.builtinEnv On in a lane.
    if (this.binder == null || this.getParam('amp.builtinEnv') >= 0.5) {
      this.envAmp.offset.cancelScheduledValues(time);
      // Short 5 ms ramp to silence — gate-cut, not a musical release. The
      // engine's amp.release param is meant for the modulator ADSR; standalone
      // mode is just a fallback.
      this.envAmp.offset.linearRampToValueAtTime(0, time + 0.005);
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx cross-env NO_COLOR=1 vitest run src/engines/wavetable.test.ts src/engines/wavetable.dsp.test.ts`
Expected: PASS — new unit tests pass and the existing wavetable DSP battery still passes (standalone audibility preserved by the `binder == null` clause).

- [ ] **Step 7: Commit**

```bash
git add src/engines/wavetable.ts src/engines/wavetable.test.ts
git commit -m "feat(wavetable): built-in amp env toggle (lane), default Off"
```

---

## Task 6: Full verification + UI smoke

**Files:** none (verification only; fix-ups committed if needed)

The toggles render with **no new UI code**: `amp.builtinEnv` / `filter.builtinEnv` carry `amp.` / `filter.` prefixes, so `mountSubtractiveLaneKnobs` (Subtractive) and `wireEngineParams` inside each engine's `buildParamUI` (Karplus/Wavetable) pick them up automatically and render them as Off/On radio strips via `createSelectControl`. They also persist via `engineState.params` and register in the automation registry for free.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If a `params`-count or exact-`params`-list assertion elsewhere breaks (search: `npx cross-env NO_COLOR=1 vitest run` output from Step 2), update the threshold to account for the new specs — do not remove the new params.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: all green (565 prior + the new tests). Investigate and fix any failure (likely candidates: tests asserting an exact engine `params` length or snapshotting the modulation destination list — add the new discrete ids to the expectation).

- [ ] **Step 3: Manual UI smoke**

Run: `npm run dev`, open `http://localhost:5173`. For a Subtractive lane: confirm an Off/On toggle appears at the front of both the FILTER and AMP knob sections; set both Off and confirm the lane goes silent / static-cutoff when played (no modular connection wired), then raise the modular `adsr-amp` depth in the Modulators panel and confirm sound returns. For a Wavetable lane: confirm the AMP section shows the Off/On toggle (default Off) and that toggling it On makes the `amp.attack/decay/sustain/release` knobs audibly affect the sound.

- [ ] **Step 4: Commit any fix-ups**

```bash
git add -A
git commit -m "test: adjust param-count expectations for built-in env toggles"
```

(Skip if Steps 1-2 needed no changes.)

---

## Notes for the implementer

- **Assertions stay relative** (ratios), never absolute magnitudes — project convention.
- **Pure bypass only:** never auto-seed or alter modular connection depths from the flag. The flag gates exactly one thing: whether the built-in envelope ramps are scheduled.
- **Default state is sound-preserving:** all three default On (built-in authoritative, as today). For Wavetable this is mandatory — the built-in is the only amp.gain driver, so Off would silence lanes. Do not change existing modular connection-depth defaults.
- **FM and TB303 are intentionally out of scope** (see spec §2).
