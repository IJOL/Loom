import { LaneResourceMap } from '../core/lane-resources';
import { ChannelStrip } from '../core/fx';
import { PolySynth } from '../polysynth/polysynth';
import { InsertChain } from '../plugins/fx/insert-chain';
import { createEngineInstance, getEngineDescriptor } from '../engines/registry';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { DrumsWorkletEngine } from '../engines/drums-worklet-engine';
import { SamplerWorkletEngine } from '../engines/sampler-worklet-engine';
import { AudioWorkletEngine } from '../engines/audio-worklet-engine';
import { PRESET_KEY_TO_SPEC as TB303_PRESET_KEY_TO_SPEC } from '../engines/tb303';
import type { GlobalVoiceCap } from '../audio-worklet/global-voice-cap';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { bindEngineModulators } from '../modulation/voice-mod-binding';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import type { SynthEngine, Voice } from '../engines/engine-types';
import type { FxBus } from '../core/fx';
import type { SidechainBus } from '../core/sidechain-bus';

// Melodic engines that have a per-sample worklet renderer (Phase 1 subtractive +
// Phase 2 ports). These route to WorkletLaneEngine on the live path; drums /
// sampler / audio remain legacy until their own phases.
const WORKLET_ENGINE_IDS = new Set(['subtractive', 'tb303', 'fm', 'wavetable', 'karplus', 'westcoast']);

// Phase G: LaneAllocatorDeps is now master-only — no per-lane strips,
// instrument singletons, or boot configurators. ensureLaneResource() is
// the SOLE allocation path for every lane, including the three defaults
// (tb-303-1, drums-1, subtractive-1) which are allocated lazily when
// applyLoadedSessionState() iterates the boot session JSON.
//
// INVARIANT: lanes.resources is empty until applyLoadedSessionState runs.
// Any consumer that reads from lanes.resources MUST either:
//   (a) defer access until sessionHost.onStateApplied fires, OR
//   (b) call ensureLaneResource(laneId, engineId) explicitly as test setup.
// Accessing stripFor() before a lane is allocated now throws loudly (see below).
export interface LaneAllocatorDeps {
  ctx: AudioContext;
  master: GainNode;
  fx: FxBus;
  sidechainBus: SidechainBus;
  getBpm(): number;
  extraIds: readonly string[];
  /** Global simultaneous-voice budget coordinator. Each worklet lane registers
   *  its node so the busiest lane is told to steal when the total exceeds the
   *  budget. Absent in the offline recorder (no real-time dropout concern). */
  globalVoiceCap?: GlobalVoiceCap;
  /** Master insert chain, so `master-insert-N:<param>` resolves as a modulation
   *  destination. The modulation panel offers those destinations for every lane;
   *  without this they would be selectable and dead. */
  masterInserts?: InsertChain;
}

export interface LaneAllocator {
  resources: LaneResourceMap;
  extraStrips: Partial<Record<string, ChannelStrip>>;
  extraPolys:  Partial<Record<string, PolySynth>>;
  stripFor(t: string): ChannelStrip;
  ensureExtraPoly(id: string): PolySynth;
  ensureLaneStrip(laneId: string): ChannelStrip;
  ensureLaneVoice(laneId: string, engineId: string): Voice | null;
  ensureLaneResource(laneId: string, engineId: string): void;
  swapLaneEngine(laneId: string, newEngineId: string): void;
  getLaneEngineInstance(laneId: string): SynthEngine | null;
  /** (Re)connect the lane's modulators to their Web-Audio destinations — the
   *  lane/master insert params and any shared engine params. Call after the
   *  modulator set changes; allocation and engine swap do it themselves. */
  bindLaneModulators(laneId: string): void;
}

