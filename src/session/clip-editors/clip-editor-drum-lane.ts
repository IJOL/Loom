// src/session/clip-editors/clip-editor-drum-lane.ts
// Renders a single drum lane row for a drum-lane clip (expanded drum sub-lane).

import type { DrumVoice } from '../../core/drums';
import type { DrumStep } from '../../core/sequencer';
import type { SessionClip } from '../session';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from '../../classic/drum-cells';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

export function renderDrumLaneEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  if (!clip.drumLane || !clip.drumLaneSteps) return;

  const lane = clip.drumLane;
  const steps = clip.lengthBars * 16;

  // Ensure correct length
  while (clip.drumLaneSteps.length < steps) {
    clip.drumLaneSteps.push({ on: false, accent: false });
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  const row = document.createElement('div');
  row.className = `track drum-track ${lane}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[lane];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(steps));

  const laneSteps: DrumStep[] = clip.drumLaneSteps;
  for (let i = 0; i < steps; i++) {
    const step = laneSteps[i];
    const btn = document.createElement('button');
    btn.className = `dcell ${lane}`;
    if (i % 16 === 0 && i > 0) btn.classList.add('seg-start');
    if (i % 4 === 0) btn.classList.add('downbeat');
    applyDrumCellState(btn, step);

    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        cycleDrumRoll(step);
      } else {
        cycleDrumStep(step);
      }
      applyDrumCellState(btn, step);
    });

    cells.appendChild(btn);
  }

  row.appendChild(cells);
  container.appendChild(row);
  host.appendChild(container);
}
