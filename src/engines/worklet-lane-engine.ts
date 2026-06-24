// src/engines/worklet-lane-engine.ts
// A SynthEngine adapter backed by ONE LoomWorkletNode (the AudioWorklet
// software synth). It replaces the PolySynth-per-lane model for 'subtractive'
// lanes: createVoice() returns a thin Voice that posts a `spawn` message on
// trigger(), so trigger-dispatch, the lane scheduler, note-FX, and the
// live-voice registry stay untouched. setBaseValue/applyPreset post param
// updates into the worklet.
//
// Phase 1 scope: modulation (LFO/ADSR) moves in-worklet in Task 10, so
// getAudioParams() returns an empty Map and buildParamUI() is a stub here.
// Per-lane voice cap (poly.voices) maps to the worklet's maxVoices; mono/legato
// (poly.mode/poly.retrig) are not yet modelled in the worklet renderer.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { ParamBag, SubParams, ModTarget } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import { LoomWorkletNode } from '../audio-worklet/loom-node';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { type ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { velNorm, resolveVelocity } from '../core/velocity-gain';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { createKnob, type KnobHandle } from '../core/knob';
import { attachKnobUndo } from '../save/history-wiring';

// dot-id (SUB_PARAM_SPECS vocabulary) → flat SubParams field. Single source of
// the mapping. Params not present here (poly.*) are handled explicitly in
// setBaseValue/getBaseValue.
const DOT_TO_FIELD: Record<string, keyof SubParams> = {
  'master.tune': 'masterTune',
  'osc1.wave': 'osc1Wave', 'osc1.level': 'osc1Level', 'osc1.detune': 'osc1Detune',
  'osc2.wave': 'osc2Wave', 'osc2.level': 'osc2Level', 'osc2.detune': 'osc2Detune',
  'sub.level': 'subLevel', 'noise.level': 'noiseLevel', 'noise.color': 'noiseColor',
  'filter.cutoff': 'filterCutoff', 'filter.resonance': 'filterResonance',
  'filter.envAmount': 'filterEnvAmount', 'filter.drive': 'filterDrive',
  'filter.keyTrack': 'filterKeyTrack', 'filter.builtinEnv': 'filterBuiltinEnv',
  'filter.attack': 'filterAttack', 'filter.decay': 'filterDecay',
  'filter.sustain': 'filterSustain', 'filter.release': 'filterRelease',
  'amp.builtinEnv': 'ampBuiltinEnv', 'amp.attack': 'ampAttack', 'amp.decay': 'ampDecay',
  'amp.sustain': 'ampSustain', 'amp.release': 'ampRelease',
};

/** Resolve a modulation connection's paramId (possibly lane-prefixed, e.g.
 *  "subtractive-1.filter.cutoff") to a modulation target via the dot-id suffix.
 *  `amp.gain` is the synthetic tremolo target (not a stored SubParams field). */
function fieldForParamId(paramId: string): ModTarget | null {
  if (paramId === 'amp.gain' || paramId.endsWith('.amp.gain')) return 'ampGain';
  for (const dotId in DOT_TO_FIELD) {
    if (paramId === dotId || paramId.endsWith('.' + dotId)) return DOT_TO_FIELD[dotId];
  }
  return null;
}

/** Map the host's ModulatorState[] to the worklet's compact ModLite[]. Only
 *  connections that resolve to a modulation target carry depth; everything else
 *  is sent inert. (The runtime acts only on `kind:'lfo'`; ADSR mods are sent for
 *  completeness but contribute zero — per-voice modular ADSR is deferred.) */
export function toModLite(state: ModulatorState[]): ModLite[] {
  return state.map((m) => {
    const depthByParam: Record<string, number> = {};
    for (const c of m.connections) {
      if (!c.depth) continue;
      const field = fieldForParamId(c.paramId);
      if (field) depthByParam[field as string] = (depthByParam[field as string] ?? 0) + c.depth;
    }
    return {
      id: m.id,
      kind: m.kind === 'lfo' ? 'lfo' : 'adsr',
      enabled: m.enabled !== false,
      rateHz: m.rateHz ?? 4,
      waveform: m.waveform ?? 'sine',
      depthByParam,
    };
  });
}

