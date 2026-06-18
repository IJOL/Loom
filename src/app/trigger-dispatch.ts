import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { resolveVelocity } from '../core/velocity-gain';
import type { LaneResourceMap } from '../core/lane-resources';
import type { Sequencer } from '../core/sequencer';
import type { LiveVoiceRegistry } from './live-voice-registry';

export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
  sample?: import('../session/session').ClipSample,
  velocity?: number,
) => void;

export interface TriggerDispatchDeps {
  ctx: AudioContext;
  laneResources: LaneResourceMap;
  seq: Sequencer;
  /** Optional per-lane live-voice registry. When present, every voice the
   *  dispatch creates is recorded so the stop seams can release it immediately
   *  (the 'audio' channel clip otherwise plays to the end after any Stop). */
  liveVoices?: LiveVoiceRegistry;
  /** Diagnostics seam (perf-monitor). Called once per voice fired with the
   *  lane id and the gate seconds used. No-op when unset → zero cost when the
   *  perf tool is closed. */
  onVoiceFired?: (laneId: string, gateSec: number) => void;
}

export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false, sample, velocity) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;
    const vel = resolveVelocity(velocity, accent);

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      // Track the live voice so any Stop path can release it immediately.
      deps.liveVoices?.record(laneId, v);
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample, velocity: vel });
      deps.onVoiceFired?.(laneId, g);
    };

    // Audio clips bypass note-FX; drums lanes are not note-transformed.
    const chain = sample == null && engineId !== 'drums-machine'
      ? getNoteFxChain(laneId)
      : null;

    if (chain && chain.noteFx.some((s) => s.enabled)) {
      const events = chain.process([{ note, time, gate, accent }], { bpm: deps.seq.bpm });
      for (const e of events) fire(e.note, e.time, e.gate, e.accent, false);
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
