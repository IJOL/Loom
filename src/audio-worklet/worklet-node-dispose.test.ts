/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The node wrappers import their processor bundle via Vite's `?worker&url` suffix.
// In the unit env there is no worklet runtime, so stub those URL imports — we only
// exercise the wrappers' MAIN-THREAD message protocol (dispose → port message +
// disconnect), never the real processor code.
vi.mock('./loom-processor.ts?worker&url', () => ({ default: 'mock://loom' }));
vi.mock('./drums-processor.ts?worker&url', () => ({ default: 'mock://drums' }));
vi.mock('./sampler-processor.ts?worker&url', () => ({ default: 'mock://sampler' }));

// A minimal fake AudioWorkletNode that records the messages posted to its port and
// counts disconnect() calls. node-web-audio-api has no AudioWorkletNode, so the
// real wrappers can't construct one in tests; this stands in for it.
const posted: unknown[] = [];
let disconnects = 0;

class FakeAudioWorkletNode {
  port = {
    postMessage: (m: unknown): void => { posted.push(m); },
    onmessage: null as ((e: MessageEvent) => void) | null,
  };
  connect(): void {}
  disconnect(): void { disconnects++; }
}

beforeEach(() => {
  posted.length = 0;
  disconnects = 0;
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
});

import { LoomWorkletNode } from './loom-node';
import { DrumsWorkletNode } from './drums-node';
import { SamplerWorkletNode } from './sampler-node';

// REGRESSION: a disposed lane used to only disconnect() its worklet node — but the
// processor's process() returns true, so the audio engine kept calling it forever.
// Re-importing N MIDIs left N phantom processors burning audio-thread CPU →
// progressive clicks/dropouts. dispose() must now tell the processor to die (a
// `kill` message it answers with `return false`), THEN disconnect.
describe('worklet node dispose() shuts the processor down (not just disconnect)', () => {
  it('LoomWorkletNode.dispose posts a kill message AND disconnects', () => {
    const n = new LoomWorkletNode({} as BaseAudioContext, 'subtractive');
    n.dispose();
    expect(posted).toContainEqual({ type: 'kill' });
    expect(disconnects).toBe(1);
  });

  it('DrumsWorkletNode.dispose posts a kill message AND disconnects', () => {
    const n = new DrumsWorkletNode({} as BaseAudioContext);
    n.dispose();
    expect(posted).toContainEqual({ type: 'kill' });
    expect(disconnects).toBe(1);
  });

  it('SamplerWorkletNode.dispose posts a kill message AND disconnects', () => {
    const n = new SamplerWorkletNode({} as BaseAudioContext);
    n.dispose();
    expect(posted).toContainEqual({ type: 'kill' });
    expect(disconnects).toBe(1);
  });
});