export function createLaneAllocator(deps: LaneAllocatorDeps): LaneAllocator {
  const resources = new LaneResourceMap();
  const extraStrips: Partial<Record<string, ChannelStrip>> = {};
  const extraPolys: Partial<Record<string, PolySynth>> = {};
  const extraLaneStrips = new Map<string, ChannelStrip>();
  const laneVoices = new Map<string, Voice>();

  const createLaneEngine = (laneId: string, engineId: string, inserts: InsertChain): SynthEngine | null => {
    // Phase 4 cutover: synthesis is worklet-only. The legacy node-per-note engine
    // classes are gone; the offline recorder renders melodic lanes through the
    // pure audio-dsp kernel (it no longer constructs lane engines for synthesis).
    //
    // Worklet-capable melodic engines run in the AudioWorklet via a
    // WorkletLaneEngine, which constructs its own LoomWorkletNode and self-wires
    // to inserts.inputNode. Config (name/polyphony/params/modulators) is read
    // from the pure-data registry descriptor — never a synthesising engine class.
    if (WORKLET_ENGINE_IDS.has(engineId)) {
      const spec = getEngineDescriptor(engineId);
      if (spec) {
        const eng = new WorkletLaneEngine(deps.ctx, inserts.inputNode, {
          engineId, name: spec.name, presetsKey: engineId, polyphony: spec.polyphony,
          params: spec.params, modulators: spec.modulators,
          // TB-303 preset JSON uses legacy flat keys; remap them to dot-ids so
          // presets actually apply on the worklet path (other engines' JSON is
          // already dot-id keyed).
          presetKeyRemap: engineId === 'tb303' ? TB303_PRESET_KEY_TO_SPEC : undefined,
        });
        // Enrol this lane's worklet node in the global voice cap.
        deps.globalVoiceCap?.register(laneId, eng.getWorkletNode());
        return eng;
      }
    }
    // Drums use the 8-output DrumsWorkletEngine (its own DrumsWorkletNode + 8
    // per-voice strips, NOT the LoomWorkletNode). Wired by the drums-machine
    // branch in wireEngineIntoLane (setSharedFx/setBusStrip/setOutputTarget), so
    // it builds its node + strips on first createVoice. Not enrolled in the
    // global voice cap (which is LoomWorkletNode-only).
    if (engineId === 'drums-machine') return new DrumsWorkletEngine();
    // Sampler + Audio channel use their own worklet engines (each owns a
    // SamplerWorkletNode; dry → lane insert chain, send → FxBus). Wired by the
    // sampler/audio branch in wireEngineIntoLane.
    if (engineId === 'sampler') return new SamplerWorkletEngine();
    if (engineId === 'audio') return new AudioWorkletEngine();
    return null;
  };

  /** Per-engine wiring against a lane's strip + inserts. Shared by
   *  ensureLaneResource (initial alloc) and swapLaneEngine (in-place swap).
   *  WorkletLaneEngine melodic lanes self-wire in createLaneEngine, so only the
   *  8-output drums + sampler/audio worklet engines need their shared-fx/output
   *  targets set here. */
  const wireEngineIntoLane = (
    engineId: string,
    engine: SynthEngine,
    strip: ChannelStrip,
    inserts: InsertChain,
  ): void => {
    if (WORKLET_ENGINE_IDS.has(engineId)) return;   // self-wiring WorkletLaneEngine
    if (engineId === 'drums-machine') {
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
      (engine as unknown as { setOutputTarget?(n: AudioNode): void }).setOutputTarget?.(inserts.inputNode);
    }
    if (engineId === 'sampler' || engineId === 'audio') {
      // SamplerWorkletEngine / AudioWorkletEngine own a SamplerWorkletNode: dry →
      // lane insert chain, send → FxBus.
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
      (engine as unknown as { setOutputTarget?(n: AudioNode): void }).setOutputTarget?.(inserts.inputNode);
    }
  };

  // Phase G: No boot prefill block. The three default lanes (tb-303-1,
  // drums-1, subtractive-1) are allocated via ensureLaneResource() when
  // applyLoadedSessionState iterates the boot session JSON.

  const slugFromExtraId = (id: string): string => {
    const n = parseInt(id.replace('poly', ''), 10) + 1;
    return `subtractive-${n}`;
  };

  const ensureExtraPoly = (id: string): PolySynth => {
    let p = extraPolys[id];
    if (p) return p;
    const slug = slugFromExtraId(id);
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
      { sidechain: { bus: deps.sidechainBus, id: slug, label: id.toUpperCase() } });
    const inserts = new InsertChain(deps.ctx.createGain(), strip.input);
    p = new PolySynth(deps.ctx, inserts.inputNode);
    p.bpm = deps.getBpm();
    extraStrips[id] = strip;
    extraPolys[id] = p;
    const engine = createEngineInstance('subtractive');
    if (engine) {
      const setPS = (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth;
      if (setPS) setPS.call(engine, p);
      resources.set(slugFromExtraId(id), { strip, engine, inserts });
    }
    return p;
  };

  const ensureLaneStrip = (laneId: string): ChannelStrip => {
    // Phase G: no special-cased boot-lane fallbacks (those lanes are now
    // allocated via ensureLaneResource). If the lane already has a resource,
    // return its strip; otherwise create a standalone strip for extra poly ids.
    const existing = resources.get(laneId);
    if (existing) return existing.strip;
    if (deps.extraIds.includes(laneId)) {
      ensureExtraPoly(laneId);
      return extraStrips[laneId]!;
    }
    let s = extraLaneStrips.get(laneId);
    if (!s) {
      s = new ChannelStrip(deps.ctx, deps.master, deps.fx,
        { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
      extraLaneStrips.set(laneId, s);
    }
    return s;
  };

  // Phase G: stripFor now throws if no resource exists for a given track id.
  // This converts silent-undefined audio dropouts into loud runtime errors,
  // surfacing boot-order bugs that used to go unnoticed.
  const stripFor = (t: string): ChannelStrip => {
    const res = resources.get(t);
    if (res) return res.strip;
    if (t === 'bass') {
      const r = resources.get(LANE_ID_BASS);
      if (!r) throw new Error(`stripFor: no resource for legacy alias 'bass' (LANE_ID_BASS not yet allocated)`);
      return r.strip;
    }
    if (t === 'poly') {
      const r = resources.get(LANE_ID_POLY);
      if (!r) throw new Error(`stripFor: no resource for legacy alias 'poly' (LANE_ID_POLY not yet allocated)`);
      return r.strip;
    }
    if (t === 'drumBus') {
      const r = resources.get(LANE_ID_DRUMS);
      if (!r) throw new Error(`stripFor: no resource for legacy alias 'drumBus' (LANE_ID_DRUMS not yet allocated)`);
      return r.strip;
    }
    // Drum-voice track names ('kick', 'snare', etc.) → look up the drum lane.
    const drumLane = resources.get(LANE_ID_DRUMS);
    if (drumLane) return drumLane.strip;
    if (deps.extraIds.includes(t)) {
      ensureExtraPoly(t);
      return extraStrips[t]!;
    }
    // Deliberate throw: forces ordering bugs to surface in tests.
    // Access lanes.resources only AFTER applyLoadedSessionState has run.
    throw new Error(`stripFor: no resource for track "${t}" — was applyLoadedSessionState called?`);
  };

  const ensureLaneVoice = (laneId: string, engineId: string): Voice | null => {
    const cached = laneVoices.get(laneId);
    if (cached) return cached;
    // Ensure the lane resource exists (idempotent).
    ensureLaneResource(laneId, engineId);
    const res = resources.get(laneId);
    const engine = res?.engine ?? null;
    if (!engine) return null;
    // Route voice output through the lane InsertChain so any inserted FX
    // sits between the engine's voice and the channel strip.
    const voiceOutput = res?.inserts?.inputNode ?? ensureLaneStrip(laneId).input;
    setCurrentLaneForVoice(laneId);
    const voice = engine.createVoice(deps.ctx, voiceOutput);
    setCurrentLaneForVoice(null);
    laneVoices.set(laneId, voice);
    return voice;
  };

  const ensureLaneResource = (laneId: string, engineId: string): void => {
    if (resources.get(laneId)) return;
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
      { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
    // Phase H: every lane gets an InsertChain between the engine voice and the
    // channel strip. The chain's entry node is a GainNode (pass-through when
    // empty); its output is strip.input.
    const inserts = new InsertChain(deps.ctx.createGain(), strip.input);
    const engine = createLaneEngine(laneId, engineId, inserts);
    if (!engine) return;
    wireEngineIntoLane(engineId, engine, strip, inserts);
    resources.set(laneId, { strip, engine, inserts });
    bindLaneModulators(laneId);
  };

  /** Connect this lane's modulators to their Web-Audio destinations.
   *
   *  This is the ONE place it happens, which is why both the live host and the
   *  offline recorder get it: they share this allocator. Before, only the drums
   *  and sampler engines bound anything (from inside their own createVoice), so
   *  on the six melodic engines a modulator routed to an FX param was offered by
   *  the panel and silently connected to nothing — and the exporter bound
   *  nothing at all, for any engine.
   *
   *  Drums and Sampler still bind themselves, with their own range lookups; a
   *  second bind here would only dispose theirs and rebuild a worse one. */
  const bindLaneModulators = (laneId: string): void => {
    const res = resources.get(laneId);
    if (!res) return;
    const engine = res.engine;
    if (engine instanceof DrumsWorkletEngine || engine instanceof SamplerWorkletEngine) return;
    const voiceMods = engine.modulators.spawnVoice(deps.ctx, deps.getBpm);
    bindEngineModulators({
      laneId, engine, voiceMods, ctx: deps.ctx,
      laneInserts: res.inserts,
      masterInserts: deps.masterInserts,
    });
  };

  /** Replace the live engine of an already-allocated lane, reusing its strip
   *  and inserts. The old engine (and its cached voice) is disposed. No-op if
   *  the lane isn't allocated or the new engineId can't be resolved. */
  const swapLaneEngine = (laneId: string, newEngineId: string): void => {
    const res = resources.get(laneId);
    if (!res) return;
    // createLaneEngine registers a NEW worklet engine's node with the cap,
    // overwriting the old laneId entry (the old node's stale reports are then
    // ignored by the cap's node-identity guard). Build first so that on an
    // unknown engineId we leave BOTH the lane and its cap registration intact.
    const engine = createLaneEngine(laneId, newEngineId, res.inserts);
    if (!engine) return; // unknown engine → leave the lane intact
    // Replacement is NOT a worklet engine → the old worklet lane's cap
    // registration is now orphaned; drop it so the disposed node stops counting.
    if (!(engine instanceof WorkletLaneEngine)) deps.globalVoiceCap?.unregister(laneId);
    wireEngineIntoLane(newEngineId, engine, res.strip, res.inserts);
    laneVoices.delete(laneId);                  // drop the old engine's cached voice
    resources.replaceEngine(laneId, engine);    // disposes old engine, keeps strip+inserts
    bindLaneModulators(laneId);                 // the new engine owns a new host
  };

  const getLaneEngineInstance = (laneId: string): SynthEngine | null =>
    resources.get(laneId)?.engine ?? null;

  return {
    resources, extraStrips, extraPolys,
    stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice, ensureLaneResource,
    swapLaneEngine,
    getLaneEngineInstance,
    bindLaneModulators,
  };
}
