# AudioWorklet Phase 3 — Sampler + Audio Channel Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **RECONCILE WITH PHASES 1, 2 & 2b FIRST.** Written against the interfaces designed in the earlier plans (`VoiceRenderer`, `VoiceManager`, the worklet message protocol, `LoomWorkletNode`/`WorkletLaneEngine`, the renderer registry). Verify against the real implementation before executing; real code wins.

**Goal:** Move sample playback into the worklet for the **Sampler** engine (one-shot keymapped samples + loop/song clips) and the dedicated **Audio** channel — and, with it, the Sampler-backed **drumkit** path (the Drums engine's `kitMode: 'sample'`, which the user uses to load sample kits as drum kits). Warp/WSOLA stays a main-thread pre-render; the worklet just plays the result.

**Architecture:** A worklet-side **sample bank** (decoded `Float32Array` channels transferred via `postMessage`, keyed by `sampleId` — the Strudel `dough` `loadSample` model). A pure per-sample **`BufferPlayer`** (fractional read + rate) powers both engines. The **Sampler renderer** resolves nothing audio-rate itself: the main-thread engine does keymap lookup + repitch + pad-param resolution and posts a spawn carrying `{sampleId, rate, loop window, pad filter/amp/pan/send params}`; the worklet plays it through a per-pad lowpass (`Svf`) + amp env + pan, with a separate **send output** for per-pad reverb/delay into the existing `FxBus`. The **Audio renderer** plays a (pre-warped/pre-stretched) buffer flat. `DrumsWorkletEngine` (Phase 2b) gains sample-mode by delegating to the Sampler worklet path instead of the embedded Web-Audio `SamplerEngine`.

**Tech Stack:** Phases 1–2 kernel + worklet. Reuses `BufferPlayer` concept from `dough.mjs`. Keymap/repitch/warp helpers (`samples/keymap.ts`, `samples/timestretch.ts`, `samples/warp-stretch.ts`, `sample-cache.ts`) stay main-thread (they produce buffers + rates the worklet consumes).

## Global Constraints

- **Pure playback kernel** in `src/audio-dsp/sample/` — `BufferPlayer`, `SamplerRenderer`, `AudioClipRenderer`; no Web Audio. Tested by feeding a synthetic `Float32Array` buffer and asserting playback/repitch/loop behaviour.
- **Buffers transferred, not decoded in the worklet.** The main thread decodes (existing `sampleCache`/`decodeAudioData`) and posts the channels (transferable `ArrayBuffer`s) to the worklet's sample bank, keyed by `sampleId`. The worklet never touches IndexedDB or `decodeAudioData`.
- **Warp/stretch stays a main-thread pre-render.** `warpCache`/`stretchCache`/`warpStretch`/`stretchBuffer` are unchanged. For a warped/stretched clip the main thread renders the buffer (as today) and transfers THAT (keyed by a warp/stretch key); the worklet plays it at rate 1. The varispeed cache-miss fallback (rate = span/gate on the raw buffer) is computed main-thread and sent as the spawn's `rate`.
- **Keymap/pad resolution stays main-thread.** The engine resolves note→entry→buffer→rate→pad params and posts a fully-resolved spawn. The worklet does not hold the keymap. (Live param tweaks apply to the next trigger — unchanged semantics.)
- **Per-pad sends faithful via a send output.** The Sampler worklet has 2 stereo outputs: dry (→ lane strip) and send (→ `FxBus` delay+reverb inputs). Each voice mixes its `rev`/`dly` send levels into the send output. (If reconcile shows this is heavy, the documented fallback is lane-level sends only — note it, don't silently drop.)
- **Mixer/FX/master stay Web Audio.** The `FxBus`, lane strips, master chain unchanged.
- **UI English; relative assertions; one commit per task; DRY/YAGNI/TDD.**

### Shared types (this phase)

```ts
// src/audio-dsp/sample/types.ts
export interface SampleData { channels: Float32Array[]; sampleRate: number; }

/** A fully-resolved sample spawn (main thread did keymap + repitch + pad params). */
export interface SampleSpawn {
  sampleId: string;          // key into the worklet sample bank
  beginSec: number;
  gateSec: number;
  rate: number;              // playbackRate (repitch × tune, or warp varispeed)
  offsetSec: number;         // start offset into the buffer
  loop: boolean; loopStartSec: number; loopEndSec: number;
  // per-pad voice chain (sampler); audio channel sends neutral defaults
  cutoff: number;            // 0..1 → 60·300^x Hz
  res: number;               // 0..1
  attack: number; decay: number;
  level: number; pan: number; rev: number; dly: number;
  gain: number;              // engine master gain × entry gain × velocity × OUTPUT_TRIM
}
```

---

## File Structure

New (pure):
- `src/audio-dsp/sample/types.ts` — `SampleData`, `SampleSpawn`.
- `src/audio-dsp/sample/sample-bank.ts` (+ `.test.ts`) — worklet-side `SampleBank` (id → SampleData) + `BufferPlayer`.
- `src/audio-dsp/sample/sampler-renderer.ts` (+ `.test.ts`) — `SamplerRenderer implements VoiceRenderer` (dry) with a send-level accessor.
- `src/audio-dsp/sample/audio-clip-renderer.ts` (+ `.test.ts`) — `AudioClipRenderer implements VoiceRenderer` (flat-gain buffer playback).

New (worklet glue):
- `src/audio-worklet/sampler-processor.ts` — dry + send outputs; sample-bank loading; spawn scheduling.
- `src/audio-worklet/sampler-node.ts` — `SamplerWorkletNode` (post `loadSample`, `spawn`; connect dry → strip, send → FxBus).

New (engines):
- `src/engines/sampler-worklet-engine.ts` — `SynthEngine` keeping the existing Sampler UI/keymap/pad logic but posting resolved spawns to the worklet.
- `src/engines/audio-worklet-engine.ts` — the Audio channel via the worklet.

Modified:
- `src/engines/drums-worklet-engine.ts` (Phase 2b) — sample-mode delegates to the Sampler worklet path.
- `src/app/lane-allocator.ts` — route `sampler` + `audio` to the worklet engines; wire dry → strip, send → FxBus.
- `src/main.ts` — load the sampler worklet module at boot; on sample import/decode, push the buffer to the worklet bank.

Untouched: keymap/pad UI, warp marker editor, stem import, the FxBus, master chain.

---

## Task 1: Sample bank + BufferPlayer

**Files:** Create `src/audio-dsp/sample/types.ts`, `src/audio-dsp/sample/sample-bank.ts`; Test `…/sample-bank.test.ts`.

**Interfaces:**
- Produces: `class SampleBank` — `set(id, SampleData)`, `get(id): SampleData | undefined`, `has(id)`. `class BufferPlayer` — `new (data: SampleData, hostSampleRate: number)`, `seek(offsetSec)`, `setLoop(loop, startSec, endSec)`, `update(rate): number` (mono mix; advances `pos` by `rate × srcRate/hostRate`, returns 0 past the end unless looping). Consumed by both renderers.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/sample/sample-bank.test.ts
import { describe, it, expect } from 'vitest';
import { SampleBank, BufferPlayer } from './sample-bank';
import type { SampleData } from './types';
const SR = 48000;
function ramp(n: number): SampleData { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = i / n; return { channels: [c], sampleRate: SR }; }

describe('SampleBank', () => {
  it('stores and retrieves by id', () => {
    const b = new SampleBank(); const d = ramp(10);
    b.set('x', d); expect(b.get('x')).toBe(d); expect(b.has('y')).toBe(false);
  });
});
describe('BufferPlayer', () => {
  it('plays through the buffer then returns 0 (no loop)', () => {
    const p = new BufferPlayer(ramp(100), SR);
    let last = 1; for (let i = 0; i < 200; i++) last = p.update(1);
    expect(last).toBe(0);
  });
  it('rate 2 advances twice as fast (reaches end in half the samples)', () => {
    const p1 = new BufferPlayer(ramp(100), SR); let n1 = 0; while (p1.update(1) !== 0 && n1 < 1000) n1++;
    const p2 = new BufferPlayer(ramp(100), SR); let n2 = 0; while (p2.update(2) !== 0 && n2 < 1000) n2++;
    expect(n2).toBeLessThan(n1 * 0.6);
  });
  it('loops between loopStart and loopEnd indefinitely', () => {
    const p = new BufferPlayer(ramp(100), SR); p.setLoop(true, 0, 100 / SR);
    let nonzero = false; for (let i = 0; i < 500; i++) if (p.update(1) !== 0) nonzero = true;
    expect(nonzero).toBe(true);   // still producing after the buffer length
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (modules missing).

- [ ] **Step 3: Write the bank + player**

```ts
// src/audio-dsp/sample/sample-bank.ts
import type { SampleData } from './types';

export class SampleBank {
  private map = new Map<string, SampleData>();
  set(id: string, d: SampleData): void { this.map.set(id, d); }
  get(id: string): SampleData | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
}

export class BufferPlayer {
  private pos = 0;            // fractional sample index into the source
  private step: number;       // src samples advanced per host sample at rate 1
  private len: number;
  private loop = false; private loopStart = 0; private loopEnd = 0;
  constructor(private data: SampleData, hostSampleRate: number) {
    this.step = data.sampleRate / hostSampleRate;
    this.len = data.channels[0]?.length ?? 0;
  }
  seek(offsetSec: number): void { this.pos = offsetSec * this.data.sampleRate; }
  setLoop(loop: boolean, startSec: number, endSec: number): void {
    this.loop = loop; this.loopStart = startSec * this.data.sampleRate; this.loopEnd = endSec * this.data.sampleRate;
  }
  /** mono mix of all channels at the current position; advances by rate·step. */
  update(rate: number): number {
    if (this.len === 0) return 0;
    if (this.pos >= this.len || (this.loop && this.loopEnd > this.loopStart && this.pos >= this.loopEnd)) {
      if (this.loop && this.loopEnd > this.loopStart) {
        this.pos = this.loopStart + ((this.pos - this.loopStart) % (this.loopEnd - this.loopStart));
      } else return 0;
    }
    const i = Math.floor(this.pos); const f = this.pos - i;
    let s = 0;
    for (const ch of this.data.channels) {
      const a = ch[i] ?? 0; const b = ch[i + 1] ?? a;
      s += a * (1 - f) + b * f;
    }
    s /= this.data.channels.length;
    this.pos += rate * this.step;
    return s;
  }
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/sample/types.ts src/audio-dsp/sample/sample-bank.ts src/audio-dsp/sample/sample-bank.test.ts
git commit -m "feat(audio-dsp): worklet sample bank + per-sample BufferPlayer"
```

---

## Task 2: SamplerRenderer (per-pad chain) + AudioClipRenderer (flat)

**Files:** Create `src/audio-dsp/sample/sampler-renderer.ts`, `…/audio-clip-renderer.ts`; Tests for each.

**Interfaces:**
- Consumes: `SampleBank`/`BufferPlayer` (Task 1), `Svf` (filter.ts), `SampleSpawn` (types.ts).
- Produces:
  - `class SamplerRenderer implements VoiceRenderer` — `new (spawn: SampleSpawn, bank: SampleBank, sampleRate: number)`. Dry signal = player → `Svf` lowpass → amp env (attack/decay around the gate) → level. Exposes `sendRev()` / `sendDly()` (the dry sample × send level, for the processor's send bus) and `panL()`/`panR()` (equal-power pan applied by the processor when writing stereo).
  - `class AudioClipRenderer implements VoiceRenderer` — `new (spawn: SampleSpawn, bank, sampleRate)`. Flat gain with ~5 ms fades (mirrors `audio-clip-voice.ts`), no filter.

- [ ] **Step 1: Write the failing test**

```ts
// src/audio-dsp/sample/sampler-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { SamplerRenderer } from './sampler-renderer';
import { SampleBank } from './sample-bank';
import type { SampleSpawn } from './types';
const SR = 48000;
const tone = (n: number) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = Math.sin(2 * Math.PI * 440 * i / SR); return { channels: [c], sampleRate: SR }; };
const spawn = (o: Partial<SampleSpawn> = {}): SampleSpawn => ({ sampleId: 's', beginSec: 0, gateSec: 0.2, rate: 1, offsetSec: 0, loop: false, loopStartSec: 0, loopEndSec: 0, cutoff: 1, res: 0, attack: 0.005, decay: 0.05, level: 1, pan: 0, rev: 0, dly: 0, gain: 1, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('SamplerRenderer', () => {
  it('plays the sample audibly then is done', () => {
    const bank = new SampleBank(); bank.set('s', tone(SR));
    const r = new SamplerRenderer(spawn(), bank, SR);
    const b: number[] = []; for (let i = 0; i < SR * 0.1; i++) b.push(r.renderSample(i / SR));
    expect(rms(b)).toBeGreaterThan(0.05);
    for (let i = SR * 0.1; i < SR * 0.5; i++) r.renderSample(i / SR);
    expect(r.done).toBe(true);
  });
  it('a lower cutoff removes high-frequency energy', () => {
    const bank = new SampleBank(); bank.set('s', tone(SR));
    const e = (cut: number) => { const r = new SamplerRenderer(spawn({ cutoff: cut }), bank, SR); const b: number[] = []; for (let i = 0; i < SR * 0.05; i++) b.push(r.renderSample(i / SR)); return rms(b); };
    expect(e(1)).toBeGreaterThan(e(0.1) * 1.1);
  });
  it('missing sample id renders silence + done', () => {
    const r = new SamplerRenderer(spawn({ sampleId: 'missing' }), new SampleBank(), SR);
    expect(r.renderSample(0)).toBe(0);
    expect(r.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL.

- [ ] **Step 3: Write `SamplerRenderer`**

```ts
// src/audio-dsp/sample/sampler-renderer.ts
import type { VoiceRenderer } from '../types';
import type { SampleSpawn, SampleData } from './types';
import { BufferPlayer, SampleBank } from './sample-bank';
import { Svf } from '../filter';

export class SamplerRenderer implements VoiceRenderer {
  private player: BufferPlayer | null; private filter: Svf;
  private begin: number; private holdEnd: number; private s: SampleSpawn;
  private lastDry = 0;
  done = false;
  constructor(spawn: SampleSpawn, bank: SampleBank, private sr: number) {
    this.s = spawn; this.filter = new Svf(sr);
    this.begin = spawn.beginSec; this.holdEnd = spawn.beginSec + spawn.gateSec;
    const data: SampleData | undefined = bank.get(spawn.sampleId);
    if (!data) { this.player = null; this.done = true; return; }
    this.player = new BufferPlayer(data, sr);
    this.player.seek(spawn.offsetSec);
    if (spawn.loop) this.player.setLoop(true, spawn.loopStartSec, spawn.loopEndSec);
  }
  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }
  private ampAt(t: number): number {
    const dt = t - this.begin; const relAt = Math.max(this.s.attack, this.holdEnd - this.begin);
    if (dt < this.s.attack) return dt / this.s.attack;
    if (dt < relAt) return 1;
    const rel = dt - relAt; const a = 1 - rel / Math.max(1e-4, this.s.decay);
    return a > 0 ? a : 0;
  }
  renderSample(t: number): number {
    if (!this.player || t < this.begin) return 0;
    const amp = this.ampAt(t);
    if (t > this.holdEnd && amp <= 0) { this.done = true; this.lastDry = 0; return 0; }
    const raw = this.player.update(this.s.rate);
    const cutoffHz = Math.min(this.sr * 0.45, 60 * Math.pow(300, this.s.cutoff));
    this.filter.update(raw, cutoffHz, this.s.res * 20 * 0.45);
    this.lastDry = this.filter.lp * amp * this.s.level * this.s.gain;
    return this.lastDry;
  }
  sendRev(): number { return this.lastDry * this.s.rev; }
  sendDly(): number { return this.lastDry * this.s.dly; }
  pan(): number { return this.s.pan; }
}
```

- [ ] **Step 4: Write `AudioClipRenderer`** (flat gain + fades; reuse `BufferPlayer`; `OUTPUT_TRIM`/warp already folded into `spawn.gain`/`spawn.rate` by the engine)

```ts
// src/audio-dsp/sample/audio-clip-renderer.ts
import type { VoiceRenderer } from '../types';
import type { SampleSpawn } from './types';
import { BufferPlayer, SampleBank } from './sample-bank';

export class AudioClipRenderer implements VoiceRenderer {
  private player: BufferPlayer | null; private begin: number; private holdEnd: number; private gate: number; private gain: number; private rate: number;
  done = false;
  constructor(spawn: SampleSpawn, bank: SampleBank, sr: number) {
    this.begin = spawn.beginSec; this.gate = spawn.gateSec; this.holdEnd = spawn.beginSec + spawn.gateSec;
    this.gain = spawn.gain; this.rate = spawn.rate;
    const d = bank.get(spawn.sampleId);
    if (!d) { this.player = null; this.done = true; return; }
    this.player = new BufferPlayer(d, sr); this.player.seek(spawn.offsetSec);
  }
  noteOff(t: number): void { if (t < this.holdEnd) this.holdEnd = t; }
  renderSample(t: number): number {
    if (!this.player || t < this.begin) return 0;
    const dt = t - this.begin; const fade = Math.min(0.005, this.gate / 4);
    if (dt > this.gate) { this.done = true; return 0; }
    let env = 1;
    if (dt < fade) env = dt / fade;
    else if (dt > this.gate - fade) env = (this.gate - dt) / fade;
    return this.player.update(this.rate) * Math.max(0, env) * this.gain;
  }
}
```

- [ ] **Step 5: Run tests** → both renderer test files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio-dsp/sample/sampler-renderer.ts src/audio-dsp/sample/sampler-renderer.test.ts src/audio-dsp/sample/audio-clip-renderer.ts src/audio-dsp/sample/audio-clip-renderer.test.ts
git commit -m "feat(audio-dsp): sampler + audio-clip per-sample renderers"
```

---

## Task 3: Sampler worklet processor (dry + send) + node wrapper

**Files:** Create `src/audio-worklet/sampler-processor.ts`, `src/audio-worklet/sampler-node.ts`; Test `sampler-node.test.ts`.

**Interfaces:**
- Messages: `{type:'loadSample', sampleId, channels: Float32Array[], sampleRate}` (channels' `ArrayBuffer`s sent as transferables), `{type:'spawn', kind:'sampler'|'audio', spawn: SampleSpawn}`.
- Processor: 2 stereo outputs — `outputs[0]` = dry (panned), `outputs[1]` = send (rev+dly summed; the node splits them downstream OR uses two mono sends — keep it as one stereo "fx send" the node fans to both FxBus inputs). A `VoiceManager`-like pool builds `SamplerRenderer`/`AudioClipRenderer` per spawn; `done` voices are freed.
- Produces: `class SamplerWorkletNode` — `loadSample(id, AudioBuffer)` (extracts channels, transfers), `spawn(kind, SampleSpawn)`, `connectDry(strip)`, `connectSend(fxDelayInput, fxReverbInput)`.

- [ ] **Step 1: Write the failing test** (message shaping with a mock port + `loadSample` channel extraction)

```ts
// src/audio-worklet/sampler-node.test.ts
import { describe, it, expect } from 'vitest';
import type { SampleSpawn } from '../audio-dsp/sample/types';
describe('sampler node message shaping', () => {
  it('spawn + loadSample payloads are well-shaped', () => {
    const posted: any[] = [];
    const port = { postMessage: (m: any, _t?: any) => posted.push(m) };
    const spawn = { sampleId: 's', beginSec: 0, gateSec: 1, rate: 1, offsetSec: 0, loop: false, loopStartSec: 0, loopEndSec: 0, cutoff: 1, res: 0, attack: 0.005, decay: 0.05, level: 1, pan: 0, rev: 0, dly: 0, gain: 1 } as SampleSpawn;
    port.postMessage({ type: 'loadSample', sampleId: 's', channels: [new Float32Array(4)], sampleRate: 48000 });
    port.postMessage({ type: 'spawn', kind: 'sampler', spawn });
    expect(posted.map((m) => m.type)).toEqual(['loadSample', 'spawn']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → (passes trivially; extend with an import of a `extractChannels(buf)` helper from `sampler-node.ts` that fails until implemented).

- [ ] **Step 3: Write the processor**

```ts
// src/audio-worklet/sampler-processor.ts
/// <reference lib="webworker" />
import { SampleBank } from '../audio-dsp/sample/sample-bank';
import { SchedulerQueue } from '../audio-dsp/scheduler-queue';
import { SamplerRenderer } from '../audio-dsp/sample/sampler-renderer';
import { AudioClipRenderer } from '../audio-dsp/sample/audio-clip-renderer';
import type { SampleSpawn } from '../audio-dsp/sample/types';

type Msg =
  | { type: 'loadSample'; sampleId: string; channels: Float32Array[]; sampleRate: number }
  | { type: 'spawn'; kind: 'sampler' | 'audio'; spawn: SampleSpawn };

interface Slot { r: SamplerRenderer | AudioClipRenderer; pan: number; rev: number; dly: number; }

class SamplerProcessor extends AudioWorkletProcessor {
  private bank = new SampleBank();
  private queue = new SchedulerQueue<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }>();
  private live: Slot[] = [];
  private frame = Math.floor(currentTime * sampleRate);
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'loadSample') this.bank.set(m.sampleId, { channels: m.channels, sampleRate: m.sampleRate });
      else if (m.type === 'spawn') this.queue.push(Math.floor(m.spawn.beginSec * sampleRate), { kind: m.kind, spawn: m.spawn });
    };
  }
  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    const dry = outputs[0]; const send = outputs[1];
    const n = dry[0].length;
    for (let i = 0; i < n; i++) {
      const t = this.frame / sampleRate;
      this.queue.drainDue(this.frame, ({ kind, spawn }) => {
        const r = kind === 'audio' ? new AudioClipRenderer(spawn, this.bank, sampleRate) : new SamplerRenderer(spawn, this.bank, sampleRate);
        this.live.push({ r, pan: spawn.pan, rev: spawn.rev, dly: spawn.dly });
      });
      let l = 0, rr = 0, se = 0;
      for (let s = this.live.length - 1; s >= 0; s--) {
        const slot = this.live[s]; const mono = slot.r.renderSample(t);
        const p = (slot.pan + 1) * 0.25 * Math.PI;      // equal-power pan
        l += mono * Math.cos(p); rr += mono * Math.sin(p);
        if (slot.r instanceof SamplerRenderer) se += slot.r.sendRev() + slot.r.sendDly();
        if (slot.r.done) this.live.splice(s, 1);
      }
      dry[0][i] = l; dry[1][i] = rr;
      send[0][i] = se; send[1][i] = se;
      this.frame++;
    }
    return true;
  }
}
registerProcessor('sampler-processor', SamplerProcessor);
```

(Note: rev/dly are summed into one send bus here for simplicity; if reverb and delay need independent levels, split into outputs[1]=delay and outputs[2]=reverb and have the renderer expose them separately — reconcile during execution.)

- [ ] **Step 4: Write the node wrapper** (`extractChannels` + transfer)

```ts
// src/audio-worklet/sampler-node.ts
import type { SampleSpawn } from '../audio-dsp/sample/types';
export function extractChannels(buf: AudioBuffer): { channels: Float32Array[]; sampleRate: number } {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
  return { channels, sampleRate: buf.sampleRate };
}
let loaded = false;
export async function loadSamplerWorklet(ctx: AudioContext): Promise<void> {
  if (loaded) return; await ctx.audioWorklet.addModule(new URL('./sampler-processor.ts', import.meta.url)); loaded = true;
}
export class SamplerWorkletNode {
  readonly node: AudioWorkletNode; private sent = new Set<string>();
  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'sampler-processor', { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2] });
  }
  loadSample(id: string, buf: AudioBuffer): void {
    if (this.sent.has(id)) return; this.sent.add(id);
    const { channels, sampleRate } = extractChannels(buf);
    this.node.port.postMessage({ type: 'loadSample', sampleId: id, channels, sampleRate }, channels.map((c) => c.buffer));
  }
  spawn(kind: 'sampler' | 'audio', spawn: SampleSpawn): void { this.node.port.postMessage({ type: 'spawn', kind, spawn }); }
  connectDry(dest: AudioNode): void { this.node.connect(dest, 0); }
  connectSend(delayInput: AudioNode, reverbInput: AudioNode): void { this.node.connect(delayInput, 1); this.node.connect(reverbInput, 1); }
  disconnect(): void { this.node.disconnect(); }
}
```

- [ ] **Step 5: Run tests + typecheck** → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/audio-worklet/sampler-processor.ts src/audio-worklet/sampler-node.ts src/audio-worklet/sampler-node.test.ts
git commit -m "feat(worklet): sampler processor (dry+send) + node wrapper with buffer transfer"
```

