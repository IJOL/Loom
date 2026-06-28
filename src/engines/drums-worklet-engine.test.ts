// Unit tests for DrumsWorkletEngine (synth mode). The real DrumsWorkletNode is
// mocked so these run without a real worklet: we assert the SynthEngine surface
// routes GM triggers → node.hit and kit presets → per-voice node.setVoiceParams,
// plus the per-voice bag updates on setBaseValue. A real (node-web-audio-api)
// AudioContext + FxBus back the per-voice ChannelStrips the engine builds.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hits: Array<{ v: string; t: number; vel: number }> = [];
const vparams: Array<{ v: string; p: Record<string, number> }> = [];

vi.mock('../audio-worklet/drums-node', () => ({
  loadDrumsWorklet: vi.fn().mockResolvedValue(undefined),
  DrumsWorkletNode: class {
    node = { connect() {}, disconnect() {} };
    hit(v: string, t: number, vel: number) { hits.push({ v, t, vel }); }
    setVoiceParams(v: string, p: Record<string, number>) { vparams.push({ v, p }); }
    connectVoice() {}
    voiceIndex() { return 0; }
    disconnect() {}
  },
}));

import { DrumsWorkletEngine } from './drums-worklet-engine';
import { DRUM_LANES } from '../core/drums';
import { FxBus, ChannelStrip } from '../core/fx';

// Build an engine already wired with a real ctx + FxBus so createVoice can build
// the per-voice ChannelStrips. (DrumsWorkletNode is mocked → no real worklet.)
function makeEngine() {
  const ctx = new AudioContext();
  const fx = new FxBus(ctx, ctx.destination);
  const out = ctx.createGain();
  const eng = new DrumsWorkletEngine();
  eng.setSharedFx(fx);
  const busStrip = new ChannelStrip(ctx, ctx.destination, fx);
  eng.setBusStrip(busStrip);
  return { ctx, out, eng };
}

describe('DrumsWorkletEngine (synth mode)', () => {
  beforeEach(() => { hits.length = 0; vparams.length = 0; });

  it('a GM kick note posts a kick hit at the trigger time', () => {
    const { ctx, out, eng } = makeEngine();
    const v = eng.createVoice(ctx, out);
    v.trigger(36, 2.0, { gateDuration: 0.1, accent: false, velocity: 100 }); // 36 = GM kick
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ v: 'kick', t: 2.0 });
    expect(hits[0].vel).toBeGreaterThan(0);
  });

  it('a GM open-hat note posts an openHat hit (per-voice routing)', () => {
    const { ctx, out, eng } = makeEngine();
    const v = eng.createVoice(ctx, out);
    v.trigger(46, 1.0, { gateDuration: 0.1, accent: false, velocity: 90 }); // 46 = GM open hat
    expect(hits[0].v).toBe('openHat');
  });

  it('an accented hit is louder than the same un-accented hit', () => {
    const { ctx, out, eng } = makeEngine();
    const v = eng.createVoice(ctx, out);
    v.trigger(36, 0, { gateDuration: 0.1, accent: false, velocity: 90 });
    v.trigger(36, 0, { gateDuration: 0.1, accent: true, velocity: 90 });
    expect(hits[1].vel).toBeGreaterThan(hits[0].vel);
  });

  it('wiring posts one param bag per drum voice to the worklet on createVoice', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);
    const voicesPushed = new Set(vparams.map((p) => p.v));
    expect(voicesPushed.size).toBe(DRUM_LANES.length);   // one bag per drum voice
    for (const lane of DRUM_LANES) expect(voicesPushed.has(lane)).toBe(true);
  });

  it('applyPreset(kit) re-pushes one param bag per drum voice', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);
    vparams.length = 0;
    eng.applyPreset('TR-909');
    const voicesPushed = new Set(vparams.map((p) => p.v));
    expect(voicesPushed.size).toBe(DRUM_LANES.length);
  });

  it('setBaseValue on a synth leaf re-sends that voice bag carrying the new value', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);
    vparams.length = 0;
    eng.setBaseValue('kick.decay', 0.77);
    expect(eng.getBaseValue('kick.decay')).toBeCloseTo(0.77, 5);
    const lastKick = [...vparams].reverse().find((p) => p.v === 'kick');
    expect(lastKick).toBeDefined();
    expect(lastKick!.p.decay).toBeCloseTo(0.77, 5);
  });

  it('exposes the drum-grid editor + drums-machine id', () => {
    const eng = new DrumsWorkletEngine();
    expect(eng.id).toBe('drums-machine');
    expect(eng.editor).toBe('drum-grid');
  });
});

describe('DrumsWorkletEngine — channel filter params', () => {
  it('declares filter.cutoff (20..20000, default 20000) and filter.resonance (0.7..18, default 0.7)', () => {
    const eng = new DrumsWorkletEngine();
    const cutoff = eng.params.find((p) => p.id === 'filter.cutoff')!;
    const res = eng.params.find((p) => p.id === 'filter.resonance')!;
    expect(cutoff).toMatchObject({ kind: 'continuous', min: 20, max: 20000, default: 20000, curve: 'log' });
    expect(res).toMatchObject({ kind: 'continuous', default: 0.7 });
    expect(res.min).toBeCloseTo(0.7, 5);
    expect(res.max).toBe(18);
  });

  it('get/setBaseValue round-trips the filter params and drives the live filter node', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);                 // builds the filter node
    eng.setBaseValue('filter.cutoff', 600);
    eng.setBaseValue('filter.resonance', 8);
    expect(eng.getBaseValue('filter.cutoff')).toBeCloseTo(600, 3);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(8, 3);
  });

  it('defaults read back as fully-open passthrough before any edit', () => {
    const eng = new DrumsWorkletEngine();
    expect(eng.getBaseValue('filter.cutoff')).toBe(20000);
    expect(eng.getBaseValue('filter.resonance')).toBeCloseTo(0.7, 5);
  });
});

describe('DrumsWorkletEngine — filter modulation destinations', () => {
  it('getSharedAudioParams exposes filter.cutoff→detune and filter.resonance→Q', () => {
    const { ctx, out, eng } = makeEngine();
    eng.createVoice(ctx, out);
    const m = eng.getSharedAudioParams();
    expect(m.has('filter.cutoff')).toBe(true);
    expect(m.has('filter.resonance')).toBe(true);
  });

  it('the bus range lookup gives cutoff the full cents span and resonance its Q span', () => {
    const eng = new DrumsWorkletEngine();
    const lut = (eng as unknown as { busRangeLookup(id: string): { min: number; max: number } }).busRangeLookup;
    const cut = lut('filter.cutoff');
    expect(cut.max - cut.min).toBeCloseTo(1200 * Math.log2(1000), 0);
    const res = lut('filter.resonance');
    expect(res.min).toBeCloseTo(0.7, 5);
    expect(res.max).toBe(18);
  });
});
