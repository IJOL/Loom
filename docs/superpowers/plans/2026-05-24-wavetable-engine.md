# Wavetable Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Wavetable synthesis engine that registers as a polyhost engine, appearing in the PolySynth engine selector dropdown. Users can morph between algorithmically-generated waveforms.

**Architecture:** Two oscillators per voice with a crossfade gain to morph between adjacent wavetables. A bank of 8 PeriodicWave objects generated from Fourier coefficients at boot. The morph knob (0-1) selects which two adjacent tables to blend via gain crossfade.

**Tech Stack:** TypeScript, Web Audio API (PeriodicWave, OscillatorNode, GainNode), existing engine plugin system.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/engines/wavetable.ts` | WavetableEngine class + registration |
| Create | `src/engines/wavetable-tables.ts` | Wavetable generation (Fourier coefficients for each waveform) |

---

### Task 1: Create wavetable generation utilities

**Files:**
- Create: `src/engines/wavetable-tables.ts`

- [ ] **Step 1: Create the wavetable generation file**

```typescript
// src/engines/wavetable-tables.ts

const HARMONICS = 64;

export interface WaveTableDef {
  name: string;
  real: Float32Array;
  imag: Float32Array;
}

function makeSine(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  imag[1] = 1;
  return { name: 'Sine', real, imag };
}

function makeTriangle(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 === 0 ? 1 : -1);
  }
  return { name: 'Triangle', real, imag };
}

function makeSawtooth(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = 2 / (Math.PI * k) * (k % 2 === 0 ? 1 : -1);
  }
  return { name: 'Sawtooth', real, imag };
}

function makeSquare(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 2) {
    imag[k] = 4 / (Math.PI * k);
  }
  return { name: 'Square', real, imag };
}

function makePWM(duty: number): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    imag[k] = (2 / (Math.PI * k)) * Math.sin(Math.PI * k * duty);
  }
  return { name: `PWM ${Math.round(duty * 100)}%`, real, imag };
}

function makeOrgan(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  // Drawbar-style: fundamental + 2nd + 3rd + 4th + 8th harmonics
  imag[1] = 1.0;
  imag[2] = 0.8;
  imag[3] = 0.6;
  imag[4] = 0.4;
  if (HARMONICS > 8) imag[8] = 0.3;
  return { name: 'Organ', real, imag };
}

function makeBrass(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  // Harmonics weighted for brassy timbre: strong low, gradual rolloff
  for (let k = 1; k < Math.min(HARMONICS, 20); k++) {
    imag[k] = 1 / Math.pow(k, 0.7);
  }
  return { name: 'Brass', real, imag };
}

function makeVocal(): WaveTableDef {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  // "Ahh" formant approximation: strong 1st, 2nd-5th with formant peaks
  imag[1] = 1.0;
  imag[2] = 0.7;
  imag[3] = 0.5;
  imag[4] = 0.9;  // formant peak ~4th harmonic
  imag[5] = 0.6;
  imag[6] = 0.3;
  imag[7] = 0.4;
  if (HARMONICS > 10) imag[10] = 0.25;
  if (HARMONICS > 12) imag[12] = 0.2;
  return { name: 'Vocal', real, imag };
}

export const WAVETABLES: WaveTableDef[] = [
  makeSine(),
  makeTriangle(),
  makeSawtooth(),
  makeSquare(),
  makePWM(0.25),
  makeOrgan(),
  makeBrass(),
  makeVocal(),
];

