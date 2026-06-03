# Per-voice Drum Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the 8 synthesized drum voices its own column of actuatable knobs (tune/decay/character) plus independent reverb/delay sends, laid out as a compact mini-mixer in the Drums inspector, with full persistence and kit-as-preset-of-departure semantics.

**Architecture:** Per-voice synthesis parameters become a live editable store on `DrumMachine` (seeded from the active kit), read at trigger time by each `play*`. Per-voice mixer params drive the already-existing per-voice `ChannelStrip`. Everything is declared as `EngineParamSpec` ids (`<voice>.<param>`) so the existing knob/registry/undo/`engineState`-mirror machinery persists and automates it for free. A new rack renderer draws the 8 columns inside `DrumsEngine.buildParamUI`, above the modulators panel.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (+ `node-web-audio-api` for DSP renders), SCSS.

**Scope clarification (two drum systems now exist on `main`):** this plan targets ONLY the **synthesized** drum machine — the `drums-machine` engine (`DrumsEngine`) backed by `DrumMachine` in `src/core/drums.ts`. `main` also has **sample drumkits** that load audio through the **Sampler** engine (`lane.engineState.sampler.drumkitId`, `src/samples/drumkit-loader.ts`) — a separate, orthogonal path. Do NOT touch it; every edit here is to the synthesized voices.

**Pre-flight (advisory):** Per CLAUDE.md, run `gitnexus_impact({target: "trigger", direction: "upstream"})` and on `DrumsEngine.setBaseValue` before editing and report blast radius. Note (memory): GitNexus indexes the main repo path and is worktree-blind, so `detect_changes` will see nothing from this worktree — treat its output as advisory only.

**Reference spec:** [docs/superpowers/specs/2026-06-03-drum-per-voice-synth-design.md](../specs/2026-06-03-drum-per-voice-synth-design.md)

**Test command convention:** single files via `NO_COLOR=1 npx vitest run <path>`; never add `--reporter`. DSP files need `node-web-audio-api` (already globalized in `test/setup.ts`).

---

## File Structure

- **Modify** `src/core/drums.ts` — add the per-voice synth store, `loadKitDefaults`, `setVoiceParam`/`getVoiceParam`; split CH/OH; rewrite every `play*` to read the store. (Tasks 1-4)
- **Modify** `src/engines/drums-engine.ts` — declare per-voice param specs; route `getBaseValue`/`setBaseValue`; rewrite `applyPreset`. (Tasks 5-7)
- **Modify** `src/engines/engine-ui.ts` — add `knobSize` option to `wireEngineParams`. (Task 8)
- **Create** `src/engines/drum-voice-rack.ts` — the 8-column rack renderer. (Task 9)
- **Modify** `src/engines/drums-engine.ts` `buildParamUI` — mount the rack above modulators. (Task 10)
- **Create** `src/styles/_drum-rack.scss` + import — compact rack styling. (Task 11)
- **Modify** `src/app/knob-mounting.ts` — fix `refreshLaneKnobs` for discrete params. (Task 12)
- **Modify** `src/core/randomize-ui.ts` — random drum sound reloads kit defaults + refreshes. (Task 13)
- **Modify** `src/engines/drums-engine.test.ts` — update the two assertions that the new params break. (folded into Task 5)
- **Final** verification: tsc + build + unit + DSP + browser smoke. (Task 14)

### Canonical leaf vocabulary (used across tasks — keep names identical)

Synth store leaves per voice (these are the keys in `DrumMachine.synth[voice]`):

- `kick`: `tune, attack, decay, startFreq, endFreq, sweep, wave`
- `snare`: `tune, tone, snap, bodyDecay, noiseDecay, noiseTone, tone1, tone2`
- `closedHat`: `tune, decay, filter`
- `openHat`: `tune, decay, filter`
- `clap`: `tone, decay, sharp`
- `tom`: `tune, decay, sweep, startFreq, end`
- `cowbell`: `tune, decay, detune, freq1, freq2`
- `ride`: `tune, decay`

