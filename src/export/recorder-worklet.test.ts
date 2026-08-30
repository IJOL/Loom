// src/export/recorder-worklet.test.ts
import { describe, it, expect } from 'vitest';
import { RECORDER_PROCESSOR_NAME, RECORDER_WORKLET_SOURCE } from './recorder-worklet';

describe('recorder worklet source', () => {
  it('registers the named processor', () => {
    expect(RECORDER_PROCESSOR_NAME).toBe('loom-scene-recorder');
    expect(RECORDER_WORKLET_SOURCE).toContain(`registerProcessor('${RECORDER_PROCESSOR_NAME}'`);
    expect(RECORDER_WORKLET_SOURCE).toContain('extends AudioWorkletProcessor');
  });
});

// Minimal worklet harness: the source reads bare globals `currentTime` /
// `sampleRate` and calls `registerProcessor`; give it all three and drive
// process() by hand. Instantiated fresh per test.
function makeProcessor() {
  let ProcessorClass: any = null;
  const g = globalThis as any;
  g.AudioWorkletProcessor = class {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      posted: [] as any[],
      postMessage(msg: unknown) { this.posted.push(msg); },
    };
  };
  g.registerProcessor = (_name: string, cls: unknown) => { ProcessorClass = cls; };
  g.sampleRate = 100; // 100 Hz → one 10-sample block = 0.1 s; tiny on purpose
  g.currentTime = 0;
  // eslint-disable-next-line no-eval
  (0, eval)(RECORDER_WORKLET_SOURCE);
  const p = new ProcessorClass();
  const step = (n = 10) => {
    // one block of a 0→1 ramp so slicing errors show up as wrong VALUES too
    const left = Float32Array.from({ length: n }, (_, i) => (i + 1) / n);
    const alive = p.process([[left, left.slice()]]);
    (globalThis as any).currentTime += n / 100;
    return alive;
  };
  const send = (data: unknown) => p.port.onmessage!({ data });
  return { p, step, send, posted: p.port.posted as any[] };
}

describe('recorder worklet window updates', () => {
  it('a second window message cuts a running open-ended capture at that exact time', () => {
    const { step, send, posted } = makeProcessor();
    send({ type: 'window', startTime: 0.1, endTime: Infinity }); // start at block 2
    step(); // 0.0–0.1: before the window — nothing captured
    step(); // 0.1–0.2: recording
    send({ type: 'window', startTime: 0.1, endTime: 0.25 });     // the quantized cut
    const alive = step(); // 0.2–0.3: captures half the block, then finalizes
    expect(alive).toBe(false);
    expect(posted.length).toBe(1);
    const done = posted[0];
    expect(done.type).toBe('done');
    // 0.1→0.25 at 100 Hz = 15 frames: one full block + half of the next
    expect(done.left.length).toBe(15);
    // the cut slices INSIDE the last block: its final frame is the ramp's
    // 5th sample (0.5), not the block's last (1.0)
    expect(done.left[14]).toBeCloseTo(0.5, 5);
  });
});
