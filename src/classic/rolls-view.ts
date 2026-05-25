import { bassStepsToNotes, notesToBassSteps, stepsToNotes, notesToPolySteps } from '../core/notes';
import { addPianoRollFor } from './piano-roll-helper';
import type { ClassicDeps, RollEntry } from './classic-state';

// Module-level array so the animation tick in main.ts can iterate it.
export const rollsRollEntries: RollEntry[] = [];

export function rebuildRollsView(deps: ClassicDeps): void {
  const stackEl = document.getElementById('rolls-stack') as HTMLDivElement | null;
  if (!stackEl) return;
  stackEl.innerHTML = '';
  rollsRollEntries.length = 0;

  // Bass 303 — piano-mode or step-mode (round-trip via converters)
  const bassEntry = addPianoRollFor(
    {
      parent: stackEl,
      labelText: deps.seq.pattern.bassMode === 'piano' ? 'BASS' : 'BASS (step)',
      trackId: 'bass',
      getNotes: () =>
        deps.seq.pattern.bassMode === 'piano'
          ? deps.seq.pattern.bassNotes
          : bassStepsToNotes(deps.seq.pattern.bass),
      setNotes: (n) => {
        if (deps.seq.pattern.bassMode === 'piano') deps.seq.pattern.bassNotes = n;
        else deps.seq.pattern.bass = notesToBassSteps(n, deps.seq.pattern.length);
      },
    },
    deps,
  );
  rollsRollEntries.push(bassEntry);

  // Main poly
  const mainEntry = addPianoRollFor(
    {
      parent: stackEl,
      labelText: deps.seq.pattern.polyMode === 'piano' ? 'MAIN' : 'MAIN (step)',
      trackId: 'main',
      getNotes: () =>
        deps.seq.pattern.polyMode === 'piano'
          ? deps.seq.pattern.polyNotes
          : stepsToNotes(deps.seq.pattern.melody),
      setNotes: (n) => {
        if (deps.seq.pattern.polyMode === 'piano') deps.seq.pattern.polyNotes = n;
        else deps.seq.pattern.melody = notesToPolySteps(n, deps.seq.pattern.length);
      },
    },
    deps,
  );
  rollsRollEntries.push(mainEntry);

  // Extra poly tracks
  for (const track of deps.seq.pattern.extraPolyTracks) {
    const entry = addPianoRollFor(
      {
        parent: stackEl,
        labelText: track.name.slice(0, 14),
        trackId: track.id,
        getNotes: () => track.notes,
        setNotes: (n) => { track.notes = n; },
      },
      deps,
    );
    rollsRollEntries.push(entry);
  }
}
