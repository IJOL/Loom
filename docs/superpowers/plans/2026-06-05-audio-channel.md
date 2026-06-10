# Audio Channel Implementation Plan

> **⚠️ STATUS 2026-06-10 — read before treating any checkbox as TODO.** The core
> shipped (the registered `audio` engine, the shared `audio-clip-voice` helper, the
> waveform header + Warp toggle, `clip-editor-loop.ts` deleted). **Mode 2's "✂ Slice
> → pads" button on the audio-clip editor (Tasks C1/C2/D1/D2) was deliberately
> REVERTED** — unit + e2e now ASSERT that button is ABSENT. A slice→bank path does
> exist, but on the **Sampler-import** side (`session-host.ts` `importLoopToSampler`),
> not as the audio-editor button this plan describes. What's genuinely OUTSTANDING is
> only the **product decision** (one-shot WSOLA vs sliced→bank as the default
> direction) — see [REMAINING-WORK.md](../REMAINING-WORK.md). The task list below is
> the pre-revert design, kept for rationale; do not re-implement the slice button.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class **audio channel** to Loom — drop a WAV and it plays tempo-locked without altering pitch (Mode 1), or slice it into bank samples + a normal note clip (Mode 2) — with the waveform shown as a header above the normal editor.

**Architecture:** A new registered `audio` engine plays a clip's `ClipSample` buffer WSOLA-adapted to the session tempo, reusing the existing `timestretch` + `stretch-cache` + lane-scheduler `clip.sample` path. The buffer-playback code is extracted from the Sampler into a shared `audio-clip-voice` helper so there is no duplication. Mode 2 cuts the loop with the existing `sliceBuffer`, stores each slice in the sample bank, and builds a plain note clip on a Sampler lane (the normal keymap one-shot path). The waveform is a header mounted above the normal clip editor; the old special-case loop editor is deleted.

**Tech Stack:** TypeScript, Web Audio API, Vite, Vitest (unit + `node-web-audio-api` DSP renders), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-05-audio-channel-design.md` (commit `a5bf12a`).

---

## Background the implementer needs

- Loom is a clip-grid workstation: **lanes** (columns) play **clips** in **scenes** (rows). Every `SessionLane` has an `engineId` that must resolve to a **registered engine** (see [src/engines/registry.ts](src/engines/registry.ts)). Engines are auto-discovered at build time by an `import.meta.glob('../engines/*.ts')` scan ([src/app/plugin-bootstrap.ts](src/app/plugin-bootstrap.ts)); a new `src/engines/audio.ts` that calls `registerEngine` + `registerEngineFactory` at module top level is registered automatically — **no edit to plugin-bootstrap or lane-allocator is needed**.
- A clip with `clip.sample` (a `ClipSample`) is an **audio clip**: the lane-scheduler ([src/core/lane-scheduler.ts](src/core/lane-scheduler.ts) `tickLane`) already fires **one buffer trigger per loop iteration** when `clip.sample` is present and it is not slice-mode. The trigger flows `tickSession → triggerForLane → engine.createVoice().trigger(midi, time, { sample, gateDuration })`. So Mode 1 needs only an engine whose voice plays `opts.sample`.
- WSOLA time-stretch already exists: [src/samples/timestretch.ts](src/samples/timestretch.ts) `stretchBuffer(ctx, buffer, ratio)` (pitch-preserved) + [src/samples/stretch-cache.ts](src/samples/stretch-cache.ts) (`get`/`ensure`). The BPM broadcaster re-renders stretch buffers on tempo change for any `mode:'loop', warp:true, warpMode:'stretch'` clip ([src/app/stretch-resync.ts](src/app/stretch-resync.ts) `collectStretchJobs` + [src/app/bpm-broadcast.ts](src/app/bpm-broadcast.ts)) — so this works for audio-channel clips for free.
- The Sampler's loop/song playback lives in `SamplerVoice.triggerSample` ([src/engines/sampler.ts:155-209](src/engines/sampler.ts#L155-L209)). We extract its body into a shared helper and have both the Sampler and the new audio engine call it.
- **Test convention:** assertions are **relative** (ratios/correlation), never absolute magnitudes. DSP renders use `node-web-audio-api` (globalised in [test/setup.ts](test/setup.ts)); files end in `.dsp.test.ts`. Run a single file with `NO_COLOR=1 npx vitest run path/to/file.test.ts`. Canvas in jsdom: `getContext` returns null, so stub it with a no-op `Proxy` (pattern in the existing [src/session/clip-editors/clip-editor-loop.test.ts](src/session/clip-editors/clip-editor-loop.test.ts)).
- **e2e serves the built `dist/`** with no build step — always `npm run build` before `npm run test:e2e`.

## File Structure

**New:**
| File | Responsibility |
|------|----------------|
| `src/engines/audio-clip-voice.ts` | Shared loop/song buffer playback (`playAudioClip`) + `OUTPUT_TRIM`. Used by Sampler **and** audio engine. |
| `src/engines/audio.ts` | The `audio` engine + `AudioVoice` (plays only `clip.sample`). Registers itself. |
| `src/core/scene-ensure.ts` | `ensureScenesForRows(state)` — appends scenes so every clip row has a launch button. |
| `src/samples/slice-to-bank.ts` | `slicesToKeymap()` (pure) + `audioBufferToWavBytes()` — Mode 2 helpers. |
| `src/session/clip-editors/clip-waveform-header.ts` | `mountWaveformHeader()` (waveform + ruler + slice markers) and `renderAudioClipEditor()` (waveform-only audio-clip editor + "Slice → pads"). |
| `src/engines/audio.dsp.test.ts` | Real-path render through the audio engine + `tickLane`. |
| `tests/e2e/audio-channel.spec.ts` | Playwright demo: add an audio channel, see it launchable, slice it. |

**Changed:**
| File | Change |
|------|--------|
| `src/session/session.ts` | `audioChannelClip()` builder; `waveformRef?` field on `SessionClip`. |
| `src/engines/sampler.ts` | `triggerSample` delegates to `playAudioClip`; import shared `OUTPUT_TRIM`; remove the "Import as loop" UI row. |
| `src/core/lane-scheduler.ts` (cleanup phase) | remove the slice-mode branch + `slice` from `onTrigger`. |
| `src/app/trigger-dispatch.ts`, `src/session/session-runtime.ts`, `src/session/session-host.ts`, `src/session/session-inspector.ts`, `src/session/clip-editors/clip-editor-router.ts`, `src/engines/engine-types.ts` (cleanup phase) | drop the `slice` threading / `opts.slice`. |
| `src/session/session-ui.ts` | accept audio-file drop on `audio` lanes too. |
| `src/session/session-tab-bar.ts` | "+ Audio" button + file input; hide `audio` from the generic engine dropdown. |
| `src/export/preload-scene-samples.ts` | `collectSampleIds` also collects `clip.waveformRef.sampleId`. |
| `src/session/clip-editors/clip-editor-router.ts` | route audio lanes to `renderAudioClipEditor`; mount the waveform header above the normal editor; remove `isSliceLoopClip`/`renderLoopEditor`. |
| `docs/manual/*`, `README.md` (Phase F) | document the audio channel. |

**Deleted:**
| File | Why |
|------|-----|
| `src/session/clip-editors/clip-editor-loop.ts` + `.test.ts` | the duplicate note editor — replaced by the waveform header on the normal editor. |
| `src/session/session-sliced-loop.test.ts` + `slicedLoopClip` (cleanup phase) | the clip-local slice model is superseded by slices→bank. |
| `src/core/lane-scheduler-slice.test.ts`, `src/engines/sampler-slice.dsp.test.ts` (cleanup phase) | cover the retired `opts.slice` path. |

---

## Phase A — `audio` engine + shared voice + clip model + persistence

### Task A1: Extract the shared audio-clip playback helper

**Files:**
- Create: `src/engines/audio-clip-voice.ts`
- Test: `src/engines/audio-clip-voice.dsp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/engines/audio-clip-voice.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { playAudioClip, OUTPUT_TRIM } from './audio-clip-voice';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('playAudioClip', () => {
  it('plays a cached loop buffer (non-silent) and returns a started source', async () => {
    expect(OUTPUT_TRIM).toBeGreaterThan(0);
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.0 * sr), sr);
    sampleCache.put('smp-a1', tone(render, 1.0, 220));
    const amp = render.createGain();
    amp.connect(render.destination as unknown as AudioNode);
    const r = playAudioClip({
      ctx: render as unknown as AudioContext,
      sample: { sampleId: 'smp-a1', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
      time: 0, gateDuration: 1.0, dest: amp, ampGain: amp, masterGain: 1,
    });
    expect(r).not.toBeNull();
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });

  it('returns null when the buffer is not cached', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    const amp = render.createGain();
    const r = playAudioClip({
      ctx: render as unknown as AudioContext,
      sample: { sampleId: 'missing', mode: 'loop', trimStart: 0, trimEnd: 1 },
      time: 0, gateDuration: 1, dest: amp, ampGain: amp, masterGain: 1,
    });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/audio-clip-voice.dsp.test.ts`
Expected: FAIL — `Cannot find module './audio-clip-voice'`.

- [ ] **Step 3: Create the helper (body copied verbatim from `SamplerVoice.triggerSample`)**

```ts
// src/engines/audio-clip-voice.ts
// Shared loop/song buffer playback — extracted from SamplerVoice.triggerSample so
// the Sampler and the dedicated `audio` engine play audio clips through ONE path.
// WSOLA-stretches warp:stretch loops (pitch preserved) via stretchCache, with a
// varispeed fallback that self-heals the cache for the next iteration. Flat gain
// with ~5 ms anti-click fades — no ADSR.

import type { ClipSample } from '../session/session';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';
import { stretchBuffer } from '../samples/timestretch';

/** Headroom so a full-scale sample stays < 0 dBFS. */
export const OUTPUT_TRIM = 0.7;

