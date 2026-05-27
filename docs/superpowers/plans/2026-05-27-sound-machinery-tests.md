# Sound Machinery Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-layer test suite covering sequencer scheduling, real DSP per engine, drum kits, and modulation host wiring, plus WAV artifact emission for human comparison.

**Architecture:** Vitest + `node-web-audio-api` for real `OfflineAudioContext` rendering in Node. Three reusable helpers (`renderEngine`, `dsp-asserts`, `sequencer-harness`) plus a shared engine battery (`dsp-battery`). Per-engine DSP tests are independent and meant to be implemented in parallel by separate subagents.

**Tech Stack:** TypeScript 5.4, Vitest 3.2, `node-web-audio-api` (Ircam), existing engine + sequencer + modulation infrastructure.

**Spec:** [docs/superpowers/specs/2026-05-27-sound-machinery-tests-design.md](../specs/2026-05-27-sound-machinery-tests-design.md)

---

## File Structure

**New files:**

```text
test/
  setup.ts                                  # globalize node-web-audio-api
  wav.ts                                    # writeWav(buf, path, sr) + wavPath(name)
  render.ts                                 # renderEngine(factory, opts)
  dsp-asserts.ts                            # rms, peak, isSilent, spectralCentroid, freqContour
  dsp-battery.ts                            # runStandardEngineBattery shared across engine tests
  sequencer-harness.ts                      # makeSchedulerHarness for layer-2 mocks
scripts/
  wav-diff.ts                               # compares test/output/ to test/golden/
  wav-bless.ts                              # copies output → golden
src/engines/tb303.dsp.test.ts               # layer 3
src/engines/subtractive.dsp.test.ts         # layer 3
src/engines/fm.dsp.test.ts                  # layer 3
src/engines/wavetable.dsp.test.ts           # layer 3
src/engines/karplus.dsp.test.ts             # layer 3
src/core/drums.dsp.test.ts                  # layer 3 — 8 lanes × 5 kits
src/core/sequencer.test.ts                  # layer 2 (file is new; sequencer had no test)
src/modulation/lfo-voice.wiring.test.ts     # layer 4
src/modulation/adsr-voice.wiring.test.ts    # layer 4
```

**Modified files:**

- `package.json` — add `node-web-audio-api` dep, add scripts.
- `vitest.config.ts` — add `setupFiles`, include `.dsp.test.ts` and `.wiring.test.ts`.
- `tsconfig.json` — include `test` directory.
- `.gitignore` — ignore `test/output/`.

**Why this layout:**

- DSP tests live next to the engine they test so a developer touching `tb303.ts` immediately sees `tb303.dsp.test.ts` in the same folder.
- All helpers under `test/` (root-level) so source code stays clean.
- `dsp-battery.ts` exists to keep the per-engine test files tiny (~30 lines each) by sharing the five standard assertions.
- The sequencer test file is at `src/core/sequencer.test.ts` (no `.dsp.` suffix) because it does not render audio — it uses mocks and the fake clock.

---

## Phase 1 — Infrastructure

### Task 1: Add `node-web-audio-api` and global setup

**Files:**
- Modify: `package.json`
- Create: `test/setup.ts`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-dev node-web-audio-api
```

Expected: `package.json` gains `"node-web-audio-api": "^<version>"` under `devDependencies`. No errors. If install fails on Windows because of native build, retry once; if it still fails, halt and report — falling back to a non-native shim defeats the spec.

- [ ] **Step 2: Write the global setup file**

Create `test/setup.ts`:

```ts
// Globalize node-web-audio-api so src/ code that calls `new AudioContext()`
// or `new OfflineAudioContext(...)` works under Vitest in Node.
//
// We attach every constructor src/ might instantiate by global name. The
// list comes from `Object.keys(require('node-web-audio-api'))` filtered to
// things that look like classes — extend if a new node type is needed.

import * as nwa from 'node-web-audio-api';

const g = globalThis as unknown as Record<string, unknown>;

// The whole-API copy is safe because we only assign properties not already
// present; this preserves any test that wants to stub a specific class.
for (const [name, value] of Object.entries(nwa)) {
  if (typeof value === 'function' && !(name in g)) {
    g[name] = value;
  }
}