Mixer leaves (every voice, drive the voice's `ChannelStrip`): `level, pan, rev, dly, eq.low, eq.mid, eq.high`.

`tone1/tone2` (snare), `startFreq` (tom), `freq1/freq2` (cowbell) are **internal** — seeded by `loadKitDefaults`, scaled by `tune`/`detune`, never exposed as a param spec.

Wave encoding: `WAVE_TYPES = ['sine','triangle','square']`; store holds the index; `WAVE_INDEX = { sine:0, triangle:1, square:2 }`.

---

## Task 1: DrumMachine per-voice synth store + kit defaults

**Files:**
- Modify: `src/core/drums.ts`
- Test: `src/core/drums-voice-params.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/core/drums-voice-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumMachine } from './drums';
import { FxBus } from './fx';

function makeDM(kit = '909'): DrumMachine {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const dest = ctx.createGain();
  const fx = new FxBus(ctx, dest);
  const dm = new DrumMachine(ctx, fx, dest);
  dm.setKit(kit);
  dm.loadKitDefaults(kit);
  return dm;
}

describe('DrumMachine per-voice synth store', () => {
  it('loadKitDefaults seeds the synth store from the kit', () => {
    const dm = makeDM('909');
    // 909 kick: startFreq 220, ampDecay 0.4, clickAmount 0.7
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(220);
    expect(dm.getVoiceParam('kick', 'decay')).toBe(0.4);
    expect(dm.getVoiceParam('kick', 'attack')).toBe(0.7);
    expect(dm.getVoiceParam('kick', 'tune')).toBe(1);
    expect(dm.getVoiceParam('kick', 'wave')).toBe(0); // sine
  });

  it('different kits seed different defaults', () => {
    const dm808 = makeDM('808'); // 808 kick startFreq 150
    expect(dm808.getVoiceParam('kick', 'startFreq')).toBe(150);
    const dm606 = makeDM('606'); // 606 kick tone triangle -> index 1
    expect(dm606.getVoiceParam('kick', 'wave')).toBe(1);
  });

  it('setVoiceParam / getVoiceParam round-trip', () => {
    const dm = makeDM('909');
    dm.setVoiceParam('snare', 'snap', 0.9);
    expect(dm.getVoiceParam('snare', 'snap')).toBe(0.9);
  });

  it('setKit changes the active id WITHOUT reseeding the store', () => {
    const dm = makeDM('909');
    dm.setVoiceParam('kick', 'startFreq', 999);
    dm.setKit('808'); // id only — must NOT clobber the tweak
    expect(dm.kitId).toBe('808');
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(999);
  });

  it('loadKitDefaults resets per-voice mixer to neutral', () => {
    const dm = makeDM('909');
    dm.channels.kick.setReverbSend(0.8);
    dm.loadKitDefaults('808');
    expect(dm.channels.kick.serialize().reverbSend).toBe(0);
    expect(dm.channels.kick.serialize().level).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-params.test.ts`
Expected: FAIL — `loadKitDefaults`/`getVoiceParam`/`setVoiceParam` are not functions.

- [ ] **Step 3: Implement the store on DrumMachine**

In `src/core/drums.ts`, add near the top (after the `Kit` interface):

```ts
export const WAVE_TYPES: OscillatorType[] = ['sine', 'triangle', 'square'];
const WAVE_INDEX: Record<string, number> = { sine: 0, triangle: 1, square: 2 };

/** Live, editable per-voice synthesis params. Seeded from the active kit by
 *  loadKitDefaults; read at trigger time by each play* method. Keys are the
 *  canonical leaf names documented in the plan. */
export type VoiceSynthState = Record<string, number>;
export type DrumSynthState = Record<DrumVoice, VoiceSynthState>;

function seedSynthState(kit: Kit): DrumSynthState {
  return {
    kick: {
      tune: 1, attack: kit.kick.clickAmount, decay: kit.kick.ampDecay,
      startFreq: kit.kick.startFreq, endFreq: kit.kick.endFreq,
      sweep: kit.kick.pitchDecay, wave: WAVE_INDEX[kit.kick.tone] ?? 0,
    },
    snare: {
      tune: 1, tone: kit.snare.toneAmount, snap: kit.snare.noiseAmount,
      bodyDecay: kit.snare.toneDecay, noiseDecay: kit.snare.noiseDecay,
      noiseTone: kit.snare.noiseFilter, tone1: kit.snare.tone1, tone2: kit.snare.tone2,
    },
    closedHat: { tune: kit.hat.tune, decay: kit.hat.decay,    filter: 7000 },
    openHat:   { tune: kit.hat.tune, decay: kit.hat.openDecay, filter: 7000 },
    clap: { tone: kit.clap.filterFreq, decay: kit.clap.decay, sharp: kit.clap.filterQ },
    tom: {
      tune: 1, decay: kit.tom.ampDecay, sweep: kit.tom.pitchDecay,
      startFreq: kit.tom.startFreq, end: kit.tom.endFreq,
    },
    cowbell: {
      tune: 1, decay: kit.cowbell.decay, detune: 1,
      freq1: kit.cowbell.freq1, freq2: kit.cowbell.freq2,
    },
    ride: { tune: kit.ride.tune, decay: kit.ride.decay },
  };
}
```

In the `DrumMachine` class, add the field + methods (place the field next to `noiseBuffer`, the methods after `setKit`):

```ts
  synth: DrumSynthState;
```

In the constructor, after `this.channels = ...`, seed the store:

```ts
    this.synth = seedSynthState(BY_ID[this.kitId]);
```

Then add methods:

```ts
  /** Reload all per-voice synth params from a kit (the "preset of departure")
   *  AND reset every per-voice mixer strip to neutral. Distinct from setKit,
   *  which only changes the active id. */
  loadKitDefaults(id: string): void {
    const kit = BY_ID[id] ?? BY_ID[this.kitId];
    if (BY_ID[id]) this.kitId = id;
    this.synth = seedSynthState(kit);
    for (const v of DRUM_LANES) {
      const st = this.channels[v];
      st.setLevel(1); st.setPan(0); st.setReverbSend(0); st.setDelaySend(0);
      st.setEqLow(0); st.setEqMid(0); st.setEqHigh(0);
    }
  }

  setVoiceParam(voice: DrumVoice, leaf: string, value: number): void {
    const v = this.synth[voice];
    if (v) v[leaf] = value;
  }

  getVoiceParam(voice: DrumVoice, leaf: string): number | undefined {
    return this.synth[voice]?.[leaf];
  }
```

Leave `setKit` exactly as-is (id only — no reseed).

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-params.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/drums.ts src/core/drums-voice-params.test.ts
git commit -m "feat(drums): per-voice synth store + loadKitDefaults/setVoiceParam"
```

---

## Task 2: play* read from the synth store

**Files:**
- Modify: `src/core/drums.ts` (every `play*` method)
- Test: `src/core/drums-voice-synth.dsp.test.ts` (create)

- [ ] **Step 1: Write the failing DSP test**

Create `src/core/drums-voice-synth.dsp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DrumMachine, type DrumVoice } from './drums';
import { FxBus } from './fx';
import { spectralCentroid, rms } from '../../test/dsp-asserts';

const SR = 44100;

