/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import type { NoteSpec, ParamBag } from '../audio-dsp/types';
import type { EngineUIContext } from './engine-types';
import type { ModLite } from '../audio-dsp/modulation-runtime';

// Mock the node wrapper: capture spawns/params/maxVoices/mods + the engineId
// passed to the node constructor, without a real AudioWorkletNode (and without
// loading loom-node's ?worker&url processor).
const spawns: NoteSpec[] = [];
const params: ParamBag[] = [];
const maxVoicesCalls: number[] = [];
const modsCalls: ModLite[][] = [];
let lastEngineId: string | undefined;
vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  LoomWorkletNode: class {
    constructor(_ctx: unknown, engineId?: string) { lastEngineId = engineId; }
    spawn(n: NoteSpec) { spawns.push(n); }
    setParams(p: ParamBag) { params.push(p); }
    setMaxVoices(n: number) { maxVoicesCalls.push(n); }
    setMods(m: ModLite[]) { modsCalls.push(m); }
    steal() {} onVoiceCount() {} connect() {} disconnect() {}
  },
}));

import { WorkletLaneEngine, toModLite, type WorkletEngineConfig } from './worklet-lane-engine';
import { SUB_PARAM_SPECS } from './subtractive-params';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorState } from '../modulation/types';

const subMods = (): ModulatorState[] => [
  { ...makeDefaultADSR('adsr-amp'), connections: [{ id: 'c-amp', paramId: 'amp.gain', depth: 0 }] },
  { ...makeDefaultADSR('adsr-filter'), connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0 }] },
  makeDefaultLFO('lfo1'),
  { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
];
const subCfg = (over: Partial<WorkletEngineConfig> = {}): WorkletEngineConfig => ({
  engineId: 'subtractive', name: 'Sub', params: SUB_PARAM_SPECS, presetsKey: 'subtractive',
  polyphony: 'poly', modulators: subMods(), ...over,
});
const out = () => ({ connect() {} }) as unknown as AudioNode;
const makeEngine = (over: Partial<WorkletEngineConfig> = {}) =>
  new WorkletLaneEngine({} as AudioContext, out(), subCfg(over));

describe('WorkletLaneEngine', () => {
  it('a triggered voice posts a spawn with note + gate and a normalised 0..1 velocity', () => {
    spawns.length = 0;
    const v = makeEngine().createVoice({} as AudioContext, out());
    v.trigger(60, 2.0, { gateDuration: 0.5, accent: true, slide: false, velocity: 100 });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ midi: 60, beginSec: 2.0, durationSec: 0.5, accent: true, slide: false });
    expect(spawns[0].velocity).toBeCloseTo(100 / 127, 3);   // 0..127 → 0..1
  });

  it('a velocity-less trigger falls back to the legacy default loudness (normalised)', () => {
    spawns.length = 0;
    const v = makeEngine().createVoice({} as AudioContext, out());
    v.trigger(64, 0, { gateDuration: 0.25 });               // no velocity, no accent
    expect(spawns[0].velocity).toBeCloseTo(90 / 127, 3);     // resolveVelocity(undefined,false)=90
  });

  it('setBaseValue posts the dot-id straight through to the worklet ParamBag', () => {
    params.length = 0;
    const eng = makeEngine();
    eng.setBaseValue('filter.cutoff', 0.8);
    expect(params.at(-1)).toMatchObject({ 'filter.cutoff': 0.8 });
    expect(eng.getBaseValue('filter.cutoff')).toBe(0.8);
  });

  it('poly.voices routes to the worklet voice cap (not a param post)', () => {
    params.length = 0; maxVoicesCalls.length = 0;
    const eng = makeEngine();
    eng.setBaseValue('poly.voices', 5);
    expect(maxVoicesCalls.at(-1)).toBe(5);
    expect(params).toHaveLength(0);
    expect(eng.getBaseValue('poly.voices')).toBe(5);
  });

  it('getAudioParams is empty (per-note params; shared modulation runs in the worklet)', () => {
    const v = makeEngine().createVoice({} as AudioContext, out());
    expect(v.getAudioParams().size).toBe(0);
  });

  it('posts processorOptions.engineId so the worklet builds the right renderer', () => {
    makeEngine({ engineId: 'fm', name: 'FM' });
    expect(lastEngineId).toBe('fm');
  });

  it('a mono engine (tb303) configures maxVoices = 1 on construction', () => {
    maxVoicesCalls.length = 0;
    makeEngine({ engineId: 'tb303', name: 'TB-303', polyphony: 'mono' });
    expect(maxVoicesCalls).toContain(1);
  });

  it('posts its modulator set (2 ADSR + 2 LFO) to the worklet on construction', () => {
    modsCalls.length = 0;
    makeEngine();
    expect(modsCalls).toHaveLength(1);
    expect(modsCalls[0].map((m) => m.id).sort()).toEqual(['adsr-amp', 'adsr-filter', 'lfo1', 'lfo2']);
    expect(modsCalls[0].every((m) => Object.keys(m.depthByParam).length === 0)).toBe(true);
  });

  const makeUiCtx = (registered: string[] = []): EngineUIContext => ({
    laneId: 'subtractive-1',
    registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
    registry: new Map(),
    lookupLaneDisplayName: () => undefined,
  } as unknown as EngineUIContext);

  it('buildParamUI renders the modulators panel and (for poly) a VOICES knob', () => {
    const registered: string[] = [];
    const container = document.createElement('div');
    makeEngine().buildParamUI(container, makeUiCtx(registered));
    expect(container.querySelector('.mod-panel')).toBeTruthy();
    expect(registered).toContain('subtractive-1.poly.voices');
  });

  it('a mono engine omits the VOICES knob', () => {
    const registered: string[] = [];
    const container = document.createElement('div');
    makeEngine({ engineId: 'tb303', name: 'TB-303', polyphony: 'mono' }).buildParamUI(container, makeUiCtx(registered));
    expect(container.querySelector('.mod-panel')).toBeTruthy();
    expect(registered).not.toContain('subtractive-1.poly.voices');
  });

  it('editing the modulators panel re-posts the modulator config to the worklet', () => {
    const container = document.createElement('div');
    makeEngine().buildParamUI(container, makeUiCtx());
    modsCalls.length = 0;
    const addLfo = [...container.querySelectorAll('.mod-panel-header button')]
      .find((b) => b.textContent?.includes('LFO')) as HTMLButtonElement;
    expect(addLfo).toBeTruthy();
    addLfo.click();                 // panel onChange → postMods
    expect(modsCalls.length).toBeGreaterThan(0);
    expect(modsCalls.at(-1)!.some((m) => m.kind === 'lfo')).toBe(true);
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
      { id: 'c', paramId: 'totally.unknown', depth: 0.5 },    // unresolved → dropped
    ] })]);
    expect(m.depthByParam).toEqual({ osc1Level: 0.2 });
  });

  it('maps the pitch + tremolo targets (master.tune, osc detune, amp.gain)', () => {
    const [m] = toModLite([lfo({ connections: [
      { id: 'a', paramId: 'subtractive-1.master.tune', depth: 0.3 },
      { id: 'b', paramId: 'osc1.detune', depth: -0.5 },
      { id: 'c', paramId: 'amp.gain', depth: 0.6 },           // synthetic tremolo target
    ] })]);
    expect(m.depthByParam).toEqual({ masterTune: 0.3, osc1Detune: -0.5, ampGain: 0.6 });
  });
});