// Sequencer uses `window.setTimeout` — alias window to globalThis so it works
// in the Node test environment.
if (!('window' in g)) g.window = g;
```

- [ ] **Step 3: Update vitest config**

Replace the contents of `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.dsp.test.ts', 'src/**/*.wiring.test.ts'],
    globals: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
  },
});
```

The longer `testTimeout` covers DSP tests that render 1 s of audio at 44.1 kHz.

- [ ] **Step 4: Update tsconfig**

In `tsconfig.json`, change `"include": ["src"]` to `"include": ["src", "test", "scripts"]`.

- [ ] **Step 5: Smoke test**

Create a temporary `test/setup.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('node-web-audio-api setup', () => {
  it('OfflineAudioContext is globally available', () => {
    expect(typeof (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext)
      .toBe('function');
  });

  it('can render a 0.1 s sine wave', async () => {
    const ctx = new (globalThis as { OfflineAudioContext: typeof OfflineAudioContext })
      .OfflineAudioContext(1, 4410, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start(0);
    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1.0);
  });
});
```

- [ ] **Step 6: Run the smoke test**

```bash
npx vitest run src/setup.smoke.test.ts -- --no-coverage
```

Note: vitest's include pattern doesn't match `test/setup.smoke.test.ts`. Move the smoke file to `src/_smoke/setup.smoke.test.ts` first, run, then delete the file.

```bash
mkdir -p src/_smoke
mv test/setup.smoke.test.ts src/_smoke/setup.smoke.test.ts
npx vitest run src/_smoke/setup.smoke.test.ts
```

Expected: 2 passing tests. If OfflineAudioContext is undefined, the setup file is not being loaded — check `setupFiles` path is `test/setup.ts` and tsconfig includes `test`.

- [ ] **Step 7: Remove the smoke test**

```bash
rm -rf src/_smoke
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json test/setup.ts
git commit -m "$(cat <<'EOF'
test: add node-web-audio-api setup for offline audio rendering

Globalizes AudioContext / OfflineAudioContext / friends so src/ code
under test can call them as in the browser. Includes .dsp.test.ts and
.wiring.test.ts in vitest's pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: WAV writer helper

**Files:**
- Create: `test/wav.ts`
- Create: `src/_smoke/wav.smoke.test.ts` (will be deleted)

- [ ] **Step 1: Write the failing test**

Create `src/_smoke/wav.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync, rmSync } from 'node:fs';
import { writeWav, wavPath } from '../../test/wav';

describe('writeWav', () => {
  it('writes a valid 16-bit PCM WAV file', () => {
    const data = new Float32Array(44100);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5;

    const path = wavPath('smoke-test-440hz');
    writeWav(data, path, 44100);

    expect(existsSync(path)).toBe(true);
    const stat = statSync(path);
    // 44 bytes header + 2 bytes per sample × 44100 samples
    expect(stat.size).toBe(44 + 2 * 44100);

    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');

    rmSync(path);
  });

  it('wavPath resolves to test/output/<name>.wav', () => {
    expect(wavPath('foo')).toMatch(/test[\\/]output[\\/]foo\.wav$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/_smoke/wav.smoke.test.ts
```

Expected: FAIL with `Cannot find module '../../test/wav'`.

- [ ] **Step 3: Implement `test/wav.ts`**

```ts
// test/wav.ts
// Minimal 16-bit PCM WAV writer for DSP test artifacts.
// Not a general-purpose audio library — only writes mono Float32Array.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const OUTPUT_DIR = resolve(process.cwd(), 'test', 'output');

export function wavPath(name: string): string {
  return join(OUTPUT_DIR, `${name}.wav`);
}

export function writeWav(buf: Float32Array, path: string, sampleRate: number): void {
  mkdirSync(dirname(path), { recursive: true });

  const numSamples = buf.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const fileSize = 36 + dataSize;

  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(fileSize, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);            // fmt chunk size
  out.writeUInt16LE(1, 20);             // PCM format
  out.writeUInt16LE(1, 22);             // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(16, 34);            // bits per sample
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clipped = Math.max(-1, Math.min(1, buf[i]));
    const s = Math.round(clipped * 32767);
    out.writeInt16LE(s, 44 + i * 2);
  }

  writeFileSync(path, out);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/_smoke/wav.smoke.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Remove the smoke test**

```bash
rm -rf src/_smoke
```

- [ ] **Step 6: Commit**

```bash
git add test/wav.ts
git commit -m "$(cat <<'EOF'
test: add WAV writer helper for DSP test artifacts

writeWav() emits 16-bit PCM mono WAV at test/output/<name>.wav so DSP
test runs leave inspectable audio files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `renderEngine` helper

**Files:**
- Create: `test/render.ts`
- Create: `src/_smoke/render.smoke.test.ts` (will be deleted)

- [ ] **Step 1: Write the failing test**

Create `src/_smoke/render.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderEngine, type RenderEvent } from '../../test/render';

describe('renderEngine', () => {
  it('renders a buffer of the requested length', async () => {
    const buf = await renderEngine(
      (ctx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        osc.connect(gain);
        osc.start(0);
        return {
          voice: {
            trigger() {},
            release() {},
            connect() {},
            dispose() {},
            getAudioParams: () => new Map(),
          },
          output: gain,
        };
      },
      { durationSec: 0.5, sampleRate: 44100, events: [] },
    );
    expect(buf.length).toBe(22050);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    expect(peak).toBeGreaterThan(0.1);
  });

  it('translates trigger events to voice.trigger calls', async () => {
    const calls: RenderEvent[] = [];
    await renderEngine(
      (ctx) => ({
        voice: {
          trigger(midi, time, opts) { calls.push({ time, type: 'trigger', midi, ...opts }); },
          release(time) { calls.push({ time, type: 'release' }); },
          connect() {},
          dispose() {},
          getAudioParams: () => new Map(),
        },
        output: ctx.createGain(),
      }),
      {
        durationSec: 0.5, sampleRate: 44100,
        events: [
          { time: 0,    type: 'trigger', midi: 36, gateDuration: 0.2 },
          { time: 0.25, type: 'release' },
        ],
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ time: 0, type: 'trigger', midi: 36, gateDuration: 0.2 });
    expect(calls[1]).toMatchObject({ time: 0.25, type: 'release' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/_smoke/render.smoke.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `test/render.ts`**

```ts
// test/render.ts
// Renders an engine voice through an OfflineAudioContext and returns the
// mono Float32Array result.

import type { Voice, VoiceTriggerOptions } from '../src/engines/engine-types';

export type RenderEvent =
  | { time: number; type: 'trigger'; midi: number; gateDuration: number;
      accent?: boolean; slide?: boolean; velocity?: number }
  | { time: number; type: 'release' };

export interface EngineFactoryResult {
  voice: Voice;
  output: AudioNode;
}

export type EngineFactory = (ctx: OfflineAudioContext) => EngineFactoryResult;

export interface RenderOpts {
  durationSec: number;
  sampleRate: number;
  events: RenderEvent[];
}

export async function renderEngine(
  factory: EngineFactory,
  opts: RenderOpts,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(
    1,
    Math.round(opts.durationSec * opts.sampleRate),
    opts.sampleRate,
  );

  const { voice, output } = factory(ctx as unknown as OfflineAudioContext);
  output.connect(ctx.destination);

  for (const ev of opts.events) {
    if (ev.type === 'trigger') {
      const triggerOpts: VoiceTriggerOptions = { gateDuration: ev.gateDuration };
      if (ev.accent !== undefined)   triggerOpts.accent   = ev.accent;
      if (ev.slide !== undefined)    triggerOpts.slide    = ev.slide;
      if (ev.velocity !== undefined) triggerOpts.velocity = ev.velocity;
      voice.trigger(ev.midi, ev.time, triggerOpts);
    } else {
      voice.release(ev.time);
    }
  }

  const audioBuffer = await ctx.startRendering();
  // Copy out so the buffer is detached from any context lifetime.
  return new Float32Array(audioBuffer.getChannelData(0));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/_smoke/render.smoke.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Remove the smoke test**

```bash
rm -rf src/_smoke
```

- [ ] **Step 6: Commit**

```bash
git add test/render.ts
git commit -m "$(cat <<'EOF'
test: add renderEngine helper for offline audio tests

Mounts an engine voice in an OfflineAudioContext, replays an event
list, and returns the rendered mono Float32Array.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: DSP assertion helpers

**Files:**
- Create: `test/dsp-asserts.ts`
- Create: `src/_smoke/dsp-asserts.smoke.test.ts` (will be deleted)

- [ ] **Step 1: Write the failing test**

Create `src/_smoke/dsp-asserts.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  rms, peak, isSilent, spectralCentroid, freqContour,
  expectRising, expectFalling,
} from '../../test/dsp-asserts';

function sine(freq: number, sr: number, durSec: number, amp = 0.5): Float32Array {
  const n = Math.round(sr * durSec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(2 * Math.PI * freq * i / sr) * amp;
  return out;
}

describe('dsp-asserts', () => {
  it('peak/rms of a sine match expectations', () => {
    const buf = sine(440, 44100, 0.5, 0.5);
    expect(peak(buf)).toBeCloseTo(0.5, 2);
    expect(rms(buf)).toBeCloseTo(0.5 / Math.sqrt(2), 2);
  });

  it('isSilent detects a zero buffer', () => {
    expect(isSilent(new Float32Array(1024))).toBe(true);
    expect(isSilent(sine(440, 44100, 0.1))).toBe(false);
  });

  it('spectralCentroid of a 1kHz sine is near 1kHz', () => {
    const buf = sine(1000, 44100, 0.2, 0.5);
    const c = spectralCentroid(buf, 44100);
    expect(c).toBeGreaterThan(800);
    expect(c).toBeLessThan(1200);
  });

  it('spectralCentroid is higher for a 4kHz sine than for a 200Hz sine', () => {
    const hi = sine(4000, 44100, 0.2, 0.5);
    const lo = sine(200,  44100, 0.2, 0.5);
    expect(spectralCentroid(hi, 44100)).toBeGreaterThan(spectralCentroid(lo, 44100) * 5);
  });

  it('freqContour returns one entry per window', () => {
    const buf = sine(440, 44100, 0.2);
    const contour = freqContour(buf, 44100, 20);
    expect(contour.length).toBeGreaterThan(5);
    // All windows should report ~440 Hz from zero-crossing rate.
    for (const f of contour) expect(f).toBeGreaterThan(300);
  });

  it('expectRising accepts monotonic ascending data', () => {
    expect(() => expectRising([1, 2, 3, 4, 5], 0)).not.toThrow();
  });

  it('expectRising rejects descending data', () => {
    expect(() => expectRising([5, 4, 3, 2, 1], 0)).toThrow();
  });

  it('expectFalling accepts descending data', () => {
    expect(() => expectFalling([5, 4, 3, 2, 1], 0)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/_smoke/dsp-asserts.smoke.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `test/dsp-asserts.ts`**

```ts
// test/dsp-asserts.ts
// DSP statistics + assertion helpers for audio test buffers.
// All assertions are relative (factors, ordering) — never absolute thresholds.

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function isSilent(buf: Float32Array, threshold = 1e-4): boolean {
  return peak(buf) < threshold;
}

/**
 * Spectral centroid of a buffer slice, computed over a single Hann-windowed
 * frame at the buffer's centre. Returns Hz. Frame size auto-grown to the
 * next power of two ≤ buffer length, capped at 8192 samples.
 */
export function spectralCentroid(buf: Float32Array, sampleRate: number): number {
  let frameSize = 1;
  while (frameSize * 2 <= Math.min(buf.length, 8192)) frameSize *= 2;
  if (frameSize < 64) return 0;

  const start = Math.max(0, Math.floor((buf.length - frameSize) / 2));
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frameSize - 1));
    re[i] = buf[start + i] * w;
  }

  fftRadix2(re, im);

  let weighted = 0;
  let total = 0;
  for (let k = 1; k < frameSize / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const freq = k * sampleRate / frameSize;
    weighted += mag * freq;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Zero-crossing rate per window, returned as estimated fundamental frequency
 * (Hz) per window. `hopMs` controls window stride and width.
 */
export function freqContour(buf: Float32Array, sampleRate: number, hopMs: number): number[] {
  const hop = Math.max(64, Math.round(sampleRate * hopMs / 1000));
  const out: number[] = [];
  for (let start = 0; start + hop <= buf.length; start += hop) {
    let crossings = 0;
    for (let i = start + 1; i < start + hop; i++) {
      if ((buf[i - 1] >= 0 && buf[i] < 0) || (buf[i - 1] < 0 && buf[i] >= 0)) crossings++;
    }
    const periodSec = hop / sampleRate;
    out.push(crossings / 2 / periodSec);
  }
  return out;
}

export function expectRising(values: number[], tolerance = 0.0): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1] - tolerance) {
      throw new Error(
        `expectRising: values[${i}]=${values[i]} < values[${i - 1}]=${values[i - 1]} ` +
        `(tolerance ${tolerance}); full series: ${values.join(', ')}`,
      );
    }
  }
}

export function expectFalling(values: number[], tolerance = 0.0): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1] + tolerance) {
      throw new Error(
        `expectFalling: values[${i}]=${values[i]} > values[${i - 1}]=${values[i - 1]} ` +
        `(tolerance ${tolerance}); full series: ${values.join(', ')}`,
      );
    }
  }
}

// In-place radix-2 FFT. n must be a power of two.
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k]           = uRe + vRe;
        im[i + k]           = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        const nIm = curRe * wIm + curIm * wRe;
        curRe = nRe; curIm = nIm;
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/_smoke/dsp-asserts.smoke.test.ts
```

Expected: 8 passing tests. If `spectralCentroid` returns NaN, the FFT swap probably has a typo — check the destructuring assignments.

- [ ] **Step 5: Remove the smoke test**

```bash
rm -rf src/_smoke
```

- [ ] **Step 6: Commit**

```bash
git add test/dsp-asserts.ts
git commit -m "$(cat <<'EOF'
test: add DSP assertion helpers (rms, peak, centroid, contour)

Pure utility functions used by DSP tests. All comparisons are relative
factors; helpers themselves do not assert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Engine DSP battery + gitignore

**Files:**
- Create: `test/dsp-battery.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

Append to `.gitignore`:

```text

# DSP test artifacts (regenerated on every test run)
test/output/
```

- [ ] **Step 2: Implement `test/dsp-battery.ts`**

The battery is a parameterized test factory consumed by every engine `.dsp.test.ts`. It writes WAVs and runs the five standard assertions.

```ts
// test/dsp-battery.ts
// Shared DSP test battery for SynthEngine voices. Each engine's
// .dsp.test.ts calls runStandardEngineBattery(...) plus its own
// engine-specific extras.

import { describe, it, expect } from 'vitest';
import type { SynthEngine, Voice } from '../src/engines/engine-types';
import { renderEngine, type RenderEvent } from './render';
import { rms, peak, isSilent, spectralCentroid } from './dsp-asserts';
import { writeWav, wavPath } from './wav';

export interface BatteryOpts {
  /** Test file prefix, e.g. 'tb303', 'fm', 'wavetable'. */
  name: string;
  /** Fresh engine instance per test. */
  createEngine: () => SynthEngine;
  /** Param id for the engine's main filter cutoff (skip filter test if undefined). */
  cutoffParamId?: string;
  /** Param ids written to 'maxed-out' values for the doesn't-clip test. */
  maxOutParams?: Record<string, number>;
  /** Whether the engine implements an audible accent. Default true. */
  hasAccent?: boolean;
  /** MIDI note used for the standard triggers. */
  midi?: number;
  /** Gate duration used for the standard triggers. */
  gateDuration?: number;
  /** Sample rate for renders. */
  sampleRate?: number;
}

const DEFAULT_MIDI = 36;            // C2 — bass register
const DEFAULT_GATE = 0.2;
const DEFAULT_SR   = 44100;

function buildFactory(engine: SynthEngine) {
  // We construct the output node here but do NOT connect it to ctx.destination
  // — renderEngine() owns that single connection so we don't double-route.
  return (ctx: OfflineAudioContext) => {
    const output = (ctx as unknown as { createGain(): GainNode }).createGain();
    const voice: Voice = engine.createVoice(
      ctx as unknown as AudioContext,
      output,
    );
    return { voice, output };
  };
}

async function render(
  engine: SynthEngine,
  events: RenderEvent[],
  opts: { durationSec: number; sampleRate: number },
): Promise<Float32Array> {
  return renderEngine(buildFactory(engine), {
    durationSec: opts.durationSec,
    sampleRate: opts.sampleRate,
    events,
  });
}

export function runStandardEngineBattery(o: BatteryOpts): void {
  const midi = o.midi ?? DEFAULT_MIDI;
  const gate = o.gateDuration ?? DEFAULT_GATE;
  const sr   = o.sampleRate   ?? DEFAULT_SR;

  describe(`${o.name} — standard DSP battery`, () => {
    it('produces audible sound on trigger', async () => {
      const engine = o.createEngine();
      const buf = await render(engine, [
        { time: 0, type: 'trigger', midi, gateDuration: gate },
      ], { durationSec: 0.4, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__sounds`), sr);
      expect(isSilent(buf)).toBe(false);
      expect(peak(buf)).toBeGreaterThan(0.01);
    });

    it('does not clip with max-out params', async () => {
      const engine = o.createEngine();
      if (o.maxOutParams) {
        for (const [id, v] of Object.entries(o.maxOutParams)) engine.setBaseValue(id, v);
      }
      const buf = await render(engine, [
        { time: 0, type: 'trigger', midi, gateDuration: gate, accent: true },
      ], { durationSec: 0.4, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__no-clip`), sr);
      expect(peak(buf)).toBeLessThan(1.0);
    });

    if (o.cutoffParamId) {
      it('opening filter cutoff raises spectral centroid', async () => {
        const engineLow = o.createEngine();
        engineLow.setBaseValue(o.cutoffParamId!, 0.1);
        const bufLow = await render(engineLow, [
          { time: 0, type: 'trigger', midi, gateDuration: gate },
        ], { durationSec: 0.4, sampleRate: sr });

        const engineHi = o.createEngine();
        engineHi.setBaseValue(o.cutoffParamId!, 0.9);
        const bufHi = await render(engineHi, [
          { time: 0, type: 'trigger', midi, gateDuration: gate },
        ], { durationSec: 0.4, sampleRate: sr });

        writeWav(bufLow, wavPath(`${o.name}__cutoff-low`), sr);
        writeWav(bufHi,  wavPath(`${o.name}__cutoff-hi`),  sr);

        const cLow = spectralCentroid(bufLow, sr);
        const cHi  = spectralCentroid(bufHi,  sr);
        // Factor of 2 is conservative; in practice the gap is usually 5–10×.
        expect(cHi).toBeGreaterThan(cLow * 2);
      });
    }

    if (o.hasAccent !== false) {
      it('accent raises RMS', async () => {
        const engineN = o.createEngine();
        const bufN = await render(engineN, [
          { time: 0, type: 'trigger', midi, gateDuration: gate, accent: false },
        ], { durationSec: 0.4, sampleRate: sr });

        const engineA = o.createEngine();
        const bufA = await render(engineA, [
          { time: 0, type: 'trigger', midi, gateDuration: gate, accent: true },
        ], { durationSec: 0.4, sampleRate: sr });

        writeWav(bufN, wavPath(`${o.name}__accent-off`), sr);
        writeWav(bufA, wavPath(`${o.name}__accent-on`),  sr);

        expect(rms(bufA)).toBeGreaterThan(rms(bufN));
      });
    }

    it('release cuts the gate', async () => {
      const engine = o.createEngine();
      const buf = await render(engine, [
        { time: 0,   type: 'trigger', midi, gateDuration: 1.0 },
        { time: 0.1, type: 'release' },
      ], { durationSec: 1.0, sampleRate: sr });
      writeWav(buf, wavPath(`${o.name}__release`), sr);

      // First 100 ms = the held portion; last 50 ms = well after release.
      const headLen = Math.round(0.1 * sr);
      const tailLen = Math.round(0.05 * sr);
      const head = buf.subarray(0, headLen);
      const tail = buf.subarray(buf.length - tailLen);
      // Tail should be quiet relative to head. Factor of 10 leaves room for
      // engines with long natural decays (Karplus).
      expect(rms(tail)).toBeLessThan(rms(head) * 0.1);
    });
  });
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: zero errors. The file has no test of its own — it's exercised when an engine `.dsp.test.ts` calls it (Tasks 9–14).

- [ ] **Step 4: Commit**

```bash
git add .gitignore test/dsp-battery.ts
git commit -m "$(cat <<'EOF'
test: add shared DSP battery for engine tests + gitignore test/output

runStandardEngineBattery() bundles the five standard DSP assertions
(sounds, no-clip, cutoff opens, accent raises RMS, release cuts) so
per-engine tests stay tiny.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Layer 2: Sequencer scheduling

### Task 6: Sequencer harness

**Files:**
- Create: `test/sequencer-harness.ts`

The Sequencer takes concrete `TB303`, `DrumMachine`, `PolySynth` instances. Constructing those needs an `AudioContext`, which we have via `node-web-audio-api`. We override the actual trigger callbacks (`onBassTrigger`, `onMelodyTrigger`, drum trigger via dependency stub) to capture events instead of producing audio.

- [ ] **Step 1: Implement the harness**

```ts
// test/sequencer-harness.ts
// Layer-2 harness: real Sequencer with audio dependencies present (so
// construction doesn't blow up) but trigger callbacks redirected into an
// in-memory event log. Drives the scheduler via vi.useFakeTimers() instead
// of the wall clock.

import { vi } from 'vitest';
import { Sequencer, type BassStep, type DrumStep } from '../src/core/sequencer';
import { TB303 } from '../src/core/synth';
import { DrumMachine, DRUM_LANES, type DrumVoice } from '../src/core/drums';
import { PolySynth } from '../src/polysynth/polysynth';
import { FxBus } from '../src/core/fx';
import { emptyPattern } from '../src/core/pattern';

export interface BassEvent {
  step: number;
  time: number;
  note: number;
  gate: number;
  accent: boolean;
  slidingIn: boolean;
}

export interface DrumEvent {
  step: number;
  time: number;
  lane: DrumVoice;
  accent: boolean;
}

export interface HarnessHandle {
  seq: Sequencer;
  bassLog: BassEvent[];
  drumLog: DrumEvent[];
  /** Advance both the audio clock and vitest's setTimeout queue by ms. */
  advance(ms: number): void;
  /** Tear down audio context and timers. */
  dispose(): void;
}

export interface HarnessOpts {
  bpm?: number;
  length?: number;
  bass?: BassStep[];
  drums?: Partial<Record<DrumVoice, DrumStep[]>>;
}

export function makeSchedulerHarness(opts: HarnessOpts = {}): HarnessHandle {
  vi.useFakeTimers();

  const bpm    = opts.bpm    ?? 120;
  const length = opts.length ?? 16;

  // Audio context — node-web-audio-api real instance. We don't render, we
  // only read currentTime. The sequencer also calls ctx.resume() which is
  // a no-op for a non-suspended context.
  const ctx = new AudioContext();

  // Make currentTime advance with vi's fake clock. node-web-audio-api's
  // currentTime is driven by an internal scheduler that doesn't tick under
  // fake timers, so we override the property.
  let audioNow = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => audioNow });

  const fx = new FxBus(ctx, ctx.destination);
  const synth = new TB303(ctx, ctx.destination);
  const drumMachine = new DrumMachine(ctx, fx, ctx.destination);
  const polysynth = new PolySynth(ctx, ctx.destination);

  const seq = new Sequencer(ctx, synth, drumMachine, polysynth, length);
  seq.bpm = bpm;

  // Seed bass / drum patterns if provided. The default emptyPattern is fine
  // for tests that don't need notes.
  if (opts.bass) {
    for (let i = 0; i < Math.min(length, opts.bass.length); i++) {
      seq.pattern.bass[i] = { ...opts.bass[i] };
    }
  }
  if (opts.drums) {
    for (const lane of DRUM_LANES) {
      const steps = opts.drums[lane];
      if (!steps) continue;
      for (let i = 0; i < Math.min(length, steps.length); i++) {
        seq.pattern.drums[lane][i] = { ...steps[i] };
      }
    }
  }

  const bassLog: BassEvent[] = [];
  const drumLog: DrumEvent[] = [];

  // Override bass: callback replaces default trigger.
  seq.onBassTrigger = (note, time, gate, accent, slidingIn) => {
    const stepDur = 60 / seq.bpm / 4;
    const step = Math.round((time - audioStart) / stepDur);
    bassLog.push({ step, time, note, gate, accent, slidingIn });
  };

  // Drums: monkey-patch DrumMachine.trigger to log instead of synthesize.
  const origDrumTrigger = drumMachine.trigger.bind(drumMachine);
  drumMachine.trigger = (lane: DrumVoice, time: number, accent = false) => {
    const stepDur = 60 / seq.bpm / 4;
    const step = Math.round((time - audioStart) / stepDur);
    drumLog.push({ step, time, lane, accent });
    // Don't call origDrumTrigger — we don't want audio side effects.
    void origDrumTrigger;
  };

  // Capture the audio time at start() so step indices are anchored.
  let audioStart = 0;
  const origStart = seq.start.bind(seq);
  seq.start = () => {
    audioStart = audioNow + 0.06;     // matches the +0.06 in Sequencer.start
    origStart();
  };

  return {
    seq,
    bassLog,
    drumLog,
    advance(ms: number): void {
      const targetNow = audioNow + ms / 1000;
      // The sequencer's tick runs setTimeout(this.tick, 25). vi.advanceTimersByTime
      // drains those callbacks, but each callback reads currentTime — we have to
      // step audioNow in fine slices so the look-ahead window admits steps gradually.
      const sliceMs = 5;
      const slices = Math.ceil(ms / sliceMs);
      for (let s = 0; s < slices; s++) {
        const stepMs = Math.min(sliceMs, ms - s * sliceMs);
        audioNow += stepMs / 1000;
        vi.advanceTimersByTime(stepMs);
      }
      audioNow = targetNow;
    },
    dispose(): void {
      seq.stop();
      vi.useRealTimers();
      void ctx.close?.();
    },
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add test/sequencer-harness.ts
git commit -m "$(cat <<'EOF'
test: add sequencer scheduling harness with fake clock

Constructs a real Sequencer with all audio dependencies but redirects
bass/drum triggers into an event log, driven by vi.useFakeTimers().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Sequencer tests — timing, length, slide

**Files:**
- Create: `src/core/sequencer.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// src/core/sequencer.test.ts
// Layer-2 scheduling tests. No DSP — we observe the trigger event log.

import { describe, it, expect, afterEach } from 'vitest';
import { makeSchedulerHarness, type HarnessHandle } from '../../test/sequencer-harness';
import { DRUM_LANES } from './drums';

let h: HarnessHandle | null = null;
afterEach(() => { h?.dispose(); h = null; });

const fullBass = (length: number, accent = false, slide = false) =>
  Array.from({ length }, () => ({ on: true, note: 36, accent, slide }));

const stepDurMs = (bpm: number) => 60_000 / bpm / 4;

describe('Sequencer scheduling', () => {
  it('fires 16 steps at 120 BPM spaced 125 ms apart', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 16, bass: fullBass(16) });
    h.seq.start();
    h.advance(2000);   // 16 steps × 125 ms = 2000 ms
    expect(h.bassLog.length).toBeGreaterThanOrEqual(16);
    const first16 = h.bassLog.slice(0, 16);
    for (let i = 1; i < first16.length; i++) {
      const delta = first16[i].time - first16[i - 1].time;
      expect(delta).toBeCloseTo(0.125, 3);
    }
  });

  it('skips steps with on=false', () => {
    const bass = fullBass(4);
    bass[1].on = false;
    bass[3].on = false;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 4 + 50);
    const stepsFired = h.bassLog.map(e => e.step).sort();
    // Only steps 0 and 2 should have fired.
    expect(stepsFired.filter(s => s < 4)).toEqual([0, 2]);
  });

  it('setLength(8) truncates the pattern and step 0 restarts after 8 steps', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 16, bass: fullBass(16) });
    h.seq.setLength(8);
    h.seq.start();
    h.advance(stepDurMs(120) * 9);
    const steps = h.bassLog.slice(0, 9).map(e => e.step);
    expect(steps[0]).toBe(0);
    expect(steps[8]).toBe(0);
  });

  it('changing BPM mid-pattern affects the next step\'s delta only', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 8, bass: fullBass(8) });
    h.seq.start();
    h.advance(stepDurMs(120) * 4);    // ~4 steps fired
    h.seq.bpm = 60;                    // halve tempo
    h.advance(stepDurMs(60) * 2);
    const log = h.bassLog;
    expect(log.length).toBeGreaterThan(5);
    // Delta between the first two events ≈ 0.125, but a delta after the BPM
    // change should be ≈ 0.25.
    const beforeDelta = log[1].time - log[0].time;
    const afterDelta = log[log.length - 1].time - log[log.length - 2].time;
    expect(beforeDelta).toBeCloseTo(0.125, 2);
    expect(afterDelta).toBeCloseTo(0.25, 2);
  });
});

