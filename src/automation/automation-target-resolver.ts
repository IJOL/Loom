// Deciding WHERE a knob's automation lives — the heart of the right-click
// "Automate…" menu (Task 3). Pure decision logic: no DOM, no UI imports.
//
// The rule has five branches and each one writes somewhere different, so it
// is kept here as a pure function rather than inline in a click handler —
// five fast unit tests instead of five browser states.

import { parseAutomationParamId } from './automation-apply';
import type { SessionState } from '../session/session-types';
import type { LanePlayState } from '../session/session-runtime';

export type AutomationTarget =
  | { kind: 'clip'; laneId: string; clipIdx: number; clipName: string; existing: boolean }
  | { kind: 'timeline'; existing: boolean }
  | { kind: 'unavailable'; reason: string };

export interface ResolveTargetInput {
  paramId: string;
  mode: 'session' | 'performance';
  state: SessionState;
  laneStates: ReadonlyMap<string, LanePlayState>;
  /** Curve param ids already present in the arrangement (lane + global). */
  timelineParamIds: readonly string[];
}

export function resolveAutomationTarget(input: ResolveTargetInput): AutomationTarget {
  const { paramId, mode, state, laneStates, timelineParamIds } = input;

  if (mode === 'performance') {
    return { kind: 'timeline', existing: timelineParamIds.includes(paramId) };
  }

  const parsed = parseAutomationParamId(paramId);

  // A malformed id (no lane segment at all) parses to null. Reject upfront
  // with a clear reason, not "track is gone".
  if (!parsed) {
    return { kind: 'unavailable', reason: 'Invalid parameter format' };
  }

  const scopeId = parsed.scopeId;
  const lane = state.lanes.find((l) => l.id === scopeId);
  if (lane) {
    const playing = laneStates.get(lane.id)?.playing;
    let clipIdx = -1;
    if (playing) clipIdx = lane.clips.findIndex((c) => c?.id === playing.id);
    if (clipIdx < 0) clipIdx = lane.clips.findIndex((c) => c !== null);

    if (clipIdx < 0) {
      return { kind: 'unavailable', reason: 'This track has no clips' };
    }

    const clip = lane.clips[clipIdx]!;
    const existing = (clip.envelopes ?? []).some((e) => e.paramId === paramId);
    // FINDING 3: Fall back to a positional label for unnamed clips.
    const clipName = clip.name ?? `Clip ${clipIdx + 1}`;
    return { kind: 'clip', laneId: lane.id, clipIdx, clipName, existing };
  }

  if (scopeId === 'fx' || scopeId.startsWith('fx.')) {
    return {
      kind: 'unavailable',
      reason: 'Master and send FX automate on the timeline — switch to Performance',
    };
  }

  return { kind: 'unavailable', reason: 'That track is gone' };
}
