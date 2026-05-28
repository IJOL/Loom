// Per-step audio dispatch for Session mode.
// Called once per 16th-note step from the look-ahead scheduler in session-runtime.
// Routes each clip step to the lane's trigger callback.

import type { DrumVoice } from '../core/drums';
import type { SessionClip, SessionState } from './session';
import { TICKS_PER_STEP } from '../core/notes';
import type { NoteEvent } from '../core/notes';
import { arp } from '../arp/arp-ui';
import { scheduleArpForNote } from '../arp/arp';

export interface StepSchedulerDeps {
  state: SessionState;
  drumLanes: readonly DrumVoice[];
  bpm: () => number;
  /** Single per-lane trigger entry point — encapsulates engineId dispatch,
   *  laneResources lookup, and modulator wiring. Replaces the old triple
   *  (bassTriggerDirect / bassTriggerForArp / polyTriggerDirect). */
  triggerForLane: (laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean) => void;
  markTrackActive: (trackId: string, time: number) => void;
}

export function scheduleClipStep(
  deps: StepSchedulerDeps,
  laneId: string,
  clip: SessionClip,
  stepInClip: number,
  stepTime: number,
  stepDur: number,
): void {
  const { state, markTrackActive } = deps;
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane || !clip.notes) return;

  const stepStartTick = stepInClip * TICKS_PER_STEP;
  const stepEndTick   = stepStartTick + TICKS_PER_STEP;
  const tickToSec     = stepDur / TICKS_PER_STEP;

  for (const n of clip.notes) {
    if (n.start < stepStartTick || n.start >= stepEndTick) continue;
    const offsetSec = (n.start - stepStartTick) * tickToSec;
    const durSec    = Math.max(0.01, n.duration * tickToSec);
    const accent    = n.velocity >= 100;
    routeNoteToEngine(deps, lane.engineId, laneId, n.midi, stepTime + offsetSec, durSec, accent, clip.notes, n);
  }
  markTrackActive(lane.id, stepTime);
}

function routeNoteToEngine(
  deps: StepSchedulerDeps,
  engineId: string,
  laneId: string,
  midi: number,
  time: number,
  gate: number,
  accent: boolean,
  allNotes: NoteEvent[],
  thisNote: NoteEvent,
): void {
  const arpEnabled = arp.enabled && arp.scope.includes(laneId);
  // TB-303-specific slide detection: a previous overlapping note from the
  // same clip means slide INTO this trigger.
  const slidingIn = engineId === 'tb303'
    && allNotes.some((m) => m !== thisNote
        && m.start < thisNote.start
        && (m.start + m.duration) > thisNote.start + 1);
  if (arpEnabled) {
    scheduleArpForNote(
      (n, t, g, a) => deps.triggerForLane(laneId, n, t, g, a, slidingIn),
      arp, deps.bpm(), midi, time, gate, accent,
    );
  } else {
    deps.triggerForLane(laneId, midi, time, gate, accent, slidingIn);
  }
}