describe('Sequencer slide', () => {
  it('marks the slidingIn flag on the step AFTER a slide=true step', () => {
    const bass = fullBass(4);
    bass[0].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 5);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(0)?.slidingIn).toBe(false);
    expect(byStep.get(1)?.slidingIn).toBe(true);
    expect(byStep.get(2)?.slidingIn).toBe(false);
  });

  it('a slide-out step has gate ≈ 1.5 × normal step duration', () => {
    const bass = fullBass(2);
    bass[0].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 2, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 3);
    const step0 = h.bassLog.find(e => e.step === 0);
    const step1 = h.bassLog.find(e => e.step === 1);
    expect(step0).toBeDefined();
    expect(step1).toBeDefined();
    // Step 0's gate is stepDur * 1.5 = 0.1875 s.
    expect(step0!.gate).toBeCloseTo(0.1875, 3);
    // Step 1 is non-slide, gate ≈ stepDur * 0.92 = 0.115 s.
    expect(step1!.gate).toBeCloseTo(0.115, 3);
  });

  it('chained slides keep slidingIn=true on each following step', () => {
    const bass = fullBass(4);
    bass[0].slide = true;
    bass[1].slide = true;
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 4);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(1)?.slidingIn).toBe(true);
    expect(byStep.get(2)?.slidingIn).toBe(true);
    expect(byStep.get(3)?.slidingIn).toBe(false);
  });
});

