// Unit tests for AudioWorkletEngine. SamplerWorkletNode is mocked so these run
// without a real worklet: we assert a clip trigger resolves the buffer + posts a
// flat kind:'audio' spawn, that a note WITHOUT a sample posts nothing, and that
// the engine gain folds into the spawn gain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import type { SampleSpawn } from '../audio-dsp/sample/types';

const loaded: string[] = [];
const spawns: Array<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }> = [];

vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    private sent = new Set<string>();
    loadSample(id: string) { this.sent.add(id); loaded.push(id); }
    hasSample(id: string) { return this.sent.has(id); }
    spawn(kind: 'sampler' | 'audio', spawn: SampleSpawn) { spawns.push({ kind, spawn }); }
    connectDry() {}
    connectSend() {}
    disconnect() {}
  },
}));

import { AudioWorkletEngine } from './audio-worklet-engine';
import { sampleCache } from '../samples/sample-cache';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

const out = () => ({ connect() {} }) as unknown as AudioNode;

describe('AudioWorkletEngine', () => {
  beforeEach(() => { loaded.length = 0; spawns.length = 0; });

  it('a clip trigger resolves the buffer + posts a flat kind:"audio" spawn', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('awe-loop', tone(render, 1.0, 220));
    const eng = new AudioWorkletEngine();
    const v = eng.createVoice(render as unknown as AudioContext, out());
    v.trigger(0, 1.5, {
      gateDuration: 1.0,
      sample: { sampleId: 'awe-loop', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].kind).toBe('audio');
    expect(spawns[0].spawn).toMatchObject({ sampleId: 'awe-loop', beginSec: 1.5, gateSec: 1.0 });
    expect(loaded).toContain('awe-loop');
  });

  it('a note WITHOUT a sample posts nothing (audio channel plays only clips)', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    const eng = new AudioWorkletEngine();
    const v = eng.createVoice(render as unknown as AudioContext, out());
    v.trigger(60, 0, { gateDuration: 0.5, velocity: 100 });
    expect(spawns).toHaveLength(0);
  });

  it('a missing buffer posts nothing', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    const eng = new AudioWorkletEngine();
    const v = eng.createVoice(render as unknown as AudioContext, out());
    v.trigger(0, 0, {
      gateDuration: 1.0,
      sample: { sampleId: 'awe-missing', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    expect(spawns).toHaveLength(0);
  });

  it('engine gain scales the spawn gain', () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('awe-gain', tone(render, 1.0, 220));
    const eng = new AudioWorkletEngine();
    const v = eng.createVoice(render as unknown as AudioContext, out());
    v.trigger(0, 0, { gateDuration: 1.0, sample: { sampleId: 'awe-gain', mode: 'loop', trimStart: 0, trimEnd: 1.0 } });
    const fullGain = spawns[0].spawn.gain;
    spawns.length = 0;
    eng.setBaseValue('gain', 0.5);
    v.trigger(0, 0, { gateDuration: 1.0, sample: { sampleId: 'awe-gain', mode: 'loop', trimStart: 0, trimEnd: 1.0 } });
    expect(spawns[0].spawn.gain).toBeCloseTo(fullGain * 0.5, 4);
  });

  it('exposes the audio id + mono polyphony', () => {
    const eng = new AudioWorkletEngine();
    expect(eng.id).toBe('audio');
    expect(eng.polyphony).toBe('mono');
  });
});