async function render(mut: (dm: DrumMachine) => void, lane: DrumVoice): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  const dest = ctx.createGain();
  dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  dm.setKit('909'); dm.loadKitDefaults('909');
  mut(dm);
  dm.trigger(lane, 0, false);
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('per-voice synth params shape the sound', () => {
  it('kick TUNE up raises the body centroid', async () => {
    const low  = await render((dm) => dm.setVoiceParam('kick', 'tune', 0.6), 'kick');
    const high = await render((dm) => dm.setVoiceParam('kick', 'tune', 1.8), 'kick');
    const head = (b: Float32Array) => b.subarray(0, Math.round(0.05 * SR));
    expect(spectralCentroid(head(high), SR)).toBeGreaterThan(spectralCentroid(head(low), SR));
  });

  it('snare SNAP up raises overall energy (more noise)', async () => {
    const dry  = await render((dm) => dm.setVoiceParam('snare', 'snap', 0.1), 'snare');
    const snap = await render((dm) => dm.setVoiceParam('snare', 'snap', 1.0), 'snare');
    expect(rms(snap)).toBeGreaterThan(rms(dry));
  });

  it('kick DECAY longer raises tail energy', async () => {
    const tailWin = (b: Float32Array) => b.subarray(Math.round(0.2 * SR));
    const shortD = await render((dm) => dm.setVoiceParam('kick', 'decay', 0.15), 'kick');
    const longD  = await render((dm) => dm.setVoiceParam('kick', 'decay', 1.2), 'kick');
    expect(rms(tailWin(longD))).toBeGreaterThan(rms(tailWin(shortD)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-synth.dsp.test.ts`
Expected: FAIL — the `play*` methods still read kit params, so `setVoiceParam` has no effect (centroids/RMS roughly equal → assertions fail).

- [ ] **Step 3: Rewrite the play* methods to read `this.synth`**

In `src/core/drums.ts`, replace the bodies. Each method drops its `KickParams`-style argument and reads the store. Update `trigger` first:

```ts
  trigger(voice: DrumVoice, time: number, accent = false) {
    const vel = accent ? 1.0 : 0.65;
    switch (voice) {
      case 'kick':      this.playKick(time, vel); break;
      case 'snare':     this.playSnare(time, vel); break;
      case 'closedHat': this.playHat('closedHat', time, vel); break;
      case 'openHat':   this.playHat('openHat', time, vel); break;
      case 'clap':      this.playClap(time, vel); break;
      case 'cowbell':   this.playCowbell(time, vel); break;
      case 'tom':       this.playTom(time, vel); break;
      case 'ride':      this.playRide(time, vel); break;
    }
  }
```

Then the methods (full replacements):

```ts
  private playKick(time: number, vel: number) {
    const s = this.synth.kick;
    const dest = this.channels.kick.input;
    const osc = this.ctx.createOscillator();
    osc.type = WAVE_TYPES[Math.round(s.wave)] ?? 'sine';
    osc.frequency.setValueAtTime(s.startFreq * s.tune, time);
    osc.frequency.exponentialRampToValueAtTime(s.endFreq * s.tune, time + s.sweep);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.2, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + s.decay + 0.05);
    if (s.attack > 0) {
      const click = this.ctx.createOscillator();
      click.type = 'square';
      click.frequency.value = 1500;
      const clickAmp = this.ctx.createGain();
      clickAmp.gain.setValueAtTime(vel * s.attack * 0.5, time);
      clickAmp.gain.exponentialRampToValueAtTime(0.001, time + 0.008);
      click.connect(clickAmp).connect(dest);
      click.start(time);
      click.stop(time + 0.015);
    }
  }

  private playSnare(time: number, vel: number) {
    const s = this.synth.snare;
    const dest = this.channels.snare.input;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle'; osc2.type = 'triangle';
    osc1.frequency.value = s.tone1 * s.tune;
    osc2.frequency.value = s.tone2 * s.tune;
    const toneAmp = this.ctx.createGain();
    toneAmp.gain.setValueAtTime(vel * s.tone, time);
    toneAmp.gain.exponentialRampToValueAtTime(0.001, time + s.bodyDecay);
    osc1.connect(toneAmp); osc2.connect(toneAmp); toneAmp.connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + s.bodyDecay + 0.05);
    osc2.stop(time + s.bodyDecay + 0.05);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = s.noiseTone;
    const noiseAmp = this.ctx.createGain();
    noiseAmp.gain.setValueAtTime(vel * s.snap, time);
    noiseAmp.gain.exponentialRampToValueAtTime(0.001, time + s.noiseDecay);
    noise.connect(hp).connect(noiseAmp).connect(dest);
    noise.start(time);
    noise.stop(time + s.noiseDecay + 0.05);
  }

  private playHat(voice: 'closedHat' | 'openHat', time: number, vel: number) {
    const s = this.synth[voice];
    const dest = this.channels[voice].input;
    const baseFreqs = [205, 304, 369, 522, 540, 800];
    const decay = s.decay;
    const merger = this.ctx.createGain();
    merger.gain.value = 0.25;
    for (const f of baseFreqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * s.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + decay + 0.05);
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.6;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = s.filter;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + decay);
    merger.connect(bp).connect(hp).connect(amp).connect(dest);
  }

  private playClap(time: number, vel: number) {
    const s = this.synth.clap;
    const dest = this.channels.clap.input;
    const offsets = [0, 0.011, 0.022, 0.033];
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const isLast = i === offsets.length - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = s.tone;
      bp.Q.value = s.sharp;
      const amp = this.ctx.createGain();
      const v = isLast ? vel : vel * 0.6;
      const d = isLast ? s.decay : 0.008;
      amp.gain.setValueAtTime(v, time + off);
      amp.gain.exponentialRampToValueAtTime(0.001, time + off + d);
      noise.connect(bp).connect(amp).connect(dest);
      noise.start(time + off);
      noise.stop(time + off + d + 0.05);
    }
  }

  private playCowbell(time: number, vel: number) {
    const s = this.synth.cowbell;
    const dest = this.channels.cowbell.input;
    const f1 = s.freq1 * s.tune;
    const f2 = s.freq2 * s.tune * s.detune;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'square'; osc2.type = 'square';
    osc1.frequency.value = f1; osc2.frequency.value = f2;
    const merger = this.ctx.createGain();
    merger.gain.value = 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = (f1 + f2) / 2; bp.Q.value = 1.5;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.45, time);
    amp.gain.linearRampToValueAtTime(vel * 0.55, time + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc1.connect(merger); osc2.connect(merger);
    merger.connect(bp).connect(amp).connect(dest);
    osc1.start(time); osc2.start(time);
    osc1.stop(time + s.decay + 0.05);
    osc2.stop(time + s.decay + 0.05);
  }

  private playTom(time: number, vel: number) {
    const s = this.synth.tom;
    const dest = this.channels.tom.input;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(s.startFreq * s.tune, time);
    osc.frequency.exponentialRampToValueAtTime(s.end * s.tune, time + s.sweep);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 1.0, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    osc.connect(amp).connect(dest);
    osc.start(time);
    osc.stop(time + s.decay + 0.05);
  }

  private playRide(time: number, vel: number) {
    const s = this.synth.ride;
    const dest = this.channels.ride.input;
    const freqs = [284, 372, 504, 712, 858, 1057];
    const merger = this.ctx.createGain();
    merger.gain.value = 0.18;
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f * s.tune;
      osc.connect(merger);
      osc.start(time);
      osc.stop(time + s.decay + 0.05);
    }
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 5500; bp.Q.value = 0.5;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.7, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + s.decay);
    merger.connect(bp).connect(hp).connect(amp).connect(dest);
  }
```

Delete the now-unused param interfaces' read paths only if TypeScript complains; the `KitParams`-style interfaces stay (used by `KITS` + `seedSynthState`).

- [ ] **Step 4: Run both DSP + the unit suite for drums**

Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-synth.dsp.test.ts src/core/drums.dsp.test.ts`
Expected: PASS — new param tests green, and the existing `drums.dsp.test.ts` battery still green (it calls `setKit` then triggers; the constructor seeds the store from the default kit, and `setKit` no longer reseeds — so add a `loadKitDefaults` call there, see Step 5).

- [ ] **Step 5: Fix the existing DSP battery to seed via the new path**

In `src/core/drums.dsp.test.ts`, the helpers call `dm.setKit(kitId)`. Since `setKit` no longer seeds the synth store, change both `renderLane` and `listKits` to load defaults. In `renderLane`:

```ts
  dm.setKit(kitId);
  dm.loadKitDefaults(kitId);
  dm.trigger(lane, 0, accent);
```

(`listKits` does not trigger, so it needs no change.)

Run: `NO_COLOR=1 npx vitest run src/core/drums.dsp.test.ts`
Expected: PASS (battery green again).

- [ ] **Step 6: Commit**

```bash
git add src/core/drums.ts src/core/drums-voice-synth.dsp.test.ts src/core/drums.dsp.test.ts
git commit -m "feat(drums): play* read live per-voice synth store at trigger time"
```

---

## Task 3: CH/OH independence verification

**Files:**
- Test: `src/core/drums-voice-params.test.ts` (extend)

CH/OH already became independent in Task 1 (`closedHat` and `openHat` are separate keys in the store, each with its own `tune`/`decay`). This task locks that in with a test.

- [ ] **Step 1: Add the test**

Append to `src/core/drums-voice-params.test.ts`:

```ts
describe('closed/open hat are independent', () => {
  it('editing closedHat.tune does not change openHat.tune', () => {
    const dm = makeDM('909');
    const before = dm.getVoiceParam('openHat', 'tune');
    dm.setVoiceParam('closedHat', 'tune', 0.5);
    expect(dm.getVoiceParam('closedHat', 'tune')).toBe(0.5);
    expect(dm.getVoiceParam('openHat', 'tune')).toBe(before);
  });

  it('closed and open carry independent decay', () => {
    const dm = makeDM('909');
    // 909 hat: closed decay 0.06, open decay 0.35
    expect(dm.getVoiceParam('closedHat', 'decay')).toBe(0.06);
    expect(dm.getVoiceParam('openHat', 'decay')).toBe(0.35);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-params.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/drums-voice-params.test.ts
git commit -m "test(drums): lock in independent closed/open hat params"
```

---

## Task 4: (no-op placeholder removed)

Per-voice mixer access needs no `drums.ts` change — `DrumMachine.channels[voice]` is already public and each `ChannelStrip` exposes `setLevel/setPan/setReverbSend/setDelaySend/setEqLow/setEqMid/setEqHigh` + `serialize()`. The engine (Task 6) drives them directly. Skip to Task 5.

---

## Task 5: Declare per-voice EngineParamSpecs

**Files:**
- Modify: `src/engines/drums-engine.ts`
- Modify: `src/engines/drums-engine.test.ts`

- [ ] **Step 1: Update the failing existing tests first**

In `src/engines/drums-engine.test.ts`, replace the `'exposes only bus.* specs ...'` test and the `'all params are continuous'` test with:

