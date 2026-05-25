import { createPianoRoll } from '../core/pianoroll';
import { TICKS_PER_STEP, patternTicks as ptTicks, type NoteEvent } from '../core/notes';
import type { ClassicDeps, RollEntry } from './classic-state';

export function rangeForNotes(notes: NoteEvent[]): { lo: number; hi: number } {
  if (notes.length === 0) return { lo: 48, hi: 72 };
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  let pLo = Math.max(0, lo - 2);
  let pHi = Math.min(127, hi + 2);
  if (pHi - pLo < 12) {
    const center = Math.floor((pLo + pHi) / 2);
    pLo = Math.max(0, center - 6);
    pHi = Math.min(127, pLo + 12);
  }
  return { lo: pLo, hi: pHi };
}

export function autoScrollRoll(entry: RollEntry, deps: ClassicDeps) {
  if (!deps.seq.isPlaying()) return;
  const playTick = deps.seq.currentPlayPosition() * TICKS_PER_STEP;
  const playX = (playTick / ptTicks(deps.seq.length)) * entry.canvasEl.width;
  const sw = entry.scrollEl;
  const visW = sw.clientWidth;
  if (playX > sw.scrollLeft + visW * 0.7 || playX < sw.scrollLeft) {
    sw.scrollLeft = Math.max(0, playX - visW * 0.3);
  }
}

export function addPianoRollFor(
  opts: {
    parent: HTMLElement;
    labelText: string;
    height?: number;
    getNotes: () => NoteEvent[];
    setNotes: (notes: NoteEvent[]) => void;
    trailingControls?: HTMLElement;
    onLabelClick?: () => void;
    trackId?: string;
  },
  deps: ClassicDeps,
): RollEntry {
  const wrap = document.createElement('div');
  wrap.className = 'track melody-track piano-roll-wrap';
  const label = document.createElement('div');
  label.className = 'track-label';
  label.dataset.polyTarget = opts.labelText;
  if (opts.trackId) label.dataset.trackId = opts.trackId;
  const labelText = document.createElement('span');
  labelText.textContent = opts.labelText;
  label.appendChild(labelText);
  if (opts.onLabelClick) {
    label.style.cursor = 'pointer';
    label.title = 'Click to edit this synth';
    label.addEventListener('click', () => opts.onLabelClick?.());
  }
  if (opts.trailingControls) {
    label.style.display = 'flex';
    label.style.flexDirection = 'column';
    label.style.gap = '4px';
    label.style.justifyContent = 'center';
    label.appendChild(opts.trailingControls);
  }
  wrap.appendChild(label);

  const { lo, hi } = rangeForNotes(opts.getNotes());
  const rows = hi - lo + 1;
  const ROW_PX = 10;
  const height = opts.height ?? Math.min(360, Math.max(140, rows * ROW_PX));

  const PX_PER_STEP = 6;
  const canvasWidth = Math.max(1024, deps.seq.length * PX_PER_STEP);
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'piano-roll-scroll';
  const canvas = document.createElement('canvas');
  canvas.className = 'piano-roll-canvas';
  canvas.width = canvasWidth;
  canvas.height = height;
  canvas.style.height = `${height}px`;
  canvas.style.width = `${canvasWidth}px`;
  scrollWrap.appendChild(canvas);
  wrap.appendChild(scrollWrap);
  opts.parent.appendChild(wrap);

  const handle = createPianoRoll({
    canvas,
    patternTicks: ptTicks(deps.seq.length),
    getNotes: opts.getNotes,
    setNotes: opts.setNotes,
    minMidi: lo,
    maxMidi: hi,
    onChange: () => {},
    getPlayheadTick: () =>
      deps.seq.isPlaying() ? deps.seq.currentPlayPosition() * TICKS_PER_STEP : -1,
  });
  return { handle, scrollEl: scrollWrap, canvasEl: canvas };
}