describe('Sequencer accent and drums', () => {
  it('propagates accent flag on bass triggers', () => {
    const bass = fullBass(2, false);
    bass[1].accent = true;
    h = makeSchedulerHarness({ bpm: 120, length: 2, bass });
    h.seq.start();
    h.advance(stepDurMs(120) * 2 + 20);
    const byStep = new Map(h.bassLog.map(e => [e.step, e]));
    expect(byStep.get(0)?.accent).toBe(false);
    expect(byStep.get(1)?.accent).toBe(true);
  });

  it('kick + hat on the same step fire at the same time', () => {
    h = makeSchedulerHarness({
      bpm: 120, length: 1,
      drums: {
        kick:      [{ on: true, accent: false }],
        closedHat: [{ on: true, accent: false }],
      },
    });
    h.seq.start();
    h.advance(stepDurMs(120) + 20);
    const kick = h.drumLog.find(e => e.lane === 'kick');
    const hat  = h.drumLog.find(e => e.lane === 'closedHat');
    expect(kick).toBeDefined();
    expect(hat).toBeDefined();
    expect(kick!.time).toBeCloseTo(hat!.time, 5);
  });

  it('muting one drum lane does not affect others', () => {
    // The Sequencer has no per-lane mute; muting = clearing the lane.
    h = makeSchedulerHarness({
      bpm: 120, length: 2,
      drums: {
        kick:  [{ on: true, accent: false }, { on: true, accent: false }],
        snare: [{ on: false, accent: false }, { on: false, accent: false }],
      },
    });
    h.seq.start();
    h.advance(stepDurMs(120) * 2 + 20);
    const lanes = new Set(h.drumLog.map(e => e.lane));
    expect(lanes.has('kick')).toBe(true);
    expect(lanes.has('snare')).toBe(false);
  });

  it('after stop() no more triggers fire', () => {
    h = makeSchedulerHarness({ bpm: 120, length: 4, bass: fullBass(4) });
    h.seq.start();
    h.advance(stepDurMs(120) * 1 + 5);
    h.seq.stop();
    const beforeStop = h.bassLog.length;
    h.advance(5000);
    expect(h.bassLog.length).toBe(beforeStop);
  });
});

