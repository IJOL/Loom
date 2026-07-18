// Unit tests for SamplerWorkletEngine. The SamplerWorkletNode is mocked so these
// run without a real worklet: we assert that
//   1) a keymap set + a decoded buffer in the cache → node.loadSample(sampleId),
//   2) a triggered keymapped note → node.spawn('sampler', resolved SampleSpawn),
//   3) repitch is correct (root → rate 1; +12 semis → rate 2),
//   4) the loop/song audio-clip path posts kind:'audio'.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SampleSpawn } from '../audio-dsp/sample/types';

const loaded: string[] = [];
const spawns: Array<{ kind: 'sampler' | 'audio'; spawn: SampleSpawn }> = [];
let silenceAllCalls = 0;

vi.mock('../audio-worklet/sampler-node', () => ({
  loadSamplerWorklet: vi.fn().mockResolvedValue(undefined),
  SamplerWorkletNode: class {
    private sent = new Set<string>();
    loadSample(id: string) { this.sent.add(id); loaded.push(id); }
    hasSample(id: string) { return this.sent.has(id); }
    spawn(kind: 'sampler' | 'audio', spawn: SampleSpawn) { spawns.push({ kind, spawn }); }
    silenceAll() { silenceAllCalls++; }
    connectDry() {}
    connectSend() {}
    disconnect() {}
  },
}));

import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { sampleCache } from '../samples/sample-cache';
import type { KeymapEntry } from '../samples/types';

const SR = 48000;
function fakeBuffer(durationSec: number): AudioBuffer {
  const n = Math.ceil(durationSec * SR);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(2 * Math.PI * 220 * i / SR);
  return {
    numberOfChannels: 1, sampleRate: SR, length: n, duration: durationSec,
    getChannelData: () => ch,
  } as unknown as AudioBuffer;
}

function fakeBufferAmp(durationSec: number, amp: number): AudioBuffer {
  const n = Math.ceil(durationSec * SR);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * 220 * i / SR);
  return {
    numberOfChannels: 1, sampleRate: SR, length: n, duration: durationSec,
    getChannelData: () => ch,
  } as unknown as AudioBuffer;
}

// Use a real AudioContext (from node-web-audio-api, globalized by test/setup.ts)
// so createVoice can build its worklet node without a stub.
const ctx = new AudioContext();
// Use a real gain node so the engine can connect() to it without
// node-web-audio-api rejecting a stub as an invalid destination.
const out = () => ctx.createGain();

describe('SamplerWorkletEngine', () => {
  beforeEach(() => { loaded.length = 0; spawns.length = 0; silenceAllCalls = 0; });

  it('release() silences the worklet so a long loop/song clip stops on transport Stop', () => {
    const eng = new SamplerWorkletEngine();
    const v = eng.createVoice(ctx, out());
    v.release(1.0);
    expect(silenceAllCalls).toBe(1);
  });

  it('pushes a decoded keymap buffer to the worklet bank on createVoice', () => {
    sampleCache.put('swe-kick', fakeBuffer(0.5));
    const eng = new SamplerWorkletEngine();
    const km: KeymapEntry[] = [{ sampleId: 'swe-kick', rootNote: 36, loNote: 36, hiNote: 36 }];
    eng.setKeymap(km);
    eng.createVoice(ctx, out());     // builds the node → pushes cached buffers
    expect(loaded).toContain('swe-kick');
  });

  it('a triggered keymapped note posts a sampler spawn at the root rate (≈1)', () => {
    sampleCache.put('swe-piano', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-piano', rootNote: 60, loNote: 0, hiNote: 127 }]);
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 2.0, { gateDuration: 0.5, velocity: 100 });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].kind).toBe('sampler');
    expect(spawns[0].spawn).toMatchObject({ sampleId: 'swe-piano', beginSec: 2.0, gateSec: 0.5 });
    expect(spawns[0].spawn.rate).toBeCloseTo(1, 3);
    expect(spawns[0].spawn.gain).toBeGreaterThan(0);
  });

  it('repitches an octave up to rate 2', () => {
    sampleCache.put('swe-piano2', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-piano2', rootNote: 60, loNote: 0, hiNote: 127 }]);
    const v = eng.createVoice(ctx, out());
    v.trigger(72, 0, { gateDuration: 0.5, velocity: 100 });   // +12 semitones
    expect(spawns[0].spawn.rate).toBeCloseTo(2, 3);
  });

  it('carries per-pad cutoff/pan/sends into the spawn', () => {
    sampleCache.put('swe-pad', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-pad', rootNote: 60, loNote: 60, hiNote: 60 }]);
    eng.setBaseValue('zone60.cutoff', 0.4);
    eng.setBaseValue('zone60.pan', -0.5);
    eng.setBaseValue('zone60.rev', 0.3);
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90 });
    expect(spawns[0].spawn.cutoff).toBeCloseTo(0.4, 4);
    expect(spawns[0].spawn.pan).toBeCloseTo(-0.5, 4);
    expect(spawns[0].spawn.rev).toBeCloseTo(0.3, 4);
  });

  it('an accented hit is louder than the same un-accented hit', () => {
    sampleCache.put('swe-acc', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-acc', rootNote: 60, loNote: 60, hiNote: 60 }]);
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90, accent: false });
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90, accent: true });
    expect(spawns[1].spawn.gain).toBeGreaterThan(spawns[0].spawn.gain);
  });

  it('the loop/song audio-clip path posts kind:"audio"', () => {
    sampleCache.put('swe-loop', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    const v = eng.createVoice(ctx, out());
    v.trigger(0, 0, {
      gateDuration: 1.0,
      sample: { sampleId: 'swe-loop', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].kind).toBe('audio');
    expect(spawns[0].spawn.sampleId).toBe('swe-loop');
  });

  it('a muted pad emits a silent spawn (gain 0) but still posts', () => {
    sampleCache.put('swe-mute', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-mute', rootNote: 60, loNote: 60, hiNote: 60 }]);
    eng.setDrumVoiceMute('zone60', true);
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90 });
    expect(spawns[0].spawn.gain).toBe(0);
  });

  it('peak-normalizes a quiet keymap asset louder than a full-scale one', () => {
    sampleCache.put('swe-loud', fakeBufferAmp(0.5, 1.0));   // peak ~0 dBFS → no boost
    sampleCache.put('swe-quiet', fakeBufferAmp(0.5, 0.4));  // peak ~-8 dBFS → boosted
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([
      { sampleId: 'swe-loud', rootNote: 60, loNote: 60, hiNote: 60 },
      { sampleId: 'swe-quiet', rootNote: 62, loNote: 62, hiNote: 62 },
    ]);
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90 });
    v.trigger(62, 0, { gateDuration: 0.2, velocity: 90 });
    const loud = spawns[0].spawn.gain, quiet = spawns[1].spawn.gain;
    expect(quiet).toBeGreaterThan(loud * 1.5); // the sub-peak asset is lifted toward the target
  });

  it('exposes the sampler id + piano-roll editor', () => {
    const eng = new SamplerWorkletEngine();
    expect(eng.id).toBe('sampler');
    expect(eng.editor).toBe('piano-roll');
    expect(eng.polyphony).toBe('poly');
  });
});

