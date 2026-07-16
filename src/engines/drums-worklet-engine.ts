// src/engines/drums-worklet-engine.ts
// Synth-mode drum machine backed by the 8-output AudioWorklet (drums-processor).
// Mirrors the SynthEngine surface of the legacy DrumsEngine (src/engines/
// drums-engine.ts) — same params, presets, kit/sample mode, per-voice mute/solo,
// bus strip + modulation — but in SYNTH mode it routes hits to a DrumsWorkletNode
// instead of building a per-hit Web Audio node graph.
//
// Architecture (synth mode):
//   - One DrumsWorkletNode with 8 mono outputs (one per DrumVoice).
//   - Eight per-voice ChannelStrips (kept Web Audio, exactly as DrumMachine did):
//     worklet output i → strips[DRUM_VOICE_IDS[i]].input → inserts/bus.
//   - Per-voice synth params flow as a per-voice ParamBag (seedSynthState shape);
//     setBaseValue / applyPreset re-post the affected voice's bag to the worklet.
//   - Choke lives IN the worklet (the chokeGroup leaf travels in each voice bag).
//   - Per-voice mute/solo act on the 8 strips (computeVoiceMutes), independent of
//     the lane bus mute/solo on the shared bus strip.
//
// Sample mode (kitMode === 'sample') is UNCHANGED this phase: it keeps delegating
// to the embedded SamplerEngine on the old path. Phase 3 moves the Sampler into
// the worklet; only then does sample-mode drums follow.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { getCachedPresets } from '../presets/preset-loader';
import {
  DRUM_LANES, BY_ID, seedSynthState, type DrumVoice, type DrumSynthState,
} from '../core/drums';
import { computeVoiceMutes } from '../core/mute-solo';
import { ChannelStrip, type FxBus } from '../core/fx';
import { DrumsWorkletNode } from '../audio-worklet/drums-node';
import { DRUM_VOICE_IDS } from '../audio-dsp/drums/types';
import { SamplerWorkletEngine } from './sampler-worklet-engine';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';
import type { KeymapEntry } from '../samples/types';
import type { PadParams } from './sampler-pad-params';
import { GM_DRUM_MAP } from './drum-gm-map';
import { velGain, velNorm } from '../core/velocity-gain';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { getCurrentLaneForVoice } from '../modulation/active-mods';
import { findDrumKit } from '../presets/drum-kits-loader';
import {
  bindEngineModulators, reapplyLaneModulations, disposeLaneModulations, disposeEngineMods,
} from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import type { KnobHandle } from '../core/knob';
import {
  ChannelFilter,
  FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX, FILTER_CUTOFF_DEFAULT,
  FILTER_Q_MIN, FILTER_Q_MAX, FILTER_Q_DEFAULT, FILTER_DETUNE_SPAN_CENTS,
} from '../core/channel-filter';

// ── Param spec (identical vocabulary to the legacy DrumsEngine) ───────────────
// Bus-level automatable params (rendered by the static drum-master strip + the
// LFO/ADSR destination dropdown). Per-voice synth + mixer leaves are appended
// below; they drive the worklet bag (synth) and the per-voice strip (mixer).
const BUS_PARAMS: EngineParamSpec[] = [
  { id: 'bus.level',       label: 'Vol',  kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { id: 'bus.pan',         label: 'Pan',  kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { id: 'bus.delaySend',   label: 'A',    kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.reverbSend',  label: 'B',    kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.eq.low',      label: 'Lo',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.mid',      label: 'Mid',  kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.high',     label: 'Hi',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'filter.cutoff',    label: 'CUTOFF', kind: 'continuous', min: FILTER_CUTOFF_MIN, max: FILTER_CUTOFF_MAX, default: FILTER_CUTOFF_DEFAULT, curve: 'log', unit: 'Hz' },
  { id: 'filter.resonance', label: 'RES',    kind: 'continuous', min: FILTER_Q_MIN,      max: FILTER_Q_MAX,      default: FILTER_Q_DEFAULT },
];

const WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'square', label: 'Sqr' },
];