class WorkletVoice implements Voice {
  constructor(private node: LoomWorkletNode) {}
  trigger(midi: number, time: number, o: VoiceTriggerOptions): void {
    const accent = o.accent ?? false;
    // VoiceTriggerOptions.velocity is the MIDI 0..127 scale (see velocity-gain.ts:
    // velNorm/resolveVelocity). NoteSpec.velocity the renderer expects is the
    // normalised 0..1 value, so convert here (defaulting via resolveVelocity so a
    // velocity-less audition/note-FX trigger lands at the legacy loudness).
    this.node.spawn({
      midi, beginSec: time, durationSec: o.gateDuration,
      velocity: velNorm(resolveVelocity(o.velocity, accent)),
      accent, slide: o.slide ?? false,
    });
  }
  release(_t: number): void { /* gate handled by durationSec; live note-off deferred to a later task */ }
  connect(_d: AudioNode): void { /* the lane's worklet node is already connected by the engine */ }
  getAudioParams(): Map<string, AudioParam> { return new Map(); }
  dispose(): void { /* no per-note nodes to tear down */ }
}

/** Per-engine configuration for a worklet-backed lane. */
export interface WorkletEngineConfig {
  engineId: string;
  name: string;
  params: EngineParamSpec[];
  presetsKey: string;          // preset cache key (engine id)
  polyphony: 'mono' | 'poly';
  modulators?: ModulatorState[];
  /** Optional remap from a preset JSON's legacy flat keys to the engine's
   *  dot-id param spec (e.g. TB-303's 'cutoff' → 'filter.cutoff'). Engines whose
   *  preset JSON already uses dot-ids omit it. */
  presetKeyRemap?: Record<string, string>;
}

