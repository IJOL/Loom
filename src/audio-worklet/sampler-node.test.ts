import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractChannels, samplerLoadMessage, samplerSpawnMessage } from './sampler-node';
import type { SampleSpawn } from '../audio-dsp/sample/types';

const SR = 48000;

/** Minimal stand-in for the AudioBuffer fields extractChannels reads. */
function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    duration: (channels[0]?.length ?? 0) / sampleRate,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer;
}

const spawn = (o: Partial<SampleSpawn> = {}): SampleSpawn => ({
  sampleId: 's', beginSec: 0, gateSec: 1, rate: 1, offsetSec: 0,
  loop: false, loopStartSec: 0, loopEndSec: 0,
  cutoff: 1, res: 0, attack: 0.005, decay: 0.05,
  level: 1, pan: 0, rev: 0, dly: 0, gain: 1, ...o,
});

describe('extractChannels', () => {
  it('copies every channel (sliced, not aliased) and reads the buffer sampleRate', () => {
    const c0 = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    const c1 = Float32Array.from([-0.1, -0.2, -0.3, -0.4]);
    const { channels, sampleRate } = extractChannels(fakeBuffer([c0, c1], SR));
    expect(channels.length).toBe(2);
    expect(sampleRate).toBe(SR);
    // exact copy (Float32 tolerance for the 0.1-isn't-representable artifact).
    channels[0].forEach((v, i) => expect(v).toBeCloseTo(c0[i], 6));
    channels[1].forEach((v, i) => expect(v).toBeCloseTo(c1[i], 6));
    // sliced (own buffer) so the ArrayBuffer can be transferred without
    // detaching the source AudioBuffer's backing store.
    expect(channels[0].buffer).not.toBe(c0.buffer);
  });
});

describe('sampler node message shaping', () => {
  it('loadSample posts the channels + sampleRate as transferables', () => {
    const posted: { msg: unknown; transfer?: Transferable[] }[] = [];
    const port = { postMessage: (m: unknown, t?: Transferable[]) => posted.push({ msg: m, transfer: t }) };
    const channels = [new Float32Array(4), new Float32Array(4)];
    port.postMessage(...samplerLoadMessage('s', channels, SR));
    expect(posted).toHaveLength(1);
    expect(posted[0].msg).toMatchObject({ type: 'loadSample', sampleId: 's', sampleRate: SR });
    // the transfer list is the channels' ArrayBuffers (zero-copy hand-off)
    expect(posted[0].transfer).toEqual(channels.map((c) => c.buffer));
  });

  it('spawn posts a kind-tagged resolved SampleSpawn (no transferables)', () => {
    const posted: { msg: unknown; transfer?: Transferable[] }[] = [];
    const port = { postMessage: (m: unknown, t?: Transferable[]) => posted.push({ msg: m, transfer: t }) };
    const [m] = samplerSpawnMessage('sampler', spawn());
    port.postMessage(m);
    expect(posted[0].msg).toMatchObject({ type: 'spawn', kind: 'sampler' });
    expect((posted[0].msg as { spawn: SampleSpawn }).spawn.sampleId).toBe('s');
    const [audioMsg] = samplerSpawnMessage('audio', spawn());
    expect(audioMsg).toMatchObject({ type: 'spawn', kind: 'audio' });
  });
});

// Regression guard mirroring drums-node / loom-node: importing
// sampler-processor.ts as a normal ESM module on the main thread executes its
// top-level `class extends AudioWorkletProcessor` + registerProcessor() →
// ReferenceError at boot. The processor MUST be referenced ONLY via the
// ?worker&url import; the node refers to it by the registered string name.
describe('sampler-node main-thread safety', () => {
  it('references sampler-processor ONLY via ?worker&url (never a bare main-thread import)', () => {
    const src = readFileSync(new URL('./sampler-node.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/sampler-processor(\.ts)?['"]/);
    expect(src).toMatch(/\.\/sampler-processor\.ts\?worker&url/);
    expect(src).toMatch(/['"]sampler-processor['"]/);
  });
});