---

## Task 4: SamplerWorkletEngine + AudioWorkletEngine + routing (incl. sample-mode drums)

**Files:** Create `src/engines/sampler-worklet-engine.ts`, `src/engines/audio-worklet-engine.ts`; Modify `src/engines/drums-worklet-engine.ts`, `src/app/lane-allocator.ts`, `src/main.ts`; Tests for each engine.

**Interfaces:**
- `SamplerWorkletEngine implements SynthEngine` — keeps ALL the existing Sampler UI/keymap/pad-store/instrument-loading logic from `SamplerEngine` (that code is main-thread and unchanged), but `createVoice().trigger(midi,…)` resolves the spawn (keymap lookup via `keymapEntryFor`, `repitchRate`, `getPad`, `samplePlaybackWindow`, audible/velocity) and posts it to a shared `SamplerWorkletNode` instead of building a `SamplerVoice` graph. On keymap/sample load it pushes the decoded buffer to the worklet bank (`node.loadSample(sampleId, sampleCache.get(sampleId))`). The audio-clip path (`opts.sample`) posts `kind:'audio'` with the warp/stretch buffer resolved main-thread (render via `warpStretch`/`stretchBuffer`, push to bank under a warp key, post the spawn referencing it).
- `AudioWorkletEngine implements SynthEngine` — thin: resolves the clip buffer (warp/stretch as today) + posts `kind:'audio'`.
- `DrumsWorkletEngine` (Phase 2b): in `kitMode === 'sample'`, delegate triggers to a `SamplerWorkletEngine` instance (the embedded sampler) exactly as today, but through the worklet path — so the **Sampler-as-drumkit** plays in the worklet too.