export interface AudioClipPlayback { src: AudioBufferSourceNode; endTime: number; }

export function playAudioClip(opts: {
  ctx: AudioContext;
  sample: ClipSample;
  time: number;
  gateDuration: number;
  dest: AudioNode;     // where the source connects (e.g. a filter or amp input)
  ampGain: GainNode;   // gain node the flat envelope is scheduled on
  masterGain: number;  // engine 'gain' global
}): AudioClipPlayback | null {
  const { ctx, sample, time, gateDuration, dest, ampGain, masterGain } = opts;
  const buf = sampleCache.get(sample.sampleId);
  if (!buf) return null;

  const trimStart = Math.max(0, sample.trimStart);
  const trimEnd = sample.trimEnd > trimStart ? Math.min(sample.trimEnd, buf.duration) : buf.duration;
  const region = Math.max(0.001, trimEnd - trimStart);
  const gate = Math.max(0.001, gateDuration);

  const src = ctx.createBufferSource();
  const wantStretch = sample.mode === 'loop' && sample.warp && sample.warpMode === 'stretch';
  const ratio = gate / region;
  const stretched = wantStretch ? stretchCache.get(sample.sampleId, ratio) : undefined;
  if (stretched) {
    src.buffer = stretched;
    src.playbackRate.value = 1; // pitch preserved; buffer already fills the gate
  } else {
    src.buffer = buf;
    src.playbackRate.value = sample.mode === 'loop' ? region / gate : 1;
    if (wantStretch) {
      void stretchCache.ensure(sample.sampleId, ratio, () => stretchBuffer(ctx, buf, ratio));
    }
  }
  src.connect(dest);

  const peak = masterGain * (sample.gain ?? 1) * OUTPUT_TRIM;
  const fade = Math.min(0.005, gate / 4);
  const g = ampGain.gain;
  g.cancelScheduledValues(time);
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(peak, time + fade);
  g.setValueAtTime(peak, Math.max(time + fade, time + gate - fade));
  g.linearRampToValueAtTime(0, time + gate);

  const endTime = time + gate + 0.01;
  src.start(time, stretched ? 0 : trimStart);
  src.stop(endTime);
  return { src, endTime };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/audio-clip-voice.dsp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/audio-clip-voice.ts src/engines/audio-clip-voice.dsp.test.ts
git commit -m "feat(audio): shared audio-clip playback helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A2: Sampler delegates to the shared helper (no behaviour change)

**Files:**
- Modify: `src/engines/sampler.ts` (`OUTPUT_TRIM` const ~line 50; `triggerSample` ~lines 155-209)

- [ ] **Step 1: Run the existing sampler stretch/loop tests to capture green baseline**

Run: `NO_COLOR=1 npx vitest run src/engines/sampler-stretch.dsp.test.ts src/engines/sampler-loop.dsp.test.ts`
Expected: PASS (these guard the behaviour we must preserve).

- [ ] **Step 2: Replace the local `OUTPUT_TRIM` with the shared one**

In `src/engines/sampler.ts`, delete the line:
```ts
const OUTPUT_TRIM = 0.7; // headroom so a full-scale sample + resonance stays < 0 dBFS
```
and add to the imports near the top (after the existing `slicedLoopClip` import):
```ts
import { playAudioClip, OUTPUT_TRIM } from './audio-clip-voice';
```

- [ ] **Step 3: Rewrite `triggerSample` to delegate**

Replace the whole `private triggerSample(...)` method body with:
```ts
  /** Loop/song path: delegates to the shared audio-clip playback helper, then
   *  sets a neutral (wide-open) filter so audio clips aren't coloured. */
  private triggerSample(time: number, opts: VoiceTriggerOptions): void {
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    // Neutral filter for audio clips (filter wide open, flat gain).
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, PAD_DEFAULTS.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + PAD_DEFAULTS.res * 20, time);

    const r = playAudioClip({
      ctx: this.ctx,
      sample: opts.sample!,
      time,
      gateDuration: opts.gateDuration,
      dest: this.filter,
      ampGain: this.ampGain,
      masterGain: this.api.getGlobal('gain'),
    });
    if (!r) return;
    this.src = r.src;
    this.endTime = r.endTime;
    this.started = true;
  }
```

- [ ] **Step 4: Typecheck + re-run the sampler tests (must stay green)**

Run: `npx tsc --noEmit`
Run: `NO_COLOR=1 npx vitest run src/engines/sampler-stretch.dsp.test.ts src/engines/sampler-loop.dsp.test.ts src/engines/sampler.dsp.test.ts`
Expected: tsc clean; all PASS (behaviour preserved).

- [ ] **Step 5: Commit**

```bash
git add src/engines/sampler.ts
git commit -m "refactor(sampler): play loop/song clips via shared audio-clip helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A3: The `audio` engine

**Files:**
- Create: `src/engines/audio.ts`
- Test: `src/engines/audio.dsp.test.ts` (extended in Task B5 — start it here)

- [ ] **Step 1: Write the failing test**

```ts
// src/engines/audio.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from './audio';
import { createEngineInstance, getEngine } from './registry';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('audio engine', () => {
  it('is registered under id "audio" via factory', () => {
    expect(getEngine('audio')?.id).toBe('audio');
    expect(createEngineInstance('audio')?.id).toBe('audio');
  });

  it('plays a clip sample buffer (non-silent)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.0 * sr), sr);
    sampleCache.put('smp-au', tone(render, 1.0, 220));
    const engine = new AudioEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(60, 0, {
      gateDuration: 1.0,
      sample: { sampleId: 'smp-au', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/audio.dsp.test.ts`
Expected: FAIL — `Cannot find module './audio'`.

- [ ] **Step 3: Create the engine**

```ts
// src/engines/audio.ts
// The dedicated audio channel engine. Plays ONLY a clip's ClipSample buffer
// (whole loop/song) WSOLA-adapted to the session tempo via the shared
// audio-clip-voice helper. No keymap, no notes, no synthesis params beyond Gain.

import type { SynthEngine, Voice, EngineSequencer, EngineUIContext, VoiceTriggerOptions } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { wireEngineParams } from './engine-ui';
import { playAudioClip } from './audio-clip-voice';

const AUDIO_PARAMS: EngineParamSpec[] = [
  { id: 'gain', label: 'Gain', kind: 'continuous', min: 0, max: 1.5, default: 1 },
];

class AudioSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

class AudioVoice implements Voice {
  private readonly amp: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private started = false;
  private endTime = Infinity;

  constructor(private ctx: AudioContext, output: AudioNode, private getGain: () => number) {
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(output);
  }

  trigger(_midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (!opts.sample) return; // audio engine only plays clip samples
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    const r = playAudioClip({
      ctx: this.ctx, sample: opts.sample, time, gateDuration: opts.gateDuration,
      dest: this.amp, ampGain: this.amp, masterGain: this.getGain(),
    });
    if (!r) return;
    this.src = r.src;
    this.endTime = r.endTime;
    this.started = true;
  }

  release(time: number): void {
    const g = this.amp.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + 0.005);
    if (this.src && this.started && time + 0.02 < this.endTime) {
      try { this.src.stop(time + 0.02); } catch { /* already stopped */ }
    }
  }

  connect(_dest: AudioNode): void { /* already connected to output */ }
  getAudioParams(): Map<string, AudioParam> { return new Map([['gain', this.amp.gain]]); }
  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.amp.disconnect();
  }
}

export class AudioEngine implements SynthEngine {
  readonly id = 'audio';
  readonly name = 'Audio';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = AUDIO_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];
  private modHost = new ModulationHostImpl([]);
  private values: Record<string, number> = { gain: 1 };

  get modulators(): ModulationHostImpl { return this.modHost; }
  getBaseValue(id: string): number { return this.values[id] ?? 0; }
  setBaseValue(id: string, v: number): void { this.values[id] = v; }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new AudioVoice(ctx, output, () => this.getBaseValue('gain'));
  }
  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new AudioSequencer(); }
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;
    const row = document.createElement('div');
    row.className = 'knob-row';
    container.appendChild(row);
    wireEngineParams(this, ctx, row, { filter: (id) => id === 'gain' });
  }
  applyPreset(): void { /* audio clips have no presets */ }
  dispose(): void { /* no shared resources */ }
}

export const audioEngine = new AudioEngine();
registerEngine(audioEngine);
registerEngineFactory('audio', () => new AudioEngine());
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/engines/audio.dsp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/audio.ts src/engines/audio.dsp.test.ts
git commit -m "feat(audio): dedicated audio-channel engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A4: `audioChannelClip()` builder + `waveformRef` field

**Files:**
- Modify: `src/session/session.ts` (`SessionClip` interface ~lines 42-62; add builder after `audioClip` ~line 150)
- Test: `src/session/audio-channel-clip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/session/audio-channel-clip.test.ts
import { describe, it, expect } from 'vitest';
import { audioChannelClip } from './session';
import { DEFAULT_METER } from '../core/meter';

describe('audioChannelClip', () => {
  it('builds a warp:stretch loop clip with bar-count length and no notes', () => {
    // 120 BPM, 4/4 → one bar = 2s. A 4s loop = 2 bars.
    const clip = audioChannelClip({
      name: 'beat', sampleId: 'smp-x', durationSec: 4, originalBpm: 120, projectMeter: DEFAULT_METER,
    });
    expect(clip.notes).toEqual([]);
    expect(clip.lengthBars).toBe(2);
    expect(clip.sample?.mode).toBe('loop');
    expect(clip.sample?.warp).toBe(true);
    expect(clip.sample?.warpMode).toBe('stretch');
    expect(clip.sample?.originalBpm).toBe(120);
    expect(clip.sample?.trimStart).toBe(0);
    expect(clip.sample?.trimEnd).toBe(4);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/session/audio-channel-clip.test.ts`
Expected: FAIL — `audioChannelClip is not a function`.

- [ ] **Step 3: Add the `waveformRef` field to `SessionClip`**

In `src/session/session.ts`, inside the `SessionClip` interface, after the `sample?: ClipSample;` field add:
```ts
  /** Display-only source buffer for the waveform header (Mode-2 sliced clips
   *  whose audio now lives in the bank keymap). The scheduler IGNORES this — it
   *  is purely for the editor's waveform strip. Absent ⇒ no header. */
  waveformRef?: { sampleId: string };
```

- [ ] **Step 4: Add the builder (next to `audioClip`)**

In `src/session/session.ts`, after the `audioClip(...)` function, add:
```ts
/** Build an audio-channel clip: a whole-loop ClipSample warped to the session
 *  tempo via pitch-preserving WSOLA. lengthBars = whole-bar count at the loop's
 *  native BPM, so at that BPM it plays near-identical to the source. */
export function audioChannelClip(opts: {
  name: string;
  sampleId: string;
  durationSec: number;
  originalBpm: number;
  projectMeter: import('../core/meter').TimeSignature;
}): SessionClip {
  const lengthBars = barCountFor(opts.durationSec, opts.originalBpm, opts.projectMeter);
  return {
    id: nextId('clip'),
    name: opts.name,
    color: pickRandomClipColor(),
    lengthBars,
    notes: [],
    sample: {
      sampleId: opts.sampleId,
      mode: 'loop',
      originalBpm: opts.originalBpm,
      warp: true,
      warpMode: 'stretch',
      trimStart: 0,
      trimEnd: opts.durationSec,
      gain: 1,
    },
  };
}
```
Add the import at the top of `session.ts` (it currently imports only `NoteEvent`):
```ts
import { barCountFor } from '../core/slice-clip';
```

- [ ] **Step 5: Run the test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/audio-channel-clip.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS; tsc clean.

> Note: `core/slice-clip.ts` imports `LoopSlice` from `session.ts`, and `session.ts` will now import `barCountFor` from `slice-clip.ts`. This is a value/type cycle that Vite + tsc handle (type-only one direction, function the other), but if `tsc` reports a circular-init error, instead inline the one-line body: `const barSec = quartersPerBar(opts.projectMeter) * (60 / opts.originalBpm); const lengthBars = Math.max(1, Math.round(opts.durationSec / barSec));` and import `quartersPerBar` from `../core/meter`.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/session/audio-channel-clip.test.ts
git commit -m "feat(audio): audioChannelClip builder + waveformRef clip field

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A5: Persistence — hydrate audio buffers on load; collect `waveformRef`

**Files:**
- Modify: `src/export/preload-scene-samples.ts` (`collectSampleIds` ~lines 13-24)
- Modify: `src/session/session-host.ts` (`applyLoadedSessionState` ~line 285, after `renderWithMixer()`)
- Test: `src/export/preload-scene-samples.test.ts` (add a case)

- [ ] **Step 1: Add the failing test case**

In `src/export/preload-scene-samples.test.ts`, add inside the `describe('collectSampleIds', ...)`:
```ts
  it('includes clip.sample and clip.waveformRef sampleIds', () => {
    const lanes = [{
      id: 'a', engineId: 'audio', clips: [
        { id: 'c1', lengthBars: 1, notes: [], sample: { sampleId: 'smp-clip', mode: 'loop', trimStart: 0, trimEnd: 1 } },
        { id: 'c2', lengthBars: 1, notes: [], waveformRef: { sampleId: 'smp-wave' } },
      ],
    }] as unknown as import('../session/session').SessionLane[];
    const ids = collectSampleIds(lanes);
    expect(ids.has('smp-clip')).toBe(true);
    expect(ids.has('smp-wave')).toBe(true);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/export/preload-scene-samples.test.ts`
Expected: FAIL — `smp-wave` not collected.

- [ ] **Step 3: Collect `waveformRef` in `collectSampleIds`**

In `src/export/preload-scene-samples.ts`, inside the `for (const clip of lane.clips)` loop, after the existing `if (clip?.sample?.sampleId) ids.add(clip.sample.sampleId);` add:
```ts
      if (clip?.waveformRef?.sampleId) ids.add(clip.waveformRef.sampleId);
```

- [ ] **Step 4: Hydrate sample buffers when a session loads**

In `src/session/session-host.ts`, add the import near the top (with the other `../samples` imports):
```ts
import { preloadSceneSamples } from '../export/preload-scene-samples';
```
Then in `applyLoadedSessionState`, immediately after `this.renderWithMixer();` (before `this._fireStateApplied();`) add:
```ts
    // Decode every referenced audio buffer (audio clips, sampler keymaps, slice
    // banks) into the cache so loaded sessions sound on first Play, not just on
    // offline export. Fire-and-forget: editors render regardless; audio comes
    // alive once decode resolves.
    void preloadSceneSamples(this.deps.ctx, this.state.lanes);
```

- [ ] **Step 5: Run the test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/export/preload-scene-samples.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/export/preload-scene-samples.ts src/export/preload-scene-samples.test.ts src/session/session-host.ts
git commit -m "feat(audio): hydrate sample buffers on session load (incl. waveformRef)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — Mode 1: drop WAV → sounds adapted to tempo + scene fix

### Task B1: `ensureScenesForRows` helper (the scene-play-button fix)

**Files:**
- Create: `src/core/scene-ensure.ts`
- Test: `src/core/scene-ensure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/scene-ensure.test.ts
import { describe, it, expect } from 'vitest';
import { ensureScenesForRows } from './scene-ensure';
import { emptySessionState, emptyClip } from '../session/session';

describe('ensureScenesForRows', () => {
  it('appends scenes so every clip row has one (returns true when it added)', () => {
    const s = emptySessionState();
    s.lanes[0].clips = [emptyClip(1), emptyClip(1), emptyClip(1)]; // 3 rows, 0 scenes
    expect(s.scenes.length).toBe(0);
    const added = ensureScenesForRows(s);
    expect(added).toBe(true);
    expect(s.scenes.length).toBe(3);
  });

  it('is a no-op when scenes already cover every row (returns false)', () => {
    const s = emptySessionState();
    s.lanes[0].clips = [emptyClip(1)];
    ensureScenesForRows(s);
    const added = ensureScenesForRows(s);
    expect(added).toBe(false);
    expect(s.scenes.length).toBe(1);
  });

  it('does not remove existing extra scenes', () => {
    const s = emptySessionState();
    s.scenes = [{ id: 'x', name: 'A', clipPerLane: {} }, { id: 'y', name: 'B', clipPerLane: {} }];
    s.lanes[0].clips = [emptyClip(1)]; // only 1 clip row, but 2 scenes exist
    const added = ensureScenesForRows(s);
    expect(added).toBe(false);
    expect(s.scenes.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/core/scene-ensure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

```ts
// src/core/scene-ensure.ts
// Append scenes so every clip row across all lanes has a launchable scene
// (and therefore a play button in the grid). The grid renders a scene-launch
// button only for rows that have a state.scenes[r], so adding a lane / dropping
// a loop without this leaves the row un-launchable. Mutates state in place.

import type { SessionState } from '../session/session';

export function ensureScenesForRows(state: SessionState): boolean {
  let maxClipRows = 0;
  for (const lane of state.lanes) maxClipRows = Math.max(maxClipRows, lane.clips.length);
  let added = false;
  while (state.scenes.length < maxClipRows) {
    state.scenes.push({
      id: `scene-${Date.now().toString(36)}-${state.scenes.length}`,
      name: `Scene ${state.scenes.length + 1}`,
      clipPerLane: {},
    });
    added = true;
  }
  return added;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/core/scene-ensure.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/scene-ensure.ts src/core/scene-ensure.test.ts
git commit -m "feat(session): ensureScenesForRows — every clip row gets a launch button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B2: Call `ensureScenesForRows` from `onAddLane` and stem lanes

**Files:**
- Modify: `src/session/session-host.ts` (`onAddLane` ~lines 558-584; `onAddStemLanes` ~lines 588-616)

- [ ] **Step 1: Import the helper**

In `src/session/session-host.ts`, add near the other `../core` imports:
```ts
import { ensureScenesForRows } from '../core/scene-ensure';
```

- [ ] **Step 2: Call it in `onAddLane`**

In `onAddLane`'s `run` closure, replace `self.deps.ensureLaneResource?.(newId, engineId);` ... `self.renderWithMixer();` tail so it reads:
```ts
          self.deps.ensureLaneResource?.(newId, engineId);
          ensureScenesForRows(self.state);
          self.renderWithMixer();
```

- [ ] **Step 3: Call it in `onAddStemLanes`**

In `onAddStemLanes`'s `run` closure, just before the final `self.renderWithMixer();`, add:
```ts
          ensureScenesForRows(self.state);
```

- [ ] **Step 4: Build + run the full unit suite (no regressions)**

Run: `npx tsc --noEmit`
Run: `npm run test:unit`
Expected: tsc clean; suite green (a flaky `ERR_IPC_CHANNEL_CLOSED` on teardown is not a failure — re-run to confirm).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "fix(session): adding a lane creates its scene launch button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B3: `onAddAudioChannel` — the immediate WAV → audio channel path

**Files:**
- Modify: `src/session/session-tab-bar.ts` (add "+ Audio" input + button)
- Modify: `src/session/session-host.ts` (new callback; `refreshSynthTabs` wiring)
- Modify: `src/session/session-ui.ts` (`SessionUICallbacks` — add `onAddAudioChannel?`)

- [ ] **Step 1: Add the callback type to `SessionUICallbacks`**

In `src/session/session-ui.ts`, inside `SessionUICallbacks`, add:
```ts
  /** A WAV was chosen via the "+ Audio" control: create an audio-channel lane. */
  onAddAudioChannel?: (file: File) => void;
```

- [ ] **Step 2: Add the "+ Audio" control to the tab bar**

In `src/session/session-tab-bar.ts`, extend `SessionTabBarDeps`:
```ts
  onAddAudioChannel?: (file: File) => void;
```
and before `host.appendChild(adder);` (the trailing block), add a second adder:
```ts
  if (deps.onAddAudioChannel) {
    const audioAdder = document.createElement('span');
    audioAdder.className = 'session-tabs-add-audio';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.className = 'session-add-audio-input';
    fileInput.style.display = 'none';
    const audioBtn = document.createElement('button');
    audioBtn.className = 'tab session-add-audio-btn';
    audioBtn.textContent = '+ Audio';
    audioBtn.title = 'Drop a WAV loop as a tempo-locked audio channel';
    audioBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) deps.onAddAudioChannel!(f);
      fileInput.value = '';
    });
    audioAdder.append(fileInput, audioBtn);
    host.appendChild(audioAdder);
  }
```
> Place this AFTER the existing `host.appendChild(adder);` line.

- [ ] **Step 3: Filter `audio` out of the generic engine dropdown**

In `src/session/session-tab-bar.ts`, change the dropdown population loop:
```ts
  for (const engine of listEngines('polyhost')) {
```
to:
```ts
  for (const engine of listEngines('polyhost')) {
    if (engine.id === 'audio') continue; // audio lanes are created via "+ Audio"
```
(keep the rest of the loop body unchanged).

- [ ] **Step 4: Wire `onAddAudioChannel` through `refreshSynthTabs`**

In `src/session/session-host.ts` `refreshSynthTabs`, change the `renderSessionTabBar(host, {...})` call to also pass:
```ts
      onAddAudioChannel: (file) => this.callbacks.onAddAudioChannel?.(file),
```

- [ ] **Step 5: Implement the `onAddAudioChannel` callback**

In `src/session/session-host.ts`, add `audioChannelClip` to the **existing** `import { ... } from './session';` list (do NOT add a second `./session` import line), and add this new import:
```ts
import { detectLoop } from '../samples/loop-analysis';
```

Then add to the `this.callbacks = { ... }` object (e.g. after `onCellDropAudio`):
```ts
      onAddAudioChannel(file: File) {
        void ctx.resume();
        void (async () => {
          try {
            const asset = await importFile(file, ctx);
            await sampleStore.put(asset);
            const buf = await ctx.decodeAudioData(asset.bytes.slice(0));
            sampleCache.put(asset.id, buf);
            const det = detectLoop(buf, seq.meter);
            const name = file.name.replace(/\.[^.]+$/, '');
            const clip = audioChannelClip({
              name, sampleId: asset.id, durationSec: buf.duration,
              originalBpm: det.originalBpm, projectMeter: seq.meter,
            });
            const hd = self.deps.historyDeps;
            const run = () => {
              const used = new Set(self.state.lanes.map((l) => l.id));
              const newId = nextLaneSlug(used, 'audio');
              const lane = emptyLane(newId, 'audio');
              lane.name = name;
              const rows = Math.max(self.state.scenes.length, 1);
              const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
              for (let r = 0; r < rows; r++) lane.clips.push(r === 0 ? clip : emptyClip(defaultLen));
              self.state.lanes.push(lane);
              self.laneStates.set(newId, emptyLanePlayState(newId));
              self.deps.ensureLaneResource?.(newId, 'audio');
              ensureScenesForRows(self.state);
              self.inspector.setSelectedClip({ laneId: newId, clipIdx: 0 });
              self.inspector.openInspector();
              self.renderWithMixer();
            };
            if (hd) withUndo(hd, run); else run();
          } catch (err) {
            console.warn('Audio channel: could not load loop:', err);
          }
        })();
      },
```
> `nextLaneSlug` falls through to `engineId` for `'audio'` → ids like `audio-1`, `audio-2`. No change needed there.

- [ ] **Step 6: Build + typecheck**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: clean (this path is verified end-to-end by the Playwright test in Phase E).

- [ ] **Step 7: Commit**

```bash
git add src/session/session-tab-bar.ts src/session/session-host.ts src/session/session-ui.ts
git commit -m "feat(audio): + Audio control creates a tempo-locked audio channel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B4: Accept WAV drop onto `audio` lane cells

**Files:**
- Modify: `src/session/session-ui.ts` (`clipCell` drop guard ~line 193)
- Modify: `src/session/session-host.ts` (`onCellDropAudio` ~lines 506-531; `onCellClick` ~lines 491-505)

- [ ] **Step 1: Allow file drop on audio lanes (grid)**

In `src/session/session-ui.ts` `clipCell`, change:
```ts
  if (lane.engineId === 'sampler' && cb.onCellDropAudio) {
```
to:
```ts
  if ((lane.engineId === 'sampler' || lane.engineId === 'audio') && cb.onCellDropAudio) {
```

- [ ] **Step 2: Branch `onCellDropAudio` for audio lanes**

In `src/session/session-host.ts` `onCellDropAudio`, change the guard + clip build. Replace:
```ts
        if (!lane || lane.engineId !== 'sampler') return;
```
with:
```ts
        if (!lane || (lane.engineId !== 'sampler' && lane.engineId !== 'audio')) return;
```
and replace the clip construction line:
```ts
            const clip = audioClip({ name, sampleId: asset.id, durationSec: buf.duration, bpm: seq.bpm });
```
with:
```ts
            const clip = lane.engineId === 'audio'
              ? audioChannelClip({
                  name, sampleId: asset.id, durationSec: buf.duration,
                  originalBpm: detectLoop(buf, seq.meter).originalBpm, projectMeter: seq.meter,
                })
              : audioClip({ name, sampleId: asset.id, durationSec: buf.duration, bpm: seq.bpm });
```
and inside the `run` closure of `onCellDropAudio`, before `self.renderWithMixer();`, add:
```ts
              ensureScenesForRows(self.state);
```

- [ ] **Step 3: Make empty-cell clicks on an audio lane a no-op**

In `src/session/session-host.ts` `onCellClick`, at the top of the function after `if (!lane) return;` add:
```ts
        if (lane.engineId === 'audio') return; // audio cells are filled by dropping a WAV
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-ui.ts src/session/session-host.ts
git commit -m "feat(audio): drop a WAV onto an audio lane cell → audio-channel clip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B5: Real-path render test — green means audible

**Files:**
- Modify: `src/engines/audio.dsp.test.ts` (add the scheduler-path cases)

- [ ] **Step 1: Add the failing real-path tests**

Append to `src/engines/audio.dsp.test.ts`:
```ts
import { AudioEngine as _AE } from './audio'; // already imported above; keep one import
import { tickLane } from '../core/lane-scheduler';
import { stretchCache } from '../samples/stretch-cache';
import { audioChannelClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

/** Drive tickLane across the whole render, firing each audio trigger into the
 *  engine voice — the SAME path the live transport uses (engine + scheduler). */
async function renderViaScheduler(opts: {
  durationSec: number; bpm: number; sampleId: string;
  loopDurSec: number; originalBpm: number; preStretch?: boolean;
}): Promise<AudioBuffer> {
  const sr = 44100;
  const render = new OfflineAudioContext(1, Math.ceil(opts.durationSec * sr), sr);
  const engine = new AudioEngine();
  const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
  const clip = audioChannelClip({
    name: 'l', sampleId: opts.sampleId, durationSec: opts.loopDurSec,
    originalBpm: opts.originalBpm, projectMeter: DEFAULT_METER,
  });
  // Walk the look-ahead window across the render in scheduler-sized steps.
  const tick = 0.025, look = 0.12;
  let loopStartedAt = 0, lastScheduledAt = -Infinity;
  for (let now = 0; now < opts.durationSec; now += tick) {
    loopStartedAt = tickLane(clip, {
      bpm: opts.bpm, lookaheadSec: look, now, loopStartedAt, lastScheduledAt,
      meter: DEFAULT_METER,
      onTrigger: (note, when) => {
        voice.trigger(note.midi, when, { gateDuration: (note.duration / 96) * (60 / opts.bpm), sample: note.sample });
        lastScheduledAt = when;
      },
      onAutomation: () => {},
    });
  }
  return render.startRendering() as unknown as AudioBuffer;
}

function pitchHz(buf: AudioBuffer, a0: number, a1: number): number {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const a = Math.floor(a0 * sr), b = Math.floor(a1 * sr);
  let cross = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
  return (cross / 2) * (sr / (b - a));
}

describe('audio engine — real scheduler path', () => {
  it('plays through engine+scheduler (non-silent) at native tempo', async () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('smp-native', tone(render, 1.0, 220));
    stretchCache.clear();
    const out = await renderViaScheduler({
      durationSec: 1.0, bpm: 120, sampleId: 'smp-native', loopDurSec: 1.0, originalBpm: 120,
    });
    let peak = 0; const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });

  it('preserves pitch when stretched to a faster tempo (ratio ≈ 1, not varispeed)', async () => {
    // loop native = 120 BPM, 1 bar = 2s. Play it at 60 BPM → clip gate = 4s,
    // ratio 4/2 = 2 → WSOLA stretch keeps 220 Hz; varispeed would drop to 110 Hz.
    const sr = 44100;
    const big = new OfflineAudioContext(1, Math.ceil(4 * sr), sr);
    sampleCache.put('smp-pitch', tone(big, 2.0, 220));
    stretchCache.clear();
    await stretchCache.ensure('smp-pitch', 2.0, () => tone(big, 4.0, 220)); // pre-render the stretch
    const out = await renderViaScheduler({
      durationSec: 3.5, bpm: 60, sampleId: 'smp-pitch', loopDurSec: 2.0, originalBpm: 120,
    });
    const f = pitchHz(out, 0.5, 3.0);
    expect(f).toBeGreaterThan(200);
    expect(f).toBeLessThan(240);
  });
});
```
> Remove the redundant `import { AudioEngine as _AE }` line if `AudioEngine` is already imported at the top of the file (it is, from Task A3) — keep a single import. The `note.duration` is in ticks on the 96-PPQ grid; the gate conversion `(duration/96)*(60/bpm)` matches the runtime's seconds-per-tick.

- [ ] **Step 2: Run it and confirm the new cases pass**

Run: `NO_COLOR=1 npx vitest run src/engines/audio.dsp.test.ts`
Expected: PASS (all cases). If the pitch case reads ~110 Hz, the stretch buffer was not picked up — verify the pre-rendered `stretchCache.ensure` ratio equals `gate/region` (4/2 = 2.0) exactly.

- [ ] **Step 3: Commit**

```bash
git add src/engines/audio.dsp.test.ts
git commit -m "test(audio): real-path render through engine + scheduler (pitch preserved)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — Waveform header + audio-clip editor; delete clip-editor-loop

### Task C1: `mountWaveformHeader` + `renderAudioClipEditor`

**Files:**
- Create: `src/session/clip-editors/clip-waveform-header.ts`
- Test: `src/session/clip-editors/clip-waveform-header.test.ts`

- [ ] **Step 1: Write the failing test (jsdom + stubbed canvas)**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountWaveformHeader, renderAudioClipEditor } from './clip-waveform-header';
import type { SessionClip } from '../session';
import { DEFAULT_METER } from '../../core/meter';

function stubCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {} }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as never);
}

const audioClip = (): SessionClip => ({
  id: 'c1', name: 'beat', lengthBars: 2, notes: [],
  sample: { sampleId: 'smp-x', mode: 'loop', warp: true, warpMode: 'stretch', originalBpm: 120, trimStart: 0, trimEnd: 4 },
});

describe('clip-waveform-header', () => {
  it('mountWaveformHeader mounts a canvas and returns a redraw handle', () => {
    stubCanvas();
    const host = document.createElement('div');
    const handle = mountWaveformHeader(host, audioClip(), DEFAULT_METER);
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(typeof handle.redraw).toBe('function');
  });

  it('renderAudioClipEditor shows the bpm + a Slice → pads button that calls back', () => {
    stubCanvas();
    const host = document.createElement('div');
    const onSlice = vi.fn();
    renderAudioClipEditor(host, audioClip(), DEFAULT_METER, { onSliceToBank: onSlice });
    expect(host.textContent).toContain('120');
    const btn = host.querySelector('.audio-clip-slice') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(onSlice).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```ts
// src/session/clip-editors/clip-waveform-header.ts
// The waveform strip shown ABOVE the normal clip editor (the visual the user
// liked). Two exports:
//   - mountWaveformHeader: canvas (waveform + bar/beat ruler + slice markers)
//     mounted above the body editor; returns { redraw } for the host RAF.
//   - renderAudioClipEditor: the audio-clip (Mode 1) editor — waveform header +
//     a small toolbar (bpm / bars / warp / Slice → pads). No note grid.

import type { SessionClip } from '../session';
import { sampleCache } from '../../samples/sample-cache';
import { ticksPerBar, stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';

const RULER_H = 18;
const WAVE_H = 64;

export interface WaveformHeaderHandle { redraw: () => void; }
export interface WaveformHeaderDeps { getPlayheadFrac?: () => number; }

/** Source buffer id used by the header: the audio clip's own sample, or a
 *  display-only waveformRef (Mode-2 sliced note clip). */
function headerSampleId(clip: SessionClip): string | undefined {
  return clip.sample?.sampleId ?? clip.waveformRef?.sampleId;
}

export function mountWaveformHeader(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: WaveformHeaderDeps = {},
): WaveformHeaderHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-waveform-header';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  host.appendChild(canvas);
  const c2d = canvas.getContext('2d');

  const barTicks = ticksPerBar(meter);
  const beatsPerBar = stepsPerBar(meter) / stepsPerBeat(meter);
  const beatTicks = barTicks / beatsPerBar;
  const patternTicks = Math.max(1, clip.lengthBars * barTicks);
  let playheadFrac = -1;

  function draw(): void {
    if (!c2d) return;
    const w = Math.max(320, host.clientWidth || 600);
    const h = RULER_H + WAVE_H;
    canvas.width = w; canvas.height = h;
    canvas.style.height = `${h}px`;
    c2d.fillStyle = '#0c0c12'; c2d.fillRect(0, 0, w, h);

    // waveform
    const buf = headerSampleId(clip) ? sampleCache.get(headerSampleId(clip)!) : undefined;
    if (buf) {
      const data = buf.getChannelData(0);
      const mid = RULER_H + WAVE_H / 2;
      c2d.strokeStyle = '#4a6a8a'; c2d.beginPath();
      for (let px = 0; px < w; px++) {
        const i0 = Math.floor((px / w) * data.length);
        const i1 = Math.floor(((px + 1) / w) * data.length);
        let peak = 0; for (let i = i0; i < i1 && i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        c2d.moveTo(px, mid - peak * (WAVE_H / 2)); c2d.lineTo(px, mid + peak * (WAVE_H / 2));
      }
      c2d.stroke();
    }

    // bar/beat ruler
    for (let t = 0; t <= patternTicks; t += beatTicks) {
      const x = (t / patternTicks) * w;
      c2d.strokeStyle = (t % barTicks === 0) ? '#555' : '#2a2a2a';
      c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, RULER_H); c2d.stroke();
    }

    // slice markers (when present)
    const slices = clip.sample?.slices ?? [];
    const dur = (clip.sample?.trimEnd ?? 0) - (clip.sample?.trimStart ?? 0);
    if (slices.length && dur > 0) {
      c2d.strokeStyle = '#ffb454';
      for (const s of slices) {
        const x = (s.start / dur) * w;
        c2d.beginPath(); c2d.moveTo(x, RULER_H); c2d.lineTo(x, RULER_H + WAVE_H); c2d.stroke();
      }
    }

    // playhead
    if (playheadFrac >= 0) {
      const x = playheadFrac * w;
      c2d.strokeStyle = '#f7d000'; c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, h); c2d.stroke();
    }
  }

  draw();
  return {
    redraw() {
      const f = deps.getPlayheadFrac?.() ?? -1;
      if (f !== playheadFrac) { playheadFrac = f; }
      draw();
    },
  };
}

export interface AudioClipEditorDeps {
  onSliceToBank?: () => void;
  getPlayheadFrac?: () => number;
}

export function renderAudioClipEditor(
  host: HTMLElement, clip: SessionClip, meter: TimeSignature = DEFAULT_METER, deps: AudioClipEditorDeps = {},
): WaveformHeaderHandle {
  host.innerHTML = '';
  const sample = clip.sample;

  const toolbar = document.createElement('div');
  toolbar.className = 'audio-clip-toolbar';
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 2px', fontSize: '11px' } as Partial<CSSStyleDeclaration>);

  const bpmLabel = document.createElement('span');
  bpmLabel.className = 'audio-clip-bpm';
  bpmLabel.textContent = `BPM ${Math.round(sample?.originalBpm ?? 120)}`;
  bpmLabel.title = 'Detected loop tempo';

  const barsLabel = document.createElement('span');
  barsLabel.textContent = `${clip.lengthBars} bar${clip.lengthBars > 1 ? 's' : ''}`;

  const warpBtn = document.createElement('button');
  warpBtn.className = 'audio-clip-warp';
  const refreshWarp = () => { warpBtn.textContent = sample?.warp ? '♺ Warp ON' : '♺ Warp OFF'; };
  warpBtn.addEventListener('click', () => { if (sample) { sample.warp = !sample.warp; refreshWarp(); } });
  refreshWarp();

  const sliceBtn = document.createElement('button');
  sliceBtn.className = 'audio-clip-slice';
  sliceBtn.textContent = '✂ Slice → pads';
  sliceBtn.title = 'Chop into bank samples + a note clip on a new sampler lane';
  sliceBtn.addEventListener('click', () => deps.onSliceToBank?.());

  toolbar.append(bpmLabel, barsLabel, warpBtn, sliceBtn);
  host.appendChild(toolbar);

  const headerHost = document.createElement('div');
  host.appendChild(headerHost);
  return mountWaveformHeader(headerHost, clip, meter, { getPlayheadFrac: deps.getPlayheadFrac });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-editors/clip-waveform-header.ts src/session/clip-editors/clip-waveform-header.test.ts
git commit -m "feat(audio): waveform header + audio-clip editor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task C2: Route audio lanes + mount the header; delete the loop editor

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts`
- Modify: `src/session/clip-editors/clip-editor-router.test.ts` (drop the `isSliceLoopClip` block; add `isAudioClip`)
- Modify: `src/session/session-inspector.ts` (thread `onSliceToBank`; pass playhead frac)
- Delete: `src/session/clip-editors/clip-editor-loop.ts` + `clip-editor-loop.test.ts`

- [ ] **Step 1: Update the router test first (red)**

In `src/session/clip-editors/clip-editor-router.test.ts`:
- change the import line `import { chooseClipEditor, isSliceLoopClip } from './clip-editor-router';` to `import { chooseClipEditor, isAudioClip } from './clip-editor-router';`
- delete the entire `describe('isSliceLoopClip', ...)` block.
- add:
```ts
describe('isAudioClip', () => {
  it('true only for an audio-lane clip with a sample and no notes', () => {
    const audio = { id: 'a', engineId: 'audio', clips: [] } as unknown as SessionLane;
    const sampler = { id: 's', engineId: 'sampler', clips: [] } as unknown as SessionLane;
    const withSample = { id: 'c', lengthBars: 1, notes: [], sample: { sampleId: 's', mode: 'loop', trimStart: 0, trimEnd: 1 } } as unknown as SessionClip;
    const noteClip = { id: 'd', lengthBars: 1, notes: [{ start: 0, duration: 1, midi: 60, velocity: 90 }] } as unknown as SessionClip;
    expect(isAudioClip(audio, withSample)).toBe(true);
    expect(isAudioClip(sampler, withSample)).toBe(false);
    expect(isAudioClip(audio, noteClip)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts`
Expected: FAIL — `isAudioClip` not exported.

- [ ] **Step 3: Rewrite the router**

In `src/session/clip-editors/clip-editor-router.ts`:
- remove `import { renderLoopEditor } from './clip-editor-loop';`
- add:
```ts
import { mountWaveformHeader, renderAudioClipEditor } from './clip-waveform-header';
```
- add `onSliceToBank?: () => void;` to `ClipEditorDeps`.
- replace the `isSliceLoopClip` function with:
```ts
/** An audio-channel clip: lives on an `audio` lane, has a sample, no notes. */
export function isAudioClip(lane: SessionLane, clip: SessionClip): boolean {
  return lane.engineId === 'audio' && !!clip.sample && (clip.notes?.length ?? 0) === 0;
}
```
- replace the body of `renderClipEditor` (from `host.innerHTML = '';` through the `return handle;`) with:
```ts
  host.innerHTML = '';
  const engine = getEngine(lane.engineId);
  const editor = chooseClipEditor(lane, engine?.editor, override);

  const playheadFrac = (): number => {
    const lp = deps.laneStates.get(lane.id);
    if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
    const stepDur = 60 / deps.seq.bpm / 4;
    const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
    const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
    return (stepsElapsed % clipSteps) / clipSteps;
  };

  // Audio-channel clip → waveform-only editor (no note grid).
  if (isAudioClip(lane, clip)) {
    return renderAudioClipEditor(host, clip, deps.seq.meter, {
      onSliceToBank: deps.onSliceToBank,
      getPlayheadFrac: playheadFrac,
    });
  }

  // Everything else: optional waveform header (when the clip references a buffer)
  // ABOVE the normal note editor.
  let headerHandle: { redraw: () => void } | null = null;
  if (clip.sample || clip.waveformRef) {
    const headerBox = document.createElement('div');
    host.appendChild(headerBox);
    headerHandle = mountWaveformHeader(headerBox, clip, deps.seq.meter, { getPlayheadFrac: playheadFrac });
  }
  const bodyBox = document.createElement('div');
  host.appendChild(bodyBox);

  let bodyHandle: PianoRollHandle | null;
  if (editor === 'drum-grid') {
    const audition = deps.triggerForLane
      ? (midi: number) => deps.triggerForLane!(lane.id, midi, deps.ctx.currentTime, AUDITION_GATE, false, false)
      : undefined;
    const getPlayheadTick = (): number => {
      const lp = deps.laneStates.get(lane.id);
      if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
      const stepDur = 60 / deps.seq.bpm / 4;
      const stepsElapsed = Math.max(0, (deps.ctx.currentTime - lp.startTime) / stepDur);
      const clipSteps = clip.lengthBars * stepsPerBar(deps.seq.meter);
      return (stepsElapsed % clipSteps) * TICKS_PER_STEP;
    };
    bodyHandle = renderDrumGridEditor(bodyBox, clip, deps.historyDeps, deps.seq.meter, { auditionNote: audition, getPlayheadTick });
  } else {
    bodyHandle = buildPianoRoll(bodyBox, lane, clip, deps);
  }

  mountClipLoopBrace(bodyBox, clip, deps.seq.meter, deps.historyDeps, () => {});
  return { redraw: () => { headerHandle?.redraw(); bodyHandle?.redraw(); } };
```
> This drops the `isSliceLoopClip`/`renderLoopEditor` branch entirely. The `buildPianoRoll` helper below is unchanged. `AUDITION_GATE`, `TICKS_PER_STEP`, `stepsPerBar` are already imported.

- [ ] **Step 4: Thread `onSliceToBank` from the inspector**

In `src/session/session-inspector.ts`:
- add to `InspectorDeps`:
```ts
  /** Mode 2: chop the audio clip into bank samples + a note clip on a new
   *  sampler lane. Bound to (laneId, clipIdx) by the host. */
  onSliceToBank?: (laneId: string, clipIdx: number) => void;
```
- in `renderEditor`, change the `editorDeps` object to include:
```ts
      onSliceToBank: this.selectedClip
        ? () => this.deps.onSliceToBank?.(this.selectedClip!.laneId, this.selectedClip!.clipIdx)
        : undefined,
```

- [ ] **Step 5: Pass `onSliceToBank` into the inspector from the host**

In `src/session/session-host.ts` `init()`, in the `new SessionInspector({...})` deps, add:
```ts
      onSliceToBank: (laneId, clipIdx) => this.onSliceToBank(laneId, clipIdx),
```
> `this.onSliceToBank` is implemented in Task D2. Until then, add a temporary stub method on the class so this compiles:
```ts
  onSliceToBank(_laneId: string, _clipIdx: number): void { /* implemented in Task D2 */ }
```
Remove the stub when Task D2 lands.

- [ ] **Step 6: Delete the loop editor + its test**

```bash
git rm src/session/clip-editors/clip-editor-loop.ts src/session/clip-editors/clip-editor-loop.test.ts
```

- [ ] **Step 7: Typecheck, run router test, build**

Run: `npx tsc --noEmit`
Run: `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts`
Run: `npm run build`
Expected: tsc clean; router test PASS; build OK.
> If tsc flags `slice` usages elsewhere (it shouldn't yet — the slice plumbing stays until Phase D-cleanup), leave them; this task only removes the loop **editor**.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(audio): waveform header on the normal editor; delete clip-editor-loop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task C3: Remove the Sampler's "Import as loop" UI

**Files:**
- Modify: `src/engines/sampler.ts` (`buildParamUI`: the `loopRow` / `loadLoop` block ~lines 576-623)

- [ ] **Step 1: Delete the "Import as loop" UI block**

In `src/engines/sampler.ts` `buildParamUI`, remove the entire block that builds `loopRow`, `loopLabel`, `loopInput`, `loopStatus`, the `loadLoop` async function, and the `loopInput.addEventListener(...)` — i.e. everything from the comment `// Import-as-loop: ...` down to (but not including) the `const loadFile = async (file: File) => {` line.

- [ ] **Step 2: Remove now-unused imports**

Remove from `src/engines/sampler.ts` the imports that only the deleted block used:
- `import { parseLoopMetadata } from '../samples/loop-metadata';`
- `import { detectLoop } from '../samples/loop-analysis';`
- `import { analyzeLoopFor } from '../samples/loop-import';`
- `import { slicedLoopClip } from '../session/session';`
- `import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';`
- `import { DEFAULT_METER } from '../core/meter';`

> Verify with a search that none of these symbols are used elsewhere in `sampler.ts` before removing each import. Keep any that are still referenced.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: clean (tsc will flag any import you removed that's still in use — re-add only those).

- [ ] **Step 4: Commit**

```bash
git add src/engines/sampler.ts
git commit -m "refactor(sampler): remove Import-as-loop UI (superseded by audio channel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase D — Mode 2: Slice → sampler lane (slices into the bank)

### Task D1: `slice-to-bank` helpers

**Files:**
- Create: `src/samples/slice-to-bank.ts`
- Test: `src/samples/slice-to-bank.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/samples/slice-to-bank.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { slicesToKeymap, audioBufferToWavBytes } from './slice-to-bank';
import { SLICE_BASE_NOTE } from '../core/slice-clip';

describe('slicesToKeymap', () => {
  it('maps each slice id to a single-note entry from SLICE_BASE_NOTE', () => {
    const km = slicesToKeymap(['a', 'b', 'c']);
    expect(km).toHaveLength(3);
    expect(km[0]).toEqual({ sampleId: 'a', rootNote: SLICE_BASE_NOTE, loNote: SLICE_BASE_NOTE, hiNote: SLICE_BASE_NOTE });
    expect(km[2].rootNote).toBe(SLICE_BASE_NOTE + 2);
    expect(km[2].loNote).toBe(km[2].hiNote); // single-note range
  });
});

describe('audioBufferToWavBytes', () => {
  it('encodes a buffer to RIFF/WAVE bytes', async () => {
    const ctx = new OfflineAudioContext(1, 1000, 44100);
    const buf = ctx.createBuffer(1, 1000, 44100);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 10);
    const bytes = await audioBufferToWavBytes(buf as unknown as AudioBuffer);
    const head = new Uint8Array(bytes, 0, 4);
    expect(String.fromCharCode(...head)).toBe('RIFF');
    expect(bytes.byteLength).toBeGreaterThan(44);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `NO_COLOR=1 npx vitest run src/samples/slice-to-bank.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helpers**

```ts
// src/samples/slice-to-bank.ts
// Mode 2 helpers: turn cut slice buffers into bank samples + a single-note
// keymap (one consecutive note per slice from SLICE_BASE_NOTE). The original
// loop's audio thereby lives in the bank, played via the normal keymap one-shot
// path (no clip-local slice regions).

import type { KeymapEntry } from './types';
import { SLICE_BASE_NOTE } from '../core/slice-clip';
import { encodeWavPcm16 } from '../export/wav-encoder';

/** One single-note keymap entry per slice id, consecutive from `baseNote`. */
export function slicesToKeymap(sliceIds: string[], baseNote: number = SLICE_BASE_NOTE): KeymapEntry[] {
  return sliceIds.map((sampleId, i) => ({
    sampleId, rootNote: baseNote + i, loNote: baseNote + i, hiNote: baseNote + i,
  }));
}

/** AudioBuffer → 16-bit PCM WAV bytes (for SampleStore persistence). */
export async function audioBufferToWavBytes(buf: AudioBuffer): Promise<ArrayBuffer> {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice());
  const blob = encodeWavPcm16(chans, buf.sampleRate);
  return blob.arrayBuffer();
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `NO_COLOR=1 npx vitest run src/samples/slice-to-bank.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/samples/slice-to-bank.ts src/samples/slice-to-bank.test.ts
git commit -m "feat(audio): slice-to-bank helpers (keymap + wav bytes)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task D2: `onSliceToBank` — chop into a new sampler lane

**Files:**
- Modify: `src/session/session-host.ts` (replace the Task C2 stub `onSliceToBank` with the real method; add imports)

- [ ] **Step 1: Add imports**

In `src/session/session-host.ts` add:
```ts
import { sliceBuffer } from '../samples/slice-buffer';
import { slicesToKeymap, audioBufferToWavBytes } from '../samples/slice-to-bank';
import { buildSliceClip } from '../core/slice-clip';
import { buildSampleAsset, newSampleId } from '../samples/import';
import { DEFAULT_RESOLUTION } from '../core/drum-grid-editing';
```
> `detectLoop` is already imported (Task B3). `mirrorKeymapChange` is already imported. `SamplerEngine` type is reached via `as unknown as { setKeymap(...) }`.

- [ ] **Step 2: Replace the stub with the implementation**

Replace the temporary `onSliceToBank(_laneId, _clipIdx) { ... }` stub method on `SessionHost` with:
```ts
  /** Mode 2: chop an audio clip into per-slice bank samples + a normal note clip
   *  on a NEW sampler lane (the original audio lane is left intact). */
  onSliceToBank(laneId: string, clipIdx: number): void {
    const { ctx, seq } = this.deps;
    const lane = this.state.lanes.find((l) => l.id === laneId);
    const clip = lane?.clips[clipIdx];
    if (!lane || !clip?.sample) return;
    void ctx.resume();
    void (async () => {
      const srcId = clip.sample!.sampleId;
      const buf = sampleCache.get(srcId) ?? await sampleCache.ensureLoaded(ctx, srcId, sampleStore);
      if (!buf) return;
      const det = detectLoop(buf, seq.meter);
      const cuts = sliceBuffer(ctx, buf, det.slicePointsSec);
      const sliceIds: string[] = [];
      for (const cut of cuts) {
        const id = newSampleId();
        const bytes = await audioBufferToWavBytes(cut.buffer);
        await sampleStore.put(buildSampleAsset({
          id, name: `${clip.name ?? 'slice'} ${sliceIds.length + 1}`,
          mime: 'audio/wav', bytes, buffer: cut.buffer, createdAt: Date.now(),
        }));
        sampleCache.put(id, cut.buffer);
        sliceIds.push(id);
      }
      const km = slicesToKeymap(sliceIds);
      const built = buildSliceClip({
        slicePointsSec: det.slicePointsSec, durationSec: buf.duration,
        originalBpm: clip.sample!.originalBpm ?? det.originalBpm,
        projectMeter: seq.meter, gridResolution: DEFAULT_RESOLUTION,
      });
      const noteClip: SessionClip = {
        id: `clip-${Date.now().toString(36)}`,
        name: `${clip.name ?? 'Loop'} sliced`,
        color: clip.color,
        lengthBars: built.lengthBars,
        notes: built.notes,
        gridResolution: DEFAULT_RESOLUTION,
        waveformRef: { sampleId: srcId }, // keep the waveform header above the notes
      };
      const hd = this.deps.historyDeps;
      const run = () => {
        const used = new Set(this.state.lanes.map((l) => l.id));
        const newId = nextLaneSlug(used, 'sampler');
        const newLane = emptyLane(newId, 'sampler');
        newLane.name = `${lane.name ?? 'Audio'} slices`;
        newLane.engineState = { sampler: { keymap: km } };
        const rows = Math.max(this.state.scenes.length, 1);
        const defaultLen = Math.max(1, Math.floor(seq.length / stepsPerBar(seq.meter)));
        for (let r = 0; r < rows; r++) newLane.clips.push(r === 0 ? noteClip : emptyClip(defaultLen));
        this.state.lanes.push(newLane);
        this.laneStates.set(newId, emptyLanePlayState(newId));
        this.deps.ensureLaneResource?.(newId, 'sampler');
        const eng = this.deps.laneResources?.get(newId)?.engine as unknown as { setKeymap?(k: typeof km): void };
        eng?.setKeymap?.(km);
        mirrorKeymapChange(this.state, newId, km);
        ensureScenesForRows(this.state);
        this.inspector.setSelectedClip({ laneId: newId, clipIdx: 0 });
        this.inspector.openInspector();
        this.renderWithMixer();
      };
      if (hd) withUndo(hd, run); else run();
    })();
  }
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: clean. (Behaviour is verified by the Playwright test in Phase E.)

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: green (re-run on the known flaky teardown).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(audio): Slice → pads chops a loop into a sampler lane + bank

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task D3 (cleanup): Retire the clip-local slice plumbing

> This removes the now-dead `opts.slice` / `triggerSlice` / scheduler slice-branch / runtime+dispatch slice threading and the `slicedLoopClip` builder. The feature is already complete and green after D2; this is the cleanup the spec calls for. If any step's blast radius looks larger than expected, stop and report — the feature does not depend on this phase.

**Files:**
- Modify: `src/core/lane-scheduler.ts`, `src/app/trigger-dispatch.ts`, `src/session/session-runtime.ts`, `src/session/session-host.ts`, `src/session/session-inspector.ts`, `src/session/clip-editors/clip-editor-router.ts`, `src/engines/engine-types.ts`, `src/engines/sampler.ts`, `src/session/session.ts`
- Delete: `src/core/lane-scheduler-slice.test.ts`, `src/engines/sampler-slice.dsp.test.ts`, `src/session/session-sliced-loop.test.ts`

- [ ] **Step 1: Delete the slice-path tests**

```bash
git rm src/core/lane-scheduler-slice.test.ts src/engines/sampler-slice.dsp.test.ts src/session/session-sliced-loop.test.ts
```

- [ ] **Step 2: Simplify the lane-scheduler**

In `src/core/lane-scheduler.ts`:
- in `SchedulerContext.onTrigger`, change the note type to drop `slice`:
```ts
  onTrigger: (note: { midi: number; duration: number; velocity: number; sample?: ClipSample }, scheduleTime: number) => void;
```
- in `tickLane`, replace the `const sliceMode = ...` discrimination so the audio-clip branch is taken whenever `clip.sample` is present (audio clips are never slice-mode now):
```ts
    if (clip.sample) {
```
(remove the `sliceMode` local and the `!sliceMode` condition.)
- in the `else` (note-clip) branch, delete the `slices`/`sampleId`/`slice` logic; the trigger becomes:
```ts
      for (const n of clip.notes) {
        if (n.start < startTick || n.start >= endTick) continue;
        const clipTimeSec = ((n.start - startTick) / TICKS_PER_QUARTER) * secPerBeat;
        const scheduleAt  = iterStart + clipTimeSec;
        if (scheduleAt >= windowStart && scheduleAt < windowEnd) {
          ctx.onTrigger({ midi: n.midi, duration: n.duration, velocity: n.velocity }, scheduleAt);
        }
      }
```

- [ ] **Step 3: Drop `slice` from the trigger signatures**

- `src/engines/engine-types.ts`: remove the `slice?: { ... }` field from `VoiceTriggerOptions`.
- `src/app/trigger-dispatch.ts`: remove `slice` from the `TriggerForLane` type, the closure params, and the `v.trigger(..., { ..., slice, ... })` call; update the `chain` guard `sample == null && slice == null` → `sample == null`.
- `src/session/session-runtime.ts`: remove `slice` from the `onLaneTrigger`/`tickSession` signatures and forwarding (search for `slice`).
- `src/session/session-host.ts`: remove `slice` from `SessionHostDeps.triggerForLane`, from the `tickSession` lambda, and from the inspector's `triggerForLane` dep type.
- `src/session/session-inspector.ts`: remove `slice` from the `triggerForLane` dep type.
- `src/session/clip-editors/clip-editor-router.ts`: remove `slice` from the `ClipEditorDeps.triggerForLane` type (and the now-unused `slice` audition arg).

- [ ] **Step 4: Remove `SamplerVoice.triggerSlice` + its dispatch**

In `src/engines/sampler.ts`:
- delete the whole `private triggerSlice(...)` method.
- in `SamplerVoice.trigger`, delete the first line `if (opts.slice) { this.triggerSlice(midi, time, opts); return; }`.

- [ ] **Step 5: Remove `slicedLoopClip`**

In `src/session/session.ts`, delete the `slicedLoopClip(...)` function (confirm via search it has no remaining importers — Task C3 removed the last one).

- [ ] **Step 6: Typecheck, full suite, build**

Run: `npx tsc --noEmit`
Run: `npm run test:unit`
Run: `npm run build`
Expected: tsc clean; suite green; build OK. Fix any straggler `slice` references tsc points to.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(audio): retire clip-local slice plumbing (slices now go to the bank)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase E — Playwright e2e demo (the only layer that catches \"the app is silent\")

### Task E1: Commit a deterministic audio-channel e2e

**Files:**
- Create: `tests/e2e/audio-channel.spec.ts`

- [ ] **Step 1: Build so the e2e serves the latest bundle**

Run: `npm run build`
Expected: success (e2e runs against `dist/` via `vite preview`).

- [ ] **Step 2: Write the e2e**

```ts
// tests/e2e/audio-channel.spec.ts
import { test, expect } from '@playwright/test';

/** A ~2s 16-bit PCM mono WAV at 44.1k with two onset bursts so detection finds
 *  slices. Returned as a Buffer for setInputFiles. */
function loopWav(): Buffer {
  const sr = 44100, secs = 2.0, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    // decaying bursts at 0s, 0.5s, 1.0s, 1.5s → clear onsets
    const phase = (i / sr) % 0.5;
    const env = Math.exp(-phase * 18);
    const s = Math.sin(2 * Math.PI * 180 * (i / sr)) * env * 16000;
    buf.writeInt16LE(Math.round(s), 44 + i * 2);
  }
  return buf;
}

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    { timeout: 10_000 },
  );
}

test('add an audio channel from a WAV → lane + launchable scene appear', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const lanesBefore = await page.locator('button.session-lane-tab').count();
  const scenesBefore = await page.locator('.session-scene-launch').count();

  // "+ Audio" → file input.
  await page.locator('input.session-add-audio-input').setInputFiles({
    name: 'beat.wav', mimeType: 'audio/wav', buffer: loopWav(),
  });

  // A new lane appears...
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
  // ...and the row it occupies has a launchable scene button (the bug fix).
  await expect(page.locator('.session-scene-launch')).toHaveCount(
    Math.max(1, scenesBefore), { timeout: 5_000 },
  );
  await expect(page.locator('.session-cell-filled').last()).toBeVisible();
});

test('launching the audio channel scene starts the transport', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('input.session-add-audio-input').setInputFiles({
    name: 'beat.wav', mimeType: 'audio/wav', buffer: loopWav(),
  });
  await expect(page.locator('.session-scene-launch').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.session-scene-launch').first().click();
  // Transport is now playing (play button shows the stop glyph).
  await expect(page.locator('#play')).toHaveText('■', { timeout: 5_000 });
});

test('Slice → pads adds a sampler lane with the sliced notes', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('input.session-add-audio-input').setInputFiles({
    name: 'beat.wav', mimeType: 'audio/wav', buffer: loopWav(),
  });
  // The audio clip auto-opens in the inspector → the audio-clip editor is shown.
  const sliceBtn = page.locator('.audio-clip-slice');
  await expect(sliceBtn).toBeVisible({ timeout: 10_000 });
  const lanesBefore = await page.locator('button.session-lane-tab').count();
  await sliceBtn.click();
  // A new sampler lane appears with the sliced note clip.
  await expect(page.locator('button.session-lane-tab')).toHaveCount(lanesBefore + 1, { timeout: 10_000 });
});
```
> Verify the play-button selector: confirm the toolbar play button id is `#play` (search `getElementById('play')` / the markup). If the project uses a different id, use that. The "playing" glyph `■` is set in `onLaunchScene` via `playBtn.textContent = '■'`.

- [ ] **Step 3: Run the e2e**

Run: `npm run test:e2e -- audio-channel`
Expected: 3 tests PASS. If "launch starts transport" is flaky on CI timing, assert on `.session-cell-playing` appearing instead of the play glyph.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/audio-channel.spec.ts
git commit -m "test(audio): Playwright e2e — add / launch / slice an audio channel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task E2: Full green gate before docs

- [ ] **Step 1: Build + full suite**

Run: `npm run build`
Run: `npm test`
Expected: unit + e2e green (re-run the known flaky `test:unit` teardown if it exits non-zero after all tests pass).

- [ ] **Step 2: Rebase onto main and fast-forward-check** (per the user's worktree workflow — do NOT merge yet; docs are Phase F)

Run: `git rebase main`
Expected: clean or trivially resolved; suite still green after rebase.

---

## Phase F — Docs (LAST)

### Task F1: README — audio channel capability

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an "Audio channel" entry**

In `README.md`, in the engines/features list, add a short paragraph: drop a WAV via **+ Audio** (or onto an audio-lane cell) → it plays tempo-locked without pitch change (WSOLA); **Slice → pads** chops it into bank samples on a new Sampler lane with a one-note-per-slice clip; the waveform shows as a header above the clip editor.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(audio): document the audio channel in the README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task F2: User manual — audio channel section + screenshots

**Files:**
- Modify: `docs/manual/` (the relevant chapter — sampler/loops/clips) + regenerate the PDF

- [ ] **Step 1: Write the manual section**

Add a section covering: the two modes (adapted one-shot vs sliced), the **+ Audio** control, dropping onto audio-lane cells, the waveform header, **Slice → pads**, and the tempo-lock behaviour (native BPM = identical; other BPM = stretched, pitch unchanged). Reference the screenshot pipeline conventions in [tools/manual/](tools/manual/).

- [ ] **Step 2: Regenerate the manual PDF**

Run: `npm run build` (so the screenshot shots hit the latest UI)
Run: `npm run build:manual`
Expected: `docs/manual/` screenshots + `Loom-Manual.pdf` regenerate without error.

- [ ] **Step 3: Commit**

```bash
git add docs/manual Loom-Manual.pdf
git commit -m "docs(manual): audio channel chapter + screenshots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task F3: Finish — rebase + ff-merge + exit worktree

- [ ] **Step 1: Final green gate**

Run: `npm run build`
Run: `npm test`
Expected: all green.

- [ ] **Step 2: Rebase onto main, then fast-forward merge (no merge commit), then exit the worktree**

Run: `git rebase main`
Then merge `feat/audio-channel` into `main` with `git merge --ff-only` and `ExitWorktree` (per the user's global workflow). Do **not** use `--no-ff`.

---

## Notes / risks the implementer should know

- **Engine auto-registration:** `src/engines/audio.ts`'s top-level `registerEngine` + `registerEngineFactory` run because `plugin-bootstrap`'s glob eagerly imports `src/engines/*.ts`. Do not add it to any manual list.
- **Stretch on BPM change works for free:** `collectStretchJobs` already matches `mode:'loop', warp:true, warpMode:'stretch'` clips — audio-channel clips qualify, so the BPM broadcaster re-renders their stretch buffers. No new wiring.
- **First-play pitch:** on the very first loop iteration after import (cold `stretchCache`), `playAudioClip` falls back to varispeed (slight pitch shift) and self-heals the cache; from the next iteration it is pitch-preserved. At the loop's native BPM the ratio ≈ 1, so even the fallback is near-identical. This is acceptable and matches the existing sampler behaviour.
- **Persistence:** audio buffers + slice banks are stored in IndexedDB (`sampleStore`); Task A5 decodes them into the cache on load via `preloadSceneSamples`, and `waveformRef` keeps the slice clip's header buffer alive. Sampler keymaps persist via `engineState.sampler.keymap` (already handled by `applyLaneEngineState`).
- **Relative assertions only.** Never assert absolute sample magnitudes; use peaks/ratios/zero-crossing pitch (as the DSP tests above do).
- **Keep the feature green independent of D3.** Phases A–C, D1–D2, E deliver the whole feature. D3 is pure cleanup; if its blast radius surprises you, ship without it and report.