describe('SamplerWorkletEngine — choke', () => {
  beforeEach(() => { loaded.length = 0; spawns.length = 0; silenceAllCalls = 0; });

  // A single-note-per-key keymap with GM hat + kick notes → a drumkit.
  const drumkit = (): KeymapEntry[] => [
    { sampleId: 'swe-kick', rootNote: 36, loNote: 36, hiNote: 36 },
    { sampleId: 'swe-ch', rootNote: 42, loNote: 42, hiNote: 42 },
    { sampleId: 'swe-oh', rootNote: 46, loNote: 46, hiNote: 46 },
  ];

  it('exposes a per-pad CHOKE control (so the strip can render it)', () => {
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(drumkit());
    const spec = eng.params.find((p) => p.id === 'zone42.chokeGroup');
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe('discrete');
    expect(spec!.label).toBe('CHOKE');
  });

  it('GM hi-hats default to choke group 1 on a drumkit; the kick stays 0', () => {
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(drumkit());
    expect(eng.getBaseValue('zone42.chokeGroup')).toBe(1); // closed hat
    expect(eng.getBaseValue('zone46.chokeGroup')).toBe(1); // open hat
    expect(eng.getBaseValue('zone36.chokeGroup')).toBe(0); // kick — no choke
  });

  it('the hat choke default reaches the spawn (group 1, padNote 46, poly)', () => {
    sampleCache.put('swe-oh', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(drumkit());
    const v = eng.createVoice(ctx, out());
    v.trigger(46, 0, { gateDuration: 0.2, velocity: 90 });
    expect(spawns[0].spawn.chokeGroup).toBe(1);
    expect(spawns[0].spawn.padNote).toBe(46);
    expect(spawns[0].spawn.retrig).toBe(0);
  });

  it('an explicit CHOKE override wins over the GM-hat default', () => {
    sampleCache.put('swe-ch', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap(drumkit());
    eng.setBaseValue('zone42.chokeGroup', 0); // user turns the closed-hat choke OFF
    expect(eng.getBaseValue('zone42.chokeGroup')).toBe(0);
    const v = eng.createVoice(ctx, out());
    v.trigger(42, 0, { gateDuration: 0.2, velocity: 90 });
    expect(spawns[0].spawn.chokeGroup).toBe(0);
  });

  it('a melodic instrument (one wide zone) never gets the GM-hat default', () => {
    // Root 46 but a 0..127 range = melodic, not a drumkit → must stay poly (group 0).
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-piano', rootNote: 46, loNote: 0, hiNote: 127 }]);
    expect(eng.getBaseValue('zone46.chokeGroup')).toBe(0);
  });

  it('the (formerly dead) RETRIG mono flag now reaches the spawn', () => {
    sampleCache.put('swe-mono', fakeBuffer(1.0));
    const eng = new SamplerWorkletEngine();
    eng.setKeymap([{ sampleId: 'swe-mono', rootNote: 60, loNote: 60, hiNote: 60 }]);
    eng.setBaseValue('zone60.retrig', 1); // mono
    const v = eng.createVoice(ctx, out());
    v.trigger(60, 0, { gateDuration: 0.2, velocity: 90 });
    expect(spawns[0].spawn.retrig).toBe(1);
    expect(spawns[0].spawn.padNote).toBe(60);
  });
});
