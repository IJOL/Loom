// src/engines/drums-engine.ts
// Adapts DrumMachine to the SynthEngine interface. Triggers are routed via
// the GM drum map so drum clips can use NoteEvent[] like every other engine.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { DrumMachine, DRUM_LANES, type DrumVoice } from '../core/drums';
import { FxBus } from '../core/fx';
import { GM_DRUM_MAP } from './drum-gm-map';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import type { KnobHandle } from '../core/knob';
import { wireEngineParams } from './engine-ui';

// Unified-param schema for the drums engine. Master controls live at the
// engine level; per-voice `.level` ids map onto each DrumMachine channel
// strip's `level.gain` AudioParam (see DrumsVoice.getAudioParams below).
const DRUM_PARAMS: EngineParamSpec[] = [
  // Kit-level master
  { id: 'master.level', label: 'Level', kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { id: 'master.tune',  label: 'Tune',  kind: 'continuous', min: -12, max: 12,  default: 0, unit: 'st' },
  // Per-voice levels (one .level spec per DRUM_LANES entry)
  { id: 'kick.level',      label: 'Kick',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'snare.level',     label: 'Snare', kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'closedHat.level', label: 'CHat',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'openHat.level',   label: 'OHat',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'clap.level',      label: 'Clap',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'cowbell.level',   label: 'Cwbll', kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'tom.level',       label: 'Tom',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'ride.level',      label: 'Ride',  kind: 'continuous', min: 0, max: 1.5, default: 1 },
];

// Drum presets = the existing KITS. Their full per-voice param shapes live
// on the DrumMachine itself; this engine-level preset just stores the kit
// id so applyPreset can call dm.setKit().
const DRUM_PRESETS: EnginePreset[] = [
  { name: '808',       params: { kitId: 0 } },
  { name: '909',       params: { kitId: 1 } },
  { name: 'Linn',      params: { kitId: 2 } },
  { name: 'Acoustic',  params: { kitId: 3 } },
];

class DrumsVoice implements Voice {
  constructor(private dm: DrumMachine) {}

  /** Expose each drum voice's channel-strip level GainNode as an AudioParam
   *  keyed by '<voice>.level'. The lane-host's modulator binder routes
   *  enabled connections into these via depth-gains. */
  getAudioParams(): Map<string, AudioParam> {
    const m = new Map<string, AudioParam>();
    for (const voice of DRUM_LANES) {
      const ch = this.dm.channels[voice];
      if (ch && ch.level) m.set(`${voice}.level`, ch.level.gain);
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
  dispose(): void {}
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
  readonly presets = DRUM_PRESETS;

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

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  get modulators() { return this.modHost; }

  getBaseValue(id: string): number {
    if (id in this.paramValues) return this.paramValues[id];
    return DRUM_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (!(id in this.paramValues)) return;
    this.paramValues[id] = v;
    if (!this.lastInstance) return;

    // Per-voice level: push to the channel strip's level gain.
    const [scope, field] = id.split('.');
    if (field === 'level' && scope !== 'master') {
      const ch = this.lastInstance.channels[scope as DrumVoice];
      if (ch && ch.level) ch.level.gain.value = v;
    }
    // master.* lives only in paramValues for now; future work can route
    // master.level into a kit-bus VCA and master.tune into per-voice osc
    // frequency offsets at trigger time.
  }

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
    // Re-apply any per-voice levels that were set before the instance existed.
    for (const voice of DRUM_LANES) {
      const id = `${voice}.level`;
      const ch = dm.channels[voice];
      if (ch && ch.level) ch.level.gain.value = this.paramValues[id];
    }
    return new DrumsVoice(dm);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new DrumsSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmt = (id: string, v: number): string => {
      if (id === 'master.tune') return `${v >= 0 ? '+' : ''}${v.toFixed(0)}st`;
      return `${Math.round(v * 100)}%`;
    };

    // Master controls (level, tune).
    const masterRow = document.createElement('div');
    masterRow.className = 'row poly-section';
    const masterLab = document.createElement('div');
    masterLab.className = 'section-label';
    masterLab.textContent = 'MASTER';
    masterRow.appendChild(masterLab);
    const masterKnobs = document.createElement('div');
    masterKnobs.className = 'knob-row';
    masterRow.appendChild(masterKnobs);
    container.appendChild(masterRow);
    wireEngineParams(this, ctx, masterKnobs, {
      filter: (id) => id.startsWith('master.'),
      formatter: fmt,
    });

    // Per-voice levels.
    const voicesRow = document.createElement('div');
    voicesRow.className = 'row poly-section';
    const voicesLab = document.createElement('div');
    voicesLab.className = 'section-label';
    voicesLab.textContent = 'VOICES';
    voicesRow.appendChild(voicesLab);
    const voicesKnobs = document.createElement('div');
    voicesKnobs.className = 'knob-row';
    voicesRow.appendChild(voicesKnobs);
    container.appendChild(voicesRow);
    wireEngineParams(this, ctx, voicesKnobs, {
      filter: (id) => !id.startsWith('master.'),
      formatter: fmt,
    });

    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
      },
    });
  }

  applyPreset(name: string): void {
    if (!this.lastInstance) return;
    const kits = this.lastInstance.listKits();
    const kit = kits.find((k) => k.name === name);
    if (kit) this.lastInstance.setKit(kit.id);
  }

  dispose(): void {}
}

const drumsEngine = new DrumsEngine();
registerEngine(drumsEngine);
registerEngineFactory('drums-machine', () => new DrumsEngine());

export function configureDrumsEngineSharedFx(fx: FxBus): void {
  drumsEngine.setSharedFx(fx);
}
