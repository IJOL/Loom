// Transport state for the per-lane independent scheduler (Phase D of the
// lane resource unification refactor). The Sequencer used to own a single
// `pattern` + global step counter; the new model splits that into:
//   - GlobalTransport: bpm + isPlaying + startedAt (ctx.currentTime when
//     play was pressed; used to anchor scheduling math).
//   - LaneTransport: per-lane currentClipIndex + loopStartedAt + playing.
//     Each lane tracks its own loop position so clips of different
//     lengthBars loop independently.

export interface GlobalTransport {
  bpm: number;
  isPlaying: boolean;
  startedAt: number;
}

export interface LaneTransport {
  /** Index into `lane.clips[]` for the clip currently playing. Null when
   *  the cell for this lane is empty in the active scene. */
  currentClipIndex: number | null;
  /** `ctx.currentTime` when this lane's current loop iteration began.
   *  Advanced by the scheduler as iterations complete. */
  loopStartedAt: number;
  playing: boolean;
}

export function createGlobalTransport(): GlobalTransport {
  return { bpm: 120, isPlaying: false, startedAt: 0 };
}

export function createLaneTransport(): LaneTransport {
  return { currentClipIndex: null, loopStartedAt: 0, playing: false };
}
