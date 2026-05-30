// src/engines/sampler.ts
// Sampler engine: plays one-shot samples pitched per MIDI note. Phase 2 of the
// sampler spec (loop/song clip playback, modulation wiring, voice-stealing and
// the keymap UI arrive in later plans). The voice is built in Task 7.

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { KeymapEntry } from '../samples/types';
import type { VoiceTriggerOptions } from './engine-types';
import { sampleCache } from '../samples/sample-cache';
import { keymapEntryFor, repitchRate } from '../samples/keymap';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',             label: 'Gain',    kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { id: 'amp.attack',       label: 'Attack',  kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'amp.release',      label: 'Release', kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { id: 'pitch',            label: 'Pitch',   kind: 'continuous', min: -24,   max: 24,  default: 0,     unit: 'st' },
  { id: 'filter.cutoff',    label: 'Cutoff',  kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { id: 'filter.resonance', label: 'Res',     kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { id: 'poly.voices',      label: 'Voices',  kind: 'continuous', min: 1,     max: 16,  default: 8 },
];

class SamplerSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

const OUTPUT_TRIM = 0.7; // headroom so a full-scale sample + resonance stays < 0 dBFS

class SamplerVoice implements Voice {
  private src: AudioBufferSourceNode | null = null;
  private readonly filter: BiquadFilterNode;
  private readonly ampGain: GainNode;
  private started = false;
  private endTime = Infinity;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private getParam: (id: string) => number,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.filter.connect(this.ampGain).connect(output);
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return;

    // Defensive: if this voice is re-triggered, stop + disconnect the previous
    // source before replacing it so the old node doesn't leak. The poly host
    // normally creates a fresh voice per note, so this is the non-default path.
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = repitchRate(midi, entry.rootNote, this.getParam('pitch'));
    src.connect(this.filter);
    this.src = src;

    // Static lowpass: cutoff knob 0..1 → 60..18000 Hz (exp), open by default.
    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);

    // Amp envelope: attack → hold at peak until gate end → release to 0.
    const peakLevel =
      this.getParam('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM;
    const atk = Math.max(0.001, this.getParam('amp.attack'));
    const rel = Math.max(0.005, this.getParam('amp.release'));
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peakLevel, time + atk);
    const releaseAt = Math.max(time + atk, time + opts.gateDuration);
    g.setValueAtTime(peakLevel, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, 0);
    src.stop(this.endTime);
    this.started = true;
  }

  release(time: number): void {
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + 0.005); // gate cut, not a musical release
    if (this.src && this.started && time + 0.02 < this.endTime) {
      try { this.src.stop(time + 0.02); } catch { /* already stopped */ }
    }
  }

  connect(_dest: AudioNode): void { /* already connected to output */ }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['gain',             this.ampGain.gain],
      ['filter.cutoff',    this.filter.frequency],
      ['filter.resonance', this.filter.Q],
    ]);
  }

  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.filter.disconnect();
    this.ampGain.disconnect();
  }
}

export class SamplerEngine implements SynthEngine {
  readonly id = 'sampler';
  readonly name = 'Sampler';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SAMPLER_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private paramValues: Record<string, number> = {};
  private keymap: KeymapEntry[] = [];
  private modHost = new ModulationHostImpl([]);

  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }
  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
  }

  /** Replace the lane's one-shot keymap. Phase-3 UI calls this; tests call it
   *  directly. */
  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries;
  }
  getKeymap(): KeymapEntry[] {
    return this.keymap;
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params)) this.paramValues[k] = v;
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new SamplerVoice(ctx, output, this.keymap, (id) => this.getBaseValue(id));
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }
  buildParamUI(_c: HTMLElement, _ctx?: EngineUIContext): void { /* keymap UI: later plan */ }
  dispose(): void { this.keymap = []; }
}

export const samplerEngine = new SamplerEngine();
registerEngine(samplerEngine);
registerEngineFactory('sampler', () => new SamplerEngine());
