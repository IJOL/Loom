// src/engines/drums-engine.ts
// Adapts DrumMachine to the SynthEngine interface. Triggers are routed via
// the GM drum map so drum clips can use NoteEvent[] like every other engine.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import { getCachedPresets } from '../presets/preset-loader';
import { DrumMachine, DRUM_LANES, type DrumVoice } from '../core/drums';
import { FxBus } from '../core/fx';
import { SamplerEngine } from './sampler';
import type { KeymapEntry } from '../samples/types';
import type { PadParams } from './sampler-pad-params';
import { GM_DRUM_MAP } from './drum-gm-map';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { getCurrentLaneForVoice } from '../modulation/active-mods';
import { findDrumKit } from '../presets/drum-kits-loader';
import { bindEngineModulators, reapplyLaneModulations, disposeLaneModulations, disposeEngineMods } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import type { KnobHandle } from '../core/knob';

// Unified-param schema for the drums engine. Master controls live at the
// engine level; per-voice `.level` ids map onto each DrumMachine channel
// strip's `level.gain` AudioParam (see DrumsVoice.getAudioParams below).
// Bus-level automatable params. The static drum page renders the matching
// knobs (DRUM VOL / PAN / REV / DLY / LO / MID / HI) via wireDrumMasterUI;
// the LFO/ADSR destination dropdown picks them up via the same lane-prefixed
// ids registered there. Per-voice levels are NOT exposed as engine params:
// volume is controlled via the static drum-grid editor + accents at trigger
// time, and the drum-master strip's DRUM VOL handles overall bus gain.
const BUS_PARAMS: EngineParamSpec[] = [
  { id: 'bus.level',       label: 'Vol',  kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { id: 'bus.pan',         label: 'Pan',  kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { id: 'bus.reverbSend',  label: 'Rev',  kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.delaySend',   label: 'Dly',  kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.eq.low',      label: 'Lo',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.mid',      label: 'Mid',  kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.high',     label: 'Hi',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

const WAVE_OPTIONS = [
  { value: 'sine', label: 'Sin' },
  { value: 'triangle', label: 'Tri' },
  { value: 'square', label: 'Sqr' },
];

// Per-voice synth specs (leaf ids; prefixed with `<voice>.` below). Defaults
// are the 909 representative values used for cold fallback + knob double-click
// reset; the live value always comes from the DrumMachine store via getBaseValue.
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
};

const VOICE_MIXER_SPECS: Array<Omit<EngineParamSpec, 'id'> & { leaf: string }> = [
  { leaf: 'level',   label: 'LEVEL', kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { leaf: 'rev',     label: 'REV',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { leaf: 'dly',     label: 'DLY',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { leaf: 'pan',     label: 'PAN',   kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { leaf: 'eq.low',  label: 'LO',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.mid',  label: 'MID',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { leaf: 'eq.high', label: 'HI',    kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

const MIXER_LEAVES = new Set(VOICE_MIXER_SPECS.map((s) => s.leaf));

// CHOKE group selector (discrete): stored value is the option index = the group
// number. 0 = — (no group); voices sharing a non-zero group cut each other. Every
// voice gets one; default group 1 for the hi-hats (the standard CH-chokes-OH).
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

const DRUM_PARAMS: EngineParamSpec[] = [
  ...BUS_PARAMS,
  ...buildPerVoiceSpecs(),
];

function writeMixer(dm: DrumMachine, voice: DrumVoice, leaf: string, v: number): void {
  const st = dm.channels[voice];
  switch (leaf) {
    case 'level':   st.setLevel(v);      break;
    case 'pan':     st.setPan(v);        break;
    case 'rev':     st.setSendB(v); break;
    case 'dly':     st.setSendA(v); break;
    case 'eq.low':  st.setEqLow(v);      break;
    case 'eq.mid':  st.setEqMid(v);      break;
    case 'eq.high': st.setEqHigh(v);     break;
  }
}

function readMixer(dm: DrumMachine, voice: DrumVoice, leaf: string): number {
  const st = dm.channels[voice];
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

// Note: getSharedAudioParams stays bus-only (do NOT add per-voice params) so
// the LFO/ADSR destination dropdown is not flooded with 56 per-voice entries.

class DrumsVoice implements Voice {
  /** Set by DrumsEngine.createVoice for dispose-time cleanup. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    private dm: DrumMachine,
    private busStrip: import('../core/fx').ChannelStrip | null,
  ) {}

  /** Expose the drum-bus ChannelStrip's automatable AudioParams. The lane
   *  modulator binder writes depth-gains into these — moving an LFO depth
   *  on `bus.eq.low` directly drives the BiquadFilterNode gain on the bus.
   *  Per-voice levels are not modulatable; volume per voice is shaped via
   *  the drum-grid accents + the static drum-master `DRUM VOL` knob. */
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
    return m;
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const voice = GM_DRUM_MAP[midi];
    if (!voice) return;
    this.dm.trigger(voice, time, !!opts.accent, opts.velocity);
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

export class DrumsEngine implements SynthEngine {
  readonly id = 'drums-machine';
  readonly name = 'Drums';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'drum-grid' as const;
  get params(): EngineParamSpec[] {
    return this.kitMode === 'sample' ? this.sampler.params : DRUM_PARAMS;
  }
  get presets() { return getCachedPresets('drums-machine'); }

  private instances = new WeakMap<AudioNode, DrumMachine>();
  private lastInstance: DrumMachine | null = null;

  /** Embedded, complete Sampler instance — the sample-kit source. Eager so
   *  host-wiring (setSharedFx) reaches it before its first createVoice. */
  private sampler = new SamplerEngine();
  private kitMode: 'synth' | 'sample' = 'synth';

  /** The sample-player carries OUTPUT_TRIM headroom, so a sample kit reads
   *  quieter than the synth voices. Run the embedded sampler at a higher base
   *  gain so sample kits sit near the synth-drum level. The standalone Poly-lane
   *  sampler is a separate instance and keeps its default gain. */
  private static readonly SAMPLE_GAIN = 1.4;
  constructor() { this.sampler.setBaseValue('gain', DrumsEngine.SAMPLE_GAIN); }

  getKitMode(): 'synth' | 'sample' { return this.kitMode; }
  setKitMode(m: 'synth' | 'sample'): void { this.kitMode = m; }

  /** Keymap + pad-store forwarders to the embedded sampler. The session load
   *  path (applyEngineState) feature-detects these on the LANE engine (this
   *  façade), so they must exist here; they target the embedded sampler in
   *  both modes (inert for a synth lane that has no engineState.sampler). */
  setKeymap(km: KeymapEntry[]): void { this.sampler.setKeymap(km); }
  getKeymap(): KeymapEntry[] { return this.sampler.getKeymap(); }
  setPadStore(s: Record<number, Partial<PadParams>>): void { this.sampler.setPadStore(s); }
  getPadStore(): Record<number, Partial<PadParams>> { return this.sampler.getPadStore(); }

  /** Engine-level cache for scalar param values. Only bus.* params are cached
   *  here; per-voice values live in the DrumMachine synth store and are read
   *  from there by getBaseValue. This avoids a stale mirror for the 56+
   *  per-voice params and ensures the live kit default is always returned for
   *  untouched params. */
  private paramValues: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (const s of BUS_PARAMS) o[s.id] = s.default;
    return o;
  })();

  // The drum machine constructor needs an FxBus reference for sends; the
  // host injects one shared FxBus via setSharedFx so lanes can share reverb/
  // delay tails with the rest of the mix.
  private sharedFx: FxBus | null = null;
  setSharedFx(fx: FxBus): void { this.sharedFx = fx; this.sampler.setSharedFx(fx); }

  private busStrip: import('../core/fx').ChannelStrip | null = null;
  setBusStrip(strip: import('../core/fx').ChannelStrip): void {
    this.busStrip = strip;
  }

  // Per-lane insert chain routing: when setOutputTarget is called, createVoice
  // passes this node as the DrumMachine output instead of busStrip.input.
  // This lets the lane InsertChain sit between the drum voices and the strip.
  // Falls back to busStrip.input if never called (preserves legacy behavior).
  private outputTarget: AudioNode | null = null;
  setOutputTarget(n: AudioNode): void { this.outputTarget = n; }

  /** Returns the most recently created DrumMachine instance.
   *  Phase G: used by save/load path to access kitId without requiring a
   *  pre-boot singleton. */
  getInstance(): DrumMachine | null { return this.lastInstance; }

  // ── Per-voice mute/solo (delegates to the active source) ─────────────────
  private muteTarget(): { getDrumVoiceMute(v: string): boolean; setDrumVoiceMute(v: string, m: boolean): void; getDrumVoiceSolo(v: string): boolean; toggleDrumVoiceSolo(v: string): void; getDrumVoiceMutes(): Record<string, boolean>; setDrumVoiceMutes(m: Record<string, boolean>): void } | null {
    if (this.kitMode === 'sample') return this.sampler;
    return this.lastInstance
      ? {
          getDrumVoiceMute: (v) => this.lastInstance!.getVoiceMute(v as DrumVoice),
          setDrumVoiceMute: (v, m) => this.lastInstance!.setVoiceMute(v as DrumVoice, m),
          getDrumVoiceSolo: (v) => this.lastInstance!.getVoiceSolo(v as DrumVoice),
          toggleDrumVoiceSolo: (v) => this.lastInstance!.toggleVoiceSolo(v as DrumVoice),
          getDrumVoiceMutes: () => this.lastInstance!.getVoiceMutes(),
          setDrumVoiceMutes: (m) => this.lastInstance!.setVoiceMutes(m),
        }
      : null;
  }
  getDrumVoiceMute(voice: DrumVoice): boolean { return this.muteTarget()?.getDrumVoiceMute(voice) ?? false; }
  setDrumVoiceMute(voice: DrumVoice, muted: boolean): void { this.muteTarget()?.setDrumVoiceMute(voice, muted); }
  getDrumVoiceSolo(voice: DrumVoice): boolean { return this.muteTarget()?.getDrumVoiceSolo(voice) ?? false; }
  toggleDrumVoiceSolo(voice: DrumVoice): void { this.muteTarget()?.toggleDrumVoiceSolo(voice); }
  /** Full mute map for persistence (solo is live-only). */
  getDrumVoiceMutes(): Record<string, boolean> { return this.muteTarget()?.getDrumVoiceMutes() ?? {}; }
  setDrumVoiceMutes(mutes: Record<string, boolean>): void { this.muteTarget()?.setDrumVoiceMutes(mutes); }

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

  /** bus.* ranges resolve from DRUM_PARAMS regardless of kitMode — the `params`
   *  getter returns the sampler's specs in sample mode (which lack bus.*), so a
   *  bus modulator's range-lookup would otherwise fall back to span 1 and
   *  mis-scale bus EQ/pan/level modulation depth. */
  private busRangeLookup = (id: string): { min: number; max: number } => {
    const s = DRUM_PARAMS.find((p) => p.id === id);
    return { min: s?.min ?? 0, max: s?.max ?? 1 };
  };

  getBaseValue(id: string): number {
    // bus.* stays on the façade in both modes (the bus strip is shared); only
    // non-bus ids delegate to the embedded sampler.
    if (this.kitMode === 'sample' && !id.startsWith('bus.')) return this.sampler.getBaseValue(id);
    if (id.startsWith('bus.')) {
      return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    const dm = this.lastInstance;
    if (DRUM_LANES.includes(voice) && dm) {
      if (MIXER_LEAVES.has(leaf)) return readMixer(dm, voice, leaf);
      const v = dm.getVoiceParam(voice, leaf);
      if (typeof v === 'number') return v;
    }
    return id in this.paramValues ? this.paramValues[id] : this.specDefault(id);
  }

  setBaseValue(id: string, v: number): void {
    if (this.kitMode === 'sample' && !id.startsWith('bus.')) { this.sampler.setBaseValue(id, v); return; }
    // bus.* is read back from this cache, so always store it; per-voice ids are
    // sourced live from the DrumMachine once an instance exists, so only cache
    // them before the instance appears (a transient boot window).
    if (id.startsWith('bus.') || !this.lastInstance) this.paramValues[id] = v;
    if (id.startsWith('bus.')) {
      if (!this.busStrip) return;
      switch (id) {
        case 'bus.level':      this.busStrip.setLevel(v);      return;
        case 'bus.pan':        this.busStrip.setPan(v);        return;
        case 'bus.reverbSend': this.busStrip.setSendB(v); return;
        case 'bus.delaySend':  this.busStrip.setSendA(v);  return;
        case 'bus.eq.low':     this.busStrip.setEqLow(v);      return;
        case 'bus.eq.mid':     this.busStrip.setEqMid(v);      return;
        case 'bus.eq.high':    this.busStrip.setEqHigh(v);     return;
      }
      return;
    }
    const dot = id.indexOf('.');
    const voice = id.slice(0, dot) as DrumVoice;
    const leaf = id.slice(dot + 1);
    if (!DRUM_LANES.includes(voice)) return;
    const dm = this.lastInstance;
    if (!dm) return; // no instance yet: cached above for getBaseValue; the real
                     // restore path (applyEngineState) re-applies setBaseValue
                     // after createVoice, so per-voice values land on the store then.
    if (MIXER_LEAVES.has(leaf)) { writeMixer(dm, voice, leaf, v); return; }
    dm.setVoiceParam(voice, leaf, v);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  /** Modulators are engine-wide on drums (one host, one binder bound across
   *  all channel-strip level params). spawnVoice would normally return per-
   *  note modulator voices; for drums we keep one set for the lifetime of the
   *  engine instance — initialized lazily here so the host's currentValue()
   *  drives all hits consistently. */
  private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    // When an insert chain is wired for this lane, use its inputNode as the
    // routing target so audio flows through the chain before hitting the strip.
    // If setOutputTarget was never called, fall back to the passed output node
    // (which is busStrip.input in the legacy path).
    const routingTarget = this.outputTarget ?? output;

    if (this.kitMode === 'sample') {
      const inner = this.sampler.createVoice(ctx, routingTarget);
      // Keep the bus-level LFO/ADSR (which target the shared bus strip) bound
      // in sample mode too — bind on create, tear down on dispose, mirroring
      // the synth DrumsVoice lifecycle.
      if (!this.engineModVoices) this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
      const laneId = getCurrentLaneForVoice();
      let binder: ConnectionBinder | null = null;
      if (laneId) {
        binder = bindEngineModulators({ laneId, engine: this, voiceMods: this.engineModVoices, ctx, rangeLookup: this.busRangeLookup });
        this.currentLaneId = laneId;
      }
      return {
        trigger: (m, t, o) => inner.trigger(m, t, o),
        release: (t) => inner.release(t),
        connect: (d) => inner.connect(d),
        getAudioParams: () => inner.getAudioParams(),
        getAudioParamRange: (id) => inner.getAudioParamRange?.(id),
        dispose: () => {
          inner.dispose();
          if (binder) binder.disposeAll();
          if (laneId) disposeLaneModulations(laneId);
        },
      };
    }

    let dm = this.instances.get(routingTarget);
    if (!dm) {
      if (!this.sharedFx) {
        throw new Error('DrumsEngine: setSharedFx must be called before createVoice');
      }
      dm = new DrumMachine(ctx, this.sharedFx, routingTarget);
      this.instances.set(routingTarget, dm);
    }
    this.lastInstance = dm;
    const drumVoice = new DrumsVoice(dm, this.busStrip);
    if (!this.engineModVoices) {
      // One-shot modulator spawn for the lifetime of this engine instance
      // (drums share modulation across all hits — distinct from polyphonic
      // engines that re-spawn per note).
      this.engineModVoices = this.modHost.spawnVoice(ctx, () => this.bpm);
    }
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      drumVoice.laneId = laneId;
      // Drums has no per-note voices — every modulator targets the shared bus
      // strip AudioParams (bus.pan/level/sends/eq from getSharedAudioParams).
      // Use the ENGINE binder: it has NO shared-scope exclusion, so a shared
      // LFO (the makeDefaultLFO default scope) actually reaches bus.pan. The
      // per-voice binder used here previously stripped every shared-scope→
      // shared-bus connection (it assumes an engine binder owns them), so the
      // LFO→bus.* connections were silently dropped — "LFO on drums pan does
      // nothing".
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

    // Per-voice mini-mixer rack — between the master strip (#drum-master-knobs,
    // mounted on the static page) and the modulators panel below.
    const rackHost = document.createElement('div');
    rackHost.className = 'drum-rack-host';
    container.appendChild(rackHost);
    renderDrumVoiceRack(this, ctx, rackHost);

    // Strip controls (DRUM VOL/PAN/REV/DLY/LO/MID/HI) and per-voice levels are
    // rendered by the static drum page via wireDrumMasterUI + the drum-grid
    // editor — they're not repeated here. This panel only carries the lane's
    // modulators (LFO/ADSR) so the engine-mod-host stays compact.
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
      if (unified.kind === 'synth' && unified.kitId && this.lastInstance) {
        this.lastInstance.loadKitDefaults(unified.kitId);
      }
      // sample kit: kitMode is set; the async decode + engineState mirror is
      // owned by the orchestrator (live) / the drumkitId self-heal (load).
      // applyPreset is sync + ctx-less, so it does NOT fetch/decode here.
      return;
    }
    // 2) Legacy back-compat: a GM-tagged drums-machine.json preset ("KIT *",
    //    used by MIDI import / demos / drumFallback) → kitId → synth kit.
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
    // 3) Bare kit *name* fallback (direct DrumMachine kit selection).
    if (!kitId && this.lastInstance) {
      kitId = this.lastInstance.listKits().find((k) => k.name === name)?.id;
    }
    if (kitId && this.lastInstance) this.lastInstance.loadKitDefaults(kitId);
    for (const [id, v] of overrides) this.setBaseValue(id, v);
  }

  getRackLayout() {
    if (this.kitMode === 'sample') return this.sampler.getRackLayout();
    return {
      // The union ['tune','attack','decay','tone','snap'] reproduces the OLD per-voice
      // curated split exactly because each leaf only exists on some voices:
      //   kick    ∩ union = {tune, attack, decay}
      //   snare   ∩ union = {tune, tone, snap}
      //   hats    ∩ union = {tune, decay}
      //   clap    ∩ union = {tone, decay}
      //   tom     ∩ union = {tune, decay}
      //   cowbell ∩ union = {tune, decay}
      //   ride    ∩ union = {tune, decay}
      // NOTE: 'sweep' is intentionally NOT included — it would wrongly promote
      // kick/tom SWEEP from advanced to curated.
      curatedSynth: ['tune', 'attack', 'decay', 'tone', 'snap'],
      curatedMixer: ['level', 'rev', 'dly'],
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
    return m;
  }

  dispose(): void {
    disposeEngineMods(this.engineModVoices, this.currentLaneId);
    this.engineModVoices = null;
    this.currentLaneId = null;
  }
}

const drumsEngine = new DrumsEngine();
registerEngine(drumsEngine);
registerEngineFactory('drums-machine', () => new DrumsEngine());

// configureDrumsEngineSharedFx deleted in Phase G — setSharedFx is now called
// per-instance inside ensureLaneResource before createVoice runs. This fixes
// the latent bug where extra drum lanes (created at runtime) never received
// a sharedFx reference, causing createVoice to throw.

export const drumsPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'drums-machine',
    name: 'Drums',
    kind: 'synth',
    version: '1.0.0',
    params: drumsEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new DrumsEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   ()        => engine.getSharedAudioParams?.() ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
