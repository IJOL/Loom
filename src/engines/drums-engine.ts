// src/engines/drums-engine.ts
// Adapts DrumMachine to the SynthEngine interface. Triggers are routed via
// the GM drum map so drum clips can use NoteEvent[] like every other engine.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { getCachedPresets } from '../presets/preset-loader';
import { DrumMachine } from '../core/drums';
import { FxBus } from '../core/fx';
import { GM_DRUM_MAP } from './drum-gm-map';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { getCurrentLaneForVoice } from '../modulation/active-mods';
import { bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
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
const DRUM_PARAMS: EngineParamSpec[] = [
  { id: 'bus.level',       label: 'Vol',  kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { id: 'bus.pan',         label: 'Pan',  kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { id: 'bus.reverbSend',  label: 'Rev',  kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.delaySend',   label: 'Dly',  kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.eq.low',      label: 'Lo',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.mid',      label: 'Mid',  kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.high',     label: 'Hi',   kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

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
      m.set('bus.reverbSend', this.busStrip.reverbSend.gain);
      m.set('bus.delaySend',  this.busStrip.delaySend.gain);
      m.set('bus.eq.low',     this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',     this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high',    this.busStrip.getEqGainParam('high'));
    }
    return m;
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const voice = GM_DRUM_MAP[midi];
    if (!voice) return;
    this.dm.trigger(voice, time, !!opts.accent);
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
  readonly params = DRUM_PARAMS;
  get presets() { return getCachedPresets('drums-machine'); }

  private instances = new WeakMap<AudioNode, DrumMachine>();
  private lastInstance: DrumMachine | null = null;

  /** Engine-level cache for scalar param values. Per-voice `.level` writes
   *  push through to the matching ChannelStrip; master.* values are stored
   *  here for now (no audio destination wired yet — modulators and the
   *  knob UI still read/write them consistently). */
  private paramValues: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (const s of DRUM_PARAMS) o[s.id] = s.default;
    return o;
  })();

  // The drum machine constructor needs an FxBus reference for sends; the
  // host injects one shared FxBus via setSharedFx so lanes can share reverb/
  // delay tails with the rest of the mix.
  private sharedFx: FxBus | null = null;
  setSharedFx(fx: FxBus): void { this.sharedFx = fx; }

  private busStrip: import('../core/fx').ChannelStrip | null = null;
  setBusStrip(strip: import('../core/fx').ChannelStrip): void {
    this.busStrip = strip;
  }

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  get modulators() { return this.modHost; }

  /** Tempo for LFO BPM sync. main.ts updates this when seq.bpm changes. */
  bpm = 120;

  getBaseValue(id: string): number {
    if (id in this.paramValues) return this.paramValues[id];
    return DRUM_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (!(id in this.paramValues)) return;
    this.paramValues[id] = v;
    if (!this.busStrip) return;
    switch (id) {
      case 'bus.level':       this.busStrip.setLevel(v);       return;
      case 'bus.pan':         this.busStrip.setPan(v);         return;
      case 'bus.reverbSend':  this.busStrip.setReverbSend(v);  return;
      case 'bus.delaySend':   this.busStrip.setDelaySend(v);   return;
      case 'bus.eq.low':      this.busStrip.setEqLow(v);       return;
      case 'bus.eq.mid':      this.busStrip.setEqMid(v);       return;
      case 'bus.eq.high':     this.busStrip.setEqHigh(v);      return;
    }
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
    let dm = this.instances.get(output);
    if (!dm) {
      if (!this.sharedFx) {
        throw new Error('DrumsEngine: setSharedFx must be called before createVoice');
      }
      dm = new DrumMachine(ctx, this.sharedFx, output);
      this.instances.set(output, dm);
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
      drumVoice.binder = bindVoiceModulators({
        laneId, engine: this, voice: drumVoice, voiceMods: this.engineModVoices, ctx,
      });
      this.currentLaneId = laneId;
    }
    return drumVoice;
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new DrumsSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

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
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  applyPreset(name: string): void {
    if (!this.lastInstance) return;
    const preset = this.presets.find((p) => p.name === name);
    if (preset) {
      const kitId = (preset.params as { kitId?: string }).kitId;
      if (typeof kitId === 'string') {
        this.lastInstance.setKit(kitId);
        return;
      }
    }
    // Fallback: match against actual kit names (back-compat for direct kit selection).
    const kits = this.lastInstance.listKits();
    const kit = kits.find((k) => k.name === name);
    if (kit) this.lastInstance.setKit(kit.id);
  }

  getSharedAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    if (this.busStrip) {
      m.set('bus.level',      this.busStrip.level.gain);
      m.set('bus.pan',        this.busStrip.getPanParam());
      m.set('bus.reverbSend', this.busStrip.reverbSend.gain);
      m.set('bus.delaySend',  this.busStrip.delaySend.gain);
      m.set('bus.eq.low',     this.busStrip.getEqGainParam('low'));
      m.set('bus.eq.mid',     this.busStrip.getEqGainParam('mid'));
      m.set('bus.eq.high',    this.busStrip.getEqGainParam('high'));
    }
    return m;
  }

  dispose(): void {}
}

const drumsEngine = new DrumsEngine();
registerEngine(drumsEngine);
registerEngineFactory('drums-machine', () => new DrumsEngine());

export function configureDrumsEngineSharedFx(fx: FxBus): void {
  drumsEngine.setSharedFx(fx);
}
