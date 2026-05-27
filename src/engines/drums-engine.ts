// src/engines/drums-engine.ts
// Adapts DrumMachine to the SynthEngine interface. Triggers are routed via
// the GM drum map so drum clips can use NoteEvent[] like every other engine.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer,
  EngineUIContext, EnginePreset, ParamDef,
} from './engine-types';
import { registerEngine, registerEngineFactory } from './registry';
import { DrumMachine } from '../core/drums';
import { FxBus } from '../core/fx';
import { GM_DRUM_MAP } from './drum-gm-map';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import type { KnobHandle } from '../core/knob';

const PARAMS: ParamDef[] = [
  { id: 'master-gain', label: 'LEVEL', min: 0,   max: 1.5, default: 1 },
  { id: 'master-tune', label: 'TUNE',  min: -12, max: 12,  default: 0 },
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
  readonly params = PARAMS;
  readonly presets = DRUM_PRESETS;

  private instances = new WeakMap<AudioNode, DrumMachine>();
  private lastInstance: DrumMachine | null = null;

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
    return new DrumsVoice(dm);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new DrumsSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (!ctx) return;
    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      extraPrefixes: ['drumBus', 'kick', 'snare', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride'],
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
