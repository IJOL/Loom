import { DRUM_LANES } from '../core/drums';
import { classicState, type ClassicDeps } from './classic-state';
import { addPianoRollFor } from './piano-roll-helper';
import { renderBassStepGrid } from './bass-grid';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from './drum-cells';
import { rebuildPolyTrack } from './poly-track-area';
import { rebuildSynthTabs } from './synth-tabs';

export function visibleRange(deps: ClassicDeps): { start: number; end: number } {
  const { seq, VIEW_SIZE } = deps;
  if (classicState.viewStart >= seq.length) classicState.viewStart = 0;
  return {
    start: classicState.viewStart,
    end: Math.min(classicState.viewStart + VIEW_SIZE, seq.length),
  };
}

export function updatePager(deps: ClassicDeps): void {
  const totalPages = Math.max(1, Math.ceil(deps.seq.length / deps.VIEW_SIZE));
  const currentPage = Math.floor(classicState.viewStart / deps.VIEW_SIZE) + 1;
  const pageLabelEl = document.getElementById('page-label');
  const pagePrevBtn = document.getElementById('page-prev') as HTMLButtonElement | null;
  const pageNextBtn = document.getElementById('page-next') as HTMLButtonElement | null;
  const pagerEl = document.getElementById('pager');
  if (pageLabelEl) pageLabelEl.textContent = `${currentPage} / ${totalPages}`;
  if (pagePrevBtn) pagePrevBtn.disabled = currentPage <= 1;
  if (pageNextBtn) pageNextBtn.disabled = currentPage >= totalPages;
  if (pagerEl) pagerEl.style.display = totalPages > 1 ? 'flex' : 'none';
}

export function rebuildTracks(deps: ClassicDeps): void {
  const { bassTracksEl, drumTracksEl, seq } = deps;
  bassTracksEl.innerHTML = '';
  drumTracksEl.innerHTML = '';
  classicState.bassCells = {};
  for (const k of Object.keys(classicState.drumCells) as Array<keyof typeof classicState.drumCells>) {
    classicState.drumCells[k] = {};
  }

  const { start, end } = visibleRange(deps);
  const count = end - start;
  bassTracksEl.style.setProperty('--steps', String(count));
  drumTracksEl.style.setProperty('--steps', String(count));

  if (seq.pattern.bassMode === 'piano') {
    classicState.bassRollEntry = addPianoRollFor(
      {
        parent: bassTracksEl,
        labelText: deps.laneLabels.bass,
        getNotes: () => seq.pattern.bassNotes,
        setNotes: (notes) => { seq.pattern.bassNotes = notes; },
        trackId: 'bass',
      },
      deps,
    );
  } else {
    classicState.bassRollEntry = null;
    renderBassStepGrid(start, end, deps);
  }

  for (const lane of DRUM_LANES) {
    const row = document.createElement('div');
    row.className = `track drum-track ${lane}`;
    const label = document.createElement('div');
    label.className = 'track-label';
    label.textContent = deps.laneLabels[lane];
    row.appendChild(label);
    const cellsEl = document.createElement('div');
    cellsEl.className = 'cells drum-cells';
    row.appendChild(cellsEl);

    for (let i = start; i < end; i++) {
      const step = seq.drums[lane][i];
      const b = document.createElement('button');
      b.className = `dcell ${lane}`;
      if (i > start && (i - start) % 16 === 0) b.classList.add('seg-start');
      if (i % 4 === 0) b.classList.add('downbeat');
      applyDrumCellState(b, step);
      b.addEventListener('click', (e) => {
        if (e.shiftKey) cycleDrumRoll(step);
        else cycleDrumStep(step);
        applyDrumCellState(b, step);
      });
      b.title = 'Click: off → on → accent. Shift+click: roll x2 → x4';
      cellsEl.appendChild(b);
      classicState.drumCells[lane][i] = b;
    }
    drumTracksEl.appendChild(row);
  }

  rebuildPolyTrack(deps, () => updatePager(deps));
  updatePager(deps);
}

/**
 * Called once at boot from main.ts.
 * Wires up poly-target dropdown + rebuilds synth tabs, then builds the
 * initial track grid.
 */
export function wireClassicUI(deps: ClassicDeps): void {
  classicState.activePolyTarget = deps.polysynth;
  rebuildSynthTabs(deps, () => rebuildPolyTrack(deps, () => updatePager(deps)), deps.rebuildMixer);
  rebuildTracks(deps);
}
