// Callback contract the host (main.ts) wires into the session grid. Split into a
// leaf module so both the grid renderer (session-ui.ts) and the clip-drag helper
// (session-clip-drag.ts) can import it without forming an import cycle.

import type { ClipSlot } from './session-ops';

export interface SessionUICallbacks {
  /** Click on the clip body (anywhere except the ▶ icon): open the clip in
   *  the inspector and focus the editor. Does not affect transport. */
  onClipClick: (laneId: string, clipIdx: number) => void;
  /** Click on the ▶ / ⏸ icon: launch the clip (or stop it if already
   *  playing/queued). Respects launchQuantize when transport is running;
   *  starts immediately if transport is idle. */
  onClipPlayPause: (laneId: string, clipIdx: number) => void;
  onCellClick: (laneId: string, clipIdx: number) => void;
  /** An audio file was dropped onto an EMPTY clip cell of a sampler lane. The
   *  host imports it and creates a loop clip carrying clip.sample. */
  onCellDropAudio?: (laneId: string, clipIdx: number, file: File) => void;
  /** A WAV was chosen via the "+ Audio" control: create an audio-channel lane. */
  onAddAudioChannel?: () => void;
  /** Drop a clip onto another slot. `copy=true` when the user held Ctrl
   *  during the drag (Ctrl=copy, plain drag=move). Caller is responsible
   *  for wrapping the mutation in withUndo. */
  onMoveClip: (from: ClipSlot, to: ClipSlot, copy: boolean) => void;
  onStopLane:  (laneId: string) => void;
  onLaunchScene: (sceneIdx: number) => void;
  onStopAll:   () => void;
  onAddScene:  () => void;
  onAddLane: (engineId: string) => void;
  /** Full-clone a lane (instrument + clips); the new lane appears to the right. */
  onDuplicateLane: (laneId: string) => void;
  /** Append a clone of the scene at sceneIdx. */
  onDuplicateScene: (sceneIdx: number) => void;
  /** Append a new scene capturing the currently-playing clip on each lane. */
  onCaptureScene: () => void;
  onAddStemLanes: (
    stems: { label: string; sampleId: string; durationSec: number; warpRef?: boolean }[],
    opts?: { replace?: boolean; anchorSec?: number; warpMarkers?: import('./session-types').WarpMarker[]; warpGroupId?: string },
  ) => void;
  onAddClipRow: () => void;
  onEditLane:  (laneId: string) => void;
  onDeleteClip:  (laneId: string, clipIdx: number) => void;
  onDeleteLane:  (laneId: string) => void;
  onDeleteScene: (sceneIdx: number) => void;
  /** Rename a track / scene in place. Optional so test fixtures + the host
   *  (which wires them in a later task) compile independently. */
  onRenameLane?: (laneId: string, name: string) => void;
  onRenameScene?: (sceneIdx: number, name: string) => void;
  onToggleDrumsExpanded: () => void;
  _mixerRow?: HTMLElement;
}
