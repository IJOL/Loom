// src/modulation/voice-mod-binding.ts
// Wires a freshly-spawned voice's modulator outputs to its destination
// AudioParams via a per-voice ConnectionBinder.
//
// Each engine calls bindVoiceModulators(...) once at voice-creation time. The
// binder is stored alongside the voiceMods so a later modulator-state change
// (add/remove connection, depth tweak) can call reapplyLaneModulations(laneId)
// to diff and re-bind without recreating the voice or skipping a beat.
//
// This is the missing link between ModulationHost.spawnVoice (which only
// creates the modulator AudioNodes) and the real audio graph: without these
// gain bridges, an LFO has output but no path into the destination param.

import type { SynthEngine, Voice } from '../engines/engine-types';
import type { ModulatorVoice } from './types';
import type { ParamRange } from './modulation-host';
import { ConnectionBinder } from './connection-binder';

export interface BindVoiceModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voice: Voice;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
}

/** Records of the per-lane binding so onChange can re-apply later. */
interface LaneBinding {
  laneId: string;
  engine: SynthEngine;
  voice: Voice;
  voiceMods: Map<string, ModulatorVoice>;
  binder: ConnectionBinder;
  ctx: AudioContext;
}

const laneBindings = new Map<string, LaneBinding>();

/**
 * Build the (destMap, rangeMap) keyed by canonical `${laneId}.${shortId}` ids
 * that ConnectionBinder + the modulator-UI destination dropdown both expect,
 * then call binder.apply() to (re)materialize the gain bridges.
 *
 * Side-effect: records the binding into a per-lane map so a subsequent
 * `reapplyLaneModulations(laneId)` call can update bridges without rebuilding
 * the voice.
 *
 * If a binding already exists for this lane (i.e. the previous voice hasn't
 * been disposed yet), its binder is torn down first to avoid leaking gain
 * nodes still connected from the old voice's modulator outputs.
 */
export function bindVoiceModulators(opts: BindVoiceModulatorsOpts): ConnectionBinder {
  const prev = laneBindings.get(opts.laneId);
  if (prev) prev.binder.disposeAll();

  const binder = new ConnectionBinder();
  applyBinder(binder, opts.laneId, opts.engine, opts.voice, opts.voiceMods, opts.ctx);

  laneBindings.set(opts.laneId, {
    laneId: opts.laneId,
    engine: opts.engine,
    voice: opts.voice,
    voiceMods: opts.voiceMods,
    binder,
    ctx: opts.ctx,
  });
  return binder;
}

/**
 * Re-apply the binder for `laneId` against the current modulator state. Used
 * by each engine's modulation-panel onChange callback so adding/removing a
 * connection or tweaking depth takes audible effect immediately on the
 * currently-held voice (when one exists).
 */
export function reapplyLaneModulations(laneId: string): void {
  const b = laneBindings.get(laneId);
  if (!b) return;
  applyBinder(b.binder, b.laneId, b.engine, b.voice, b.voiceMods, b.ctx);
}

/** Drops the lane's record (call when the voice is disposed). The binder
 *  itself is disposed too in case nothing else has. */
export function disposeLaneModulations(laneId: string): void {
  const b = laneBindings.get(laneId);
  if (!b) return;
  b.binder.disposeAll();
  laneBindings.delete(laneId);
}

/** Internal: builds the canonical destMap + rangeMap and calls binder.apply. */
function applyBinder(
  binder: ConnectionBinder,
  laneId: string,
  engine: SynthEngine,
  voice: Voice,
  voiceMods: Map<string, ModulatorVoice>,
  ctx: AudioContext,
): void {
  const shortParams = voice.getAudioParams();
  const destMap = new Map<string, AudioParam>();
  const rangeMap = new Map<string, ParamRange>();

  for (const [shortId, param] of shortParams) {
    const fullId = `${laneId}.${shortId}`;
    const spec = engine.params.find((p) => p.id === shortId);
    // Prefer the voice's declared AudioParam operating range when present —
    // a spec might say `filter.cutoff` is 0..1 (normalized knob) while the
    // actual AudioParam is `BiquadFilterNode.frequency` in Hz. Falling back
    // to the spec range (or 0..1 when neither is available) keeps engines
    // that don't override working as before.
    const declared = voice.getAudioParamRange?.(shortId);
    const min = declared ? declared.min : (spec ? spec.min : 0);
    const max = declared ? declared.max : (spec ? spec.max : 1);
    // Register both id forms. The UI dropdown adds new connections with the
    // full `lane.id` form, but engines ship with default modulator
    // connections keyed by the short id (e.g. ADSR-AMP → 'amp.gain') so the
    // same state is reusable across lanes. Accept both so depth changes on
    // default connections actually modulate the param.
    destMap.set(fullId, param);
    rangeMap.set(fullId, { min, max });
    destMap.set(shortId, param);
    rangeMap.set(shortId, { min, max });
  }

  binder.apply(voiceMods, engine.modulators.modulators, destMap, rangeMap, ctx);
}

/** Test-only: clear the per-lane bindings map. */
export function _resetLaneBindingsForTesting(): void {
  for (const b of laneBindings.values()) b.binder.disposeAll();
  laneBindings.clear();
}

/** Test-only inspector. */
export function _getLaneBindingForTesting(laneId: string): { binder: ConnectionBinder } | undefined {
  const b = laneBindings.get(laneId);
  return b ? { binder: b.binder } : undefined;
}