- [ ] **Step 1: Write the failing tests** (mock `SamplerWorkletNode`; assert a triggered note posts a resolved spawn; assert `loadSample` is called on keymap set; assert audio-clip posts `kind:'audio'`).

```ts
// src/engines/sampler-worklet-engine.test.ts  (sketch — fill with the mock pattern from earlier phases)
// 1) setKeymap([entry]) + a decoded buffer in sampleCache → node.loadSample(entry.sampleId) called.
// 2) createVoice().trigger(rootNote,…) → node.spawn('sampler', {sampleId, rate≈1, …}).
// 3) trigger with opts.sample → node.spawn('audio', …).
```

- [ ] **Step 2: Run tests to verify they fail** → FAIL.

- [ ] **Step 3: Write `SamplerWorkletEngine`** — copy `SamplerEngine` wholesale (UI, keymap, padStore, mute/solo, loadFamilyRef) and replace ONLY the audio path: remove `SamplerVoice`; add a `SamplerWorkletNode`; `createVoice` returns a thin `Voice` posting spawns; add `pushBuffer(sampleId)` calls wherever a sample becomes available (`setKeymap`, `loadFamilyRef`, import). Resolve the spawn fields from `getPad`/`repitchRate`/`samplePlaybackWindow`/`isPadAudible`/`velGain` (same math as `SamplerVoice.trigger`).

