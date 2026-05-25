import { classicState, type ClassicDeps, type ExtraId } from './classic-state';
import { addPianoRollFor } from './piano-roll-helper';
import { renderMainPolyStepRow } from './poly-step-row';
import { refreshPolyTargetSelect } from './poly-target';
import { rebuildRollsView } from './rolls-view';

export function rebuildPolyTrack(deps: ClassicDeps, updatePagerFn: () => void): void {
  const { polyTracksEl } = deps;
  polyTracksEl.innerHTML = '';
  classicState.melodyCells = {};
  classicState.pianoRoll = null;
  classicState.extraRolls.clear();

  if (classicState.currentSynthLane === 'main') {
    if (deps.seq.pattern.polyMode === 'piano') {
      classicState.mainRollEntry = addPianoRollFor(
        {
          parent: polyTracksEl,
          labelText: 'MAIN',
          getNotes: () => deps.seq.pattern.polyNotes,
          setNotes: (notes) => { deps.seq.pattern.polyNotes = notes; },
          trackId: 'main',
        },
        deps,
      );
      classicState.pianoRoll = classicState.mainRollEntry.handle;
    } else {
      renderMainPolyStepRow(deps);
      classicState.mainRollEntry = null;
    }
  } else {
    // Show only the active extra lane
    const track = deps.seq.pattern.extraPolyTracks.find(
      (t) => t.id === classicState.currentSynthLane,
    );
    if (track) {
      const ctrl = document.createElement('div');
      ctrl.style.display = 'flex';
      ctrl.style.gap = '4px';
      const toggle = document.createElement('button');
      toggle.className = 'enable' + (track.enabled ? ' active' : '');
      toggle.textContent = track.enabled ? 'ON' : 'OFF';
      toggle.style.fontSize = '9px';
      toggle.style.padding = '2px 4px';
      toggle.addEventListener('click', () => {
        track.enabled = !track.enabled;
        toggle.classList.toggle('active', track.enabled);
        toggle.textContent = track.enabled ? 'ON' : 'OFF';
      });
      ctrl.appendChild(toggle);
      const labelText = track.name.slice(0, 14);
      const entry = addPianoRollFor(
        {
          parent: polyTracksEl,
          labelText,
          getNotes: () => track.notes,
          setNotes: (notes) => { track.notes = notes; },
          trailingControls: ctrl,
          trackId: track.id as ExtraId,
        },
        deps,
      );
      classicState.extraRolls.set(track.id, entry);
    }
  }

  // Re-apply active-edit highlight
  const activeLabel =
    (document.getElementById('poly-active-label') as HTMLElement | null)?.textContent ?? 'MAIN';
  document.querySelectorAll('.track-label.active-edit').forEach((el) =>
    el.classList.remove('active-edit'),
  );
  const node = document.querySelector(`.track-label[data-poly-target="${activeLabel}"]`);
  if (node) node.classList.add('active-edit');

  refreshPolyTargetSelect(deps);
  updatePagerFn();
  rebuildRollsView(deps);
}
