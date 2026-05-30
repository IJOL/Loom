import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { scheduleArpForNote } from '../arp/arp';
import type { LaneResourceMap } from '../core/lane-resources';
import type { Sequencer } from '../core/sequencer';
import type { arp as ArpSingleton } from '../arp/arp-ui';

export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
  sample?: import('../session/session').ClipSample,
) => void;

export interface TriggerDispatchDeps {
  ctx: AudioContext;
  laneResources: LaneResourceMap;
  // Phase G: drums: DrumMachine removed — drums-machine lanes trigger via
  // res.engine.createVoice() just like every other engine.
  arp: typeof ArpSingleton;
  seq: Sequencer;
}

export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false, sample) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample });
    };

    // Audio clips (loop/song) are not arpeggiated — fire the buffer directly.
    if (sample == null && deps.arp.enabled && deps.arp.scope.includes(laneId) && engineId !== 'drums-machine') {
      scheduleArpForNote(
        (m, t, g, a) => fire(m, t, g, a, false),
        deps.arp, deps.seq.bpm, note, time, gate, accent,
      );
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