- [ ] **Step 4: Write `AudioWorkletEngine`** — port `AudioVoice.trigger`'s buffer resolution (`playAudioClip`'s cache logic) to compute `{bufferId, rate, offset, gain}` main-thread, push the (warped/stretched) buffer to the bank, post `kind:'audio'`.

- [ ] **Step 5: Wire sample-mode drums** — in `DrumsWorkletEngine`, replace the embedded Web-Audio `SamplerEngine` with `SamplerWorkletEngine`; sample-mode triggers post through it (the GM-note → pad mapping is unchanged). Verify a sample drumkit plays.

- [ ] **Step 6: Route in the allocator + boot** — route `sampler` + `audio` to the worklet engines; connect dry → strip, send → `fx.delayInput`/`fx.reverbInput`. Add `await loadSamplerWorklet(ctx)` at boot. On any sample decode (import, stem, drumkit load), call the lane node's `loadSample`.

- [ ] **Step 7: Run tests + typecheck + build** → unit suite green; `npx tsc --noEmit` clean; `npm run build` OK.

- [ ] **Step 8: Manual audible verification** — (a) a Sampler lane: keymapped one-shots repitch correctly, per-pad cutoff/level/pan/sends work, loops loop; (b) an Audio channel: a loop plays tempo-locked (warp/stretch), no first-play noise; (c) a **sample drumkit** (Drums in sample mode, e.g. a tidal kit): each pad plays, mute/solo works. Compare to pre-worklet.