export class WorkletLaneEngine implements SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type = 'polyhost' as const;
  readonly polyphony: 'mono' | 'poly';
  readonly editor = 'piano-roll' as const;
  readonly params: EngineParamSpec[];
  private readonly presetsKey: string;
  private readonly presetKeyRemap?: Record<string, string>;
  private modHost: ModulationHostImpl;
  // Current scalar param state as a dot-id ParamBag, seeded from the spec
  // defaults. setBaseValue mirrors here and posts the same dot-id to the worklet.
  private state: ParamBag = {};
  private maxVoices: number;
  private worklet: LoomWorkletNode;
  bpm = 120;

  constructor(ctx: AudioContext, output: AudioNode, cfg: WorkletEngineConfig) {
    this.id = cfg.engineId;
    this.name = cfg.name;
    this.polyphony = cfg.polyphony;
    this.params = cfg.params;
    this.presetsKey = cfg.presetsKey;
    this.presetKeyRemap = cfg.presetKeyRemap;
    this.modHost = new ModulationHostImpl(cfg.modulators ?? []);
    for (const s of cfg.params) this.state[s.id] = s.default;
    this.maxVoices = cfg.polyphony === 'mono' ? 1 : 8;
    this.state['poly.voices'] = this.maxVoices;   // keep the bag in sync with the authoritative cap
    this.worklet = new LoomWorkletNode(ctx, cfg.engineId);
    this.worklet.connect(output);
    if (cfg.polyphony === 'mono') this.worklet.setMaxVoices(1);
    this.postMods();
  }

  /** Push the current modulator set to the worklet runtime. Called on
   *  construction, after applyPreset, and whenever the modulators panel edits a
   *  modulator/connection. (In-worklet modulation is currently subtractive-only;
   *  for other engines toModLite yields inert mods until their targets are wired.) */
  private postMods(): void {
    this.worklet.setMods(toModLite(this.modHost.modulators));
  }

  get presets(): EnginePreset[] { return getCachedPresets(this.presetsKey); }
  get modulators(): ModulationHostImpl { return this.modHost; }
  /** Exposed for the global voice cap and for tests. */
  getWorkletNode(): LoomWorkletNode { return this.worklet; }

  /** Snapshot of the current dot-id param state — the exact ParamBag the
   *  audio-dsp renderer reads. The offline scene recorder uses this to render
   *  this lane through the pure kernel (the worklet itself can't run under the
   *  OfflineAudioContext / node-web-audio-api stub). */
  getParamBag(): ParamBag { return { ...this.state }; }
  /** Current per-lane voice cap (mirrors the worklet's maxVoices). */
  getMaxVoices(): number { return this.maxVoices; }
  /** Compact in-worklet modulation set (shared LFOs) — the same ModLite[] the
   *  worklet runs. The offline kernel render feeds these to a ModulationRuntime. */
  getModLite(): ModLite[] { return toModLite(this.modHost.modulators); }

  getBaseValue(id: string): number {
    if (id === 'poly.voices') return this.maxVoices;
    if (id in this.state) return this.state[id];
    return this.params.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      this.maxVoices = Math.max(1, Math.min(64, Math.round(v)));
      this.worklet.setMaxVoices(this.maxVoices);
      return;
    }
    // mono/legato are not modelled in the worklet renderer yet; accept-and-ignore
    // so a preset carrying them doesn't error.
    if (id === 'poly.mode' || id === 'poly.retrig') return;
    this.state[id] = v;
    this.worklet.setParams({ [id]: v });   // dot-id straight through to the renderer's ParamBag
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
      if (typeof val !== 'number') continue;
      // Remap legacy flat preset keys to the engine's dot-id spec when needed
      // (e.g. TB-303's 'cutoff' → 'filter.cutoff'); other engines pass through.
      this.setBaseValue(this.presetKeyRemap?.[id] ?? id, val);
    }
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
    this.postMods();
  }

  createVoice(_ctx: AudioContext, _output: AudioNode): Voice { return new WorkletVoice(this.worklet); }

  buildSequencer(): EngineSequencer {
    return {
      getStepAt: () => null, setLength() {}, highlight() {},
      serialize: () => null, deserialize() {}, dispose() {},
    };
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (!ctx) return;
    container.innerHTML = '';
    // POLY header (poly engines only): a VOICES knob → the worklet voice cap.
    // Mono engines (TB-303) are fixed at 1 voice, so the header is omitted. The
    // lane's osc/filter/amp knobs are mounted separately by knob-mounting.
    if (this.polyphony === 'poly') {
      const header = document.createElement('div');
      header.className = 'row poly-section';
      const lab = document.createElement('div');
      lab.className = 'section-label';
      lab.textContent = 'POLY';
      header.appendChild(lab);
      const knobRow = document.createElement('div');
      knobRow.className = 'knob-row';
      header.appendChild(knobRow);
      const voices = createKnob({
        id: `${ctx.laneId}.poly.voices`,
        label: 'VOICES', min: 1, max: 16, step: 1, value: this.getBaseValue('poly.voices'), defaultValue: 8,
        format: (v) => String(v),
        onChange: (v) => { this.setBaseValue('poly.voices', v); },
        ...(ctx.historyDeps ? attachKnobUndo(ctx.historyDeps) : {}),
      });
      ctx.registerKnob(voices);
      knobRow.appendChild(voices.el);
      container.appendChild(header);
    }

    // Per-engine knob grid. Subtractive's osc/filter/amp/master knobs are mounted
    // separately into fixed page sections by knob-mounting.mountSubtractiveLaneKnobs;
    // every OTHER worklet engine (fm/wavetable/karplus/westcoast/tb303) has no such
    // section, so render a generic grid here from its param spec — otherwise the
    // lane would show no parameter controls at all.
    if (this.id !== 'subtractive') {
      const grid = document.createElement('div');
      grid.className = 'row knob-row';
      for (const spec of this.params) {
        if (spec.id.startsWith('poly.')) continue;   // poly.* handled by the POLY header
        const discrete = spec.kind === 'discrete' && !!spec.options && spec.options.length > 0;
        const knob = createKnob({
          id: `${ctx.laneId}.${spec.id}`,
          label: spec.label,
          min: spec.min, max: spec.max,
          step: discrete ? 1 : (spec.max - spec.min) / 200,
          value: this.getBaseValue(spec.id), defaultValue: spec.default,
          color: spec.color,
          format: discrete
            ? (v) => spec.options![Math.max(0, Math.min(spec.options!.length - 1, Math.round(v)))].label
            : (spec.unit ? (v) => `${v.toFixed(2)}${spec.unit}` : undefined),
          onChange: (v) => { this.setBaseValue(spec.id, v); },
          ...(ctx.historyDeps ? attachKnobUndo(ctx.historyDeps) : {}),
        });
        ctx.registerKnob(knob);
        grid.appendChild(knob.el);
      }
      container.appendChild(grid);
    }

    // Modulators panel. Editing a modulator/connection re-posts the whole
    // modulator set to the worklet runtime (postMods) so live LFO edits sound.
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
        this.postMods();
      },
    });
  }

  dispose(): void { this.worklet.disconnect(); }
}
