/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import type { NoteSpec, ParamBag } from '../audio-dsp/types';
import type { EngineUIContext } from './engine-types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import type { KnobHandle } from '../core/knob';
import type { SessionState } from '../session/session';

// Mock the node wrapper: capture spawns/params/maxVoices/mods + the engineId
// passed to the node constructor, without a real AudioWorkletNode (and without
// loading loom-node's ?worker&url processor).
const spawns: NoteSpec[] = [];
const params: ParamBag[] = [];
const maxVoicesCalls: number[] = [];
const modsCalls: ModLite[][] = [];
let silenceAllCalls = 0;
const releasedIds: number[] = [];
let lastEngineId: string | undefined;
let lastModCb: ((o: Record<string, number>) => void) | null = null;
vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  LoomWorkletNode: class {
    constructor(_ctx: unknown, engineId?: string) { lastEngineId = engineId; }
    spawn(n: NoteSpec) { spawns.push(n); }
    setParams(p: ParamBag) { params.push(p); }
    setMaxVoices(n: number) { maxVoicesCalls.push(n); }
    setMods(m: ModLite[]) { modsCalls.push(m); }
    releaseVoice(id: number) { releasedIds.push(id); }
    steal() {} silenceAll() { silenceAllCalls++; } onVoiceCount() {}
    onModValues(cb: (o: Record<string, number>) => void) { lastModCb = cb; }
    connect() {} disconnect() {} dispose() {}
  },
}));

import { WorkletLaneEngine, toModLite, type WorkletEngineConfig } from './worklet-lane-engine';
import type { EngineParamSpec } from './engine-params';
import subtractiveManifest from '../../plugins/subtractive/plugin.json';

// Subtractive ships as a plugin, so its declared params ARE its manifest.
const SUB_PARAM_SPECS = subtractiveManifest.components[0].params as unknown as EngineParamSpec[];
import { makeDotIdMapper } from './mod-lite';
import type { ModulatorState } from '../modulation/types';
import { makeDefaultLFO } from '../plugins/modulators/lfo';
import { makeDefaultADSR } from '../plugins/modulators/adsr';
// Side-effect imports register the real engine descriptors (mirrors main.ts /
// registry-descriptor.test.ts), so makeWorkletEngine below can build a
// WorkletLaneEngine from each engine's ACTUAL params + groups table, not a
// hand-picked spec — the POLY-section tests need the real descriptor because
// they assert on what subtractive.ts / tb303.ts declare, not on a fixture.
import { getEngineDescriptor } from './registry';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// subtractive and tb303 ship as plugins: the equivalent of the old
// side-effect import is that manifest going through the same registerComponent
// door the plugin loader uses.
registerPluginEngine('subtractive');
registerPluginEngine('tb303');

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

/** Build a WorkletLaneEngine straight from the registered engine descriptor
 *  (same config shape lane-allocator.ts assembles), so a test exercises the
 *  REAL params/groups an engine file declares. */
const makeWorkletEngine = (engineId: string): WorkletLaneEngine => {
  const spec = getEngineDescriptor(engineId);
  if (!spec) throw new Error(`no descriptor for '${engineId}' — is it side-effect imported above?`);
  return new WorkletLaneEngine({} as AudioContext, out(), {
    engineId, name: spec.name, presetsKey: engineId, polyphony: spec.polyphony,
    params: spec.params, groups: spec.groups, modulators: spec.modulators,
  });
};

