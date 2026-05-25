// src/session/clip-editors/clip-editor-drum-bus.ts
// Renders a multi-row drum step grid for a drum-bus clip.
// Each row = one DRUM_LANE; each column = one 16th step.
// Click cycles: off → on → accent; Shift+click cycles roll factor.

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { DrumStep } from '../../core/sequencer';
import type { SessionClip } from '../session';
import { cycleDrumStep, cycleDrumRoll, applyDrumCellState } from '../../classic/drum-cells';

export function renderDrumBusEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  if (!clip.drumSteps) return;

  const steps = clip.lengthBars * 16;

  // Ensure all lanes exist in drumSteps
  for (const lane of DRUM_LANES) {
    if (!clip.drumSteps[lane]) {
      clip.drumSteps[lane] = Array.from({ length: steps }, () => ({ on: false, accent: false }));
    }
    // Ensure correct length
    while (clip.drumSteps[lane].length < steps) {
      clip.drumSteps[lane].push({ on: false, accent: false });
    }
  }

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  for (const lane of DRUM_LANES) {
    container.appendChild(buildDrumRow(lane, clip.drumSteps[lane], steps));
  }

  host.appendChild(container);
}

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

function buildDrumRow(lane: DrumVoice, laneSteps: DrumStep[], totalSteps: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `track drum-track ${lane}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[lane];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(totalSteps));

  for (let i = 0; i < totalSteps; i++) {
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
  return row;
}
