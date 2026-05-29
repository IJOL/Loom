import { LaneResourceMap } from '../core/lane-resources';
import { ChannelStrip } from '../core/fx';
import { PolySynth } from '../polysynth/polysynth';
import { getEngine, createEngineInstance } from '../engines/registry';
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import { type DrumVoice, type DrumMachine } from '../core/drums';
import type { SynthEngine, Voice } from '../engines/engine-types';
import type { FxBus } from '../core/fx';
import type { SidechainBus } from '../core/sidechain-bus';

export interface LaneAllocatorDeps {
  ctx: AudioContext;
  master: GainNode;
  fx: FxBus;
  sidechainBus: SidechainBus;
  bassStrip: ChannelStrip;
  polyStrip: ChannelStrip;
  drumBusStrip: ChannelStrip;
  drums: DrumMachine;
  tb303Engine: SynthEngine;
  mainSubtractive: SynthEngine | null;
  drumsEngineInstance: SynthEngine | null;
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

  if (deps.drumsEngineInstance && deps.mainSubtractive) {
    resources.set(LANE_ID_BASS,  { strip: deps.bassStrip,    engine: deps.tb303Engine });
    resources.set(LANE_ID_DRUMS, { strip: deps.drumBusStrip, engine: deps.drumsEngineInstance });
    (deps.drumsEngineInstance as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(deps.drumBusStrip);
    resources.set(LANE_ID_POLY,  { strip: deps.polyStrip,    engine: deps.mainSubtractive });
  }

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
    if (laneId === 'tb-303-1')      return deps.bassStrip;
    if (laneId === 'drums-1')       return deps.drumBusStrip;
    if (laneId === 'subtractive-1') return deps.polyStrip;
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

  const stripFor = (t: string): ChannelStrip => {
    if (t in deps.drums.channels) {
      const ch = deps.drums.channels[t as DrumVoice];
      if (ch) return ch;
    }
    const res = resources.get(t);
    if (res) return res.strip;
    if (t === 'bass')    return resources.get(LANE_ID_BASS)!.strip;
    if (t === 'poly')    return resources.get(LANE_ID_POLY)!.strip;
    if (t === 'drumBus') return resources.get(LANE_ID_DRUMS)!.strip;
    if (deps.extraIds.includes(t)) {
      ensureExtraPoly(t);
      return extraStrips[t]!;
    }
    return ensureLaneStrip(t);
  };

  const ensureLaneVoice = (laneId: string, engineId: string): Voice | null => {
    const cached = laneVoices.get(laneId);
    if (cached) return cached;
    const engine = getEngine(engineId);
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
      (engine as unknown as { setBusStrip?(s: ChannelStrip): void }).setBusStrip?.(strip);
    }
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
