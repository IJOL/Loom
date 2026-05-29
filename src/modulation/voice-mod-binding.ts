// src/modulation/voice-mod-binding.ts
// Wires modulator outputs to destination AudioParams via ConnectionBinder.
// Modulators are partitioned by scope:
//
//   bindEngineModulators — scope='shared' mods wired to the engine's
//                          modulation-bus AudioParams (getSharedAudioParams).
//                          Called once per engine instance.
//
//   bindVoiceModulators  — scope='per-voice' mods wired to a freshly-spawned
//                          Voice's per-note AudioParams (getAudioParams).
//                          Called per createVoice call.
//
// Both record into the lane bindings map so reapplyLaneModulations can refresh
// both paths after a state change.

import type { SynthEngine, Voice } from '../engines/engine-types';
import type { ModulatorState, ModulatorVoice } from './types';
import { defaultScopeFor } from './types';
import type { ParamRange } from './modulation-host';
import { ConnectionBinder } from './connection-binder';

export interface BindVoiceModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voice: Voice;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
}

export interface BindEngineModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
}

interface LaneBindings {
  laneId: string;
  ctx: AudioContext;
  engineRef: SynthEngine;
  /** Engine-wide binder for scope='shared' modulators. */
  engineBinding?: { binder: ConnectionBinder; voiceMods: Map<string, ModulatorVoice> };
  /** Per-voice binder + the latest voice. Replaced on every new Voice. */
  voiceBinding?: { binder: ConnectionBinder; voice: Voice; voiceMods: Map<string, ModulatorVoice> };
}

const laneBindings = new Map<string, LaneBindings>();

function scopeOf(m: ModulatorState): 'shared' | 'per-voice' {
  return m.scope ?? defaultScopeFor(m.kind);
}

function applyBinder(
  binder: ConnectionBinder,
  laneId: string,
  engine: SynthEngine,
  voiceMods: Map<string, ModulatorVoice>,
  shortParams: Map<string, AudioParam>,
  rangeLookup: (shortId: string) => ParamRange,
  scope: 'shared' | 'per-voice',
  ctx: AudioContext,
): void {
  const destMap = new Map<string, AudioParam>();
  const rangeMap = new Map<string, ParamRange>();
  for (const [shortId, param] of shortParams) {
    const fullId = `${laneId}.${shortId}`;
    const r = rangeLookup(shortId);
    destMap.set(fullId, param);
    rangeMap.set(fullId, r);
    destMap.set(shortId, param);
    rangeMap.set(shortId, r);
  }
  const scopeFilter = engine.modulators.modulators.filter((m) => scopeOf(m) === scope);
  binder.apply(voiceMods, scopeFilter, destMap, rangeMap, ctx);
}

function rangeLookupForVoice(engine: SynthEngine, voice: Voice): (id: string) => ParamRange {
  return (shortId: string): ParamRange => {
    const declared = voice.getAudioParamRange?.(shortId);
    if (declared) return declared;
    const spec = engine.params.find((p) => p.id === shortId);
    return { min: spec ? spec.min : 0, max: spec ? spec.max : 1 };
  };
}

function rangeLookupForEngine(engine: SynthEngine): (id: string) => ParamRange {
  return (shortId: string): ParamRange => {
    const spec = engine.params.find((p) => p.id === shortId);
    return { min: spec ? spec.min : 0, max: spec ? spec.max : 1 };
  };
}

function getOrCreateLane(laneId: string, engine: SynthEngine, ctx: AudioContext): LaneBindings {
  let lb = laneBindings.get(laneId);
  if (!lb) {
    lb = { laneId, ctx, engineRef: engine };
    laneBindings.set(laneId, lb);
  }
  return lb;
}

export function bindEngineModulators(opts: BindEngineModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  if (lb.engineBinding) lb.engineBinding.binder.disposeAll();

  const binder = new ConnectionBinder();
  const shortParams = opts.engine.getSharedAudioParams?.(opts.ctx) ?? new Map<string, AudioParam>();
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    shortParams, rangeLookupForEngine(opts.engine), 'shared', opts.ctx,
  );
  lb.engineBinding = { binder, voiceMods: opts.voiceMods };
  return binder;
}

export function bindVoiceModulators(opts: BindVoiceModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  if (lb.voiceBinding) lb.voiceBinding.binder.disposeAll();

  const binder = new ConnectionBinder();
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    opts.voice.getAudioParams(),
    rangeLookupForVoice(opts.engine, opts.voice),
    'per-voice',
    opts.ctx,
  );
  lb.voiceBinding = { binder, voice: opts.voice, voiceMods: opts.voiceMods };
  return binder;
}

export function reapplyLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  if (lb.engineBinding) {
    const shortParams = lb.engineRef.getSharedAudioParams?.(lb.ctx) ?? new Map<string, AudioParam>();
    applyBinder(
      lb.engineBinding.binder, lb.laneId, lb.engineRef, lb.engineBinding.voiceMods,
      shortParams, rangeLookupForEngine(lb.engineRef), 'shared', lb.ctx,
    );
  }
  if (lb.voiceBinding) {
    applyBinder(
      lb.voiceBinding.binder, lb.laneId, lb.engineRef, lb.voiceBinding.voiceMods,
      lb.voiceBinding.voice.getAudioParams(),
      rangeLookupForVoice(lb.engineRef, lb.voiceBinding.voice),
      'per-voice', lb.ctx,
    );
  }
}

export function disposeLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  lb.engineBinding?.binder.disposeAll();
  lb.voiceBinding?.binder.disposeAll();
  laneBindings.delete(laneId);
}

export function clearLaneBindings(): void {
  for (const lb of laneBindings.values()) {
    lb.engineBinding?.binder.disposeAll();
    lb.voiceBinding?.binder.disposeAll();
  }
  laneBindings.clear();
}

// ── Test-only back-compat aliases ─────────────────────────────────────────
// Earlier tests imported these underscore-prefixed names. Keep them as thin
// wrappers so existing test files (and dsp-render fixtures) keep compiling.

/** Test-only: clear the per-lane bindings map. Alias for clearLaneBindings. */
export function _resetLaneBindingsForTesting(): void {
  clearLaneBindings();
}

/** Test-only inspector. Returns the per-voice binder for the lane (which is
 *  what the historic single-binder tests probed). */
export function _getLaneBindingForTesting(laneId: string): { binder: ConnectionBinder } | undefined {
  const lb = laneBindings.get(laneId);
  if (!lb || !lb.voiceBinding) return undefined;
  return { binder: lb.voiceBinding.binder };
}
