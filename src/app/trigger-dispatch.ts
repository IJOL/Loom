import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { scheduleArpForNote } from '../arp/arp';
import { GM_DRUM_MAP } from '../engines/drum-gm-map';
import type { LaneResourceMap } from '../core/lane-resources';
import type { DrumMachine } from '../core/drums';
import type { Sequencer } from '../core/sequencer';
import type { arp as ArpSingleton } from '../arp/arp-ui';

export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
) => void;

export interface TriggerDispatchDeps {
  ctx: AudioContext;
  laneResources: LaneResourceMap;
  drums: DrumMachine;
  arp: typeof ArpSingleton;
  seq: Sequencer;
}

export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      if (engineId === 'tb303') {
        setCurrentLaneForVoice(laneId);
        const v = res.engine.createVoice(deps.ctx, res.strip.input);
        setCurrentLaneForVoice(null);
        v.trigger(m, t, { gateDuration: g, accent: a, slide: sl });
        return;
      }
      if (engineId === 'drums-machine') {
        const dv = GM_DRUM_MAP[m];
        if (dv) deps.drums.trigger(dv, t, a);
        return;
      }
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a });
    };

    if (deps.arp.enabled && deps.arp.scope.includes(laneId) && engineId !== 'drums-machine') {
      scheduleArpForNote(
        (m, t, g, a) => fire(m, t, g, a, false),
        deps.arp, deps.seq.bpm, note, time, gate, accent,
      );
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
