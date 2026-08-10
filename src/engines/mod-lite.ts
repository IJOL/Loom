// src/engines/mod-lite.ts
// ModulatorState[] → ModLite[]: the host's mapping into the worklet's compact
// wire format. Pure data mapping — no Web Audio, no DOM — extracted out of
// worklet-lane-engine.ts so the offline kernel's pure-DSP tests (e.g.
// default-envelopes.dsp.test.ts) can import the REAL converter without pulling
// in that module's Web-Audio/lit-html dependency chain (LoomWorkletNode,
// lit-html…).
import type { EngineParamSpec } from './engine-params';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import { type ModulatorState } from '../modulation/types';
import { effectiveRateHz } from '../modulation/rate-sync';
import { getModulator } from '../modulation/modulator-registry';

/** Target mapper for EVERY engine: resolve a connection to a param's OWN dot-id
 *  (e.g. 'wavetable-1.filter.cutoff' → 'filter.cutoff', or 'fm-1.op1.level' →
 *  'op1.level'), plus the three synthetic envelope/gain targets. Renderers read
 *  their offsets by these same dot-ids.
 *
 *  Subtractive used to have its own: fieldForParamId translated a connection into
 *  a flat SubParams field name ('filter.cutoff' → 'filterCutoff') because its
 *  renderer read that struct. That translation table is gone with the struct. It
 *  was also what stopped the modulation offsets being numbered by the lane's
 *  ParamIndex, which is keyed by dot-ids — one vocabulary is the price of one
 *  numbering. Nothing persisted changes: a connection always stored the dot-id.
 *
 *  @param extra targets the engine contributes that are not declared params —
 *  LAYERS' per-slot `l0.amp`, `l0.filter.env`, … Checked FIRST, and the order is
 *  load-bearing: `l0.amp` ends with `.amp`, so with the bare three in front
 *  every slot's amplitude envelope would collapse onto the lane's single `amp`
 *  and all four instruments would share one. */
export function makeDotIdMapper(
  params: EngineParamSpec[], extra: readonly string[] = [],
): (paramId: string) => string | null {
  const targets = [...extra, ...params.map((p) => p.id), 'amp', 'filter.env', 'amp.gain'];
  return (paramId) => {
    for (const t of targets) if (paramId === t || paramId.endsWith('.' + t)) return t;
    return null;
  };
}

/** Map the host's ModulatorState[] to the worklet's compact ModLite[]. Only
 *  connections that resolve to a modulation target carry depth; everything else
 *  is sent inert. LFOs carry their TRIG + SCOPE so the runtime can place their
 *  phase origin; ADSR mods contribute zero to the LFO sum because they travel a
 *  different road — the renderer gates one envelope per voice from them.
 *
 *  `bpm` resolves a BPM-synced LFO's rate to free Hz here (effectiveRateHz),
 *  because the in-worklet ModulationRuntime runs at a free `rateHz`. Without
 *  this a synced LFO would send its stale free `rateHz` and ignore the tempo. */
export function toModLite(
  state: ModulatorState[], bpm = 120,
  // No default: the mapper needs the engine's declared params to resolve a
  // connection to a target, so only the caller that has them can supply it.
  // It used to default to subtractive's translator, which quietly made every
  // caller that forgot the argument behave like a subtractive lane.
  mapTarget: (paramId: string) => string | null,
): ModLite[] {
  return state.map((m) => {
    const depthByParam: Record<string, number> = {};
    for (const c of m.connections) {
      if (!c.depth) continue;
      const key = mapTarget(c.paramId);
      if (key) depthByParam[key] = (depthByParam[key] ?? 0) + c.depth;
    }
    return {
      id: m.id,
      kind: m.kind,
      // The kind's driver ('time' runs off the clock, 'gate' is the per-voice
      // envelope road) — a registry question, resolved once here where the
      // main thread still has the registry, so ModulationRuntime.getAdsrMods
      // downstream can ask a property instead of comparing kind === 'adsr'.
      // Undefined for an unregistered kind (nothing to ask), same as a kernel
      // miss elsewhere in this file's output.
      driver: getModulator(m.kind)?.driver,
      enabled: m.enabled !== false,
      // effectiveRateHz returns the free rateHz when syncToBpm is unset, so a
      // free LFO is unchanged; a synced LFO gets the bpm-derived rate. Keep the
      // legacy free-rate default (4 Hz) for a rate-less modulator.
      rateHz: effectiveRateHz({ ...m, rateHz: m.rateHz ?? 4 }, bpm),
      waveform: m.waveform ?? 'sine',
      bipolar: m.bipolar !== false,   // POLARITY: default bipolar; uni maps wave to 0..1
      // TRIG + SCOPE. Both decide where the LFO's phase starts, so the runtime
      // needs them: without these two lines the dropdowns are inert and every
      // LFO free-runs, shared across the lane.
      // NOTE the rename: the UI scope is 'per-voice', the wire format is 'voice'.
      trigger: m.trigger === 'note' ? 'note' : 'free',
      scope: m.scope === 'per-voice' ? 'voice' : 'shared',
      // ADSR shape (inert for LFOs; the renderer reads these for kind:'adsr').
      attackSec: m.attackSec ?? 0.01,
      decaySec: m.decaySec ?? 0.3,
      sustain: m.sustain ?? 0.7,
      releaseSec: m.releaseSec ?? 0.3,
      depthByParam,
      // A plugin kernel's own settings, carried through untouched — without
      // this a plugin's kernel would reach the audio thread with no way to
      // read what the user configured for it.
      params: m.params,
    };
  });
}
