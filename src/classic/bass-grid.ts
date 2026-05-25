import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function renderBassStepGrid(start: number, end: number, deps: ClassicDeps): void {
  const { seq, bassTracksEl, laneLabels, midiLabel } = deps;

  const bassRow = document.createElement('div');
  bassRow.className = 'track bass-track';
  const bassLabel = document.createElement('div');
  bassLabel.className = 'track-label';
  bassLabel.textContent = laneLabels.bass;
  bassRow.appendChild(bassLabel);
  const bassCellsEl = document.createElement('div');
  bassCellsEl.className = 'cells bass-cells';
  bassRow.appendChild(bassCellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.bass[i];
    const cell = document.createElement('div');
    cell.className = 'bcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    for (let m = 24; m <= 60; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === step.note) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      step.note = parseInt(noteSel.value, 10);
    });

    const mkToggle = (label: string, key: 'on' | 'accent' | 'slide') => {
      const b = document.createElement('button');
      b.className = `toggle ${key}`;
      b.textContent = label;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    const onBtn = mkToggle('●', 'on');
    const accentBtn = mkToggle('A', 'accent');
    const slideBtn = mkToggle('S', 'slide');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(slideBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    bassCellsEl.appendChild(cell);
    classicState.bassCells[i] = { el: cell, noteSel, onBtn, accentBtn, slideBtn };
  }
  bassTracksEl.appendChild(bassRow);
}
