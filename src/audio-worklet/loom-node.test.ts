import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultSubParams } from '../audio-dsp/default-params';
import type { MainToWorklet } from '../audio-dsp/messages';
import { LoomWorkletNode } from './loom-node';

// The wrapper's posting logic is pure; test it by capturing posted messages.
// (We don't instantiate a real AudioWorkletNode — that needs a worklet env.)
describe('loom-node message shaping', () => {
  it('defaultSubParams returns a complete SubParams snapshot', () => {
    const p = defaultSubParams();
    expect(p.osc1Level).toBeGreaterThan(0);
    expect(p.filterCutoff).toBeGreaterThan(0);
    expect(p.ampSustain).toBeGreaterThan(0);
  });

  it('postMessage payloads are well-typed spawn/params/config/steal unions', () => {
    const posted: MainToWorklet[] = [];
    const fakePort = { postMessage: (m: MainToWorklet) => posted.push(m) };
    fakePort.postMessage({ type: 'spawn', note: { midi: 60, beginSec: 1, durationSec: 0.5, velocity: 0.8, accent: false, slide: false } });
    fakePort.postMessage({ type: 'params', params: { filterCutoff: 0.7 } });
    fakePort.postMessage({ type: 'config', maxVoices: 12 });
    fakePort.postMessage({ type: 'steal', count: 3 });
    expect(posted.map((m) => m.type)).toEqual(['spawn', 'params', 'config', 'steal']);
  });

  it('silenceAll posts a steal covering every active voice (the Stop path)', () => {
    // The global AudioWorkletNode stub (test/setup.ts) lets the node construct;
    // capture what silenceAll posts to the worklet.
    const node = new LoomWorkletNode({} as BaseAudioContext, 'subtractive');
    const posted: MainToWorklet[] = [];
    node.node.port.postMessage = (m: MainToWorklet) => posted.push(m);
    node.silenceAll();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('steal');
    // A steal larger than any plausible per-lane voice count releases them all.
    expect((posted[0] as { count: number }).count).toBeGreaterThan(64);
  });

  // Regression guard for a bug that already shipped once: importing
  // loom-processor.ts as a normal ESM module on the main thread executes its
  // top-level `class extends AudioWorkletProcessor` + registerProcessor() →
  // ReferenceError at boot (those globals exist only in the worklet scope). The
  // processor MUST be referenced ONLY via the ?worker&url import (a separate
  // worklet chunk); the shared name comes from processor-name.ts.
  it('loom-node references loom-processor ONLY via ?worker&url (never a bare main-thread import)', () => {
    const src = readFileSync(new URL('./loom-node.ts', import.meta.url), 'utf8');
    // a bare `from './loom-processor'` (with or without .ts, no ?worker&url) is forbidden
    expect(src).not.toMatch(/from\s+['"]\.\/loom-processor(\.ts)?['"]/);
    // the allowed worker-url form must be present
    expect(src).toMatch(/\.\/loom-processor\.ts\?worker&url/);
  });
});