export function createPeriodicWaves(ctx: AudioContext): PeriodicWave[] {
  return WAVETABLES.map((t) => ctx.createPeriodicWave(t.real, t.imag));
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Create the Wavetable engine

**Files:**
- Create: `src/engines/wavetable.ts`

- [ ] **Step 1: Create the wavetable engine file**

```typescript
// src/engines/wavetable.ts

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, ParamDef } from './engine-types';
import { registerEngine } from './registry';
import { createPeriodicWaves, WAVETABLES } from './wavetable-tables';

const WAVETABLE_PARAMS: ParamDef[] = [
  { id: 'wt-morph', label: 'Morph', min: 0, max: 1, default: 0 },
  { id: 'wt-attack', label: 'Attack', min: 0.001, max: 2, default: 0.01, curve: 'exponential', unit: 's' },
  { id: 'wt-decay', label: 'Decay', min: 0.001, max: 2, default: 0.3, curve: 'exponential', unit: 's' },
  { id: 'wt-sustain', label: 'Sustain', min: 0, max: 1, default: 0.7 },
  { id: 'wt-release', label: 'Release', min: 0.005, max: 4, default: 0.3, curve: 'exponential', unit: 's' },
  { id: 'wt-filterCutoff', label: 'Cutoff', min: 0, max: 1, default: 0.8 },
  { id: 'wt-filterRes', label: 'Resonance', min: 0, max: 1, default: 0.1 },
  { id: 'wt-filterEnv', label: 'Filt Env', min: 0, max: 1, default: 0.3 },
];

class WavetableVoice implements Voice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private output: AudioNode;
  private stopTime = 0;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private waves: PeriodicWave[],
    private params: ParamDef[],
    private getParam: (id: string) => number,
  ) {
    this.output = output;
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.gainA = ctx.createGain();
    this.gainB = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    this.oscA.connect(this.gainA).connect(this.filter);
    this.oscB.connect(this.gainB).connect(this.filter);
    this.filter.connect(this.amp).connect(output);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;
    const morph = this.getParam('wt-morph');
    const attack = Math.max(0.001, this.getParam('wt-attack'));
    const decay = Math.max(0.001, this.getParam('wt-decay'));
    const sustain = this.getParam('wt-sustain');
    const release = Math.max(0.005, this.getParam('wt-release'));
    const cutoff = this.getParam('wt-filterCutoff');
    const res = this.getParam('wt-filterRes');
    const filterEnv = this.getParam('wt-filterEnv');

    // Morph position: 0..1 maps across WAVETABLES.length-1 slots
    const tableCount = this.waves.length;
    const pos = morph * (tableCount - 1);
    const idxA = Math.floor(pos);
    const idxB = Math.min(idxA + 1, tableCount - 1);
    const blend = pos - idxA;

    this.oscA.setPeriodicWave(this.waves[idxA]);
    this.oscB.setPeriodicWave(this.waves[idxB]);
    this.oscA.frequency.setValueAtTime(freq, time);
    this.oscB.frequency.setValueAtTime(freq, time);
    this.gainA.gain.setValueAtTime((1 - blend) * velMul, time);
    this.gainB.gain.setValueAtTime(blend * velMul, time);

    // Filter envelope
    const baseHz = 60 * Math.pow(220, cutoff);
    const peakHz = Math.min(baseHz * Math.pow(8, filterEnv * velMul), 18000);
    const sustainHz = baseHz + (peakHz - baseHz) * sustain;
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);
    this.filter.frequency.setValueAtTime(baseHz, time);
    this.filter.frequency.linearRampToValueAtTime(peakHz, time + attack);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(sustainHz, 40), time + attack + decay);

    // Amp envelope
    const peakAmp = 0.35 * velMul;
    const sustainAmp = Math.max(0.0001, peakAmp * sustain);
    this.amp.gain.setValueAtTime(0, time);
    this.amp.gain.linearRampToValueAtTime(peakAmp, time + attack);
    this.amp.gain.linearRampToValueAtTime(sustainAmp, time + attack + decay);

    // Release scheduling
    const releaseStart = Math.max(time + attack + decay, time + options.gateDuration);
    this.amp.gain.setValueAtTime(sustainAmp, releaseStart);
    this.amp.gain.exponentialRampToValueAtTime(0.001, releaseStart + release);
    this.filter.frequency.setValueAtTime(sustainHz, releaseStart);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(baseHz, 40), releaseStart + release);

    this.stopTime = releaseStart + release + 0.05;
    this.oscA.start(time);
    this.oscB.start(time);
    this.oscA.stop(this.stopTime);
    this.oscB.stop(this.stopTime);
  }

  release(_time: number): void {
    // Release handled via gateDuration scheduling
  }

  connect(_dest: AudioNode): void {
    // Already connected in constructor
  }

  dispose(): void {
    try { this.oscA.stop(); } catch {}
    try { this.oscB.stop(); } catch {}
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.amp.disconnect();
  }
}

class WavetableSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

class WavetableEngine implements SynthEngine {
  readonly id = 'wavetable';
  readonly name = 'Wavetable';
  readonly type = 'polyhost' as const;
  readonly polyphony = 8;
  readonly params = WAVETABLE_PARAMS;

  private waves: PeriodicWave[] = [];
  private paramValues: Record<string, number> = {};

  constructor() {
    for (const p of WAVETABLE_PARAMS) {
      this.paramValues[p.id] = p.default;
    }
  }

  setParam(id: string, value: number): void {
    this.paramValues[id] = value;
  }

  getParam(id: string): number {
    return this.paramValues[id] ?? 0;
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (this.waves.length === 0) {
      this.waves = createPeriodicWaves(ctx);
    }
    return new WavetableVoice(ctx, output, this.waves, this.params, (id) => this.getParam(id));
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new WavetableSequencer();
  }

  buildParamUI(_container: HTMLElement): void {
    // UI will be built by main.ts using params array + knob component
  }

  dispose(): void {
    this.waves = [];
  }
}

export const wavetableEngine = new WavetableEngine();
registerEngine(wavetableEngine);
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 3: Register wavetable engine in main.ts and add param UI

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import wavetable engine (side-effect)**

Add after the existing `import './engines/subtractive';` line:

```typescript
import './engines/wavetable';
```

- [ ] **Step 2: Add wavetable param knobs to the engine change handler**

The existing `engineSel.addEventListener('change', ...)` callback currently only updates `currentEngineId` and calls `dispose()` on the previous engine. Extend it to also rebuild a param panel. Find the section with the engine select change handler and replace it with:

```typescript
const engineParamContainer = document.createElement('div');
engineParamContainer.className = 'knob-row';
engineParamContainer.id = 'engine-params';
// Insert after the first poly-section row (the one with ENGINE select)
const polyPage = document.querySelector('[data-page="poly"]')!;
const firstRow = polyPage.querySelector('.poly-section')!;
firstRow.parentNode!.insertBefore(engineParamContainer, firstRow.nextSibling);

function rebuildEngineParamUI() {
  engineParamContainer.innerHTML = '';
  engineParamContainer.style.display = currentEngineId === 'subtractive' ? 'none' : '';
  const engine = getEngine(currentEngineId);
  if (!engine || currentEngineId === 'subtractive') return;
  // Build knobs for each engine param
  const wavetableEngine = engine as { setParam?: (id: string, v: number) => void; getParam?: (id: string) => number };
  for (const p of engine.params) {
    const k = createKnob({
      label: p.label,
      min: p.min,
      max: p.max,
      value: wavetableEngine.getParam?.(p.id) ?? p.default,
      curve: p.curve ?? 'linear',
    });
    k.element.addEventListener('knob-change', ((e: CustomEvent) => {
      wavetableEngine.setParam?.(p.id, e.detail.value);
    }) as EventListener);
    engineParamContainer.appendChild(k.element);
  }
}

populateEngineSelect();

engineSel.addEventListener('change', () => {
  const prev = getEngine(currentEngineId);
  if (prev) prev.dispose();
  currentEngineId = engineSel.value;
  seq.pattern.engineId = currentEngineId;
  rebuildEngineParamUI();
});
```

- [ ] **Step 3: Wire wavetable engine into the sequencer's melody trigger**

When the wavetable engine is selected, the melody steps should trigger through it instead of the polysynth. Find the section where `seq.onMelodyTrigger` is set and modify it to check `currentEngineId`:

The existing `onMelodyTrigger` is likely set up for the arpeggiator. We need to ensure that when wavetable is active, notes go through the wavetable engine's voice. The simplest approach: when currentEngineId !== 'subtractive', create a wavetable voice per trigger.

Add this logic near where `seq.onMelodyTrigger` is defined — or better, update the existing melody trigger to route through the engine:

```typescript
// In the onMelodyTrigger handler, add engine routing:
// If currentEngineId !== 'subtractive', use the engine's createVoice
```

Actually, the cleanest approach for Phase 2 is to keep using the existing polysynth trigger path for the subtractive engine, and for wavetable, create voices on-the-fly in the trigger callback. This should be done at the point where `polysynth.trigger(...)` is called.

Find where the sequencer calls `polysynth.trigger(n, time, gate, mel.accent)` — this is in `scheduleStep()` in sequencer.ts, or via the `onMelodyTrigger` callback. The simplest integration: set `seq.onMelodyTrigger` to route to the active engine.

After the `rebuildEngineParamUI()` function, add:

```typescript
function triggerActiveEngine(note: number, time: number, gate: number, accent: boolean) {
  if (currentEngineId === 'subtractive') {
    polysynth.trigger(note, time, gate, accent);
  } else {
    const engine = getEngine(currentEngineId);
    if (engine) {
      const voice = engine.createVoice(ctx, polyStrip.input);
      voice.trigger(note, time, { gateDuration: gate, accent });
    }
  }
}
```

Then update the `seq.onMelodyTrigger` assignment to use this function. Find where it's currently set (it may be used by the arpeggiator). The arpeggiator likely already sets `seq.onMelodyTrigger`. We need to ensure the arp's output also goes through the engine.

The safest approach: find where `polysynth.trigger` is called inside the arpeggiator's output and replace/wrap it with `triggerActiveEngine`.

- [ ] **Step 4: Verify typecheck and test in browser**

Run: `npx tsc --noEmit`
Then: `npm run dev` and verify:
1. Engine selector shows "Subtractive" and "Wavetable" 
2. Selecting "Wavetable" shows morph/attack/decay/sustain/release/cutoff/resonance/filtenv knobs
3. Playing a melody triggers wavetable voices with audible morph between waveforms
4. Switching back to "Subtractive" restores normal behavior

---

### Task 4: Verify integration end-to-end

**Files:**
- No new files

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 2: Manual browser test**

Start dev server and verify:
1. Engine dropdown shows both options
2. Wavetable engine produces sound when melody steps trigger
3. Morph knob audibly changes the waveform character
4. All existing functionality (bass, drums, subtractive poly) still works
5. Pattern slot switching preserves engineId

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: Builds successfully
