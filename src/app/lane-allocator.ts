import { LaneResourceMap } from '../core/lane-resources';
import { ChannelStrip } from '../core/fx';
import { PolySynth } from '../polysynth/polysynth';
import { InsertChain } from '../plugins/fx/insert-chain';
import { createEngineInstance } from '../engines/registry';
import { WorkletLaneEngine } from '../engines/worklet-lane-engine';
import { getPlugin, createInstance } from '../plugins/registry';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import type { SynthEngine, Voice } from '../engines/engine-types';
import type { SynthInstance, PluginManifest } from '../plugins/types';
import type { FxBus } from '../core/fx';
import type { SidechainBus } from '../core/sidechain-bus';

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
  /** How 'subtractive' lanes synthesise. 'worklet' (default) routes them to the
   *  AudioWorklet (WorkletLaneEngine) — the live path. 'legacy' keeps the
   *  PolySynth node-per-note engine; used by the offline scene recorder, which
   *  batch-renders through an OfflineAudioContext where the real-time dropout
   *  problem the worklet solves does not apply and where worklet message
   *  delivery during startRendering is unreliable. TEMPORARY: Phase 4 (cutover)
   *  removes the legacy engine and this seam. */
  subtractiveBackend?: 'worklet' | 'legacy';
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
}

/**
 * Wraps a SynthInstance (plugin interface) in a minimal SynthEngine adapter
 * so it can be stored in LaneResourceMap and used by the rest of the audio
 * graph without a separate legacy SynthEngine registration.
 *
 * The adapter is intentionally thin: buildSequencer / buildParamUI return no-op
 * stubs because plugin-only synths manage their own UI through the plugin panel.
 */
function pluginSynthAsEngine(manifest: PluginManifest, inst: SynthInstance): SynthEngine {
  const modHost = new ModulationHostImpl([]);
  return {
    id:         manifest.id,
    name:       manifest.name,
    type:       'polyhost' as const,
    polyphony:  'mono' as const,
    editor:     'piano-roll' as const,
    params:     manifest.params,
    presets:    [],
    modulators: modHost,

    getBaseValue(id: string): number  { return inst.getBaseValue(id); },
    setBaseValue(id: string, v: number): void { inst.setBaseValue(id, v); },

    createVoice(_ctx: AudioContext, _output: AudioNode): Voice {
      return {
        trigger:        (m, t, o) => inst.trigger(m, t, o),
        release:        (t)       => inst.release(t),
        connect:        (d)       => inst.connect(d),
        getAudioParams: ()        => inst.getAudioParams(),
        getAudioParamRange: (id)  => inst.getAudioParamRange?.(id),
        dispose:        ()        => { /* instance is shared per lane; disposal handled in engine.dispose */ },
      };
    },

    getSharedAudioParams(ctx?: AudioContext): Map<string, AudioParam> {
      return inst.getSharedAudioParams?.(ctx) ?? new Map();
    },

    applyPreset(name: string): void { inst.applyPreset(name); },

    buildSequencer(_container: HTMLElement, _stepCount: number) {
      // Plugin-only synths use the default piano-roll sequencer wired by session-host.
      return {
        getStepAt: () => null,
        setLength:  () => { /* no-op */ },
        highlight:  () => { /* no-op */ },
        serialize:  () => ({}),
        deserialize: () => { /* no-op */ },
        dispose:    () => { /* no-op */ },
      };
    },

    buildParamUI(_container: HTMLElement): void {
      // Plugin-only synths manage their param UI through the plugin panel.
    },

    dispose(): void { inst.dispose(); },
  };
}

export function createLaneAllocator(deps: LaneAllocatorDeps): LaneAllocator {
  const resources = new LaneResourceMap();
  const extraStrips: Partial<Record<string, ChannelStrip>> = {};
  const extraPolys: Partial<Record<string, PolySynth>> = {};
  const extraLaneStrips = new Map<string, ChannelStrip>();
  const laneVoices = new Map<string, Voice>();

  /** Resolve an engine instance: legacy registry first, plugin registry as
   *  fallback (plugin-only synths get wrapped via pluginSynthAsEngine). */
  const subtractiveBackend = deps.subtractiveBackend ?? 'worklet';

  const createLaneEngine = (engineId: string, inserts: InsertChain): SynthEngine | null => {
    // 'subtractive' lanes are synthesised in the AudioWorklet (live path). The
    // engine constructs its own LoomWorkletNode and self-wires to
    // inserts.inputNode, bypassing the legacy PolySynth path in
    // wireEngineIntoLane below. The offline recorder opts into 'legacy'.
    if (engineId === 'subtractive' && subtractiveBackend === 'worklet') {
      return new WorkletLaneEngine(deps.ctx, inserts.inputNode);
    }
    let engine = createEngineInstance(engineId);
    if (!engine) {
      const factory = getPlugin('synth', engineId);
      if (factory && factory.kind === 'synth') {
        const inst = createInstance('synth', engineId, deps.ctx, inserts.inputNode);
        if (inst) engine = pluginSynthAsEngine(factory.manifest, inst);
      }
    }
    return engine ?? null;
  };

  /** Per-engine wiring against a lane's strip + inserts. Shared by
   *  ensureLaneResource (initial alloc) and swapLaneEngine (in-place swap). */
  const wireEngineIntoLane = (
    engineId: string,
    engine: SynthEngine,
    strip: ChannelStrip,
    inserts: InsertChain,
  ): void => {
    if (engineId === 'subtractive') {
      // Worklet backend: WorkletLaneEngine owns and self-wires its
      // LoomWorkletNode (see createLaneEngine) — no PolySynth needed.
      if (subtractiveBackend === 'worklet') return;
      // Legacy backend: wire a PolySynth into the SubtractiveEngine.
      const p = new PolySynth(deps.ctx, inserts.inputNode);
      p.bpm = deps.getBpm();
      (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
    }
    if (engineId === 'drums-machine') {
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
      (engine as unknown as { setOutputTarget?(n: AudioNode): void }).setOutputTarget?.(inserts.inputNode);
    }
    if (engineId === 'sampler') {
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
    }
    // tb303: TB303Engine.createVoice is self-registering — no external call.
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
    const engine = createLaneEngine(engineId, inserts);
    if (!engine) return;
    wireEngineIntoLane(engineId, engine, strip, inserts);
    resources.set(laneId, { strip, engine, inserts });
  };

  /** Replace the live engine of an already-allocated lane, reusing its strip
   *  and inserts. The old engine (and its cached voice) is disposed. No-op if
   *  the lane isn't allocated or the new engineId can't be resolved. */
  const swapLaneEngine = (laneId: string, newEngineId: string): void => {
    const res = resources.get(laneId);
    if (!res) return;
    const engine = createLaneEngine(newEngineId, res.inserts);
    if (!engine) return; // unknown engine → leave the lane intact
    wireEngineIntoLane(newEngineId, engine, res.strip, res.inserts);
    laneVoices.delete(laneId);                  // drop the old engine's cached voice
    resources.replaceEngine(laneId, engine);    // disposes old engine, keeps strip+inserts
  };

  const getLaneEngineInstance = (laneId: string): SynthEngine | null =>
    resources.get(laneId)?.engine ?? null;

  return {
    resources, extraStrips, extraPolys,
    stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice, ensureLaneResource,
    swapLaneEngine,
    getLaneEngineInstance,
  };
}