- [ ] **Step 9: Commit**

```bash
git add src/engines/sampler-worklet-engine.ts src/engines/sampler-worklet-engine.test.ts src/engines/audio-worklet-engine.ts src/engines/audio-worklet-engine.test.ts src/engines/drums-worklet-engine.ts src/app/lane-allocator.ts src/main.ts
git commit -m "feat(worklet): sampler + audio + sample-drumkit through the worklet"
```

---

## Self-Review

**Spec coverage:** Build-order step 3 ("Sampler / Audio — buffer transfer + repitch; warp = pre-render") — sample bank + transfer (Task 1), repitch via `BufferPlayer` rate + per-pad chain (Task 2), worklet (Task 3), all three consumers wired incl. **Sampler-as-drumkit** (Task 4, the user's reminder). Warp/WSOLA stays a main-thread pre-render (constraint + Task 4). Per-pad sends preserved via a send output (constraint + Task 3).

**Placeholder scan:** Task 4 describes the engine ports as "copy `SamplerEngine` wholesale, replace only the audio path" + a test sketch, rather than re-inlining the ~800-line Sampler UI (which is unchanged main-thread code). This is a concrete "reuse existing code, swap the voice path" instruction, not a vague TODO; the executor copies real existing code. Tasks 1–3 have full code.

**Type consistency:** `SampleData`/`SampleSpawn` (Task 1) flow through `BufferPlayer`→renderers (Task 2)→processor (Task 3)→engines (Task 4). The spawn is resolved main-thread so the worklet stays keymap-free. `SamplerWorkletNode` (Task 3) consumed by all three engines (Task 4).

**Reconcile caveats (by design):** the send-bus shape (one summed send vs split reverb/delay), and every Phase-1/2 symbol (`SchedulerQueue`, `Svf`, `VoiceRenderer`, lane wiring), are flagged to verify against the real implementation before executing.
