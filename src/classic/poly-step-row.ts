import { classicState } from './classic-state';
import type { ClassicDeps } from './classic-state';

export function renderMainPolyStepRow(deps: ClassicDeps): void {
  const { seq, polyTracksEl, VIEW_SIZE, midiLabel } = deps;
  const { viewStart } = classicState;
  const start = viewStart;
  const end = Math.min(viewStart + VIEW_SIZE, seq.length);
  const count = end - start;
  polyTracksEl.style.setProperty('--steps', String(count));

  const row = document.createElement('div');
  row.className = 'track melody-track';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'POLYSYNTH';
  row.appendChild(label);
  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells melody-cells';
  row.appendChild(cellsEl);

  for (let i = start; i < end; i++) {
    const step = seq.melody[i];
    const cell = document.createElement('div');
    cell.className = 'bcell mcell';
    if (i > start && (i - start) % 16 === 0) cell.classList.add('seg-start');

    const noteSel = document.createElement('select');
    noteSel.className = 'note-sel';
    const rootNote = step.notes[0] ?? 60;
    for (let m = 36; m <= 84; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = midiLabel(m);
      if (m === rootNote) opt.selected = true;
      noteSel.appendChild(opt);
    }
    noteSel.addEventListener('change', () => {
      const newRoot = parseInt(noteSel.value, 10);
      const oldRoot = step.notes[0] ?? newRoot;
      const delta = newRoot - oldRoot;
      step.notes = step.notes.length === 0 ? [newRoot] : step.notes.map((n) => n + delta);
    });

    const chordBtn = document.createElement('button');
    chordBtn.className = 'toggle chord';
    const renderChordBtn = () => {
      const n = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      chordBtn.textContent = n === 1 ? '♪1' : n === 3 ? '♪3' : '♪4';
      chordBtn.classList.toggle('active', n > 1);
    };
    chordBtn.addEventListener('click', () => {
      const root = step.notes[0] ?? 60;
      const cur = step.notes.length === 4 ? 4 : step.notes.length === 3 ? 3 : 1;
      const next = cur === 1 ? 3 : cur === 3 ? 4 : 1;
      if (next === 1) step.notes = [root];
      else if (next === 3) step.notes = [root, root + 3, root + 7];
      else step.notes = [root, root + 3, root + 7, root + 10];
      renderChordBtn();
    });
    renderChordBtn();

    const mkToggle = (label: string, key: 'on' | 'accent' | 'tie') => {
      const b = document.createElement('button');
      b.className = `toggle ${key === 'tie' ? 'slide' : key}`;
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
    const tieBtn = mkToggle('T', 'tie');
    cell.appendChild(noteSel);
    cell.appendChild(onBtn);
    cell.appendChild(accentBtn);
    cell.appendChild(tieBtn);
    cell.appendChild(chordBtn);
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
    classicState.melodyCells[i] = { el: cell, noteSel, onBtn, accentBtn, tieBtn, chordBtn };
  }
  polyTracksEl.appendChild(row);
}
