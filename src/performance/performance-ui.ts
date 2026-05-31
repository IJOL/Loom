import type { ArrangementState } from './performance';
import { stepsPerSec } from './performance';
import { AUTOMATION_SUB_RES } from '../core/pattern';

const PX_PER_BAR = 80;

function makeLabel(text: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `perf-label ${cls}`;
  el.textContent = text;
  return el;
}

function makeRuler(durationSec: number, bpm: number): HTMLElement {
  const barSec = (60 / bpm) * 4;
  const bars = Math.ceil(durationSec / barSec);
  const ruler = document.createElement('div');
  ruler.className = 'perf-row perf-ruler';
  ruler.appendChild(makeLabel('bars'));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${bars * PX_PER_BAR}px`;
  for (let b = 0; b < bars; b++) {
    const m = document.createElement('span');
    m.className = 'perf-bar-mark';
    m.style.left = `${b * PX_PER_BAR}px`;
    m.textContent = String(b + 1);
    track.appendChild(m);
  }
  ruler.appendChild(track);
  return ruler;
}

function makeClipBand(
  laneRec: import('./performance').ArrangementLaneRec,
  durationSec: number,
  bpm: number,
  resolveClipColor: (clipId: string) => string,
  resolveClipName:  (clipId: string) => string,
): HTMLElement {
  const barSec = (60 / bpm) * 4;
  const totalBars = Math.ceil(durationSec / barSec);

  const row = document.createElement('div');
  row.className = 'perf-row';
  row.appendChild(makeLabel(laneRec.laneId));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${totalBars * PX_PER_BAR}px`;
  const band = document.createElement('div');
  band.className = 'perf-clip-band';

  for (const ev of laneRec.clipEvents) {
    const x = (ev.atSec / barSec) * PX_PER_BAR;
    const w = (Math.min(ev.untilSec, durationSec) - ev.atSec) / barSec * PX_PER_BAR;
    const el = document.createElement('div');
    el.className = 'perf-clip';
    el.style.left  = `${x}px`;
    el.style.width = `${Math.max(8, w)}px`;
    const color = resolveClipColor(ev.clipId);
    if (color) el.style.background = color;
    else el.classList.add('missing');
    el.textContent = resolveClipName(ev.clipId);
    band.appendChild(el);
  }
  track.appendChild(band);
  row.appendChild(track);
  return row;
}

function makeAutomationBand(
  curve: import('./performance').AutomationCurve,
  durationSec: number,
  bpm: number,
): HTMLElement {
  const totalBars = Math.ceil(durationSec / ((60 / bpm) * 4));
  const row = document.createElement('div');
  row.className = 'perf-row';
  row.appendChild(makeLabel(curve.paramId, 'sub'));
  const track = document.createElement('div');
  track.className = 'perf-track';
  const width = totalBars * PX_PER_BAR;
  track.style.width = `${width}px`;

  const canvas = document.createElement('canvas');
  canvas.className = 'perf-auto-canvas';
  canvas.width  = width;
  canvas.height = 32;
  const cx = canvas.getContext('2d')!;
  cx.strokeStyle = '#f4c8a8';
  cx.lineWidth = 1.5;
  cx.beginPath();
  for (let x = 0; x < width; x++) {
    const t = (x / width) * durationSec;
    const subIdx = Math.floor(t * stepsPerSec(bpm) * AUTOMATION_SUB_RES);
    const v = curve.values[Math.min(subIdx, curve.values.length - 1)] ?? 0.5;
    const y = (1 - v) * (canvas.height - 4) + 2;
    if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
  }
  cx.stroke();
  track.appendChild(canvas);
  row.appendChild(track);
  return row;
}

export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
  resolveClipColor: (clipId: string) => string;
  resolveClipName:  (clipId: string) => string;
}

export function renderPerformanceView(
  host: HTMLElement,
  state: ArrangementState,
  cb: PerfUICallbacks,
): void {
  host.innerHTML = '';
  host.classList.add('performance-view');

  if (state.durationSec === 0) {
    const empty = document.createElement('div');
    empty.className = 'perf-empty';
    empty.innerHTML = `
      <p>Sin grabación.</p>
      <p>Arma <b>REC</b>, vuelve a Session, lanza clips y mueve knobs.</p>
      <button class="perf-empty-back">Volver a Session</button>
    `;
    empty.querySelector('.perf-empty-back')!.addEventListener('click', cb.onGoToSession);
    host.appendChild(empty);
    return;
  }

  host.appendChild(makeRuler(state.durationSec, state.bpm));
  for (const lane of state.lanes) {
    host.appendChild(makeClipBand(lane, state.durationSec, state.bpm,
      cb.resolveClipColor, cb.resolveClipName));
    for (const curve of lane.automation) {
      host.appendChild(makeAutomationBand(curve, state.durationSec, state.bpm));
    }
  }
  if (state.globalAutomation.length > 0) {
    const masterLabel = document.createElement('div');
    masterLabel.className = 'perf-row perf-master-header';
    masterLabel.appendChild(makeLabel('MASTER'));
    masterLabel.appendChild(document.createElement('div'));
    host.appendChild(masterLabel);
    for (const curve of state.globalAutomation) {
      host.appendChild(makeAutomationBand(curve, state.durationSec, state.bpm));
    }
  }

  const playhead = document.createElement('div');
  playhead.className = 'perf-playhead';
  playhead.id = 'perf-playhead';
  host.appendChild(playhead);
}