// Per-voice synth specs (leaf ids; prefixed with `<voice>.` below). Leaf names
// match seedSynthState (drums.ts) exactly so the bag sent to the worklet renderer
// carries the right keys. Defaults are the 909 representative values used for cold
// fallback + knob double-click reset; the live value comes from the voice bag.
const VOICE_SYNTH_SPECS: Record<DrumVoice, EngineParamSpec[]> = {
  kick: [
    { id: 'tune',      label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2,   default: 1 },
    { id: 'attack',    label: 'ATTACK', kind: 'continuous', min: 0,   max: 1,   default: 0.7 },
    { id: 'decay',     label: 'DECAY',  kind: 'continuous', min: 0.05, max: 1.5, default: 0.4 },
    { id: 'startFreq', label: 'START',  kind: 'continuous', min: 40,  max: 400, default: 220, unit: 'Hz' },
    { id: 'endFreq',   label: 'END',    kind: 'continuous', min: 30,  max: 150, default: 55,  unit: 'Hz' },
    { id: 'sweep',     label: 'SWEEP',  kind: 'continuous', min: 0.005, max: 0.3, default: 0.03 },
    { id: 'wave',      label: 'WAVE',   kind: 'discrete',   min: 0,   max: 2,   default: 0, options: WAVE_OPTIONS },
  ],
  snare: [
    { id: 'tune',       label: 'TUNE', kind: 'continuous', min: 0.5, max: 2,    default: 1 },
    { id: 'tone',       label: 'TONE', kind: 'continuous', min: 0,   max: 1,    default: 0.35 },
    { id: 'snap',       label: 'SNAP', kind: 'continuous', min: 0,   max: 1,    default: 0.75 },
    { id: 'bodyDecay',  label: 'BODY', kind: 'continuous', min: 0.01, max: 0.3, default: 0.04 },
    { id: 'noiseDecay', label: 'NDEC', kind: 'continuous', min: 0.02, max: 0.5, default: 0.18 },
    { id: 'noiseTone',  label: 'NTONE', kind: 'continuous', min: 1000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  closedHat: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1.2 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.01, max: 0.3, default: 0.06 },
    { id: 'filter', label: 'FILTER', kind: 'continuous', min: 3000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  openHat: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1.2 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.05, max: 1.0, default: 0.35 },
    { id: 'filter', label: 'FILTER', kind: 'continuous', min: 3000, max: 12000, default: 7000, unit: 'Hz' },
  ],
  clap: [
    { id: 'tone',  label: 'TONE',  kind: 'continuous', min: 500, max: 4000, default: 1500, unit: 'Hz' },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.05, max: 0.5, default: 0.16 },
    { id: 'sharp', label: 'SHARP', kind: 'continuous', min: 0.3, max: 8,    default: 2.0 },
  ],
  tom: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5, max: 2, default: 1 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.05, max: 1.0, default: 0.5 },
    { id: 'sweep', label: 'SWEEP', kind: 'continuous', min: 0.01, max: 0.3, default: 0.08 },
    { id: 'end',   label: 'END',   kind: 'continuous', min: 40, max: 200, default: 95, unit: 'Hz' },
  ],
  cowbell: [
    { id: 'tune',   label: 'TUNE',   kind: 'continuous', min: 0.5, max: 2, default: 1 },
    { id: 'decay',  label: 'DECAY',  kind: 'continuous', min: 0.05, max: 0.6, default: 0.25 },
    { id: 'detune', label: 'DETUNE', kind: 'continuous', min: 0.5, max: 2, default: 1 },
  ],
  ride: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5, max: 2, default: 1.5 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.2, max: 3, default: 1.2 },
  ],
  rimshot: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5,  max: 2,    default: 1 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.01, max: 0.15, default: 0.025 },
    { id: 'freq',  label: 'FREQ',  kind: 'continuous', min: 800,  max: 3000, default: 1800, unit: 'Hz' },
  ],
  crash: [
    { id: 'tune',  label: 'TUNE',  kind: 'continuous', min: 0.5, max: 2, default: 1.1 },
    { id: 'decay', label: 'DECAY', kind: 'continuous', min: 0.5, max: 5, default: 2.2 },
  ],
};