// Sanity: all expected drum lanes are spelled correctly for the harness.
describe('Sequencer constants', () => {
  it('every DRUM_LANES entry has a defined harness path', () => {
    for (const lane of DRUM_LANES) {
      expect(typeof lane).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/core/sequencer.test.ts
```

Expected: 11 passing tests. Most likely failure mode: the harness's `audioStart` anchor for step numbering may be off by one step. If a test reports `step` values that all look shifted by 1, adjust `audioStart = audioNow + 0.06` in the harness — the Sequencer adds 0.06 in `start()` before the first step.

- [ ] **Step 3: Commit**

```bash
git add src/core/sequencer.test.ts
git commit -m "$(cat <<'EOF'
test(sequencer): layer-2 scheduling tests for timing, slide, accent

Covers step spacing, on/off filtering, BPM change mid-pattern, setLength
truncation, slide N-1 lookback, gate 1.5× sliding step, chained slides,
accent propagation, drum multi-lane, post-stop silence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Layer 3: DSP per engine

The next six tasks (Tasks 8–13) are **independent and parallelizable**. They each touch one new file and depend only on the helpers from Phase 1. Subagent-driven execution should dispatch them concurrently.

### Task 8: TB303 DSP tests

**Files:**
- Create: `src/engines/tb303.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/engines/tb303.dsp.test.ts
// Layer-3: real DSP tests for the TB-303 engine.

import { describe, it, expect } from 'vitest';
import { TB303Engine } from './tb303';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { freqContour } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

runStandardEngineBattery({
  name: 'tb303',
  createEngine: () => new TB303Engine(),
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
    'env.amount':       0.9,
  },
});

describe('tb303 — slide', () => {
  it('two consecutive triggers with slide produce a continuous freq contour', async () => {
    const engine = new TB303Engine();
    const SR = 44100;
    const buf = await renderEngine(
      (ctx) => {
        const out = ctx.createGain();
        out.connect(ctx.destination);
        const voice = engine.createVoice(ctx as unknown as AudioContext, out);
        voice.connect(out);
        return { voice, output: out };
      },
      {
        durationSec: 0.6, sampleRate: SR,
        events: [
          { time: 0.0,  type: 'trigger', midi: 36, gateDuration: 0.4, slide: true },
          { time: 0.25, type: 'trigger', midi: 43, gateDuration: 0.25, slide: false },
        ],
      },
    );
    writeWav(buf, wavPath('tb303__slide'), SR);

    const contour = freqContour(buf, SR, 20);
    // Across the trigger boundary (~step at 0.25 s = index ~12.5 of 20 ms windows),
    // the contour should still be > 0 (no silence) and not jump by more than a
    // few-fold within a single window (continuous portamento).
    const nonZero = contour.filter(f => f > 30);
    expect(nonZero.length).toBeGreaterThan(contour.length / 2);
    let maxJump = 0;
    for (let i = 1; i < nonZero.length; i++) {
      const ratio = nonZero[i] / nonZero[i - 1];
      maxJump = Math.max(maxJump, ratio, 1 / ratio);
    }
    // A glide between C2 (65 Hz) and G2 (98 Hz) over 250 ms should never
    // produce a >2× ratio between adjacent 20 ms windows.
    expect(maxJump).toBeLessThan(2.5);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engines/tb303.dsp.test.ts
```

Expected: 6 passing tests (5 from battery + 1 slide). If the slide test fails with a too-high `maxJump`, listen to `test/output/tb303__slide.wav` — the engine may not be portamento'ing correctly, which is a real DSP bug worth investigating before relaxing the threshold.

- [ ] **Step 3: Commit**

```bash
git add src/engines/tb303.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(tb303): DSP battery + slide continuity test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Subtractive DSP tests

**Files:**
- Create: `src/engines/subtractive.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/engines/subtractive.dsp.test.ts
// Layer-3: real DSP tests for the Subtractive (poly) engine.

import { SubtractiveEngine } from './subtractive';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'subtractive',
  createEngine: () => new SubtractiveEngine(),
  // Inspect subtractive.ts for the actual cutoff param id. The engine
  // declares them under 'filter.cutoff' following the unified scheme.
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
  },
  midi: 48,  // C3 — subtractive is a poly synth, mid register
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engines/subtractive.dsp.test.ts
```

Expected: 5 passing tests. If the engine's param id is not `filter.cutoff`, the test will fail loudly — open `src/engines/subtractive.ts`, find the PARAMS array, copy the cutoff id, and update the test. (The plan author verified `filter.cutoff` exists for this engine via the spec; treat any mismatch as a discrepancy worth investigating.)

- [ ] **Step 3: Commit**

```bash
git add src/engines/subtractive.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(subtractive): standard DSP battery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: FM DSP tests

**Files:**
- Create: `src/engines/fm.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/engines/fm.dsp.test.ts
// Layer-3: real DSP tests for the FM engine.

import { describe, it, expect } from 'vitest';
import { FMEngine } from './fm';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

// FM has no traditional filter — it relies on operator ratios for brightness.
// We omit cutoffParamId and replace with a ratio test below.
runStandardEngineBattery({
  name: 'fm',
  createEngine: () => new FMEngine(),
  midi: 48,
  maxOutParams: {
    'op1.level': 1.0,
    'op2.level': 1.0,
    'amp.mix':   1.0,
  },
});

describe('fm — operator ratio', () => {
  it('raising op2.ratio raises the spectral centroid', async () => {
    const SR = 44100;
    const render = (ratio: number) => {
      const engine = new FMEngine();
      engine.setBaseValue('op2.ratio', ratio);
      return renderEngine(
        (ctx) => {
          const out = ctx.createGain();
          out.connect(ctx.destination);
          const voice = engine.createVoice(ctx as unknown as AudioContext, out);
          voice.connect(out);
          return { voice, output: out };
        },
        {
          durationSec: 0.3, sampleRate: SR,
          events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }],
        },
      );
    };
    const lo = await render(1);
    const hi = await render(8);
    writeWav(lo, wavPath('fm__ratio-lo'), SR);
    writeWav(hi, wavPath('fm__ratio-hi'), SR);
    expect(spectralCentroid(hi, SR)).toBeGreaterThan(spectralCentroid(lo, SR) * 1.5);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engines/fm.dsp.test.ts
```

Expected: 5 passing tests (4 from battery without cutoff + 1 ratio).

- [ ] **Step 3: Commit**

```bash
git add src/engines/fm.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(fm): DSP battery + op2.ratio brightness test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wavetable DSP tests

**Files:**
- Create: `src/engines/wavetable.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/engines/wavetable.dsp.test.ts
// Layer-3: real DSP tests for the Wavetable engine.

import { describe, it, expect } from 'vitest';
import { WavetableEngine } from './wavetable';
import { runStandardEngineBattery } from '../../test/dsp-battery';
import { renderEngine } from '../../test/render';
import { spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

runStandardEngineBattery({
  name: 'wavetable',
  createEngine: () => new WavetableEngine(),
  cutoffParamId: 'filter.cutoff',
  maxOutParams: {
    'filter.cutoff':    0.95,
    'filter.resonance': 0.9,
  },
  midi: 48,
});

describe('wavetable — position', () => {
  it('sweeping wave.position changes the spectral centroid', async () => {
    const SR = 44100;
    const render = (pos: number) => {
      const engine = new WavetableEngine();
      engine.setBaseValue('wave.position', pos);
      return renderEngine(
        (ctx) => {
          const out = ctx.createGain();
          out.connect(ctx.destination);
          const voice = engine.createVoice(ctx as unknown as AudioContext, out);
          voice.connect(out);
          return { voice, output: out };
        },
        {
          durationSec: 0.3, sampleRate: SR,
          events: [{ time: 0, type: 'trigger', midi: 48, gateDuration: 0.25 }],
        },
      );
    };
    const p0 = await render(0);
    const p1 = await render(1);
    writeWav(p0, wavPath('wavetable__pos-0'), SR);
    writeWav(p1, wavPath('wavetable__pos-1'), SR);
    expect(Math.abs(spectralCentroid(p0, SR) - spectralCentroid(p1, SR))).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engines/wavetable.dsp.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 3: Commit**

```bash
git add src/engines/wavetable.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(wavetable): DSP battery + position sweep test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Karplus DSP tests

**Files:**
- Create: `src/engines/karplus.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/engines/karplus.dsp.test.ts
// Layer-3: real DSP tests for the Karplus engine.
// Karplus-Strong has no traditional filter knob and no separate accent path
// (string excitation is fixed). We omit both from the battery.

import { KarplusEngine } from './karplus';
import { runStandardEngineBattery } from '../../test/dsp-battery';

runStandardEngineBattery({
  name: 'karplus',
  createEngine: () => new KarplusEngine(),
  midi: 48,
  hasAccent: false,
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/engines/karplus.dsp.test.ts
```

Expected: 3 passing tests (sounds, no-clip, release — no filter or accent battery items).

If the release test fails because Karplus has a very long natural decay (string-like), open `test/output/karplus__release.wav` to confirm. If real Karplus tails are dominating the "after release" window, increase the factor of 10 in `dsp-battery.ts` for this engine specifically by passing a custom `releaseTailFactor` option — but only after auditing the WAV.

- [ ] **Step 3: Commit**

```bash
git add src/engines/karplus.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(karplus): DSP battery (no filter, no accent)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Drums DSP tests

**Files:**
- Create: `src/core/drums.dsp.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/core/drums.dsp.test.ts
// Layer-3: real DSP tests for every drum lane × kit.

import { describe, it, expect } from 'vitest';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './drums';
import { FxBus } from './fx';
import { rms, peak, isSilent, spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

const SR = 44100;
const DURATION = 0.5;

async function renderLane(kitId: string, lane: DrumVoice, accent = false): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * DURATION), SR);
  const dest = ctx.createGain();
  dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  dm.setKit(kitId);
  dm.trigger(lane, 0, accent);
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

// Discover kits at module load. We can't call dm.listKits() before
// constructing one, but the constructor needs a context. Build a throwaway.
function listKits(): string[] {
  const ctx = new OfflineAudioContext(1, 1024, SR);
  const dest = ctx.createGain();
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  return dm.listKits().map(k => k.id);
}
const KITS = listKits();

describe('drums — every lane × every kit sounds and does not clip', () => {
  for (const kitId of KITS) {
    for (const lane of DRUM_LANES) {
      it(`${kitId}/${lane}`, async () => {
        const buf = await renderLane(kitId, lane);
        writeWav(buf, wavPath(`drums-${kitId}__${lane}`), SR);
        expect(isSilent(buf)).toBe(false);
        expect(peak(buf)).toBeLessThan(1.0);
      });
    }
  }
});

describe('drums — accent raises RMS per lane', () => {
  // Use one kit (909) as representative — accent is a per-lane code path.
  const kit = '909';
  for (const lane of DRUM_LANES) {
    it(`${lane} accent louder than non-accent`, async () => {
      const bufN = await renderLane(kit, lane, false);
      const bufA = await renderLane(kit, lane, true);
      writeWav(bufN, wavPath(`drums-${kit}__${lane}__accent-off`), SR);
      writeWav(bufA, wavPath(`drums-${kit}__${lane}__accent-on`),  SR);
      expect(rms(bufA)).toBeGreaterThan(rms(bufN));
    });
  }
});

describe('drums — character coherence', () => {
  const kit = '909';
  it('kick has low-frequency centroid in its body', async () => {
    const buf = await renderLane(kit, 'kick');
    // First 50 ms = kick body.
    const head = buf.subarray(0, Math.round(0.05 * SR));
    expect(spectralCentroid(head, SR)).toBeLessThan(400);
  });

  it('closed hat has high-frequency centroid', async () => {
    const buf = await renderLane(kit, 'closedHat');
    expect(spectralCentroid(buf, SR)).toBeGreaterThan(2000);
  });

  it('snare has intermediate centroid (between kick and hat)', async () => {
    const snare = await renderLane(kit, 'snare');
    const kick  = await renderLane(kit, 'kick');
    const hat   = await renderLane(kit, 'closedHat');
    const cS = spectralCentroid(snare, SR);
    const cK = spectralCentroid(kick,  SR);
    const cH = spectralCentroid(hat,   SR);
    expect(cS).toBeGreaterThan(cK);
    expect(cS).toBeLessThan(cH);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/core/drums.dsp.test.ts
```

Expected: 8 lanes × 5 kits = 40 "sounds + no clip" tests, plus 8 accent tests, plus 3 character tests = 51 tests.

If a kit/lane combination is silent, open the corresponding WAV at `test/output/drums-<kit>__<lane>.wav` — the kit may genuinely lack that voice or the parameter table may have a bug.

- [ ] **Step 3: Commit**

```bash
git add src/core/drums.dsp.test.ts
git commit -m "$(cat <<'EOF'
test(drums): DSP tests for every lane × kit + character coherence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Layer 4: Modulation wiring

### Task 14: LFO and ADSR voice wiring tests

**Files:**
- Create: `src/modulation/lfo-voice.wiring.test.ts`
- Create: `src/modulation/adsr-voice.wiring.test.ts`

These tests render the modulator's `output` AudioNode through a gain-bridge into a target AudioParam — exactly how the binder wires real engines — and observe the resulting modulation pattern in the rendered buffer.

- [ ] **Step 1: Write LFO wiring test**

Create `src/modulation/lfo-voice.wiring.test.ts`:

```ts
// src/modulation/lfo-voice.wiring.test.ts
// Layer-4: a free-running LFO connected to a gain via a depth bridge should
// produce audible oscillation. This catches breaks in the LFOVoice output
// path or the host's spawnVoice routing.

import { describe, it, expect } from 'vitest';
import { LFOVoice } from './lfo-voice';
import { makeDefaultLFO } from './types';
import { rms } from '../../test/dsp-asserts';

async function renderLfoIntoGain(rateHz: number, durSec: number, depth: number): Promise<Float32Array> {
  const SR = 44100;
  const ctx = new OfflineAudioContext(1, Math.round(SR * durSec), SR);

  // Source: silent DC at 0.5 amplitude. We modulate ITS gain via the LFO.
  const src = ctx.createConstantSource();
  src.offset.value = 0.5;
  const carrier = ctx.createGain();
  carrier.gain.value = 1.0;
  src.connect(carrier);
  carrier.connect(ctx.destination);
  src.start(0);

  const state = makeDefaultLFO('lfo1');
  state.rateHz = rateHz;
  state.bipolar = true;
  const lfo = new LFOVoice(ctx as unknown as AudioContext, state, () => 120);

  // Bridge: lfo.output → gain (depth) → carrier.gain
  const depthGain = ctx.createGain();
  depthGain.gain.value = depth;
  lfo.output.connect(depthGain);
  depthGain.connect(carrier.gain);

  lfo.trigger(0, { gateDuration: durSec });

  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('LFOVoice wiring', () => {
  it('produces oscillation in the bridged gain when depth > 0', async () => {
    const buf = await renderLfoIntoGain(4, 0.5, 0.4);
    // The DC (0.5) is gain-modulated by ±0.4 — output should vary across
    // the buffer. Compare RMS of the first 50 ms (likely below the LFO peak)
    // to RMS of the whole buffer.
    const head = buf.subarray(0, Math.round(44100 * 0.05));
    expect(Math.abs(rms(buf) - rms(head))).toBeGreaterThan(0.01);
  });

  it('depth=0 leaves the carrier at its base value', async () => {
    const buf = await renderLfoIntoGain(4, 0.5, 0);
    // Buffer should be ≈ 0.5 throughout. Standard deviation tiny.
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    const mean = sum / buf.length;
    let varSum = 0;
    for (let i = 0; i < buf.length; i++) varSum += (buf[i] - mean) ** 2;
    const sd = Math.sqrt(varSum / buf.length);
    expect(sd).toBeLessThan(0.01);
  });

  it('higher rateHz produces more zero crossings around the carrier mean', async () => {
    const slow = await renderLfoIntoGain(2, 0.5, 0.4);
    const fast = await renderLfoIntoGain(20, 0.5, 0.4);
    const meanCrossings = (buf: Float32Array, mean: number) => {
      let c = 0;
      for (let i = 1; i < buf.length; i++) {
        if ((buf[i - 1] >= mean && buf[i] < mean) || (buf[i - 1] < mean && buf[i] >= mean)) c++;
      }
      return c;
    };
    expect(meanCrossings(fast, 0.5)).toBeGreaterThan(meanCrossings(slow, 0.5) * 4);
  });
});
```

- [ ] **Step 2: Run the LFO wiring test**

```bash
npx vitest run src/modulation/lfo-voice.wiring.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 3: Write ADSR wiring test**

Create `src/modulation/adsr-voice.wiring.test.ts`:

```ts
// src/modulation/adsr-voice.wiring.test.ts
// Layer-4: ADSRVoice connected to a gain should follow the A→D→S envelope
// while gated and decay to ~0 after release.

import { describe, it, expect } from 'vitest';
import { ADSRVoice } from './adsr-voice';
import { makeDefaultADSR } from './types';
import { rms } from '../../test/dsp-asserts';

async function renderAdsrIntoGain(
  attack: number, decay: number, sustain: number, release: number,
  gateDur: number, totalDur: number,
): Promise<Float32Array> {
  const SR = 44100;
  const ctx = new OfflineAudioContext(1, Math.round(SR * totalDur), SR);

  const src = ctx.createConstantSource();
  src.offset.value = 1.0;
  const target = ctx.createGain();
  target.gain.value = 0.0;
  src.connect(target);
  target.connect(ctx.destination);
  src.start(0);

  const state = makeDefaultADSR('adsr1');
  state.attackSec = attack;
  state.decaySec = decay;
  state.sustain = sustain;
  state.releaseSec = release;
  const adsr = new ADSRVoice(ctx as unknown as AudioContext, state);

  const depthGain = ctx.createGain();
  depthGain.gain.value = 1.0;
  adsr.output.connect(depthGain);
  depthGain.connect(target.gain);

  adsr.trigger(0, { gateDuration: gateDur });
  adsr.release(gateDur);

  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

function meanIn(buf: Float32Array, startSec: number, endSec: number, sr: number): number {
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(buf.length, Math.floor(endSec * sr));
  let sum = 0;
  for (let i = s; i < e; i++) sum += buf[i];
  return (e - s) > 0 ? sum / (e - s) : 0;
}

describe('ADSRVoice wiring', () => {
  it('attack ramps from 0 toward peak', async () => {
    const buf = await renderAdsrIntoGain(0.1, 0.1, 0.7, 0.1, 0.5, 0.8);
    const SR = 44100;
    const early = meanIn(buf, 0,    0.02, SR);
    const peakish = meanIn(buf, 0.08, 0.12, SR);
    expect(peakish).toBeGreaterThan(early + 0.1);
  });

  it('decay falls from peak toward sustain', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.1, 0.5, 0.1, 0.5, 0.8);
    const SR = 44100;
    const justAfterAttack = meanIn(buf, 0.015, 0.025, SR);
    const afterDecay      = meanIn(buf, 0.15,  0.18,  SR);
    expect(justAfterAttack).toBeGreaterThan(afterDecay + 0.1);
  });

  it('sustain holds a level above zero while gated', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.05, 0.7, 0.1, 0.5, 0.8);
    const SR = 44100;
    const sustain = meanIn(buf, 0.3, 0.45, SR);
    expect(sustain).toBeGreaterThan(0.3);
    expect(sustain).toBeLessThan(0.9);
  });

  it('release decays toward 0 after gate ends', async () => {
    const buf = await renderAdsrIntoGain(0.01, 0.05, 0.5, 0.1, 0.3, 0.7);
    const SR = 44100;
    const beforeRelease = meanIn(buf, 0.25, 0.29, SR);
    const afterRelease  = meanIn(buf, 0.55, 0.65, SR);
    expect(afterRelease).toBeLessThan(beforeRelease * 0.3);
  });

  it('not gating produces near-silent output', async () => {
    const SR = 44100;
    const ctx = new OfflineAudioContext(1, Math.round(SR * 0.3), SR);
    const src = ctx.createConstantSource();
    src.offset.value = 1.0;
    const target = ctx.createGain();
    target.gain.value = 0.0;
    src.connect(target).connect(ctx.destination);
    src.start(0);

    const state = makeDefaultADSR('adsr1');
    const adsr = new ADSRVoice(ctx as unknown as AudioContext, state);
    adsr.output.connect(target.gain);
    // No trigger.

    const ab = await ctx.startRendering();
    const buf = new Float32Array(ab.getChannelData(0));
    expect(rms(buf)).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 4: Run the ADSR wiring test**

```bash
npx vitest run src/modulation/adsr-voice.wiring.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/modulation/lfo-voice.wiring.test.ts src/modulation/adsr-voice.wiring.test.ts
git commit -m "$(cat <<'EOF'
test(modulation): wiring tests for LFOVoice and ADSRVoice

Verifies the modulator output node, connected to a target AudioParam
via a depth bridge, produces the expected envelope/oscillation. Catches
regressions in the voice → output → bridge → AudioParam chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — WAV comparison tooling

### Task 15: WAV diff script

**Files:**
- Create: `scripts/wav-diff.ts`

- [ ] **Step 1: Implement the diff script**

```ts
// scripts/wav-diff.ts
// Compares every WAV under test/output/ to the same-named file under
// test/golden/. Prints a table of peak / RMS / spectral centroid deltas.
// Never exits non-zero — this is a human-inspection tool, not a CI gate.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'test', 'output');
const GOLDEN = resolve(process.cwd(), 'test', 'golden');

function readWavMono(path: string): { data: Float32Array; sr: number } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Not a WAV: ${path}`);
  const sr = buf.readUInt32LE(24);
  const bps = buf.readUInt16LE(34);
  if (bps !== 16) throw new Error(`Unsupported bits/sample ${bps} in ${path}`);
  const dataSize = buf.readUInt32LE(40);
  const samples = dataSize / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = buf.readInt16LE(44 + i * 2) / 32767;
  }
  return { data: out, sr };
}

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

function l2(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}

function main(): void {
  if (!existsSync(OUTPUT)) {
    console.log('test/output/ does not exist — run tests first.');
    return;
  }
  if (!existsSync(GOLDEN)) {
    console.log('test/golden/ does not exist — run `npm run test:wav-bless` to seed.');
    return;
  }
  const files = readdirSync(OUTPUT).filter(f => f.endsWith('.wav'));
  const rows: Array<{ name: string; status: string; dPeak: string; dRms: string; l2: string }> = [];
  for (const f of files) {
    const op = join(OUTPUT, f);
    const gp = join(GOLDEN, f);
    if (!existsSync(gp)) {
      rows.push({ name: f, status: 'NEW',     dPeak: '-', dRms: '-', l2: '-' });
      continue;
    }
    const a = readWavMono(op).data;
    const b = readWavMono(gp).data;
    const dPeak = (peak(a) - peak(b)).toFixed(4);
    const dRms  = (rms(a)  - rms(b)).toFixed(4);
    const l2v   = l2(a, b).toFixed(4);
    rows.push({ name: f, status: 'CMP', dPeak, dRms, l2: l2v });
  }
  rows.sort((x, y) => Math.abs(parseFloat(y.l2) || 0) - Math.abs(parseFloat(x.l2) || 0));
  const pad = (s: string, n: number) => s.padEnd(n, ' ');
  console.log(pad('FILE', 44) + pad('STATUS', 8) + pad('ΔPEAK', 10) + pad('ΔRMS', 10) + 'L2');
  for (const r of rows) {
    console.log(pad(r.name, 44) + pad(r.status, 8) + pad(r.dPeak, 10) + pad(r.dRms, 10) + r.l2);
  }
}

main();
```

- [ ] **Step 2: Add the script to package.json**

Insert into `package.json`'s `"scripts"`:

```json
"test:wav-diff": "tsx scripts/wav-diff.ts",
"test:wav-bless": "tsx scripts/wav-bless.ts"
```

You will also need `tsx` (zero-dep TypeScript runner) to execute the script as-is:

```bash
npm install --save-dev tsx
```

- [ ] **Step 3: Implement the bless script**

Create `scripts/wav-bless.ts`:

```ts
// scripts/wav-bless.ts
// Copies every WAV from test/output/ to test/golden/, overwriting. The
// resulting golden set should be committed deliberately.

import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'test', 'output');
const GOLDEN = resolve(process.cwd(), 'test', 'golden');

if (!existsSync(OUTPUT)) {
  console.error('test/output/ does not exist — run tests first.');
  process.exit(1);
}

mkdirSync(GOLDEN, { recursive: true });

const files = readdirSync(OUTPUT).filter(f => f.endsWith('.wav'));
for (const f of files) {
  copyFileSync(join(OUTPUT, f), join(GOLDEN, f));
}
console.log(`Blessed ${files.length} WAV(s) to test/golden/`);
```

- [ ] **Step 4: Smoke-test the scripts**

```bash
npm test
npm run test:wav-diff
```

Expected: `wav-diff` prints "test/golden/ does not exist" (nothing blessed yet). Then:

```bash
npm run test:wav-bless
npm run test:wav-diff
```

Expected: `wav-bless` prints "Blessed N WAV(s)"; `wav-diff` now prints a table where every row is CMP with deltas near zero and L2 ≈ 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/wav-diff.ts scripts/wav-bless.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
test: add wav-diff and wav-bless scripts

wav-diff compares test/output/ to test/golden/ and prints a delta table
(non-failing, human-inspection only). wav-bless copies output to golden
so reference WAVs can be updated deliberately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Fast / DSP scripts + initial golden bless

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test:fast and test:dsp scripts**

Edit `package.json` so `scripts` contains:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:fast": "vitest run --exclude 'src/**/*.dsp.test.ts'",
  "test:dsp": "vitest run src/**/*.dsp.test.ts",
  "test:wav-diff": "tsx scripts/wav-diff.ts",
  "test:wav-bless": "tsx scripts/wav-bless.ts"
}
```

- [ ] **Step 2: Run the full suite**

```bash
npm test
```

Expected: every test from Phases 1–4 passes. Total runtime: ~30–60 s. If anything fails, fix in place — the plan does not finish with red tests.

- [ ] **Step 3: Bless the goldens**

```bash
npm run test:wav-bless
```

- [ ] **Step 4: Verify wav-diff is clean**

```bash
npm run test:wav-diff
```

Expected: every row is CMP and L2 < 1e-5 (audio is deterministic across runs in the same machine; values should be identical bit-for-bit).

- [ ] **Step 5: Commit goldens + script changes**

```bash
git add package.json test/golden/
git commit -m "$(cat <<'EOF'
test: add test:fast / test:dsp scripts and bless initial golden WAVs

The golden set is the reference for npm run test:wav-diff. Updating
goldens is a deliberate action: regenerate WAVs, listen, then re-bless.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Layer 1 — Pure | Pre-existing (no new task). |
| Layer 2 — Scheduling | Tasks 6, 7. |
| Layer 3 — DSP real | Tasks 5, 8, 9, 10, 11, 12, 13. |
| Layer 4 — Modulation wiring | Task 14. |
| `node-web-audio-api` dep | Task 1. |
| `test/setup.ts` global | Task 1. |
| `test/render.ts` | Task 3. |
| `test/dsp-asserts.ts` | Task 4. |
| `test/sequencer-harness.ts` | Task 6. |
| `.dsp.test.ts` suffix + filter | Tasks 1 (vitest include), 16 (scripts). |
| `test:fast` / `test:dsp` | Task 16. |
| WAV artifacts | Tasks 2, 5 (per-engine), 13 (drums), 14 (modulation wiring writes via shared paths). |
| `test/output/` ignored | Task 5. |
| `wav-diff` / `wav-bless` | Tasks 15, 16. |
| Relative assertions only | Battery and all per-engine tests follow this. |
| Subagent parallelization | Tasks 8–13 are independent (no shared file). |

No spec gaps.

**Placeholder scan:** None of the disallowed phrases appear. Every code step contains complete code. Every command has expected output. Adjustments-on-failure paragraphs point to concrete fallback actions (audit the WAV, check param id) rather than vague "handle errors".

**Type consistency:** `VoiceTriggerOptions.gateDuration` is required everywhere it is used. `RenderEvent` discriminator type stays consistent across `renderEngine` callers. Engine `setBaseValue(id, v)` signature matches what tests call.

**Risk: `node-web-audio-api` API gaps.** Mitigated in Task 1 step 6 by smoke-testing oscillator + gain rendering; if either fails, halt and report. The plan does not attempt to limp along with a half-broken backend.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-sound-machinery-tests.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Tasks 8–13 are mutually independent and a perfect fit for parallel subagents. Dispatcher reviews each engine test as it returns and either accepts or sends feedback.
2. **Inline Execution** — Run through Tasks 1–16 sequentially in this session with batch checkpoints.

Which approach?
