// src/session/clip-editors/clip-editor-drum-grid.ts
// Renders an 8-row × N-step drum grid for any clip that uses NoteEvent[]
// with GM drum-mapped midis. Replaces clip-editor-drum-bus and clip-editor-
// drum-lane (which read the legacy drumSteps/drumLaneSteps fields).

import { DRUM_LANES, type DrumVoice } from '../../core/drums';
import type { SessionClip } from '../session';
import type { NoteEvent } from '../../core/notes';
import { TICKS_PER_STEP } from '../../core/notes';
import { GM_DRUM_MAP, VOICE_MIDI } from '../../engines/drum-gm-map';
import { withUndo, type HistoryDeps } from '../../save/history-wiring';
import { stepsPerBar, stepsPerBeat, DEFAULT_METER, type TimeSignature } from '../../core/meter';

const LANE_LABELS: Record<DrumVoice, string> = {
  kick: 'KICK', snare: 'SNARE', closedHat: 'CH', openHat: 'OH',
  clap: 'CLAP', cowbell: 'COWBL', tom: 'TOM', ride: 'RIDE',
};

export function renderDrumGridEditor(
  host: HTMLElement,
  clip: SessionClip,
  historyDeps?: HistoryDeps,
  meter: TimeSignature = DEFAULT_METER,
): void {
  host.innerHTML = '';
  const spb = stepsPerBar(meter);
  const spbeat = stepsPerBeat(meter);
  const steps = clip.lengthBars * spb;
  if (!clip.notes) clip.notes = [];

  const container = document.createElement('div');
  container.className = 'tracks';
  container.style.setProperty('--steps', String(steps));

  for (const voice of DRUM_LANES) {
    container.appendChild(buildVoiceRow(clip, voice, steps, spb, spbeat, historyDeps));
  }
  host.appendChild(container);
}

function buildVoiceRow(
  clip: SessionClip, voice: DrumVoice, totalSteps: number,
  spb: number, spbeat: number, historyDeps?: HistoryDeps,
): HTMLElement {
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
    cells.appendChild(buildCell(clip, voice, i, spb, spbeat, historyDeps));
  }
  row.appendChild(cells);
  return row;
}

function buildCell(
  clip: SessionClip, voice: DrumVoice, stepIdx: number,
  spb: number, spbeat: number, historyDeps?: HistoryDeps,
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `dcell ${voice}`;
  if (stepIdx % spb === 0 && stepIdx > 0) btn.classList.add('seg-start');
  if (stepIdx % spbeat === 0)             btn.classList.add('downbeat');
  refreshCellVisual(btn, clip, voice, stepIdx);

  btn.title = 'Click: off → on → accent → off   |   Shift+click: cycle roll ×1 → ×2 → ×3 → ×4';

  btn.addEventListener('click', (e) => {
    const mutate = () => {
      if (e.shiftKey) {
        cycleRoll(clip, voice, stepIdx);
      } else {
        const existing = firstNoteInStep(clip, voice, stepIdx);
        if (!existing) {
          addHit(clip, voice, stepIdx, false, 1);
        } else if (existing.velocity < 100) {
          // Promote all hits in this step to accent (preserving roll factor).
          const cur = currentRoll(clip, voice, stepIdx);
          addHit(clip, voice, stepIdx, true, cur);
        } else {
          removeAllHitsInStep(clip, voice, stepIdx);
        }
      }
      refreshCellVisual(btn, clip, voice, stepIdx);
    };
    if (historyDeps) {
      withUndo(historyDeps, mutate);
    } else {
      mutate();
    }
  });
  return btn;
}

function firstNoteInStep(clip: SessionClip, voice: DrumVoice, stepIdx: number): NoteEvent | null {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  return clip.notes.find((n) =>
    GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end,
  ) ?? null;
}

function currentRoll(clip: SessionClip, voice: DrumVoice, stepIdx: number): number {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  return clip.notes.filter((n) =>
    GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end,
  ).length;
}

function removeAllHitsInStep(clip: SessionClip, voice: DrumVoice, stepIdx: number): void {
  const start = stepIdx * TICKS_PER_STEP;
  const end   = start + TICKS_PER_STEP;
  clip.notes = clip.notes.filter((n) =>
    !(GM_DRUM_MAP[n.midi] === voice && n.start >= start && n.start < end),
  );
}

function addHit(
  clip: SessionClip, voice: DrumVoice, stepIdx: number,
  accent: boolean, roll: number,
): void {
  removeAllHitsInStep(clip, voice, stepIdx);
  const midi = VOICE_MIDI[voice];
  const div = Math.max(1, roll);
  const subDur = TICKS_PER_STEP / div;
  const vel = accent ? 115 : 80;
  for (let r = 0; r < div; r++) {
    clip.notes.push({
      midi,
      start: stepIdx * TICKS_PER_STEP + Math.floor(r * subDur),
      duration: Math.max(1, Math.floor(subDur * 0.9)),
      velocity: vel,
    });
  }
}

function cycleRoll(clip: SessionClip, voice: DrumVoice, stepIdx: number): void {
  const existing = firstNoteInStep(clip, voice, stepIdx);
  if (!existing) {
    // Shift+click on an empty cell = start with roll=2 (matches the old UX:
    // shift+click on an off cell turned it on with first roll factor).
    addHit(clip, voice, stepIdx, false, 2);
    return;
  }
  const accent = existing.velocity >= 100;
  const cur = currentRoll(clip, voice, stepIdx);
  const next = cur >= 4 ? 1 : cur + 1; // 1 → 2 → 3 → 4 → 1
  addHit(clip, voice, stepIdx, accent, next);
}

function refreshCellVisual(btn: HTMLElement, clip: SessionClip, voice: DrumVoice, stepIdx: number): void {
  const note = firstNoteInStep(clip, voice, stepIdx);
  const roll = currentRoll(clip, voice, stepIdx);
  btn.classList.toggle('on',     !!note);
  btn.classList.toggle('accent', !!note && note.velocity >= 100);
  btn.classList.toggle('roll',   roll > 1);
  btn.textContent = roll > 1 ? `×${roll}` : '';
}