const VOICE_MIXER_SPECS: Array<Omit<EngineParamSpec, 'id'> & { leaf: string }> = [
  { leaf: 'level',   label: 'LEVEL', kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { leaf: 'dly',     label: 'A',     kind: 'continuous', min: 0,   max: 1,   default: 0, color: '#3498db' },
  { leaf: 'rev',     label: 'B',     kind: 'continuous', min: 0,   max: 1,   default: 0, color: '#9b59b6' },
  { leaf: 'pan',     label: 'PAN',   kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { leaf: 'eq.low',  label: 'LO',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.mid',  label: 'MID',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.high', label: 'HI',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

const MIXER_LEAVES = new Set(VOICE_MIXER_SPECS.map((s) => s.leaf));

// CHOKE group selector (discrete): stored value = the group number. 0 = — (none);
// voices sharing a non-zero group cut each other. Default group 1 for the hi-hats.
const CHOKE_OPTIONS = [
  { value: 'none', label: '—' },
  { value: 'g1', label: '1' }, { value: 'g2', label: '2' },
  { value: 'g3', label: '3' }, { value: 'g4', label: '4' },
];
function chokeSpec(voice: DrumVoice): EngineParamSpec {
  const dflt = voice === 'closedHat' || voice === 'openHat' ? 1 : 0;
  return { id: 'chokeGroup', label: 'CHOKE', kind: 'discrete', min: 0, max: 4, default: dflt, options: CHOKE_OPTIONS, selectStyle: 'dropdown', showLabel: true };
}

function buildPerVoiceSpecs(): EngineParamSpec[] {
  const out: EngineParamSpec[] = [];
  for (const voice of DRUM_LANES) {
    for (const s of [...VOICE_SYNTH_SPECS[voice], chokeSpec(voice)]) out.push({ ...s, id: `${voice}.${s.id}` });
    for (const m of VOICE_MIXER_SPECS) {
      const { leaf, ...rest } = m;
      out.push({ ...rest, id: `${voice}.${leaf}` });
    }
  }
  return out;
}

// Exported so the data-only 'drums-machine' registry descriptor (drums-engine.ts)
// shares the exact same param vocabulary the worklet drums engine uses.
export const DRUM_PARAMS: EngineParamSpec[] = [
  ...BUS_PARAMS,
  ...buildPerVoiceSpecs(),
];

// Synth-leaf ids that are part of the worklet param bag (everything in
// VOICE_SYNTH_SPECS + chokeGroup). Used to decide whether a setBaseValue updates
// the worklet bag vs the per-voice strip.
const SYNTH_LEAVES = new Set<string>(['chokeGroup']);
for (const voice of DRUM_LANES) for (const s of VOICE_SYNTH_SPECS[voice]) SYNTH_LEAVES.add(s.id);

// ── DrumsVoice — posts hits to the worklet (or delegates in sample mode) ──────
class DrumsVoice implements Voice {
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private node: DrumsWorkletNode,
    private busStrip: ChannelStrip | null,
    private channelFilter: ChannelFilter | null,
  ) {}

  /** Expose the drum-bus ChannelStrip's automatable AudioParams (modulation
   *  targets). Per-voice levels are not modulatable (same as the legacy engine). */
  getAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    if (this.busStrip) {
      m.set('bus.level',      this.busStrip.level.gain);
      m.set('bus.pan',        this.busStrip.getPanParam());
      m.set('bus.reverbSend', this.busStrip.sendB.gain);
      m.set('bus.delaySend',  this.busStrip.sendA.gain);
      m.set('bus.eq.low',     this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',     this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high',    this.busStrip.getEqGainParam('high'));
    }
    if (this.channelFilter) {
      m.set('filter.cutoff',    this.channelFilter.getCutoffModParam());
      m.set('filter.resonance', this.channelFilter.getResonanceParam());
    }
    return m;
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const voice = GM_DRUM_MAP[midi];
    if (!voice) return;
    // Reproduce the legacy DrumMachine loudness: vel = 0.65 · velGain(velocity,
    // accent). The renderer maps the hit's velocity straight to its env peak, so
    // matching the legacy scalar keeps synth-drum loudness identical to before.
    const vel = 0.65 * velGain(opts.velocity, !!opts.accent);
    this.node.hit(voice, time, vel);
  }

  release(_t: number): void {}
  connect(_d: AudioNode): void {}
  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
  }
}

class DrumsSequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class DrumsWorkletEngine implements SynthEngine {
  readonly id = 'drums-machine';
  readonly name = 'Drums';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'drum-grid' as const;
  get params(): EngineParamSpec[] {
    return this.kitMode === 'sample' ? this.sampler.params : DRUM_PARAMS;
  }
  get presets() { return getCachedPresets('drums-machine'); }

  // ── Worklet + per-voice strips (synth mode) ─────────────────────────────────
  private node: DrumsWorkletNode | null = null;
  /** Per-voice ChannelStrips (Web Audio), keyed by DrumVoice. Built once the
   *  ctx + shared FX are available (createVoice). */
  private voiceStrips: Partial<Record<DrumVoice, ChannelStrip>> = {};
  private wired = false;
  /** Live per-voice synth params (the worklet bag). Seeded from the active kit. */
  private kitId = '909';
  private synth: DrumSynthState = seedSynthState(BY_ID[this.kitId]);

  // ── Per-voice mute/solo (synth mode acts on voiceStrips) ────────────────────
  private voiceMute: Partial<Record<DrumVoice, boolean>> = {};
  private voiceSolo: Partial<Record<DrumVoice, boolean>> = {};

  /** Embedded Sampler instance — the sample-kit source, now the worklet-backed
   *  SamplerWorkletEngine (Phase 3) so sample drumkits play in the worklet too.
   *  Eager so host-wiring (setSharedFx/setOutputTarget) reaches it before its
   *  first createVoice. */
  private sampler = new SamplerWorkletEngine();
  private kitMode: 'synth' | 'sample' = 'synth';

  /** Sample drum kits play through the embedded sampler at the 'drum' category
   *  gain (CATEGORY_GAIN.drum, centralized in gain-staging.ts). One-shot samples
   *  read quieter than sustained synth voices, so drum sits above unity; the
   *  master soft-clip protects against the occasional hot transient. */
  constructor() { this.sampler.setCategoryGain(CATEGORY_GAIN.drum); }

  getKitMode(): 'synth' | 'sample' { return this.kitMode; }
  setKitMode(m: 'synth' | 'sample'): void { this.kitMode = m; }

  // Keymap + pad-store forwarders to the embedded sampler (feature-detected by
  // the session load path; inert for a synth lane that has no engineState.sampler).
  setKeymap(km: KeymapEntry[]): void { this.sampler.setKeymap(km); }
  getKeymap(): KeymapEntry[] { return this.sampler.getKeymap(); }
  setPadStore(s: Record<number, Partial<PadParams>>): void { this.sampler.setPadStore(s); }
  getPadStore(): Record<number, Partial<PadParams>> { return this.sampler.getPadStore(); }

  // Engine-level cache for bus.* scalar values (the bus strip is read back from here).
  private paramValues: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (const s of BUS_PARAMS) o[s.id] = s.default;
    return o;
  })();

  private channelFilter: ChannelFilter | null = null;

  private sharedFx: FxBus | null = null;
  setSharedFx(fx: FxBus): void { this.sharedFx = fx; this.sampler.setSharedFx(fx); }

  private busStrip: ChannelStrip | null = null;
  setBusStrip(strip: ChannelStrip): void { this.busStrip = strip; }

  // Per-lane insert chain routing: createVoice connects the 8 voice strips (and
  // the embedded sampler) to this node instead of busStrip.input.
  private outputTarget: AudioNode | null = null;
  setOutputTarget(n: AudioNode): void {
    this.outputTarget = n;
    // The worklet-backed embedded sampler owns its own node; point its dry output
    // at the same lane routing target (insert chain → strip) used by synth mode.
    this.sampler.setOutputTarget(n);
  }

  // ── Per-voice mute/solo surface (mirrors the legacy DrumsEngine) ────────────
  private applyVoiceMutes(): void {
    if (this.kitMode === 'sample') return; // sample mode handles its own mutes
    const muted = computeVoiceMutes(DRUM_LANES, this.voiceMute, this.voiceSolo);
    for (const v of DRUM_LANES) this.voiceStrips[v]?.setMuted(muted[v]);
  }
  getDrumVoiceMute(voice: DrumVoice): boolean {
    if (this.kitMode === 'sample') return this.sampler.getDrumVoiceMute(voice);
    return !!this.voiceMute[voice];
  }
  setDrumVoiceMute(voice: DrumVoice, muted: boolean): void {
    if (this.kitMode === 'sample') { this.sampler.setDrumVoiceMute(voice, muted); return; }
    this.voiceMute[voice] = muted;
    this.applyVoiceMutes();
  }
  getDrumVoiceSolo(voice: DrumVoice): boolean {
    if (this.kitMode === 'sample') return this.sampler.getDrumVoiceSolo(voice);
    return !!this.voiceSolo[voice];
  }
  toggleDrumVoiceSolo(voice: DrumVoice): void {
    if (this.kitMode === 'sample') { this.sampler.toggleDrumVoiceSolo(voice); return; }
    this.voiceSolo[voice] = !this.voiceSolo[voice];
    this.applyVoiceMutes();
  }
  getDrumVoiceMutes(): Record<string, boolean> {
    if (this.kitMode === 'sample') return this.sampler.getDrumVoiceMutes();
    const out: Record<string, boolean> = {};
    for (const v of DRUM_LANES) out[v] = !!this.voiceMute[v];
    return out;
  }
  setDrumVoiceMutes(mutes: Record<string, boolean>): void {
    if (this.kitMode === 'sample') { this.sampler.setDrumVoiceMutes(mutes); return; }
    this.voiceMute = { ...mutes } as Partial<Record<DrumVoice, boolean>>;
    this.applyVoiceMutes();
  }

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);
  get modulators() { return this.modHost; }

  /** Tempo for LFO BPM sync. main.ts updates this when seq.bpm changes. */
  bpm = 120;

  private specDefault(id: string): number {
    return DRUM_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }

  /** bus.* range lookup for the modulation depth bridge (resolves from
   *  DRUM_PARAMS regardless of kitMode). Filter cutoff uses the detune cents
   *  span (NOT 20..20000 Hz) so a bipolar LFO sweeps musically. */
  private busRangeLookup = (id: string): { min: number; max: number } => {
    if (id === 'filter.cutoff')    return { min: 0, max: FILTER_DETUNE_SPAN_CENTS };
    if (id === 'filter.resonance') return { min: FILTER_Q_MIN, max: FILTER_Q_MAX };
    const s = DRUM_PARAMS.find((p) => p.id === id);
    return { min: s?.min ?? 0, max: s?.max ?? 1 };
  };

  // ── Param read/write ────────────────────────────────────────────────────────
  getBaseValue(id: string): number {
    if (this.kitMode === 'sample' && !id.startsWith('bus.')) return this.sampler.getBaseValue(id);
    if (id === 'filter.cutoff' || id === 'filter.resonance') {
      return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
    }
    if (id.startsWith('bus.')) {
      return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    if (DRUM_LANES.includes(voice)) {
      if (MIXER_LEAVES.has(leaf)) return this.readMixer(voice, leaf);
      const bag = this.synth[voice];
      if (bag && leaf in bag) return bag[leaf];
    }
    return this.specDefault(id);
  }

  setBaseValue(id: string, v: number): void {
    if (this.kitMode === 'sample' && !id.startsWith('bus.')) { this.sampler.setBaseValue(id, v); return; }
    if (id === 'filter.cutoff')    { this.paramValues[id] = v; this.channelFilter?.setCutoff(v);    return; }
    if (id === 'filter.resonance') { this.paramValues[id] = v; this.channelFilter?.setResonance(v); return; }
    if (id.startsWith('bus.')) {
      this.paramValues[id] = v;
      if (!this.busStrip) return;
      switch (id) {
        case 'bus.level':      this.busStrip.setLevel(v);  return;
        case 'bus.pan':        this.busStrip.setPan(v);    return;
        case 'bus.reverbSend': this.busStrip.setSendB(v);  return;
        case 'bus.delaySend':  this.busStrip.setSendA(v);  return;
        case 'bus.eq.low':     this.busStrip.setEqLow(v);  return;
        case 'bus.eq.mid':     this.busStrip.setEqMid(v);  return;
        case 'bus.eq.high':    this.busStrip.setEqHigh(v); return;
      }
      return;
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    if (!DRUM_LANES.includes(voice)) return;
    if (MIXER_LEAVES.has(leaf)) { this.writeMixer(voice, leaf, v); return; }
    if (SYNTH_LEAVES.has(leaf)) {
      const bag = this.synth[voice];
      if (bag) { bag[leaf] = v; this.postVoice(voice); }
    }
  }

  // ── Per-voice mixer (strip) read/write ──────────────────────────────────────
  private writeMixer(voice: DrumVoice, leaf: string, v: number): void {
    const st = this.voiceStrips[voice];
    if (!st) return;
    switch (leaf) {
      case 'level':   st.setLevel(v);  break;
      case 'pan':     st.setPan(v);    break;
      case 'rev':     st.setSendB(v);  break;
      case 'dly':     st.setSendA(v);  break;
      case 'eq.low':  st.setEqLow(v);  break;
      case 'eq.mid':  st.setEqMid(v);  break;
      case 'eq.high': st.setEqHigh(v); break;
    }
  }
  private readMixer(voice: DrumVoice, leaf: string): number {
    const st = this.voiceStrips[voice];
    if (!st) return VOICE_MIXER_SPECS.find((s) => s.leaf === leaf)?.default ?? 0;
    switch (leaf) {
      case 'level':   return st.level.gain.value;
      case 'pan':     return st.getPan();
      case 'rev':     return st.sendB.gain.value;
      case 'dly':     return st.sendA.gain.value;
      case 'eq.low':  return st.getEqGainParam('low').value;
      case 'eq.mid':  return st.getEqGainParam('mid').value;
      case 'eq.high': return st.getEqGainParam('high').value;
    }
    return 0;
  }

  /** Per-voice synth ParamBag snapshot (the worklet bag) — for the offline scene
   *  recorder, which renders drum hits through a pure DrumVoiceManager (synth mode
   *  only; sample-mode kits play through the embedded Sampler). */
  getOfflineSynthBag(voice: DrumVoice): Record<string, number> { return { ...this.synth[voice] }; }
  /** Per-voice mixer level/pan for the offline render (the live path applies these
   *  on the per-voice ChannelStrip, which the offline kernel doesn't build). */
  getOfflineVoiceMix(voice: DrumVoice): { level: number; pan: number; muted: boolean } {
    const muted = computeVoiceMutes(DRUM_LANES, this.voiceMute, this.voiceSolo)[voice];
    return { level: this.readMixer(voice, 'level'), pan: this.readMixer(voice, 'pan'), muted };
  }
  /** The embedded Sampler (sample-mode kits) — exposed so the offline recorder can
   *  resolve sample-drum spawns through the same resolveSpawn path. */
  getEmbeddedSampler(): SamplerWorkletEngine { return this.sampler; }

  /** Send one voice's current bag to the worklet renderer. */
  private postVoice(voice: DrumVoice): void {
    this.node?.setVoiceParams(voice, { ...this.synth[voice] });
  }
  /** Send all 8 voice bags (after a kit change or initial wiring). */
  private postAllVoices(): void {
    for (const v of DRUM_LANES) this.postVoice(v);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  /** Modulators are engine-wide on drums (one host, one binder bound across the
   *  bus-strip params). Spawned once for the lifetime of the engine instance. */
  private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

  /** Build the worklet node + 8 voice strips on first createVoice (when ctx + FX
   *  are available), then connect each worklet output to its strip. Idempotent. */
  private ensureWired(ctx: AudioContext, output: AudioNode): void {
    if (this.wired) return;
    if (!this.sharedFx) {
      throw new Error('DrumsWorkletEngine: setSharedFx must be called before createVoice');
    }
    const routingTarget = this.outputTarget ?? output;
    // Channel filter on the RAW summed mix, BEFORE the lane inserts + bus EQ.
    this.channelFilter = new ChannelFilter(ctx);
    this.channelFilter.setCutoff(this.paramValues['filter.cutoff'] ?? FILTER_CUTOFF_DEFAULT);
    this.channelFilter.setResonance(this.paramValues['filter.resonance'] ?? FILTER_Q_DEFAULT);
    this.channelFilter.output.connect(routingTarget);
    const filterIn = this.channelFilter.input;
    this.node = new DrumsWorkletNode(ctx);
    for (let i = 0; i < DRUM_VOICE_IDS.length; i++) {
      const voice = DRUM_VOICE_IDS[i];
      const strip = new ChannelStrip(ctx, filterIn, this.sharedFx);   // strips → filter, not routingTarget
      this.voiceStrips[voice] = strip;
      this.node.connectVoice(i, strip.input);
    }
    this.wired = true;
    this.postAllVoices();
    this.applyVoiceMutes();
  }

  /** Test-only: the raw-mix input node the per-voice strips feed (the filter
   *  input). Lets a DSP test inject a source on the channel path. */
  getChannelFilterInputForTest(): AudioNode {
    if (!this.channelFilter) throw new Error('channelFilter not built — call createVoice first');
    return this.channelFilter.input;
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    const routingTarget = this.outputTarget ?? output;

    if (this.kitMode === 'sample') {
      const inner = this.sampler.createVoice(ctx, routingTarget);
      // The embedded sampler already ran bindEngineModulators for this lane,
      // wiring the modulators the sample-mode UI actually edits (the sampler's
      // own modHost) to its channel filter. The drums engine must NOT run a
      // second bindEngineModulators for the same lane: in sample mode
      // this.channelFilter is null (no ensureWired), so its shared-param map has
      // no filter destination, and a second bind would only disposeAll() the
      // sampler's fresh LFO→cutoff bridge and rebuild an empty one — which
      // silently killed cutoff (and any) modulation on sample drumkits. Just
      // track the lane so dispose() tears the sampler's bindings down.
      const laneId = getCurrentLaneForVoice();
      if (laneId) this.currentLaneId = laneId;
      return {
        trigger: (m, t, o) => inner.trigger(m, t, o),
        release: (t) => inner.release(t),
        connect: (d) => inner.connect(d),
        getAudioParams: () => inner.getAudioParams(),
        getAudioParamRange: (id) => inner.getAudioParamRange?.(id),
        dispose: () => {
          inner.dispose();
          if (laneId) disposeLaneModulations(laneId);
        },
      };
    }

    // Synth mode → worklet.
    this.ensureWired(ctx, routingTarget);
    const drumVoice = new DrumsVoice(this.node!, this.busStrip, this.channelFilter);
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
    }
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      drumVoice.laneId = laneId;
      // Use the ENGINE binder (no shared-scope exclusion) so a shared LFO reaches
      // the bus strip params — same fix as the legacy DrumsEngine.
      drumVoice.binder = bindEngineModulators({
        laneId, engine: this, voiceMods: this.engineModVoices, ctx,
        rangeLookup: this.busRangeLookup,
      });
      this.currentLaneId = laneId;
    }
    return drumVoice;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new DrumsSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (this.kitMode === 'sample') { this.sampler.buildParamUI(container, ctx); return; }
    container.innerHTML = '';
    if (!ctx) return;

    const rackHost = document.createElement('div');
    rackHost.className = 'drum-rack-host';
    container.appendChild(rackHost);
    renderDrumVoiceRack(this, ctx, rackHost);

    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      historyDeps: ctx.historyDeps,
      laneInserts: ctx.laneInserts,
      masterInserts: ctx.masterInserts,
      fxBus: ctx.fxBus,
      // Drums modulate Web-Audio bus params (main-thread): re-apply the bindings
      // so depth/on-off/rate tweaks take effect without rebuilding the panel.
      onLiveEdit: () => { if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId); },
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  applyPreset(name: string): void {
    // 1) Unified drum-kits.json entry (the drums-page picker vocabulary).
    const unified = findDrumKit(name);
    if (unified) {
      this.kitMode = unified.kind;
      if (unified.kind === 'synth' && unified.kitId) this.loadKit(unified.kitId);
      // sample kit: kitMode set; async decode + engineState mirror owned elsewhere.
      return;
    }
    // 2) Legacy back-compat: a GM-tagged drums-machine.json preset ("KIT *") →
    //    kitId → synth kit, plus any numeric param overrides.
    this.kitMode = 'synth';
    const preset = this.presets.find((p) => p.name === name);
    let kitId: string | undefined;
    let overrides: Array<[string, number]> = [];
    if (preset) {
      const params = preset.params as Record<string, number | string>;
      if (typeof params.kitId === 'string') kitId = params.kitId;
      overrides = Object.entries(params)
        .filter(([k, v]) => k !== 'kitId' && typeof v === 'number') as Array<[string, number]>;
    }
    // 3) Bare kit *name* fallback (direct kit selection).
    if (!kitId) kitId = KITS_BY_NAME[name];
    if (kitId) this.loadKit(kitId);
    for (const [id, v] of overrides) this.setBaseValue(id, v);
  }

  /** Reload every per-voice synth bag from a kit + reset the per-voice strips to
   *  neutral (mirrors DrumMachine.loadKitDefaults), then push the bags to the
   *  worklet. */
  private loadKit(id: string): void {
    const kit = BY_ID[id];
    if (!kit) return;
    this.kitId = id;
    this.synth = seedSynthState(kit);
    for (const v of DRUM_LANES) {
      const st = this.voiceStrips[v];
      if (!st) continue;
      st.setLevel(1); st.setPan(0); st.setSendA(0); st.setSendB(0);
      st.setEqLow(0); st.setEqMid(0); st.setEqHigh(0);
    }
    this.postAllVoices();
  }

  getRackLayout() {
    if (this.kitMode === 'sample') return this.sampler.getRackLayout();
    return {
      curatedSynth: ['tune', 'attack', 'decay', 'tone', 'snap'],
      curatedMixer: ['level', 'dly', 'rev'],
      advancedMixer: ['pan', 'eq.low', 'eq.mid', 'eq.high'],
    };
  }

  getSharedAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    if (this.busStrip) {
      m.set('bus.level',      this.busStrip.level.gain);
      m.set('bus.pan',        this.busStrip.getPanParam());
      m.set('bus.reverbSend', this.busStrip.sendB.gain);
      m.set('bus.delaySend',  this.busStrip.sendA.gain);
      m.set('bus.eq.low',     this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',     this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high',    this.busStrip.getEqGainParam('high'));
    }
    if (this.channelFilter) {
      m.set('filter.cutoff',    this.channelFilter.getCutoffModParam());     // .detune
      m.set('filter.resonance', this.channelFilter.getResonanceParam());     // .Q
    }
    return m;
  }

  dispose(): void {
    disposeEngineMods(this.engineModVoices, this.currentLaneId);
    this.engineModVoices = null;
    this.currentLaneId = null;
    this.channelFilter?.dispose(); this.channelFilter = null;
    this.node?.dispose();   // kill the processor, not just disconnect (phantom-processor leak)
    this.node = null;
    // The embedded sampler (sample-kit mode) owns its OWN worklet node — dispose it
    // too, else a disposed sample-drums lane leaks a phantom sampler processor.
    this.sampler.dispose();
    this.wired = false;
    this.voiceStrips = {};
  }
}

// Bare kit-name → id lookup (back-compat preset path #3).
const KITS_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.values(BY_ID).map((k) => [k.name, k.id]),
);

// NOTE: this engine is NOT registered in the engine registry. Like
// WorkletLaneEngine, it is constructed directly by the lane allocator. The
// data-only 'drums-machine' descriptor (drums-engine.ts) keeps the registry
// metadata entry (it imports DRUM_PARAMS from here for an identical param
// vocabulary). Phase 4 cutover: the legacy node-per-note DrumsEngine is gone, so
// this is the sole synthesising 'drums-machine' engine.
