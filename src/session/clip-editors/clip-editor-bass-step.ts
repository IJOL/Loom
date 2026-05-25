// src/session/clip-editors/clip-editor-bass-step.ts
// Renders a row of bass step cells for a bass-step clip.
// Matches the visual design of src/classic/bass-grid.ts but operates on
// clip.bassSteps directly instead of seq.bass[].

import type { BassStep } from '../../core/sequencer';
import type { SessionClip } from '../session';

export function renderBassStepEditor(
  host: HTMLElement,
  clip: SessionClip,
  midiLabel: (m: number) => string,
): void {
  host.innerHTML = '';
  if (!clip.bassSteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.bassSteps.length < steps) {
    clip.bassSteps.push({ on: false, note: 36, accent: false, slide: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = 'track bass-track';

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = 'BASS';
  row.appendChild(label);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'cells bass-cells';
  cellsEl.style.setProperty('--steps', String(steps));

  const laneSteps: BassStep[] = clip.bassSteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const cell = document.createElement('div');
    cell.className = 'bcell';
    if (i > 0 && i % 16 === 0) cell.classList.add('seg-start');

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

    const mkToggle = (lbl: string, key: 'on' | 'accent' | 'slide') => {
      const b = document.createElement('button');
      b.className = `toggle ${key}`;
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
    cell.appendChild(mkToggle('S', 'slide'));

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
