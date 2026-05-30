import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import { createPeriodicWaves, WAVETABLES } from './wavetable-tables';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR } from '../modulation/types';
import type { ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';
import { getCachedPresets } from '../presets/preset-loader';

const WAVE_OPTIONS = WAVETABLES.map((w, i) => ({ value: String(i), label: w.name }));

/** Operating ranges for the shared modBus AudioParams (ConstantSourceNode.offset
 *  summed into each per-voice AudioParam). Native units: Hz for cutoff, Q for
 *  resonance, gain for amp — so depth=1 on a shared LFO produces the same
 *  audible swing as on a per-voice LFO bound to the same destination. */
function sharedParamRange(shortId: string): { min: number; max: number } {
  switch (shortId) {
    case 'filter.cutoff':    return { min: -4000, max: 4000 };
    case 'filter.resonance': return { min: -10,   max: 10   };
    case 'amp.gain':         return { min: 0,     max: 1    };
    default:                 return { min: 0,     max: 1    };
  }
}

const WT_PARAMS: EngineParamSpec[] = [
  { id: 'osc.waveA',        label: 'Wave A',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 2, options: WAVE_OPTIONS },
  { id: 'osc.waveB',        label: 'Wave B',    kind: 'discrete', min: 0, max: WAVE_OPTIONS.length - 1, default: 3, options: WAVE_OPTIONS },
  { id: 'osc.morph',        label: 'Morph',     kind: 'continuous', min: 0,    max: 1,  default: 0.0 },
  { id: 'osc.detune',       label: 'Detune',    kind: 'continuous', min: -50,  max: 50, default: 0, unit: '¢' },
  { id: 'filter.cutoff',    label: 'Cutoff',    kind: 'continuous', min: 0,    max: 1,  default: 0.55 },
  { id: 'filter.resonance', label: 'Res',       kind: 'continuous', min: 0,    max: 1,  default: 0.2 },
  { id: 'amp.attack',       label: 'Attack',    kind: 'continuous', min: 0.001, max: 2, default: 0.01, unit: 's', curve: 'exponential' },
  { id: 'amp.decay',        label: 'Decay',     kind: 'continuous', min: 0.001, max: 2, default: 0.3,  unit: 's', curve: 'exponential' },
  { id: 'amp.sustain',      label: 'Sustain',   kind: 'continuous', min: 0,    max: 1,  default: 0.7 },
  { id: 'amp.release',      label: 'Release',   kind: 'continuous', min: 0.005, max: 4, default: 0.3,  unit: 's', curve: 'exponential' },
  // Polyphony cap — shown as a knob in the Wavetable inspector.
  { id: 'poly.voices',      label: 'Voices',    kind: 'continuous', min: 1, max: 16, default: 8 },
];

class WavetableVoice implements Voice {
  readonly oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private gainA: GainNode;
  private gainB: GainNode;
  public readonly filter: BiquadFilterNode;
  public readonly ampGain: GainNode;
  private envAmp!: ConstantSourceNode;
  private envCutoff!: ConstantSourceNode;
  private started = false;
  private stopScheduled = false;

  /** Set by WavetableEngine.createVoice for dispose-time cleanup. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  constructor(
    ctx: AudioContext,
    output: AudioNode,
    private waves: PeriodicWave[],
    private getParam: (id: string) => number,
    private getWaveAIndex: () => number,
    private getWaveBIndex: () => number,
    private voiceMods: Map<string, ModulatorVoice>,
    modBus?: Record<string, ConstantSourceNode>,
  ) {
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.gainA = ctx.createGain();
    this.gainB = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();

    // Wire the engine-wide shared modulation bus → this voice's filter/amp
    // AudioParams. Shared-scope LFOs write to modBus[*].offset and the
    // contribution fans out here via Web Audio summing.
    if (modBus) {
      modBus['filter.cutoff'].connect(this.filter.frequency);
      modBus['filter.resonance'].connect(this.filter.Q);
      modBus['amp.gain'].connect(this.ampGain.gain);
    }

    // Internal envelope sources — modulators sum on top of these via the
    // destination AudioParams (ampGain.gain, filter.frequency).
    this.envAmp = ctx.createConstantSource();
    this.envAmp.offset.value = 0;
    this.envAmp.start();
    this.envAmp.connect(this.ampGain.gain);

    this.envCutoff = ctx.createConstantSource();
    this.envCutoff.offset.value = 0;
    this.envCutoff.start();
    this.envCutoff.connect(this.filter.frequency);

    this.ampGain.gain.value = 0;
    this.filter.frequency.value = 0;

    this.oscA.connect(this.gainA).connect(this.filter);
    this.oscB.connect(this.gainB).connect(this.filter);
    this.filter.connect(this.ampGain).connect(output);
  }

  getAudioParams(): Map<string, AudioParam> {
    return new Map<string, AudioParam>([
      ['amp.gain',         this.ampGain.gain],
      ['filter.cutoff',    this.filter.frequency],
      ['filter.resonance', this.filter.Q],
    ]);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    // Fire modulator voices first so their AudioParam contributions land
    // before the oscillators start.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = options.accent ? 1.3 : 1.0;
    const morph = this.getParam('osc.morph');
    const detune = this.getParam('osc.detune');
    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');

    const aIdx = Math.max(0, Math.min(this.waves.length - 1, this.getWaveAIndex()));
    const bIdx = Math.max(0, Math.min(this.waves.length - 1, this.getWaveBIndex()));
    this.oscA.setPeriodicWave(this.waves[aIdx]);
    this.oscB.setPeriodicWave(this.waves[bIdx]);

    this.oscA.frequency.setValueAtTime(freq, time);
    this.oscB.frequency.setValueAtTime(freq, time);
    this.oscA.detune.setValueAtTime(-detune, time);
    this.oscB.detune.setValueAtTime(detune, time);

    // Equal-power crossfade so total energy stays roughly constant across morph.
    // OUTPUT_TRIM (0.6) holds the post-accent peak below 0 dBFS at C3 with
    // accent + cutoff fully open + max resonance (Q=20.5), giving the filter
    // room to ring without hard-clipping the engine output. This mirrors the
    // carrier-level trim in fm.ts (* 0.25). Without it the engine relies on
    // a downstream master trim to stay below unity.
    const OUTPUT_TRIM = 0.6;
    const gA = Math.cos(morph * Math.PI * 0.5) * velMul * OUTPUT_TRIM;
    const gB = Math.sin(morph * Math.PI * 0.5) * velMul * OUTPUT_TRIM;
    this.gainA.gain.setValueAtTime(gA, time);
    this.gainB.gain.setValueAtTime(gB, time);

    // Static cutoff base + Q. ADSR routed to filter.cutoff supplies envelope
    // motion; LFOs routed to filter.cutoff add wobble. Base value is written
    // onto envCutoff.offset so modulator sums stack cleanly on the destination.
    const baseHz = 60 * Math.pow(220, cutoff);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);
    this.envCutoff.offset.setValueAtTime(baseHz, time);

    // Amp envelope: when no external modulator binding is wired (i.e. no
    // laneId set during createVoice, as in standalone/test renders), schedule
    // a built-in ADSR onto envAmp.offset so the voice is audible. When a lane
    // binder is present, the modulator ADSR on amp.gain drives the envelope
    // and we leave envAmp.offset at 0 to avoid double-enveloping.
    if (this.binder == null) {
      // Standalone ADSR: oscillator gains already carry velMul, so the amp
      // envelope peaks at unity (the modulator-bound path peaks at 1 too —
      // modulator output is normalized 0..1 and connection depth scales it
      // into the destination range).
      const atk = this.getParam('amp.attack');
      const dec = this.getParam('amp.decay');
      const sus = this.getParam('amp.sustain');
      this.envAmp.offset.cancelScheduledValues(time);
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(1, time + Math.max(0.001, atk));
      this.envAmp.offset.linearRampToValueAtTime(sus, time + Math.max(0.001, atk) + Math.max(0.001, dec));
    } else {
      this.envAmp.offset.setValueAtTime(0, time);
    }

    if (!this.started) {
      this.oscA.start(time);
      this.oscB.start(time);
      this.started = true;
    }
  }

  release(time: number): void {
    for (const mv of this.voiceMods.values()) mv.release(time);
    // When running standalone (no binder), the internal ADSR scheduled in
    // trigger() holds the sustain forever — cut it down here so release tests
    // and normal note-off behavior work without a modulator binding.
    if (this.binder == null) {
      this.envAmp.offset.cancelScheduledValues(time);
      // Short 5 ms ramp to silence — gate-cut, not a musical release. The
      // engine's amp.release param is meant for the modulator ADSR; standalone
      // mode is just a fallback.
      this.envAmp.offset.linearRampToValueAtTime(0, time + 0.005);
    }
  }

  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    if (!this.stopScheduled && this.started) {
      try { this.oscA.stop(); } catch {}
      try { this.oscB.stop(); } catch {}
      this.stopScheduled = true;
    }
    try { this.envAmp.stop(); } catch {}
    try { this.envCutoff.stop(); } catch {}
    this.oscA.disconnect();
    this.oscB.disconnect();
    this.filter.disconnect();
    this.ampGain.disconnect();
    this.envAmp.disconnect();
    this.envCutoff.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
  }
}

class WavetableSequencer implements EngineSequencer {
  getStepAt(_index: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_step: number): void {}
  serialize(): unknown { return null; }
  deserialize(_data: unknown): void {}
  dispose(): void {}
}

export class WavetableEngine implements SynthEngine {
  readonly id = 'wavetable';
  readonly name = 'Wave';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly params = WT_PARAMS;
  readonly editor = 'piano-roll' as const;
  get presets(): import('./engine-types').EnginePreset[] {
    return getCachedPresets('wavetable');
  }

  private waves: PeriodicWave[] = [];
  private paramValues: Record<string, number> = {};
  private waveAIndex = 2; // Sawtooth
  private waveBIndex = 3; // Square

  /** Engine-wide shared modulation bus. ConstantSourceNodes whose .offset is
   *  driven by scope='shared' modulators (via bindEngineModulators) and whose
   *  output fans out to every voice's matching AudioParam in the constructor.
   *  Lazy-init in createVoice because we need the AudioContext. */
  readonly modBus?: Record<string, ConstantSourceNode>;

  /** Cached engine-wide modulator voices for scope='shared' mods. Spawned
   *  once on the first createVoice call and reused for every subsequent voice
   *  so shared LFOs/ADSRs share phase + state across notes. */
  private engineModVoices: Map<string, import('../modulation/types').ModulatorVoice> | null = null;

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  /** Maximum simultaneous voices. Oldest voice is stolen when exceeded. */
  maxVoices = 8;

  /** Ordered list of active voices (oldest first). */
  private activeVoices: WavetableVoice[] = [];

  /** How many voices are currently tracked as active. */
  activeVoiceCount(): number {
    return this.activeVoices.length;
  }

  /** Steal (dispose + remove) the N oldest voices. */
  private stealOldest(n: number): void {
    const toSteal = this.activeVoices.splice(0, n);
    for (const v of toSteal) {
      v.dispose();
    }
  }

  private modHost = new ModulationHostImpl([
    {
      ...makeDefaultADSR('adsr1'),
      connections: [
        { id: 'c-amp',    paramId: 'amp.gain',      depth: 1.0 },
        { id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0.5 },
      ],
    },
    makeDefaultLFO('lfo1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of WT_PARAMS) {
      this.paramValues[p.id] = p.default;
    }
  }

  getBaseValue(id: string): number {
    if (id === 'osc.waveA') return this.waveAIndex;
    if (id === 'osc.waveB') return this.waveBIndex;
    return this.paramValues[id] ?? WT_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'osc.waveA') { this.setWaveA(Math.round(v)); return; }
    if (id === 'osc.waveB') { this.setWaveB(Math.round(v)); return; }
    if (id === 'poly.voices') {
      const newCap = Math.max(1, Math.min(16, Math.round(v)));
      this.maxVoices = newCap;
      this.paramValues[id] = newCap;
      // Steal excess voices immediately if the new cap is below the current count.
      if (this.activeVoices.length > newCap) {
        this.stealOldest(this.activeVoices.length - newCap);
      }
      return;
    }
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  setWaveA(idx: number): void {
    this.waveAIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
  }

  setWaveB(idx: number): void {
    this.waveBIndex = Math.max(0, Math.min(WAVETABLES.length - 1, idx));
  }

  getWaveA(): number { return this.waveAIndex; }
  getWaveB(): number { return this.waveBIndex; }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    if (this.waves.length === 0) {
      this.waves = createPeriodicWaves(ctx);
    }
    // Lazy-init the shared modulation bus on the first createVoice call.
    if (!this.modBus) {
      const mk = () => {
        const n = ctx.createConstantSource();
        n.offset.value = 0;
        n.start();
        return n;
      };
      (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
        'filter.cutoff':    mk(),
        'filter.resonance': mk(),
        'amp.gain':         mk(),
      };
    }
    // 1. Lazy-init engine-wide modulator voices for SHARED mods and bind
    //    them ONCE to the modulation bus AudioParams. The shared modBus
    //    offsets are summed into per-voice AudioParams in their native
    //    units (Hz for cutoff, Q for resonance, gain for amp), so we
    //    use sharedParamRange here — depth=1 on a shared LFO must produce
    //    the same swing magnitude as on a per-voice LFO bound to the same
    //    destination.
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const sharedLaneId = getCurrentLaneForVoice();
      if (sharedLaneId) {
        bindEngineModulators({
          laneId: sharedLaneId,
          engine: this,
          voiceMods: this.engineModVoices,
          ctx,
          rangeLookup: (shortId) => sharedParamRange(shortId),
        });
      }
    }
    // 2. Per-voice modulators: spawn per call for this note.
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    const voice = new WavetableVoice(
      ctx,
      output,
      this.waves,
      (id) => this.getBaseValue(id),
      () => this.waveAIndex,
      () => this.waveBIndex,
      voiceMods,
      this.modBus,
    );
    // Record BOTH engine-shared and per-voice mods so the rAF tick can find
    // the shared LFO via getActiveModVoice (whose currentValue() syncs the
    // live OscillatorNode to state mutations).
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      // Merge engine-shared mods into the per-voice binding map so a
      // scope='shared' LFO targeting a per-voice-only param still gets a
      // gain bridge. The voice-mod-binder skips shared-bus paramIds for
      // shared-scope mods (see excludeSharedForSharedScope) so we don't
      // double-route those — they're already on the bus.
      const engineMods = this.engineModVoices ?? new Map();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.binder = bindVoiceModulators({ laneId, engine: this, voice, voiceMods: combinedMods, ctx });
      this.currentLaneId = laneId;
    }

    // Polyphony cap: track the new voice, then steal oldest if over limit.
    this.activeVoices.push(voice);
    if (this.activeVoices.length > this.maxVoices) {
      this.stealOldest(this.activeVoices.length - this.maxVoices);
    }

    // Self-pruning: when oscA fires its 'ended' event the voice has finished
    // naturally — remove it from activeVoices so the slot is freed without
    // waiting for a steal on overflow.
    voice.oscA.addEventListener('ended', () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    });

    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.modBus) return new Map();
    return new Map<string, AudioParam>([
      ['filter.cutoff',    this.modBus['filter.cutoff'].offset],
      ['filter.resonance', this.modBus['filter.resonance'].offset],
      ['amp.gain',         this.modBus['amp.gain'].offset],
    ]);
  }

  buildSequencer(_container: HTMLElement, _stepCount: number): EngineSequencer {
    return new WavetableSequencer();
  }

  randomize(): void {
    const rnd = (min: number, max: number) => min + Math.random() * (max - min);
    // Pick two different waves to morph between
    const n = WAVETABLES.length;
    const a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * n);
    if (b === a) b = (b + 1) % n;
    this.waveAIndex = a;
    this.waveBIndex = b;
    // Musically-useful ranges (avoid extremes that produce silence/harshness)
    this.paramValues['osc.morph']        = rnd(0.15, 0.85);
    this.paramValues['osc.detune']       = rnd(0, 20);
    this.paramValues['filter.cutoff']    = rnd(0.4, 0.95);
    this.paramValues['filter.resonance'] = rnd(0, 0.5);
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const row = document.createElement('div');
    row.className = 'row poly-section';
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    row.appendChild(knobRow);
    container.appendChild(row);

    wireEngineParams(this, ctx, knobRow, {
      formatter: (id, v) => {
        if (id === 'osc.morph') return `${Math.round(v * 100)}%`;
        if (id === 'osc.detune') return `${v.toFixed(0)}¢`;
        if (id.startsWith('filter.')) return `${Math.round(v * 100)}%`;
        if (id.startsWith('amp.') && (id.endsWith('.attack') || id.endsWith('.decay') || id.endsWith('.release'))) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

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

  dispose(): void {
    this.waves = [];
  }
}

export const wavetableEngine = new WavetableEngine();
registerEngine(wavetableEngine);
registerEngineFactory('wavetable', () => new WavetableEngine());

export const wavetablePlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'wavetable',
    name: 'Wavetable',
    kind: 'synth',
    version: '1.0.0',
    params: wavetableEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new WavetableEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