```ts
  it('exposes bus.* AND per-voice specs', () => {
    const ids = engine.params.map(p => p.id);
    expect(ids).toContain('bus.level');
    expect(ids).toContain('kick.tune');
    expect(ids).toContain('kick.decay');
    expect(ids).toContain('kick.rev');
    expect(ids).toContain('snare.snap');
    expect(ids).toContain('closedHat.tune');
    expect(ids).toContain('openHat.tune');
    expect(ids).toContain('ride.decay');
    expect(ids).toContain('kick.eq.low');
  });

  it('kick.wave is the only discrete spec; the rest are continuous', () => {
    for (const spec of engine.params) {
      if (spec.id === 'kick.wave') expect(spec.kind).toBe('discrete');
      else expect(spec.kind).toBe('continuous');
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: FAIL — `kick.tune` etc. not in params; `kick.wave` not discrete.

- [ ] **Step 3: Build the per-voice specs**

In `src/engines/drums-engine.ts`, import `DRUM_LANES`, `DrumVoice` (already imports `DrumMachine`):

```ts
import { DrumMachine, DRUM_LANES, type DrumVoice } from '../core/drums';
```

Add, above `DRUM_PARAMS`:

```ts
const WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'square', label: 'Sqr' },
];

// Per-voice synth specs (leaf ids; prefixed with `<voice>.` below). Defaults
// are the 909 representative values used for cold fallback + knob double-click
// reset; the live value always comes from the DrumMachine store via getBaseValue.
const VOICE_SYNTH_SPECS: Record<DrumVoice, EngineParamSpec[]> = {
  kick: [
    { id: 'tune',      label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2,   default: 1 },
    { id: 'attack',    label: 'ATTACK', kind: 'continuous', min: 0,   max: 1,   default: 0.7 },
    { id: 'decay',     label: 'DECAY',  kind: 'continuous', min: 0.05, max: 1.5, default: 0.4 },
    { id: 'startFreq', label: 'START',  kind: 'continuous', min: 40,  max: 400, default: 220, unit: 'Hz' },
    { id: 'endFreq',   label: 'END',    kind: 'continuous', min: 30,  max: 150, default: 55,  unit: 'Hz' },
    { id: 'sweep',     label: 'SWEEP',  kind: 'continuous', min: 0.005, max: 0.3, default: 0.03 },
    { id: 'wave',      label: 'WAVE',   kind: 'discrete',   min: 0,   max: 2,   default: 0, options: WAVE_OPTIONS },
  ],
  snare: [
    { id: 'tune',       label: 'TUNE', kind: 'continuous', min: 0.5, max: 2,    default: 1 },
    { id: 'tone',       label: 'TONE', kind: 'continuous', min: 0,   max: 1,    default: 0.35 },
    { id: 'snap',       label: 'SNAP', kind: 'continuous', min: 0,   max: 1,    default: 0.75 },
    { id: 'bodyDecay',  label: 'BODY', kind: 'continuous', min: 0.01, max: 0.3, default: 0.04 },
    { id: 'noiseDecay', label: 'NDEC', kind: 'continuous', min: 0.02, max: 0.5, default: 0.18 },
    { id: 'noiseTone',  label: 'NTONE', kind: 'continuous', min: 1000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  closedHat: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1.2 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.01, max: 0.3, default: 0.06 },
    { id: 'filter', label: 'FILTER', kind: 'continuous', min: 3000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  openHat: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1.2 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.05, max: 1.0, default: 0.35 },
    { id: 'filter', label: 'FILTER', kind: 'continuous', min: 3000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  clap: [
    { id: 'tone',  label: 'TONE',  kind: 'continuous', min: 500, max: 4000, default: 1500, unit: 'Hz' },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.05, max: 0.5, default: 0.16 },
    { id: 'sharp', label: 'SHARP', kind: 'continuous', min: 0.3, max: 8,    default: 2.0 },
  ],
  tom: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5, max: 2, default: 1 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.05, max: 1.0, default: 0.5 },
    { id: 'sweep', label: 'SWEEP', kind: 'continuous', min: 0.01, max: 0.3, default: 0.08 },
    { id: 'end',   label: 'END',   kind: 'continuous', min: 40, max: 200, default: 95, unit: 'Hz' },
  ],
  cowbell: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.05, max: 0.6, default: 0.25 },
    { id: 'detune', label: 'DETUNE', kind: 'continuous', min: 0.5, max: 2, default: 1 },
  ],
  ride: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5, max: 2, default: 1.5 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.2, max: 3, default: 1.2 },
  ],
};

