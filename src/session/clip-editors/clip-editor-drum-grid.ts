// src/session/clip-editors/clip-editor-drum-grid.ts
// Renders an 8-row × N-step drum grid for any clip that uses NoteEvent[]
// with GM drum-mapped midis. Replaces clip-editor-drum-bus and clip-editor-
// drum-lane (which read the legacy drumSteps/drumLaneSteps fields).

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { TICKS_PER_STEP } from '../../core/notes';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

export function renderDrumGridEditor(host: HTMLElement, clip: SessionClip): void {
  host.innerHTML = '';
  const steps = clip.lengthBars * 16;
  if (!clip.notes) clip.notes = [];

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  for (const voice of DRUM_LANES) {
    container.appendChild(buildVoiceRow(clip, voice, steps));
  }
  host.appendChild(container);
}

function buildVoiceRow(clip: SessionClip, voice: DrumVoice, totalSteps: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `track drum-track ${voice}`;

  const label = document.createElement('div');
  label.className = 'track-label';
  label.textContent = LANE_LABELS[voice];
  row.appendChild(label);

  const cells = document.createElement('div');
  cells.className = 'cells';
  cells.style.setProperty('--steps', String(totalSteps));

  for (let i = 0; i < totalSteps; i++) {
    cells.appendChild(buildCell(clip, voice, i));
  }
  row.appendChild(cells);
  return row;
}

function buildCell(clip: SessionClip, voice: DrumVoice, stepIdx: number): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `dcell ${voice}`;
  if (stepIdx % 16 === 0 && stepIdx > 0) btn.classList.add('seg-start');
  if (stepIdx % 4  === 0)                btn.classList.add('downbeat');
  applyCellVisual(btn, findNoteAtStep(clip, voice, stepIdx));

  btn.addEventListener('click', () => {
    const existing = findNoteAtStep(clip, voice, stepIdx);
    if (!existing) {
      addHit(clip, voice, stepIdx, false);
    } else if (existing.velocity < 100) {
      existing.velocity = 115;            // off → on → accent cycle
    } else {
      removeHit(clip, voice, stepIdx);    // accent → off
    }
    applyCellVisual(btn, findNoteAtStep(clip, voice, stepIdx));
  });
  return btn;
}

function findNoteAtStep(clip: SessionClip, voice: DrumVoice, stepIdx: number): NoteEvent | null {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  return clip.notes.find((n) =>
    GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end,
  ) ?? null;
}

function addHit(clip: SessionClip, voice: DrumVoice, stepIdx: number, accent: boolean): void {
  clip.notes.push({
    midi: VOICE_MIDI[voice],
    start: stepIdx * TICKS_PER_STEP,
    duration: Math.max(1, Math.floor(TICKS_PER_STEP * 0.9)),
    velocity: accent ? 115 : 80,
  });
}

function removeHit(clip: SessionClip, voice: DrumVoice, stepIdx: number): void {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  clip.notes = clip.notes.filter((n) =>
    !(GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end),
  );
}

function applyCellVisual(btn: HTMLElement, note: NoteEvent | null): void {
  btn.classList.toggle('on',     !!note);
  btn.classList.toggle('accent', !!note && note.velocity >= 100);
}
