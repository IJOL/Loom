import { computeStripMutes, type MuteSoloLane } from '../core/mute-solo';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';
import { DRUM_LANES } from '../core/drums';
import type { LaneResourceMap } from '../core/lane-resources';
import type { ChannelStrip } from '../core/fx';

export interface MuteSoloDeps {
  laneResources: LaneResourceMap;
  stripFor(t: string): ChannelStrip;
  allTrackIds: readonly string[];
}

export interface MuteSoloController {
  muteState: Record<string, boolean>;
  soloState: Record<string, boolean>;
  apply(): void;
}

export function createMuteSolo(deps: MuteSoloDeps): MuteSoloController {
  const muteState: Record<string, boolean> = Object.fromEntries(deps.allTrackIds.map((t) => [t, false]));
  const soloState: Record<string, boolean> = Object.fromEntries(deps.allTrackIds.map((t) => [t, false]));

  const apply = () => {
    const lanes: MuteSoloLane[] = [];
    for (const laneId of deps.laneResources.ids()) {
      const ownedTrackIds: string[] = [];
      if (laneId === LANE_ID_BASS)  ownedTrackIds.push('bass');
      if (laneId === LANE_ID_POLY)  ownedTrackIds.push('poly');
      if (laneId === LANE_ID_DRUMS) {
        ownedTrackIds.push('drumBus');
        for (const voice of DRUM_LANES) ownedTrackIds.push(voice);
      }
      lanes.push({ id: laneId, ownedTrackIds });
    }
    const mutes = computeStripMutes({ lanes, muteState, soloState });
    for (const [id, muted] of Object.entries(mutes)) {
      deps.stripFor(id).setMuted(muted);
    }
  };

  return { muteState, soloState, apply };
}
