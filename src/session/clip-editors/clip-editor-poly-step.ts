// src/session/clip-editors/clip-editor-poly-step.ts
// Renders a row of poly step cells for a poly-step clip.
// Matches the visual design of src/classic/poly-step-row.ts but operates on
// clip.polySteps directly.

import type { PolyStep } from '../../core/sequencer';
import type { SessionClip } from '../session';

export function renderPolyStepEditor(
  host: HTMLElement,
  clip: SessionClip,
  midiLabel: (m: number) => string,
): void {
  host.innerHTML = '';
  if (!clip.polySteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.polySteps.length < steps) {
    clip.polySteps.push({ on: false, notes: [60], accent: false, tie: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = 'track melody-track';

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'POLY';
  row.appendChild(label);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells melody-cells';
  cellsEl.style.setProperty('--steps', String(steps));

  const laneSteps: PolyStep[] = clip.polySteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const cell = document.createElement('div');
    cell.className = 'bcell mcell';
    if (i > 0 && i % 16 === 0) cell.classList.add('seg-start');

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
    const renderChord = () => {
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
      renderChord();
    });
    renderChord();

    const mkToggle = (lbl: string, key: 'on' | 'accent' | 'tie') => {
      const b = document.createElement('button');
      b.className = `toggle ${key === 'tie' ? 'slide' : key}`;
      b.textContent = lbl;
      if (step[key]) b.classList.add('active');
      b.addEventListener('click', () => {
        step[key] = !step[key];
        b.classList.toggle('active', step[key]);
      });
      return b;
    };

    cell.appendChild(noteSel);
    cell.appendChild(mkToggle('●', 'on'));
    cell.appendChild(mkToggle('A', 'accent'));
    cell.appendChild(mkToggle('T', 'tie'));
    cell.appendChild(chordBtn);

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1);
    cell.appendChild(num);

    cellsEl.appendChild(cell);
  }

  row.appendChild(cellsEl);
  container.appendChild(row);
  host.appendChild(container);
}
