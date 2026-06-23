import { describe, it, expect, vi } from 'vitest';
import type { NoteSpec, SubParams } from '../audio-dsp/types';

// Mock the node wrapper: capture spawns/params/maxVoices without a real
// AudioWorkletNode (and without loading loom-node's ?worker&url processor).
import type { ModLite } from '../audio-dsp/modulation-runtime';

const spawns: NoteSpec[] = [];
const params: Array<Partial<SubParams>> = [];
const maxVoicesCalls: number[] = [];
const modsCalls: ModLite[][] = [];
vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  defaultSubParams: (): SubParams => ({
    masterTune: 0, osc1Wave: 0, osc1Level: 0.6, osc1Detune: 0, osc2Wave: 1, osc2Level: 0.4, osc2Detune: 7,
    subLevel: 0.3, noiseLevel: 0, noiseColor: 0.6, filterCutoff: 0.55, filterResonance: 0.25,
    filterEnvAmount: 0.45, filterDrive: 0, filterKeyTrack: 0, filterBuiltinEnv: 1, filterAttack: 0.01,
    filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.35, ampBuiltinEnv: 1, ampAttack: 0.01,
    ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
  }),
  LoomWorkletNode: class {
    spawn(n: NoteSpec) { spawns.push(n); }
    setParams(p: Partial<SubParams>) { params.push(p); }
    setMaxVoices(n: number) { maxVoicesCalls.push(n); }
    setMods(m: ModLite[]) { modsCalls.push(m); }
    steal() {} onVoiceCount() {} connect() {} disconnect() {}
  },
}));

import { WorkletLaneEngine, toModLite } from './worklet-lane-engine';
import type { ModulatorState } from '../modulation/types';

const makeEngine = () => new WorkletLaneEngine({} as AudioContext, { connect() {} } as unknown as AudioNode);

describe('WorkletLaneEngine', () => {
  it('a triggered voice posts a spawn with note + gate and a normalised 0..1 velocity', () => {
    spawns.length = 0;
    const eng = makeEngine();
    const v = eng.createVoice({} as AudioContext, { connect() {} } as unknown as AudioNode);
    // velocity 100 is the MIDI 0..127 scale (trigger-dispatch convention).
    v.trigger(60, 2.0, { gateDuration: 0.5, accent: true, slide: false, velocity: 100 });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ midi: 60, beginSec: 2.0, durationSec: 0.5, accent: true, slide: false });
    // 100/127 ≈ 0.787 — proves the 0..127 → 0..1 conversion (not passed raw).
    expect(spawns[0].velocity).toBeCloseTo(100 / 127, 3);
  });

  it('a velocity-less trigger falls back to the legacy default loudness (normalised)', () => {
    spawns.length = 0;
    const eng = makeEngine();
    const v = eng.createVoice({} as AudioContext, { connect() {} } as unknown as AudioNode);
    v.trigger(64, 0, { gateDuration: 0.25 });          // no velocity, no accent
    // resolveVelocity(undefined,false) = 90 → 90/127 ≈ 0.709
    expect(spawns[0].velocity).toBeCloseTo(90 / 127, 3);
  });

  it('setBaseValue maps a dot-id knob to the SubParams field and posts it', () => {
    params.length = 0;
    const eng = makeEngine();
    eng.setBaseValue('filter.cutoff', 0.8);
    expect(params.at(-1)).toMatchObject({ filterCutoff: 0.8 });
    expect(eng.getBaseValue('filter.cutoff')).toBe(0.8);
  });

  it('poly.voices routes to the worklet voice cap (not a param post)', () => {
    params.length = 0; maxVoicesCalls.length = 0;
    const eng = makeEngine();
    eng.setBaseValue('poly.voices', 5);
    expect(maxVoicesCalls.at(-1)).toBe(5);
    expect(params).toHaveLength(0);                     // not a SubParams field
    expect(eng.getBaseValue('poly.voices')).toBe(5);
  });

  it('getAudioParams is empty (per-note params; shared modulation runs in the worklet)', () => {
    const eng = makeEngine();
    const v = eng.createVoice({} as AudioContext, { connect() {} } as unknown as AudioNode);
    expect(v.getAudioParams().size).toBe(0);
  });

  it('posts the default modulator set (2 ADSR + 2 LFO) to the worklet on construction', () => {
    modsCalls.length = 0;
    makeEngine();
    expect(modsCalls).toHaveLength(1);
    const ids = modsCalls[0].map((m) => m.id).sort();
    expect(ids).toEqual(['adsr-amp', 'adsr-filter', 'lfo1', 'lfo2']);
    // default seed has no audible connections (depth 0 / unconnected LFOs)
    expect(modsCalls[0].every((m) => Object.keys(m.depthByParam).length === 0)).toBe(true);
  });
});

describe('toModLite', () => {
  const lfo = (over: Partial<ModulatorState> = {}): ModulatorState => ({
    id: 'lfo1', kind: 'lfo', enabled: true, connections: [], rateHz: 3, waveform: 'triangle', ...over,
  });

  it('maps a lane-prefixed connection paramId to the SubParams field with its depth', () => {
    const [m] = toModLite([lfo({ connections: [{ id: 'c', paramId: 'subtractive-1.filter.cutoff', depth: 0.4 }] })]);
    expect(m).toMatchObject({ id: 'lfo1', kind: 'lfo', enabled: true, rateHz: 3, waveform: 'triangle' });
    expect(m.depthByParam).toEqual({ filterCutoff: 0.4 });
  });

  it('maps an unprefixed paramId and drops depth-0 / unresolved connections', () => {
    const [m] = toModLite([lfo({ connections: [
      { id: 'a', paramId: 'osc1.level', depth: 0.2 },
      { id: 'b', paramId: 'filter.resonance', depth: 0 },     // depth 0 → dropped
      { id: 'c', paramId: 'amp.gain', depth: 0.5 },           // no SubParams field → dropped
    ] })]);
    expect(m.depthByParam).toEqual({ osc1Level: 0.2 });
  });
});