const VOICE_MIXER_SPECS: Array<Omit<EngineParamSpec, 'id'> & { leaf: string }> = [
  { leaf: 'level',   label: 'LEVEL', kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { leaf: 'rev',     label: 'REV',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { leaf: 'dly',     label: 'DLY',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { leaf: 'pan',     label: 'PAN',   kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { leaf: 'eq.low',  label: 'LO',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.mid',  label: 'MID',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.high', label: 'HI',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

const MIXER_LEAVES = new Set(VOICE_MIXER_SPECS.map((s) => s.leaf));

function buildPerVoiceSpecs(): EngineParamSpec[] {
  const out: EngineParamSpec[] = [];
  for (const voice of DRUM_LANES) {
    for (const s of VOICE_SYNTH_SPECS[voice]) out.push({ ...s, id: `${voice}.${s.id}` });
    for (const m of VOICE_MIXER_SPECS) {
      const { leaf, ...rest } = m;
      out.push({ ...rest, id: `${voice}.${leaf}` });
    }
  }
  return out;
}
```

Then append the per-voice specs to `DRUM_PARAMS`. Change its declaration end from `];` to keep the existing `bus.*` entries, and right after the array add:

```ts
DRUM_PARAMS.push(...buildPerVoiceSpecs());
```

(Declare `DRUM_PARAMS` with `const` is fine — `.push` mutates the array in place; or change to a single `[...busSpecs, ...buildPerVoiceSpecs()]` expression. Use the spread form to keep it immutable-looking:)

```ts
const DRUM_PARAMS: EngineParamSpec[] = [
  ...BUS_PARAMS,
  ...buildPerVoiceSpecs(),
];
```

where `BUS_PARAMS` is the existing 7 `bus.*` specs (rename the current literal to `BUS_PARAMS`). Export `MIXER_LEAVES` is not needed outside; keep it module-local.

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-engine.test.ts`
Expected: PASS — every spec validates (the `'every spec validates'` test still runs), `kick.tune` present, `kick.wave` discrete.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-engine.test.ts
git commit -m "feat(drums): declare per-voice synth + mixer EngineParamSpecs"
```

---

## Task 6: Route getBaseValue / setBaseValue to the store + voice strips

**Files:**
- Modify: `src/engines/drums-engine.ts`
- Test: `src/engines/drums-per-voice-routing.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/engines/drums-per-voice-routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';

function makeEngine() {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input); // allocates the DrumMachine instance
  return engine;
}

describe('DrumsEngine per-voice routing', () => {
  it('synth param round-trips through the DrumMachine store', () => {
    const engine = makeEngine();
    engine.setBaseValue('kick.tune', 1.7);
    expect(engine.getBaseValue('kick.tune')).toBeCloseTo(1.7, 5);
    expect(engine.getInstance()!.getVoiceParam('kick', 'tune')).toBeCloseTo(1.7, 5);
  });

  it('per-voice rev send writes that voice ChannelStrip only', () => {
    const engine = makeEngine();
    engine.setBaseValue('kick.rev', 0.6);
    const dm = engine.getInstance()!;
    expect(dm.channels.kick.serialize().reverbSend).toBeCloseTo(0.6, 5);
    expect(dm.channels.snare.serialize().reverbSend).toBe(0); // untouched
  });

  it('per-voice level + eq route to the voice strip', () => {
    const engine = makeEngine();
    engine.setBaseValue('snare.level', 1.3);
    engine.setBaseValue('snare.eq.low', 6);
    const snare = engine.getInstance()!.channels.snare;
    expect(snare.serialize().level).toBeCloseTo(1.3, 5);
    expect(snare.getEqGainParam('low').value).toBeCloseTo(6, 5);
  });

  it('getBaseValue for an untouched per-voice param reads the kit default', () => {
    const engine = makeEngine();
    engine.getInstance()!.loadKitDefaults('808'); // 808 kick startFreq 150
    expect(engine.getBaseValue('kick.startFreq')).toBe(150);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-per-voice-routing.test.ts`
Expected: FAIL — `setBaseValue('kick.tune', ...)` currently no-ops (id not in `paramValues`).

- [ ] **Step 3: Rewrite getBaseValue / setBaseValue**

In `src/engines/drums-engine.ts`, replace the bodies. Keep `paramValues` initialized to the **bus.* defaults only** (not per-voice — per-voice defaults live in the DrumMachine store):

```ts
  private paramValues: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (const s of BUS_PARAMS) o[s.id] = s.default;
    return o;
  })();

  private specDefault(id: string): number {
    return DRUM_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }

  getBaseValue(id: string): number {
    if (id.startsWith('bus.')) {
      return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    const dm = this.lastInstance;
    if (DRUM_LANES.includes(voice) && dm) {
      if (MIXER_LEAVES.has(leaf)) return readMixer(dm, voice, leaf);
      const v = dm.getVoiceParam(voice, leaf);
      if (typeof v === 'number') return v;
    }
    return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
  }

  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
    if (id.startsWith('bus.')) {
      if (!this.busStrip) return;
      switch (id) {
        case 'bus.level':      this.busStrip.setLevel(v);      return;
        case 'bus.pan':        this.busStrip.setPan(v);        return;
        case 'bus.reverbSend': this.busStrip.setReverbSend(v); return;
        case 'bus.delaySend':  this.busStrip.setDelaySend(v);  return;
        case 'bus.eq.low':     this.busStrip.setEqLow(v);      return;
        case 'bus.eq.mid':     this.busStrip.setEqMid(v);      return;
        case 'bus.eq.high':    this.busStrip.setEqHigh(v);     return;
      }
      return;
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    if (!DRUM_LANES.includes(voice)) return;
    const dm = this.lastInstance;
    if (!dm) return; // pre-instance: cached in paramValues; restored once an instance exists
    if (MIXER_LEAVES.has(leaf)) { writeMixer(dm, voice, leaf, v); return; }
    dm.setVoiceParam(voice, leaf, v);
  }
```

Add module-local helpers (after `buildPerVoiceSpecs`):

```ts
function writeMixer(dm: DrumMachine, voice: DrumVoice, leaf: string, v: number): void {
  const st = dm.channels[voice];
  switch (leaf) {
    case 'level':   st.setLevel(v);      break;
    case 'pan':     st.setPan(v);        break;
    case 'rev':     st.setReverbSend(v); break;
    case 'dly':     st.setDelaySend(v);  break;
    case 'eq.low':  st.setEqLow(v);      break;
    case 'eq.mid':  st.setEqMid(v);      break;
    case 'eq.high': st.setEqHigh(v);     break;
  }
}

function readMixer(dm: DrumMachine, voice: DrumVoice, leaf: string): number {
  const s = dm.channels[voice].serialize();
  switch (leaf) {
    case 'level':   return s.level;
    case 'pan':     return s.pan;
    case 'rev':     return s.reverbSend;
    case 'dly':     return s.delaySend;
    case 'eq.low':  return s.eqLow;
    case 'eq.mid':  return s.eqMid;
    case 'eq.high': return s.eqHigh;
  }
  return 0;
}
```

> Note: `getSharedAudioParams` stays bus-only (do NOT add per-voice params) so the LFO/ADSR destination dropdown is not flooded with 56 per-voice mixer entries. This is intentional per the spec's non-goals.

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-per-voice-routing.test.ts src/engines/drums-engine.test.ts`
Expected: PASS (new routing + existing engine tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-per-voice-routing.test.ts
git commit -m "feat(drums): route per-voice params to synth store + voice strips"
```

---

## Task 7: applyPreset = loadKitDefaults + overlay per-voice overrides

**Files:**
- Modify: `src/engines/drums-engine.ts` (`applyPreset`)
- Test: `src/engines/drums-preset-apply.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/engines/drums-preset-apply.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';
import * as loader from '../presets/preset-loader';

function makeEngine() {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input);
  return engine;
}

describe('DrumsEngine.applyPreset (kit + per-voice overrides)', () => {
  it('loads the kit baseline then layers per-voice overrides', () => {
    const engine = makeEngine();
    vi.spyOn(loader, 'getCachedPresets').mockReturnValue([
      { name: 'Techno Punch', gm: [24],
        params: { kitId: '909', 'kick.tune': 0.9, 'snare.snap': 0.8 } as Record<string, number | string> },
    ] as never);
    engine.applyPreset('Techno Punch');
    const dm = engine.getInstance()!;
    expect(dm.kitId).toBe('909');                       // kit baseline loaded
    expect(dm.getVoiceParam('kick', 'tune')).toBeCloseTo(0.9, 5); // override applied
    expect(dm.getVoiceParam('snare', 'snap')).toBeCloseTo(0.8, 5);
    // an untouched voice keeps the 909 default (kick attack = clickAmount 0.7)
    expect(dm.getVoiceParam('kick', 'attack')).toBeCloseTo(0.7, 5);
  });

  it('a kit-only preset just loads defaults (back-compat)', () => {
    const engine = makeEngine();
    vi.spyOn(loader, 'getCachedPresets').mockReturnValue([
      { name: 'KIT TR-808', gm: [25], params: { kitId: '808' } as Record<string, number | string> },
    ] as never);
    engine.getInstance()!.setVoiceParam('kick', 'startFreq', 999); // pre-existing tweak
    engine.applyPreset('KIT TR-808');
    const dm = engine.getInstance()!;
    expect(dm.kitId).toBe('808');
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(150); // reset to 808 default
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-preset-apply.test.ts`
Expected: FAIL — current `applyPreset` only calls `setKit` (no `loadKitDefaults`, no overrides).

- [ ] **Step 3: Rewrite applyPreset**

In `src/engines/drums-engine.ts`, replace `applyPreset`:

```ts
  applyPreset(name: string): void {
    if (!this.lastInstance) return;
    const preset = this.presets.find((p) => p.name === name);
    let kitId: string | undefined;
    let overrides: Array<[string, number]> = [];
    if (preset) {
      const params = preset.params as Record<string, number | string>;
      if (typeof params.kitId === 'string') kitId = params.kitId;
      overrides = Object.entries(params)
        .filter(([k, v]) => k !== 'kitId' && typeof v === 'number') as Array<[string, number]>;
    }
    // Fallback: a bare kit *name* (back-compat for direct kit selection).
    if (!kitId) {
      const kit = this.lastInstance.listKits().find((k) => k.name === name);
      kitId = kit?.id;
    }
    if (kitId) this.lastInstance.loadKitDefaults(kitId);
    // Keep the engine param cache + the live instance in sync.
    for (const [id, v] of overrides) this.setBaseValue(id, v);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-preset-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-preset-apply.test.ts
git commit -m "feat(drums): applyPreset loads kit defaults then layers per-voice overrides"
```

---

## Task 8: wireEngineParams knobSize option

**Files:**
- Modify: `src/engines/engine-ui.ts`
- Test: `src/engines/engine-ui-knobsize.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/engines/engine-ui-knobsize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wireEngineParams } from './engine-ui';
import type { SynthEngine, EngineUIContext } from './engine-types';

function stubEngine(): SynthEngine {
  return {
    id: 'x', name: 'X', type: 'mono', polyphony: 'mono', editor: 'piano-roll',
    params: [{ id: 'a.b', label: 'AB', kind: 'continuous', min: 0, max: 1, default: 0.5 }],
    getBaseValue: () => 0.5, setBaseValue: () => {}, getAudioParams: () => new Map(),
    createVoice: () => ({} as never), buildSequencer: () => ({} as never), buildParamUI: () => {},
  } as unknown as SynthEngine;
}

function ctx(parent: HTMLElement): EngineUIContext {
  const reg = new Map<string, unknown>();
  return {
    laneId: 'L', registerKnob: (k: unknown) => reg.set('k', k), registry: reg,
  } as unknown as EngineUIContext;
}

describe('wireEngineParams knobSize', () => {
  it('passes knobSize to the rendered knob SVG', () => {
    const parent = document.createElement('div');
    wireEngineParams(stubEngine(), ctx(parent), parent, { knobSize: 30 });
    const svg = parent.querySelector('svg.knob-svg') as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('30');
  });
});
```

(Runs in jsdom — vitest's default environment for non-DSP files.)

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-ui-knobsize.test.ts`
Expected: FAIL — knob renders at default size 40, not 30.

- [ ] **Step 3: Add the option**

In `src/engines/engine-ui.ts`, extend the options interface and pass `size`:

```ts
export interface WireEngineParamsOptions {
  formatter?: (id: string, v: number) => string;
  filter?: (specId: string) => boolean;
  /** Knob SVG size in px (continuous params only). Default: createKnob's 40. */
  knobSize?: number;
}
```

In the `spec.kind === 'continuous'` branch, add `size: opts.knobSize,` to the `createKnob({...})` call (createKnob already defaults to 40 when `size` is `undefined`).

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-ui-knobsize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/engine-ui.ts src/engines/engine-ui-knobsize.test.ts
git commit -m "feat(engine-ui): optional knobSize for wireEngineParams"
```

---

## Task 9: The 8-column drum voice rack renderer

**Files:**
- Create: `src/engines/drum-voice-rack.ts`
- Test: `src/engines/drum-voice-rack.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/engines/drum-voice-rack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { DrumsEngine } from './drums-engine';
import type { EngineUIContext } from './engine-types';

function makeCtx(registered: string[]): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
    registry: new Map<string, unknown>(),
  } as unknown as EngineUIContext;
}

describe('renderDrumVoiceRack', () => {
  it('renders 8 voice columns', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    expect(host.querySelectorAll('.dv-col').length).toBe(8);
  });

  it('registers curated + mixer knob ids per voice under the lane prefix', () => {
    const host = document.createElement('div');
    const ids: string[] = [];
    renderDrumVoiceRack(new DrumsEngine(), makeCtx(ids), host);
    expect(ids).toContain('drums-1.kick.tune');
    expect(ids).toContain('drums-1.kick.rev');
    expect(ids).toContain('drums-1.snare.snap');
    // advanced ids are rendered too (collapsed, but registered):
    expect(ids).toContain('drums-1.kick.startFreq');
    expect(ids).toContain('drums-1.kick.wave');
  });

  it('advanced block is collapsed by default and toggles on click', () => {
    const host = document.createElement('div');
    renderDrumVoiceRack(new DrumsEngine(), makeCtx([]), host);
    const adv = host.querySelector('.dv-advanced') as HTMLElement;
    const btn = host.querySelector('.dv-adv-toggle') as HTMLButtonElement;
    expect(adv.classList.contains('open')).toBe(false);
    btn.click();
    expect(adv.classList.contains('open')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-voice-rack.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the renderer**

Create `src/engines/drum-voice-rack.ts`:

```ts
// src/engines/drum-voice-rack.ts
// Renders the per-voice "mini-mixer" rack for a drums lane: one column per
// voice with curated synth knobs + curated mixer (LEVEL/REV/DLY) + a collapsed
// ▸advanced block (raw synth params + PAN + EQ). Each control is built through
// wireEngineParams so it registers under `<laneId>.<id>`, mirrors to
// engineState, and gets undo for free.

import type { SynthEngine, EngineUIContext } from './engine-types';
import { DRUM_LANES, type DrumVoice } from '../core/drums';
import { wireEngineParams } from './engine-ui';

const VOICE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

// Curated synth leaves shown up-front per voice; everything else for that
// voice (minus mixer) drops into ▸advanced.
const CURATED_SYNTH: Record<DrumVoice, string[]> = {
  kick: ['tune', 'attack', 'decay'],
  snare: ['tune', 'tone', 'snap'],
  closedHat: ['tune', 'decay'],
  openHat: ['tune', 'decay'],
  clap: ['tone', 'decay'],
  tom: ['tune', 'decay'],
  cowbell: ['tune', 'decay'],
  ride: ['tune', 'decay'],
};
const CURATED_MIXER = ['level', 'rev', 'dly'];
const ADVANCED_MIXER = ['pan', 'eq.low', 'eq.mid', 'eq.high'];

const KNOB = 34;

export function renderDrumVoiceRack(
  engine: SynthEngine,
  ctx: EngineUIContext,
  host: HTMLElement,
): void {
  const rack = document.createElement('div');
  rack.className = 'drum-voice-rack';

  // Precompute which spec ids exist for the engine so we can split synth vs mixer.
  const idsForVoice = (voice: DrumVoice) =>
    engine.params.map((p) => p.id).filter((id) => id.startsWith(`${voice}.`));

  for (const voice of DRUM_LANES) {
    const col = document.createElement('div');
    col.className = `dv-col ${voice}`;

    const head = document.createElement('div');
    head.className = 'dv-head';
    head.textContent = VOICE_LABELS[voice];
    col.appendChild(head);

    const all = idsForVoice(voice);
    const curatedSynth = CURATED_SYNTH[voice].map((l) => `${voice}.${l}`);
    const curatedMixer = CURATED_MIXER.map((l) => `${voice}.${l}`);
    const advancedMixer = ADVANCED_MIXER.map((l) => `${voice}.${l}`);
    const curatedSet = new Set([...curatedSynth, ...curatedMixer, ...advancedMixer]);
    const advancedSynth = all.filter((id) => !curatedSet.has(id));

    const synthBlock = document.createElement('div');
    synthBlock.className = 'dv-synth';
    col.appendChild(synthBlock);
    wireEngineParams(engine, ctx, synthBlock, {
      knobSize: KNOB, filter: (id) => curatedSynth.includes(id),
    });

    const mixBlock = document.createElement('div');
    mixBlock.className = 'dv-mix';
    col.appendChild(mixBlock);
    wireEngineParams(engine, ctx, mixBlock, {
      knobSize: KNOB, filter: (id) => curatedMixer.includes(id),
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dv-adv-toggle';
    toggle.textContent = '▸ adv';
    col.appendChild(toggle);

    const adv = document.createElement('div');
    adv.className = 'dv-advanced';
    col.appendChild(adv);
    wireEngineParams(engine, ctx, adv, {
      knobSize: KNOB, filter: (id) => advancedSynth.includes(id) || advancedMixer.includes(id),
    });

    toggle.addEventListener('click', () => {
      const open = adv.classList.toggle('open');
      toggle.textContent = open ? '▾ adv' : '▸ adv';
    });

    rack.appendChild(col);
  }

  host.appendChild(rack);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drum-voice-rack.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/drum-voice-rack.ts src/engines/drum-voice-rack.test.ts
git commit -m "feat(drums): 8-column per-voice rack renderer"
```

---

## Task 10: Mount the rack in buildParamUI (above modulators)

**Files:**
- Modify: `src/engines/drums-engine.ts` (`buildParamUI`)
- Test: `src/engines/drums-buildparamui.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/engines/drums-buildparamui.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DrumsEngine } from './drums-engine';
import type { EngineUIContext } from './engine-types';

function makeCtx(): EngineUIContext {
  return {
    laneId: 'drums-1',
    registerKnob: () => {},
    registry: new Map<string, unknown>(),
    lookupLaneDisplayName: () => 'DRUMS',
  } as unknown as EngineUIContext;
}

describe('DrumsEngine.buildParamUI', () => {
  it('renders the voice rack before the modulators panel', () => {
    const host = document.createElement('div');
    new DrumsEngine().buildParamUI(host, makeCtx());
    const rack = host.querySelector('.drum-voice-rack');
    const mods = host.querySelector('.modulators-panel, .modulators, [data-modulators]');
    expect(rack).not.toBeNull();
    // rack should appear before the modulators block in DOM order when both exist
    if (mods) {
      const pos = rack!.compareDocumentPosition(mods);
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
```

> If `renderModulatorsPanel` uses a different root class, the `mods` lookup may be null in this headless context — the test still asserts the rack renders and is harmless when `mods` is null. Keep the selector list broad.

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-buildparamui.test.ts`
Expected: FAIL — no `.drum-voice-rack` rendered.

- [ ] **Step 3: Mount the rack**

In `src/engines/drums-engine.ts`, import the renderer:

```ts
import { renderDrumVoiceRack } from './drum-voice-rack';
```

In `buildParamUI`, after `container.innerHTML = ''; if (!ctx) return;`, render the rack first:

```ts
    // Per-voice mini-mixer rack — between the master strip (#drum-master-knobs,
    // mounted on the static page) and the modulators panel below.
    const rackHost = document.createElement('div');
    rackHost.className = 'drum-rack-host';
    container.appendChild(rackHost);
    renderDrumVoiceRack(this, ctx, rackHost);
```

Then leave the existing `renderModulatorsPanel(container, {...})` call as-is (it appends below the rack).

- [ ] **Step 4: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-buildparamui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/drums-engine.ts src/engines/drums-buildparamui.test.ts
git commit -m "feat(drums): mount per-voice rack above modulators in buildParamUI"
```

---

## Task 11: Rack styling

**Files:**
- Create: `src/styles/_drum-rack.scss`
- Modify: the SCSS entry that `@use`/`@import`s the partials (find with the grep below)

- [ ] **Step 1: Find the styles entry**

Use Grep for `@use|@import` across `src/styles/*.scss` (and check `src/main.ts` for a top-level `import './styles/...'`) to identify the central stylesheet that pulls in the other `_*.scss` partials (e.g. `src/styles/main.scss` / `index.scss`).

- [ ] **Step 2: Create the partial**

Create `src/styles/_drum-rack.scss`:

```scss
.drum-voice-rack {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 6px 4px;
}
.dv-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 58px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
}
.dv-head {
  font-size: 10px;
  letter-spacing: 0.04em;
  opacity: 0.8;
  margin-bottom: 2px;
}
.dv-synth, .dv-mix, .dv-advanced {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.dv-mix { margin-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 4px; }
.dv-adv-toggle {
  margin-top: 4px;
  font-size: 9px;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  padding: 1px 4px;
}
.dv-advanced { display: none; margin-top: 4px; }
.dv-advanced.open { display: flex; }
```

- [ ] **Step 3: Wire the import**

Add to the central stylesheet identified in Step 1, matching its existing convention (e.g. `@use './drum-rack';` for `@use` files, or `@import './drum-rack';`).

- [ ] **Step 4: Verify the build compiles the SCSS**

Run: `npm run build`
Expected: typecheck + bundle succeed; no SCSS error.

- [ ] **Step 5: Commit**

```bash
git add src/styles/_drum-rack.scss src/styles/*.scss
git commit -m "style(drums): compact per-voice rack layout"
```

---

## Task 12: Fix refreshLaneKnobs for discrete params

**Files:**
- Modify: `src/app/knob-mounting.ts` (`refreshLaneKnobs`)
- Test: `src/app/refresh-lane-knobs-discrete.test.ts` (create)

A discrete control's `handle.setValue` expects a **normalized 0..1** value (it calls `quantiseSelectValue(v, n) = floor(v*n)`). `refreshLaneKnobs` currently passes the raw index from `getBaseValue`, which mis-positions WAVE (and FM's algorithm) after a kit/preset change. Fix it generally.

- [ ] **Step 1: Write the failing test**

Create `src/app/refresh-lane-knobs-discrete.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quantiseSelectValue, normaliseSelectIndex } from '../core/select-control';

// Captures the contract refreshLaneKnobs must satisfy for discrete handles:
// normaliseSelectIndex(idx, n) must round-trip back to idx through
// quantiseSelectValue (the inverse used inside the select handle's setValue).
describe('discrete refresh round-trip', () => {
  it('index -> normalized -> index is identity for a 3-option select', () => {
    for (let idx = 0; idx < 3; idx++) {
      const norm = normaliseSelectIndex(idx, 3);
      expect(quantiseSelectValue(norm, 3)).toBe(idx);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes (guard test) — then assert the wiring**

Run: `NO_COLOR=1 npx vitest run src/app/refresh-lane-knobs-discrete.test.ts`
Expected: PASS (this proves the helper math; the behavioral fix is in Step 3, verified by the existing drums/FM suites staying green and manual smoke).

- [ ] **Step 3: Apply the fix**

In `src/app/knob-mounting.ts`, add the import:

```ts
import { normaliseSelectIndex } from '../core/select-control';
```

Replace `refreshLaneKnobs`:

```ts
  const refreshLaneKnobs = (laneId: string, engine: SynthEngine) => {
    for (const spec of engine.params) {
      const handle = deps.registry.get(`${laneId}.${spec.id}`);
      if (!handle) continue;
      if (spec.kind === 'discrete' && spec.options && spec.options.length > 0) {
        const idx = Math.round(engine.getBaseValue(spec.id));
        handle.setValue(normaliseSelectIndex(idx, spec.options.length));
      } else {
        handle.setValue(engine.getBaseValue(spec.id));
      }
    }
  };
```

- [ ] **Step 4: Run the broader knob/engine suites**

Run: `NO_COLOR=1 npx vitest run src/app src/engines/drums-engine.test.ts`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/app/knob-mounting.ts src/app/refresh-lane-knobs-discrete.test.ts
git commit -m "fix(knobs): normalize discrete params in refreshLaneKnobs (WAVE/algorithm)"
```

---

## Task 13: Random drum sound reloads kit defaults + refreshes the rack

**Files:**
- Modify: `src/core/randomize-ui.ts` (`randomizeDrumsSound`)
- Modify: `src/main.ts` (wire a rack refresh callback into randomize deps)

`randomizeDrumsSound` calls `drums.setKit(pick.id)`, which under the new model no longer reseeds the synth store, so the random button would change nothing audible. It must call `loadKitDefaults` and refresh the rack knobs.

- [ ] **Step 1: Add the optional refresh callback to the deps interface**

In `src/core/randomize-ui.ts`, the interface is `RandomizeUIDeps`. It already has `getDrums(): DrumMachine | null` and `getDrumsLaneId(): string`. Add one optional field:

```ts
  /** Re-reads the per-voice rack knob handles after a kit change (set in main.ts). */
  refreshDrumsRack?: () => void;
```

- [ ] **Step 2: Update randomizeDrumsSound**

In `src/core/randomize-ui.ts`, change two lines of the existing `randomizeDrumsSound` (it already obtains `drums`/`kits` exactly as below — only the marked lines change):

```ts
function randomizeDrumsSound(deps: RandomizeUIDeps): void {
  const drums = deps.getDrums();
  if (!drums) return;
  const kits = drums.listKits();
  if (kits.length === 0) return;
  const pick = kits[Math.floor(Math.random() * kits.length)];
  drums.loadKitDefaults(pick.id);          // CHANGED: was drums.setKit(pick.id)
  markPagePresetCustom('drums-preset-select', deps.getDrumsLaneId());
  deps.refreshDrumsRack?.();               // ADDED: refresh rack from new defaults
}
```

- [ ] **Step 3: Wire the callback in main.ts**

At the `wireRandomizeUI({ ... })` call in `src/main.ts` (the object literal that supplies `RandomizeUIDeps`), add the field:

```ts
  refreshDrumsRack: () => {
    const laneId = getDrumsLaneId();
    const inst = getLaneEngineInstance(laneId);
    if (inst) refreshLaneKnobs(laneId, inst);
  },
```

(`getDrumsLaneId`, `getLaneEngineInstance`, and `refreshLaneKnobs` are all already in scope in `main.ts` — see the `applyPresetForLane` wiring at `main.ts:371-383` which uses the same trio.)

- [ ] **Step 4: Verify build + drums tests**

Run: `npm run build`
Expected: typecheck + bundle succeed.
Run: `NO_COLOR=1 npx vitest run src/core/drums-voice-params.test.ts`
Expected: PASS (still green).

- [ ] **Step 5: Commit**

```bash
git add src/core/randomize-ui.ts src/main.ts
git commit -m "feat(drums): random sound reloads kit defaults + refreshes the rack"
```

---

## Task 14: Persistence round-trip + full verification

**Files:**
- Test: `src/engines/drums-persistence.test.ts` (create)

- [ ] **Step 1: Write the persistence test**

Create `src/engines/drums-persistence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumsEngine } from './drums-engine';
import { ChannelStrip, FxBus } from '../core/fx';
import { mirrorParamChange } from '../session/session-engine-state';
import type { SessionState } from '../session/session';

function makeEngine() {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const fx = new FxBus(ctx, ctx.destination);
  const strip = new ChannelStrip(ctx, ctx.destination, fx);
  const engine = new DrumsEngine();
  engine.setSharedFx(fx);
  engine.setBusStrip(strip);
  engine.createVoice(ctx, strip.input);
  return engine;
}

describe('per-voice params persist + restore via engineState', () => {
  it('mirrorParamChange + replay restores a per-voice edit', () => {
    const state = { lanes: [{ id: 'drums-1', engineState: {} }] } as unknown as SessionState;

    // 1. Edit + mirror (what the rack knob onChange does)
    const a = makeEngine();
    a.setBaseValue('kick.tune', 1.6);
    mirrorParamChange(state, 'drums-1', 'kick.tune', 1.6);
    a.setBaseValue('snare.rev', 0.5);
    mirrorParamChange(state, 'drums-1', 'snare.rev', 0.5);

    // 2. Fresh engine + replay engineState.params (what applyEngineState does)
    const b = makeEngine();
    const params = (state.lanes[0] as { engineState: { params?: Record<string, number> } })
      .engineState.params!;
    for (const [id, v] of Object.entries(params)) b.setBaseValue(id, v);

    expect(b.getInstance()!.getVoiceParam('kick', 'tune')).toBeCloseTo(1.6, 5);
    expect(b.getInstance()!.channels.snare.serialize().reverbSend).toBeCloseTo(0.5, 5);
  });

  it('kit baseline then param override = override wins (load ordering)', () => {
    const e = makeEngine();
    // ordering: applyPreset (kit) runs first in applyLoadedSessionState, then
    // applyEngineState replays params — overrides must survive.
    e.getInstance()!.loadKitDefaults('808');         // kit baseline (preset recall)
    e.setBaseValue('kick.startFreq', 333);           // engineState override
    expect(e.getBaseValue('kick.startFreq')).toBe(333);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/drums-persistence.test.ts`
Expected: PASS.

- [ ] **Step 3: Full typecheck + build**

Run: `npm run build`
Expected: `tsc` clean + bundle to `dist/`.

- [ ] **Step 4: Full unit suite (serial, may flake on teardown — re-run if `ERR_IPC_CHANNEL_CLOSED`)**

Run: `npm run test:unit`
Expected: all green (the two updated drums-engine assertions, all new tests, existing DSP battery).

- [ ] **Step 5: Build for e2e + browser smoke (manual)**

Run: `npm run build`
Then open the dev server: `npm run dev` → http://localhost:5173
Manual checks:
- Select a drums lane → the 8-column rack appears between the DRUM VOL/PAN/REV/DLY/LO/MID/HI row and the LFO/ADSR modulators.
- Turn KICK TUNE / DECAY → next kick hit changes pitch / length.
- Turn KICK REV up → kick gets reverb independently of the snare.
- Open ▸adv on KICK → START/END/SWEEP/WAVE + PAN + EQ appear; change WAVE → timbre changes.
- Pick a different kit/preset (drums PRESET → Load) → rack knobs jump to the new kit's values (WAVE included).
- 🎲 Sound → kit + rack change together.
- Save the project, reload → per-voice tweaks restored.

- [ ] **Step 6: Commit**

```bash
git add src/engines/drums-persistence.test.ts
git commit -m "test(drums): per-voice param persistence + load-ordering round-trip"
```

---

## Self-Review notes (author)

- **Spec coverage:** per-voice knobs (T5/T9), independent rev/delay sends (T6 mixer routing + T9 REV/DLY knobs), 8 columns in the inspector between master + modulators (T9/T10), hybrid curated+advanced (T9), kit = preset of departure (T1 `loadKitDefaults` + T7 `applyPreset`), persistence (T14 + generic `applyEngineState`), preset = kit + overrides (T7), WAVE discrete encoding (T5 spec + T12 refresh fix), CH/OH independence (T1/T3). All covered.
- **Non-goals honored:** per-voice mixer NOT added to `getSharedAudioParams` (T6 note); no Save As (untouched).
- **Type consistency:** leaf names identical across `seedSynthState` (T1), `play*` (T2), `VOICE_SYNTH_SPECS` (T5), `CURATED_SYNTH` (T9). `loadKitDefaults`/`setVoiceParam`/`getVoiceParam`/`MIXER_LEAVES`/`writeMixer`/`readMixer` names consistent across T1/T6.
- **Known minor:** knob double-click resets to `spec.default` (909 representative), not the active kit's value — acceptable; noted for a possible follow-up.
