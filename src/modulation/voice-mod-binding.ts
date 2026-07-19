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
import type { ModulatorVoice } from './types';
import type { ParamRange } from './modulation-host';
import { ConnectionBinder } from './connection-binder';
import type { InsertChain } from '../plugins/fx/insert-chain';
import { insertParamId } from '../automation/automation-targets';

export interface BindVoiceModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voice: Voice;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
  /** Polyphony cap for the per-voice binding pool. A polyphonic engine passes
   *  its live voice count so each chord voice keeps its OWN modulator→param
   *  bridges (e.g. a per-voice ADSR driving amp.gain) instead of the latest
   *  note tearing down the previous note's binding — which collapsed chords to
   *  their last note. Omitted / 1 = the historical single-slot behavior
   *  (replace-previous), correct for monophonic engines (TB-303) and drums. */
  voicePool?: number;
  /** Phase J: optional insert chains — their AudioParams are added to the
   *  destination map so modulators can target FX params. */
  laneInserts?: InsertChain;
  masterInserts?: InsertChain;
}

export interface BindEngineModulatorsOpts {
  laneId: string;
  engine: SynthEngine;
  voiceMods: Map<string, ModulatorVoice>;
  ctx: AudioContext;
  /** Optional override of the shared-param range lookup. Engines whose
   *  shared bus AudioParams operate in a different unit than the engine
   *  param spec (e.g. a ConstantSourceNode.offset summed into Hz) should
   *  pass a Voice-style range lookup here so depth=1 produces full-swing
   *  modulation. Falls back to the engine spec range when omitted. */
  rangeLookup?: (shortId: string) => ParamRange;
  /** Phase J: optional insert chains — their AudioParams are added to the
   *  destination map so modulators can target FX params. */
  laneInserts?: InsertChain;
  masterInserts?: InsertChain;
}

interface LaneBindings {
  laneId: string;
  ctx: AudioContext;
  engineRef: SynthEngine;
  /** Engine-wide binder for scope='shared' modulators. */
  engineBinding?: {
    binder: ConnectionBinder;
    voiceMods: Map<string, ModulatorVoice>;
    rangeLookup?: (shortId: string) => ParamRange;
  };
  /** Per-voice binders — one entry per live voice, in trigger order (oldest
   *  first). A new note APPENDS; the oldest is disposed only when the pool
   *  exceeds `voicePool`, so a chord keeps every voice's modulator→param
   *  bridges alive instead of the latest note tearing down the previous one. */
  voiceBindings: { binder: ConnectionBinder; voice: Voice; voiceMods: Map<string, ModulatorVoice> }[];
  /** Max simultaneous per-voice bindings to retain (parity with the engine's
   *  voice-stealing cap). Defaults to 1 — single-slot, replace-previous — for
   *  monophonic engines and any caller that doesn't declare polyphony. */
  voicePool: number;
  /** Phase J: insert chains whose AudioParams are routable as modulation
   *  destinations. Stored so reapplyLaneModulations can re-include them. */
  laneInserts?: InsertChain;
  masterInserts?: InsertChain;
}

const laneBindings = new Map<string, LaneBindings>();

/** Build the FX-chain entries for destMap/rangeMap, keyed by the canonical
 *  destination id (`insertParamId`) so a modulation and an automation curve
 *  address an insert param the same way, by the slot's stable id — not its
 *  position, which shifts when a neighbouring slot is removed. */
