import { DRUM_LANES, type DrumVoice } from '../core/drums';
import type { DrumStep } from '../core/sequencer';
import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function cycleDrumStep(s: DrumStep): void {
  if (!s.on) { s.on = true; s.accent = false; }
  else if (!s.accent) { s.accent = true; }
  else { s.on = false; s.accent = false; s.roll = 0; }
}

export function cycleDrumRoll(s: DrumStep): void {
  if (!s.on) { s.on = true; s.accent = false; }
  const cur = s.roll ?? 0;
  s.roll = cur === 0 ? 2 : cur === 2 ? 4 : 0;
}

export function applyDrumCellState(b: HTMLButtonElement, s: DrumStep): void {
  b.classList.toggle('on', s.on && !s.accent);
  b.classList.toggle('accent', s.on && s.accent);
  b.classList.toggle('roll-2', !!s.on && s.roll === 2);
  b.classList.toggle('roll-4', !!s.on && s.roll === 4);
}

export function refreshAllCellsFromState(deps: ClassicDeps): void {
  const { viewStart, bassCells, melodyCells, drumCells } = classicState;
  const { VIEW_SIZE, seq } = deps;
  const start = viewStart;
  const end = Math.min(viewStart + VIEW_SIZE, seq.length);

  for (let i = start; i < end; i++) {
    const c = bassCells[i];
    if (c) {
      const step = seq.bass[i];
      c.noteSel.value = String(step.note);
      c.onBtn.classList.toggle('active', step.on);
      c.accentBtn.classList.toggle('active', step.accent);
      c.slideBtn.classList.toggle('active', step.slide);
    }
    const mc = melodyCells[i];
    if (mc) {
      const mstep = seq.melody[i];
      mc.noteSel.value = String(mstep.notes[0] ?? 60);
      mc.onBtn.classList.toggle('active', mstep.on);
      mc.accentBtn.classList.toggle('active', mstep.accent);
      mc.tieBtn.classList.toggle('active', mstep.tie);
      const n = mstep.notes.length === 4 ? 4 : mstep.notes.length === 3 ? 3 : 1;
      mc.chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      mc.chordBtn.classList.toggle('active', n > 1);
    }
    for (const lane of DRUM_LANES) {
      const b = (drumCells as Record<DrumVoice, Record<number, HTMLButtonElement>>)[lane][i];
      if (b) applyDrumCellState(b, seq.drums[lane][i]);
    }
  }
}
