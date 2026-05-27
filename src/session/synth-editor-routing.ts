// Session-owned synth editor state + routing.
// Replaces the bits of classic-state / poly-target / synth-tabs that were
// actually needed by the Session ⚙ flow.

import type { PolySynth } from '../polysynth/polysynth';

export interface SynthEditorState {
  activePolyTarget: PolySynth | null;
  currentSynthLane: string;  // 'main' | 'poly1' | 'poly2' | ...
}

export const synthEditorState: SynthEditorState = {
  activePolyTarget: null,
  currentSynthLane: 'main',
};

export interface SetActivePolyTargetDeps {
  refreshPolyKnobsFromState: () => void;
  refreshPolyPresetSelect: () => void;
  setActiveEngineLane: (laneId: string) => void;
}

/**
 * Switch the global synth editor UI (the .page[data-page="poly"] section)
 * to point at a specific PolySynth voice + lane id.
 */
export function setActivePolyTarget(
  target: PolySynth,
  laneId: string,
  deps: SetActivePolyTargetDeps,
): void {
  synthEditorState.activePolyTarget = target;
  synthEditorState.currentSynthLane = laneId;
  deps.refreshPolyKnobsFromState();
  deps.refreshPolyPresetSelect();
  deps.setActiveEngineLane(laneId);
}

/**
 * Show the synth editor page for a poly-engine lane. Called by Session's
 * onEditLane when the active lane uses a poly engine (subtractive / wavetable
 * / fm / karplus).
 */
export function showPolyEditor(
  laneId: string,
  target: PolySynth,
  displayName: string,
  deps: SetActivePolyTargetDeps,
): void {
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.hidden = p.dataset.page !== 'poly';
  });
  setActivePolyTarget(target, laneId, deps);
  const label = document.getElementById('engine-lane-label');
  if (label) label.textContent = displayName;
  const polyActive = document.getElementById('poly-active-label');
  if (polyActive) polyActive.textContent = displayName;
}
