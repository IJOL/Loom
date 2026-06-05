// src/engines/audio.ts
// The dedicated audio channel engine. Plays ONLY a clip's ClipSample buffer
// (whole loop/song) WSOLA-adapted to the session tempo via the shared
// audio-clip-voice helper. No keymap, no notes, no synthesis params beyond Gain.

import type { SynthEngine, Voice, EngineSequencer, EngineUIContext, VoiceTriggerOptions } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { wireEngineParams } from './engine-ui';
import { playAudioClip } from './audio-clip-voice';

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

class AudioVoice implements Voice {
  private readonly amp: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private started = false;
  private endTime = Infinity;

  constructor(private ctx: AudioContext, output: AudioNode, private getGain: () => number) {
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(output);
  }

  trigger(_midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (!opts.sample) return; // audio engine only plays clip samples
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    const r = playAudioClip({
      ctx: this.ctx, sample: opts.sample, time, gateDuration: opts.gateDuration,
      dest: this.amp, ampGain: this.amp, masterGain: this.getGain(),
    });
    if (!r) return;
    this.src = r.src;
    this.endTime = r.endTime;
    this.started = true;
  }

  release(time: number): void {
    const g = this.amp.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + 0.005);
    if (this.src && this.started && time + 0.02 < this.endTime) {
      try { this.src.stop(time + 0.02); } catch { /* already stopped */ }
    }
  }

  connect(_dest: AudioNode): void { /* already connected to output */ }
  getAudioParams(): Map<string, AudioParam> { return new Map([['gain', this.amp.gain]]); }
  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.amp.disconnect();
  }
}

export class AudioEngine implements SynthEngine {
  readonly id = 'audio';
  readonly name = 'Audio';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'mono' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = AUDIO_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];
  private modHost = new ModulationHostImpl([]);
  private values: Record<string, number> = { gain: 1 };

  get modulators(): ModulationHostImpl { return this.modHost; }
  getBaseValue(id: string): number { return this.values[id] ?? 0; }
  setBaseValue(id: string, v: number): void { this.values[id] = v; }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new AudioVoice(ctx, output, () => this.getBaseValue('gain'));
  }
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
  dispose(): void { /* no shared resources */ }
}

export const audioEngine = new AudioEngine();
registerEngine(audioEngine);
registerEngineFactory('audio', () => new AudioEngine());