export function addInsertChainParams(
  chain: InsertChain,
  scopeId: string,
  destMap: Map<string, AudioParam>,
  rangeMap: Map<string, ParamRange>,
): void {
  for (const cs of chain.list()) {
    for (const [paramId, ap] of cs.fx.getAudioParams()) {
      const key = insertParamId(scopeId, cs.id, paramId);
      destMap.set(key, ap);
      // Use the FX's declared modulation range (e.g. the Filter exposes its
      // freq as .detune in cents → a full-knob exponential sweep). Falls back
      // to 0..1 for params that don't declare one.
      rangeMap.set(key, cs.fx.getAudioParamRange?.(paramId) ?? { min: 0, max: 1 });
    }
  }
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
  /** Per-voice binder only: paramIds (short + lane-prefixed) that the engine
   *  binder already handles via the shared modulation bus. Shared-scope mods
   *  with connections to these params must be skipped here to avoid double
   *  routing (engine binder → modBus fan-out AND voice binder → voice param). */
  excludeSharedForSharedScope?: Set<string>,
  /** Phase J: insert chains whose AudioParams should also be routable. */
  laneInserts?: InsertChain,
  masterInserts?: InsertChain,
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
  // Phase J: add FX-chain AudioParams.
  if (laneInserts)   addInsertChainParams(laneInserts,   laneId,      destMap, rangeMap);
  if (masterInserts) addInsertChainParams(masterInserts, 'fx.master', destMap, rangeMap);
  // voiceMods is already scope-partitioned by the caller (spawnVoiceFiltered),
  // so iterating ALL modulator states is safe — connection-binder skips any
  // mod whose id isn't in voiceMods. This also lets a shared-scope LFO bind
  // to a per-voice param when the SubtractiveEngine merges engineModVoices
  // into the per-voice binder's voiceMods.
  let mods = engine.modulators.modulators;
  if (scope === 'per-voice' && excludeSharedForSharedScope && excludeSharedForSharedScope.size > 0) {
    // For shared-scope modulators iterated by the per-voice binder, strip any
    // connections whose paramId is on the shared bus — the engine binder has
    // already bound those via modBus fan-out, so re-binding here would
    // double-modulate the latest voice. Per-voice scope mods keep all
    // connections (their only routing path is the voice binder).
    mods = mods.map((m) => {
      if (m.scope !== 'shared') return m;
      const filtered = m.connections.filter((c) => {
        const short = c.paramId.startsWith(`${laneId}.`) ? c.paramId.slice(laneId.length + 1) : c.paramId;
        return !excludeSharedForSharedScope.has(short) && !excludeSharedForSharedScope.has(c.paramId);
      });
      if (filtered.length === m.connections.length) return m;
      return { ...m, connections: filtered };
    });
  }
  binder.apply(voiceMods, mods, destMap, rangeMap, ctx);
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
    lb = { laneId, ctx, engineRef: engine, voiceBindings: [], voicePool: 1 };
    laneBindings.set(laneId, lb);
  }
  return lb;
}

export function bindEngineModulators(opts: BindEngineModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  if (lb.engineBinding) lb.engineBinding.binder.disposeAll();
  // Store insert chains so reapplyLaneModulations can re-include them.
  if (opts.laneInserts   !== undefined) lb.laneInserts   = opts.laneInserts;
  if (opts.masterInserts !== undefined) lb.masterInserts = opts.masterInserts;

  const binder = new ConnectionBinder();
  const shortParams = opts.engine.getSharedAudioParams?.(opts.ctx) ?? new Map<string, AudioParam>();
  const rangeLookup = opts.rangeLookup ?? rangeLookupForEngine(opts.engine);
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    shortParams, rangeLookup, 'shared', opts.ctx,
    undefined, lb.laneInserts, lb.masterInserts,
  );
  lb.engineBinding = { binder, voiceMods: opts.voiceMods, rangeLookup: opts.rangeLookup };
  return binder;
}

export function bindVoiceModulators(opts: BindVoiceModulatorsOpts): ConnectionBinder {
  const lb = getOrCreateLane(opts.laneId, opts.engine, opts.ctx);
  // Update the polyphony cap (latest caller wins, so a live VOICES-knob change
  // is honored). NOT disposing the previous binding here is the fix: each note
  // gets its own binder appended below; the previous note's bridges live on.
  lb.voicePool = Math.max(1, Math.floor(opts.voicePool ?? lb.voicePool ?? 1));
  // Store insert chains so reapplyLaneModulations can re-include them.
  if (opts.laneInserts   !== undefined) lb.laneInserts   = opts.laneInserts;
  if (opts.masterInserts !== undefined) lb.masterInserts = opts.masterInserts;

  const binder = new ConnectionBinder();
  // Build the set of shared-bus paramIds. The engine binder already wires
  // scope='shared' mods to these via modBus fan-out. When the engine merges
  // engineModVoices into the per-voice voiceMods map (so a shared LFO can
  // reach per-voice-only params), we must NOT also bind those same shared
  // mods' shared-bus connections here — that would produce double routing
  // on the latest voice.
  const sharedKeys = new Set<string>();
  const sharedParams = opts.engine.getSharedAudioParams?.(opts.ctx);
  if (sharedParams) for (const k of sharedParams.keys()) sharedKeys.add(k);
  applyBinder(
    binder, opts.laneId, opts.engine, opts.voiceMods,
    opts.voice.getAudioParams(),
    rangeLookupForVoice(opts.engine, opts.voice),
    'per-voice',
    opts.ctx,
    sharedKeys,
    lb.laneInserts, lb.masterInserts,
  );
  lb.voiceBindings.push({ binder, voice: opts.voice, voiceMods: opts.voiceMods });
  // Evict the oldest binding(s) once the pool overflows — parity with the
  // engine's own voice stealing (the oldest voice is the one being replaced).
  // disposeAll() only tears down THAT binding's gain bridges, leaving the
  // surviving voices' bridges intact.
  while (lb.voiceBindings.length > lb.voicePool) {
    lb.voiceBindings.shift()?.binder.disposeAll();
  }
  return binder;
}

