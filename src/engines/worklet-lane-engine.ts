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
import type { SubParams } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import { LoomWorkletNode, defaultSubParams } from '../audio-worklet/loom-node';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { SUB_PARAM_SPECS } from './subtractive-params';
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
 *  "subtractive-1.filter.cutoff") to a SubParams field via the dot-id suffix. */
function fieldForParamId(paramId: string): keyof SubParams | null {
  for (const dotId in DOT_TO_FIELD) {
    if (paramId === dotId || paramId.endsWith('.' + dotId)) return DOT_TO_FIELD[dotId];
  }
  return null;
}

/** Map the host's ModulatorState[] to the worklet's compact ModLite[]. Only
 *  fields that resolve to a SubParams target (and that the runtime acts on —
 *  shared LFOs) carry depth; everything else is sent inert. */
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

export class WorkletLaneEngine implements SynthEngine {
  readonly id = 'subtractive';
  readonly name = 'Sub';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params: EngineParamSpec[] = SUB_PARAM_SPECS;
  // Same default modulator set as the legacy SubtractiveEngine (2 ADSR at
  // depth 0 — the built-in amp/filter envelopes are authoritative — + 2 LFOs)
  // so the modulators panel (Task 12) shows the same controls. Inert until the
  // user connects one; toModLite/postMods then drive the in-worklet runtime.
  private modHost = new ModulationHostImpl([
    { ...makeDefaultADSR('adsr-amp'), connections: [{ id: 'c-amp', paramId: 'amp.gain', depth: 0 }] },
    { ...makeDefaultADSR('adsr-filter'), connections: [{ id: 'c-cutoff', paramId: 'filter.cutoff', depth: 0 }] },
    makeDefaultLFO('lfo1'),
    { ...makeDefaultLFO('lfo2'), rateHz: 2, waveform: 'triangle' },
  ]);
  private state: SubParams = defaultSubParams();
  private maxVoices = 8;
  private worklet: LoomWorkletNode;
  bpm = 120;

  constructor(ctx: AudioContext, output: AudioNode) {
    this.worklet = new LoomWorkletNode(ctx);
    this.worklet.connect(output);
    this.postMods();
  }

  /** Push the current modulator set to the worklet runtime. Called on
   *  construction, after applyPreset, and (Task 12) whenever the modulators
   *  panel edits a modulator/connection. */
  private postMods(): void {
    this.worklet.setMods(toModLite(this.modHost.modulators));
  }

  get presets(): EnginePreset[] { return getCachedPresets('subtractive'); }
  get modulators(): ModulationHostImpl { return this.modHost; }
  /** Exposed for the global voice cap (Task 11) and for tests. */
  getWorkletNode(): LoomWorkletNode { return this.worklet; }

  getBaseValue(id: string): number {
    if (id === 'poly.voices') return this.maxVoices;
    if (id === 'poly.mode' || id === 'poly.retrig') {
      return SUB_PARAM_SPECS.find((p) => p.id === id)?.default ?? 0;
    }
    const f = DOT_TO_FIELD[id];
    if (f) return this.state[f];
    return SUB_PARAM_SPECS.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      this.maxVoices = Math.max(1, Math.min(64, Math.round(v)));
      this.worklet.setMaxVoices(this.maxVoices);
      return;
    }
    // mono/legato are not modelled in the worklet renderer yet (Phase 1 is
    // poly-only); accept-and-ignore so a preset carrying them doesn't error.
    if (id === 'poly.mode' || id === 'poly.retrig') return;
    const f = DOT_TO_FIELD[id];
    if (!f) return;
    this.state[f] = v;
    this.worklet.setParams({ [f]: v } as Partial<SubParams>);
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
      if (typeof val === 'number') this.setBaseValue(id, val);
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
    // POLY header. The worklet renderer is poly-only, so only VOICES is shown
    // (it maps to the worklet voice cap via setBaseValue('poly.voices')). MODE
    // (mono) / RETRIG (legato) are intentionally omitted rather than rendered
    // inert — they aren't modelled in the worklet renderer yet. The lane's
    // osc/filter/amp/master knobs are mounted separately by
    // knob-mounting.mountSubtractiveLaneKnobs (reads engine.params + getBaseValue).
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
