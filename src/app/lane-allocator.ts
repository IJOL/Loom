import { LaneResourceMap } from '../core/lane-resources';
import { ChannelStrip } from '../core/fx';
import { PolySynth } from '../polysynth/polysynth';
import { createEngineInstance } from '../engines/registry';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import type { SynthEngine, Voice } from '../engines/engine-types';
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
  getLaneEngineInstance(laneId: string): SynthEngine | null;
}

export function createLaneAllocator(deps: LaneAllocatorDeps): LaneAllocator {
  const resources = new LaneResourceMap();
  const extraStrips: Partial<Record<string, ChannelStrip>> = {};
  const extraPolys: Partial<Record<string, PolySynth>> = {};
  const extraLaneStrips = new Map<string, ChannelStrip>();
  const laneVoices = new Map<string, Voice>();

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
    p = new PolySynth(deps.ctx, strip.input);
    p.bpm = deps.getBpm();
    extraStrips[id] = strip;
    extraPolys[id] = p;
    const engine = createEngineInstance('subtractive');
    if (engine) {
      const setPS = (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth;
      if (setPS) setPS.call(engine, p);
      resources.set(slugFromExtraId(id), { strip, engine });
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
    const engine = resources.get(laneId)?.engine ?? null;
    if (!engine) return null;
    const strip = ensureLaneStrip(laneId);
    setCurrentLaneForVoice(laneId);
    const voice = engine.createVoice(deps.ctx, strip.input);
    setCurrentLaneForVoice(null);
    laneVoices.set(laneId, voice);
    return voice;
  };

  const ensureLaneResource = (laneId: string, engineId: string): void => {
    if (resources.get(laneId)) return;
    const strip = new ChannelStrip(deps.ctx, deps.master, deps.fx,
      { sidechain: { bus: deps.sidechainBus, id: laneId, label: laneId.toUpperCase() } });
    const engine = createEngineInstance(engineId);
    if (!engine) return;
    if (engineId === 'subtractive') {
      const p = new PolySynth(deps.ctx, strip.input);
      p.bpm = deps.getBpm();
      (engine as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(p);
    }
    if (engineId === 'drums-machine') {
      // Phase G latent-bug fix: setSharedFx MUST be called before createVoice
      // (DrumsEngine.createVoice throws if sharedFx is null). The old singleton
      // configureDrumsEngineSharedFx only wired the boot instance; extra drum
      // lanes added at runtime were never wired, causing createVoice to throw.
      (engine as unknown as { setSharedFx?(fx: FxBus): void }).setSharedFx?.(deps.fx);
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
    }
    // tb303: TB303Engine.createVoice is self-registering (creates TB303(ctx, output),
    // stores it in instances WeakMap, sets lastInstance). No external call needed.
    resources.set(laneId, { strip, engine });
  };

  const getLaneEngineInstance = (laneId: string): SynthEngine | null =>
    resources.get(laneId)?.engine ?? null;

  return {
    resources, extraStrips, extraPolys,
    stripFor, ensureExtraPoly, ensureLaneStrip, ensureLaneVoice, ensureLaneResource,
    getLaneEngineInstance,
  };
}