/** Minimal EngineUIContext for a given laneId, tracking registered knob ids. */
const testCtx = (laneId: string, registered: string[] = []): EngineUIContext => ({
  laneId,
  registerKnob: (k: { meta?: { id?: string } }) => { if (k.meta?.id) registered.push(k.meta.id); },
  registry: new Map(),
  lookupLaneDisplayName: () => undefined,
} as unknown as EngineUIContext);

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

  // I1 (2026-07-26 continuous-params review): loom-processor.ts builds the
  // worklet's VoiceManager from an EMPTY ParamBag, so without this every id is a
  // "first-ever write" as far as ParamSmoother is concerned — including
  // `output.trim` (not a declared spec param) the first time a preset carrying
  // it loads over an already-held note, landing as an instant gain step instead
  // of a ramp. The constructor must post the full seeded bag once, up front,
  // with an explicit output.trim default of 1.
  it('constructor posts the full seeded bag once, including an explicit output.trim default of 1', () => {
    params.length = 0;
    makeEngine();
    expect(params).toHaveLength(1);
    expect(params[0]['output.trim']).toBe(1);
    const defaultCutoff = SUB_PARAM_SPECS.find((p) => p.id === 'filter.cutoff')!.default;
    expect(params[0]['filter.cutoff']).toBe(defaultCutoff);
  });

  it('setBaseValue posts the dot-id straight through to the worklet ParamBag', () => {
    params.length = 0;
    const eng = makeEngine();
    eng.setBaseValue('filter.cutoff', 0.8);
    expect(params.at(-1)).toMatchObject({ 'filter.cutoff': 0.8 });
    expect(eng.getBaseValue('filter.cutoff')).toBe(0.8);
  });

  it('poly.voices routes to the worklet voice cap (not a param post)', () => {
    maxVoicesCalls.length = 0;
    const eng = makeEngine();
    params.length = 0; // isolate the construction-time seed post (I1) from this call
    eng.setBaseValue('poly.voices', 5);
    expect(maxVoicesCalls.at(-1)).toBe(5);
    expect(params).toHaveLength(0);
    expect(eng.getBaseValue('poly.voices')).toBe(5);
  });

  it('getAudioParams is empty (per-note params; shared modulation runs in the worklet)', () => {
    const v = makeEngine().createVoice({} as AudioContext, out());
    expect(v.getAudioParams().size).toBe(0);
  });

  // This assertion used to read "release() silences the worklet", which is what
  // the transport Stop needed but ALSO what a live key-up went through — so
  // lifting one key of a held chord killed the chord (measured: RMS 0.1954 →
  // 0.0129). The two intents are now separate methods: release() is per-voice,
  // silenceLane() is the whole-lane seam the stop paths use.
  it('silenceLane() silences the worklet so a held note stops on transport Stop', () => {
    silenceAllCalls = 0;
    const v = makeEngine().createVoice({} as AudioContext, out());
    v.trigger(60, 0, { gateDuration: 10 });   // a long held note
    (v as unknown as { silenceLane(): void }).silenceLane();
    expect(silenceAllCalls).toBe(1);
  });

  it('release() does NOT silence the lane — it note-offs only its own voice', () => {
    silenceAllCalls = 0;
    releasedIds.length = 0;
    const v = makeEngine().createVoice({} as AudioContext, out());
    v.trigger(60, 0, { gateDuration: 10 });
    v.release(0.5);
    expect(silenceAllCalls).toBe(0);
    expect(releasedIds).toHaveLength(1);
  });

  // The descriptor's `groups` table is metadata-only until it also reaches the
  // LIVE engine — buildEngineParamGrid reads `engine.groups` off the object it
  // was called on (WorkletLaneEngine, not the registry's descriptor singleton).
  // A table that only survives on the descriptor is silently dropped here.
  it('carries the declared groups table onto the live engine instance', () => {
    const groups = [{ id: 'osc1', title: 'OSC 1', row: 0, color: '#2ee0c0' }];
    const eng = makeEngine({ groups });
    expect(eng.groups).toEqual(groups);
  });

  it('has no groups when the config declares none', () => {
    const eng = makeEngine();
    expect(eng.groups).toBeUndefined();
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

  it('getLiveModOffset resolves a worklet modValues report to the param dot-id', () => {
    lastModCb = null;
    const eng = makeEngine();
    // The engine subscribed to onModValues in its constructor — simulate the
    // worklet posting a live offset. The telemetry is keyed by the SAME dot-id
    // the knob uses now; it used to arrive as the flat SubParams field name
    // ('filterCutoff') and be translated back here.
    expect(lastModCb).toBeTypeOf('function');
    lastModCb!({ 'filter.cutoff': 0.4 });
    expect(eng.getLiveModOffset('filter.cutoff')).toBeCloseTo(0.4, 6);
    expect(eng.getLiveModOffset('osc1.level')).toBe(0);                  // not reported → ring hidden
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

  // 'a mono engine omits the VOICES knob' used to live here, built from a
  // fixture ('tb303' id + 'mono' flag, but SUB_PARAM_SPECS as its params)
  // with the poly-group member filtered out by hand to keep it passing. That
  // filter made `expect(registered).not.toContain('subtractive-1.poly.voices')`
  // TAUTOLOGICAL: with 'poly.voices' removed from the fixture's own params,
  // it was mathematically impossible for that id to ever appear, so the test
  // could not fail regardless of how buildParamUI/resolveParamRows behaved —
  // it only proved Array.prototype.filter works. Deleted rather than "fixed"
  // again: a test that cannot fail reports coverage it does not provide,
  // which is worse than no test. The real invariant — a mono engine with no
  // declared 'poly' group renders no POLY section — is covered properly by
  // 'a mono engine renders no POLY section' below, against the REAL
  // registered tb303 descriptor (which truly declares no poly.voices),
  // not a hand-patched fixture.

  // Task 6: the POLY row is a declared group (subtractive-params.ts /
  // fm.ts / wavetable.ts / westcoast.ts), not hand-rolled markup in
  // buildParamUI. These two exercise the REAL registered descriptors (see
  // makeWorkletEngine above), so they pin what subtractive.ts and tb303.ts
  // actually declare, not a hand-picked fixture.
  it('renders VOICES from the declared POLY group, not from hand-rolled markup', () => {
    const container = document.createElement('div');
    const engine = makeWorkletEngine('subtractive');
    engine.buildParamUI(container, testCtx('sub-1'));

    const poly = [...container.querySelectorAll('.poly-section')]
      .find((s) => s.querySelector('.section-label')?.textContent === 'POLY');
    expect(poly).toBeDefined();
    // The label is 'Voices' (matching every other spec's Title Case label);
    // .knob-label is CSS text-transform: uppercase, so it PAINTS as "VOICES"
    // without the DOM text itself being upper case — assert case-insensitively.
    expect(poly!.querySelector('.knob-label')?.textContent?.toUpperCase()).toBe('VOICES');
  });

  it('a mono engine renders no POLY section', () => {
    const container = document.createElement('div');
    makeWorkletEngine('tb303').buildParamUI(container, testCtx('tb-1'));
    expect([...container.querySelectorAll('.section-label')].map((e) => e.textContent))
      .not.toContain('POLY');
  });

  // Trap 3 (task-6 brief): poly.mode / poly.retrig are deleted from every
  // engine's params, but applyLaneEngineState (export/apply-lane-engine-state.ts)
  // blindly replays every key in a saved lane.engineState.params via
  // engine.setBaseValue(id, v) — including a key no engine declares any more.
  // A save written before this deletion can still carry either id, so
  // setBaseValue must keep silently accepting-and-ignoring them instead of
  // letting them fall through to `this.state[id] = v` / worklet.setParams,
  // which the worklet renderer has never modelled.
  it('setBaseValue accepts-and-ignores poly.mode / poly.retrig (dead ids an old save may still carry)', () => {
    const eng = makeEngine();
    params.length = 0; // isolate the construction-time seed post (I1) from this call
    eng.setBaseValue('poly.mode', 1);
    eng.setBaseValue('poly.retrig', 0);
    expect(params).toHaveLength(0);                       // never posted to the worklet
    expect(eng.getParamBag()).not.toHaveProperty('poly.mode');
    expect(eng.getParamBag()).not.toHaveProperty('poly.retrig');
  });

  it('the VOICES knob mirrors poly.voices into the lane engineState', () => {
    // poly.voices routes to maxVoices and never enters the ParamBag, so the
    // engineState mirror is the ONLY way a voice-count edit reaches a save.
    const state = {
      lanes: [{ id: 'subtractive-1', engineId: 'subtractive', clips: [], inserts: [] }],
    } as unknown as SessionState;
    const handles = new Map<string, KnobHandle>();
    const ctx = {
      laneId: 'subtractive-1',
      registerKnob: (k: KnobHandle) => { if (k.meta?.id) handles.set(k.meta.id, k); },
      registry: new Map(),
      sessionState: state,
    } as unknown as EngineUIContext;

    const eng = makeEngine();
    const defaultVoices = eng.getBaseValue('poly.voices');
    eng.buildParamUI(document.createElement('div'), ctx);

    const voices = handles.get('subtractive-1.poly.voices');
    expect(voices, 'the VOICES knob is not registered under its canonical id').toBeDefined();
    voices!.setValue(defaultVoices + 4);

    const mirrored = state.lanes[0].engineState?.params?.['poly.voices'];
    expect(mirrored, 'the VOICES edit never reached engineState.params').toBeDefined();
    expect(mirrored).not.toBe(defaultVoices);
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
  // toModLite no longer defaults its target mapper: the default used to be
  // subtractive's translator, which quietly made every caller that omitted the
  // argument behave like a subtractive lane — including the offline render path.
  // Tests build the real one, from the real specs.
  const mapper = makeDotIdMapper(SUB_PARAM_SPECS);
  const lfo = (over: Partial<ModulatorState> = {}): ModulatorState => ({
    id: 'lfo1', kind: 'lfo', enabled: true, connections: [], scope: 'shared', rateHz: 3, waveform: 'triangle', ...over,
  });

  it('maps a lane-prefixed connection paramId to the param dot-id with its depth', () => {
    const [m] = toModLite([lfo({ connections: [{ id: 'c', paramId: 'subtractive-1.filter.cutoff', depth: 0.4 }] })], 120, mapper);
    expect(m).toMatchObject({ id: 'lfo1', kind: 'lfo', enabled: true, rateHz: 3, waveform: 'triangle' });
    expect(m.depthByParam).toEqual({ 'filter.cutoff': 0.4 });
  });

  it('maps an unprefixed paramId and drops depth-0 / unresolved connections', () => {
    const [m] = toModLite([lfo({ connections: [
      { id: 'a', paramId: 'osc1.level', depth: 0.2 },
      { id: 'b', paramId: 'filter.resonance', depth: 0 },     // depth 0 → dropped
      { id: 'c', paramId: 'totally.unknown', depth: 0.5 },    // unresolved → dropped
    ] })], 120, mapper);
    expect(m.depthByParam).toEqual({ 'osc1.level': 0.2 });
  });

  it('maps the pitch + tremolo targets (master.tune, osc detune, amp.gain)', () => {
    const [m] = toModLite([lfo({ connections: [
      { id: 'a', paramId: 'subtractive-1.master.tune', depth: 0.3 },
      { id: 'b', paramId: 'osc1.detune', depth: -0.5 },
      { id: 'c', paramId: 'amp.gain', depth: 0.6 },           // synthetic tremolo target
    ] })], 120, mapper);
    expect(m.depthByParam).toEqual({ 'master.tune': 0.3, 'osc1.detune': -0.5, 'amp.gain': 0.6 });
  });

  it('passes the free rateHz through when not BPM-synced (bpm ignored)', () => {
    const [m] = toModLite([lfo({ rateHz: 3, syncToBpm: false })], 120, mapper);
    expect(m.rateHz).toBeCloseTo(3, 6);
  });

  it('resolves a BPM-synced LFO rate from the bpm, not the stale free rateHz', () => {
    // 1 bar per cycle at 120 BPM = 4 beats/cycle = 2 s/cycle = 0.5 Hz, regardless
    // of the stale free rateHz (3). At 60 BPM the same sync is half as fast.
    const synced = lfo({ rateHz: 3, syncToBpm: true, syncBars: 1, syncSubdiv: 'straight' });
    const [at120] = toModLite([synced], 120, mapper);
    const [at60] = toModLite([synced], 60, mapper);
    expect(at120.rateHz).not.toBeCloseTo(3, 3);   // NOT the free rate
    expect(at120.rateHz).toBeGreaterThan(at60.rateHz * 1.9);   // bpm-proportional
  });

  it('carries an unknown modulator kind through instead of turning it into an ADSR', () => {
    const mods = toModLite([{
      id: 'sh1', kind: 'sh', enabled: true, connections: [], scope: 'shared',
    } as never], 120, mapper);
    expect(mods[0].kind).toBe('sh');
  });

  it("resolves driver from the registry: 'time' for lfo, 'gate' for adsr, undefined for an unregistered kind", () => {
    // ModulationRuntime.getAdsrMods asks m.driver === 'gate', not m.kind ===
    // 'adsr' — this is the one place that fills driver in, from the real
    // registry (makeDefaultADSR's component registers driver:'gate' at import
    // time, same as makeDefaultLFO registers driver:'time' — both imported at
    // the top of this file).
    const [lfoMod] = toModLite([lfo()], 120, mapper);
    expect(lfoMod.driver).toBe('time');

    const [adsrMod] = toModLite([{
      id: 'adsr1', kind: 'adsr', enabled: true, connections: [], scope: 'per-voice',
    } as never], 120, mapper);
    expect(adsrMod.driver).toBe('gate');

    const [unknownMod] = toModLite([{
      id: 'x1', kind: 'no-such-modulator', enabled: true, connections: [], scope: 'shared',
    } as never], 120, mapper);
    expect(unknownMod.driver).toBeUndefined();
  });

  it('carries a plugin modulator\'s params bag through to the worklet wire format', () => {
    // Without this a plugin's kernel reaches the audio thread with no way to
    // read what the user configured for it — the bag exists (types.ts) but a
    // kernel can only see the ModLite it's handed.
    const [m] = toModLite([{
      id: 'sh1', kind: 'sh', enabled: true, connections: [], scope: 'shared',
      params: { rate: 6, bipolar: 1 },
    } as never], 120, mapper);
    expect(m.params).toEqual({ rate: 6, bipolar: 1 });
  });

  it('leaves params undefined for a modulator with no bag (LFO/ADSR today)', () => {
    const [m] = toModLite([lfo()], 120, mapper);
    expect(m.params).toBeUndefined();
  });
});

describe('a preset carries its own modulators', () => {
  it('applyPreset installs the preset\'s LFO into the live host, replacing what was there', async () => {
    const { __seedPresetCache, __resetPresetCache } = await import('../presets/preset-loader');
    __resetPresetCache();
    __seedPresetCache('subtractive', [
      {
        name: 'Wobble', gm: [38], params: { 'filter.cutoff': 0.4 },
        modulators: [{
          id: 'wob', kind: 'lfo', enabled: true, waveform: 'sine',
          syncToBpm: true, syncBars: 2,
          connections: [{ id: 'c1', paramId: 'filter.cutoff', depth: 0.8 }],
        }],
      } as never,
    ]);
    try {
      const engine = makeEngine();
      // It boots with the config's default modulators (an adsr + two lfos).
      expect(engine.modulators.modulators.some((m) => m.id === 'wob')).toBe(false);

      engine.applyPreset('Wobble');

      // The preset's LFO is now the live set — routed to the cutoff, at depth 0.8.
      const wob = engine.modulators.modulators.find((m) => m.id === 'wob');
      expect(wob, 'the preset LFO did not reach the live host').toBeDefined();
      expect(wob!.connections[0].paramId).toBe('filter.cutoff');
      expect(wob!.connections[0].depth).toBeCloseTo(0.8, 2);
      // The old default lfo1/lfo2 are gone — a preset replaces, it does not stack.
      expect(engine.modulators.modulators.some((m) => m.id === 'lfo1')).toBe(false);
    } finally {
      __resetPresetCache();
    }
  });
});
