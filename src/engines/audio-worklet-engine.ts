// src/engines/audio-worklet-engine.ts
// The dedicated Audio channel engine, backed by the AudioWorklet sample bank.
// Mirrors the legacy AudioEngine (audio.ts) — plays ONLY a clip's ClipSample
// buffer (whole loop/song) WSOLA-adapted to the session tempo — but resolves the
// (warped/stretched) buffer main-thread and posts a flat kind:'audio' spawn to a
// shared SamplerWorkletNode instead of building an AudioBufferSourceNode graph.
//
// Not in the engine registry; constructed directly by the lane allocator on the
// worklet backend. The legacy AudioEngine (audio.ts) keeps the 'audio' registry
// entry as the offline-render source until Phase 4 (cutover).

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext, VoiceTriggerOptions,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { wireEngineParams } from './engine-ui';
import { resolveAudioClipPlayback } from './audio-clip-voice';
import { neutralAudioSpawn } from './sampler-worklet-engine';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';
import { SamplerWorkletNode } from '../audio-worklet/sampler-node';
import type { SampleSpawn } from '../audio-dsp/sample/types';
import type { FxBus } from '../core/fx';

const AUDIO_PARAMS: EngineParamSpec[] = [
  { id: 'gain', label: 'Gain', kind: 'continuous', min: 0, max: 1.5, default: 1 },
];

class AudioSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

class AudioWorkletVoice implements Voice {
  constructor(private engine: AudioWorkletEngine) {}
  trigger(_midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (!opts.sample) return; // audio engine only plays clip samples
    this.engine.spawnClip(time, opts);
  }
  release(_time: number): void { this.engine.silence(); }
  connect(_dest: AudioNode): void { /* worklet node connected by the engine */ }
  getAudioParams(): Map<string, AudioParam> { return new Map(); }
  dispose(): void { /* no per-note nodes */ }
}

export class AudioWorkletEngine implements SynthEngine {
  readonly id = 'audio';
  readonly name = 'Audio';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = AUDIO_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];
  private modHost = new ModulationHostImpl([]);
  private values: Record<string, number> = { gain: 1 };

  private node: SamplerWorkletNode | null = null;
  private ctx: AudioContext | null = null;
  private dryTarget: AudioNode | null = null;
  private fx: FxBus | null = null;

  get modulators(): ModulationHostImpl { return this.modHost; }
  getBaseValue(id: string): number { return this.values[id] ?? 0; }
  setBaseValue(id: string, v: number): void { this.values[id] = v; }

  /** The allocator wires the dry output to the lane insert chain / strip. */
  setOutputTarget(n: AudioNode): void {
    this.dryTarget = n;
    if (this.node) this.node.connectDry(n);
  }
  setSharedFx(fx: FxBus): void {
    this.fx = fx;
    if (this.node) this.node.connectSend(fx.delayInput, fx.reverbInput);
  }

  private ensureNode(ctx: AudioContext): SamplerWorkletNode {
    if (this.node && this.ctx === ctx) return this.node;
    this.ctx = ctx;
    this.node = new SamplerWorkletNode(ctx);
    if (this.dryTarget) this.node.connectDry(this.dryTarget);
    if (this.fx) this.node.connectSend(this.fx.delayInput, this.fx.reverbInput);
    return this.node;
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (!this.dryTarget) this.dryTarget = output;
    this.ensureNode(ctx);
    return new AudioWorkletVoice(this);
  }

  /** Resolve the clip buffer main-thread, push to the bank, post a flat spawn. */
  spawnClip(time: number, opts: VoiceTriggerOptions): void {
    const node = this.node;
    if (!node) return;
    const r = this.resolveSpawn(time, opts, this.ctx);
    if (!r) return;
    if (!node.hasSample(r.spawn.sampleId)) node.loadSample(r.spawn.sampleId, r.buffer);
    node.spawn('audio', r.spawn);
  }

  /** Pure spawn resolution for an audio clip — the SampleSpawn the renderer plays
   *  + the AudioBuffer to register. Shared by spawnClip (live) and the offline
   *  scene recorder (which renders the spawn through AudioClipRenderer). */
  resolveSpawn(
    time: number, opts: VoiceTriggerOptions, ctx: AudioContext | null,
  ): { spawn: SampleSpawn; buffer: AudioBuffer } | null {
    if (!opts.sample || !ctx) return null;
    const resolved = resolveAudioClipPlayback({
      ctx, sample: opts.sample, gateDuration: opts.gateDuration,
      masterGain: this.getBaseValue('gain'),
    });
    if (!resolved) return null;
    return {
      buffer: resolved.buffer,
      spawn: neutralAudioSpawn(resolved.bufferId, time, opts.gateDuration, resolved.rate, resolved.offset, resolved.gain * CATEGORY_GAIN.audio),
    };
  }

  /** Transport Stop: silence the whole-loop clip immediately (the registry's
   *  Stop seam routes here via the voice's release). */
  silence(): void { this.node?.silenceAll(); }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new AudioSequencer(); }
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;
    const row = document.createElement('div');
    row.className = 'knob-row';
    container.appendChild(row);
    wireEngineParams(this, ctx, row, { filter: (id) => id === 'gain' });
  }
  applyPreset(): void { /* audio clips have no presets */ }
  dispose(): void {
    this.node?.disconnect();
    this.node = null;
  }
}