export function reapplyLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  // Push live state mutations into running modulator voices — fixes the
  // "rate knob doesn't change the audio LFO" regression. Each ModulatorVoice
  // can opt into the hook by exposing a `syncFromState()` method (LFOVoice
  // does; ADSRVoice rebuilds its envelope on every trigger and doesn't need
  // one).
  const sync = (voices: Map<string, ModulatorVoice>): void => {
    for (const v of voices.values()) {
      (v as unknown as { syncFromState?: () => void }).syncFromState?.();
    }
  };
  if (lb.engineBinding) sync(lb.engineBinding.voiceMods);
  for (const vb of lb.voiceBindings) sync(vb.voiceMods);
  if (lb.engineBinding) {
    const shortParams = lb.engineRef.getSharedAudioParams?.(lb.ctx) ?? new Map<string, AudioParam>();
    const rangeLookup = lb.engineBinding.rangeLookup ?? rangeLookupForEngine(lb.engineRef);
    applyBinder(
      lb.engineBinding.binder, lb.laneId, lb.engineRef, lb.engineBinding.voiceMods,
      shortParams, rangeLookup, 'shared', lb.ctx,
      undefined, lb.laneInserts, lb.masterInserts,
    );
  }
  if (lb.voiceBindings.length > 0) {
    const sharedKeys = new Set<string>();
    const sharedParams = lb.engineRef.getSharedAudioParams?.(lb.ctx);
    if (sharedParams) for (const k of sharedParams.keys()) sharedKeys.add(k);
    for (const vb of lb.voiceBindings) {
      applyBinder(
        vb.binder, lb.laneId, lb.engineRef, vb.voiceMods,
        vb.voice.getAudioParams(),
        rangeLookupForVoice(lb.engineRef, vb.voice),
        'per-voice', lb.ctx,
        sharedKeys,
        lb.laneInserts, lb.masterInserts,
      );
    }
  }
}

export function disposeLaneModulations(laneId: string): void {
  const lb = laneBindings.get(laneId);
  if (!lb) return;
  lb.engineBinding?.binder.disposeAll();
  for (const vb of lb.voiceBindings) vb.binder.disposeAll();
  laneBindings.delete(laneId);
}

/** Full teardown of a polyhost engine's SHARED modulators on engine.dispose():
 *  stop/disconnect the free-running engineModVoices (LFO/ADSR oscillators) AND
 *  drop the lane's modulation bridges. Without this, a "New" or stem-"Replace"
 *  that disposes the lane left the shared LFO running and routing. Safe with a
 *  null map or null lane. Engines should null their engineModVoices afterwards. */
export function disposeEngineMods(
  engineModVoices: Map<string, ModulatorVoice> | null | undefined,
  laneId: string | null | undefined,
): void {
  if (engineModVoices) for (const mv of engineModVoices.values()) mv.dispose();
  if (laneId) disposeLaneModulations(laneId);
}

export function clearLaneBindings(): void {
  for (const lb of laneBindings.values()) {
    lb.engineBinding?.binder.disposeAll();
    for (const vb of lb.voiceBindings) vb.binder.disposeAll();
  }
  laneBindings.clear();
}
