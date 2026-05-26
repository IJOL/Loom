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

  buildParamUI(_container: HTMLElement, _ctx?: EngineUIContext): void {
    // Drum master knobs render via the existing drum-master-ui code path
    // for now. Migration of that UI into this method happens in Phase 7.
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
