import type { ArrangementState } from './performance';
import type { KnobHandle } from '../core/knob';
import type { AutoBrush, PainterDeps } from '../automation/automation-painter';
import { effectiveDurationSec } from './arrangement-ops';
import { buildAutomationHeader, buildAutomationLane, type PerfAutoDeps } from './performance-automation-ui';
import { pxToBar, clampBarRegion } from './arrangement-brace';

function makeLabel(text: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `perf-label ${cls}`;
  el.textContent = text;
  return el;
}

function barSecOf(bpm: number): number { return (60 / bpm) * 4; }

function makeRuler(durationSec: number, bpm: number, pxPerBar: number, cb: PerfUICallbacks): HTMLElement {
  const barSec = barSecOf(bpm);
  const bars = Math.ceil(durationSec / barSec);
  const ruler = document.createElement('div');
  ruler.className = 'perf-row perf-ruler';
  ruler.appendChild(makeLabel('bars'));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${bars * pxPerBar}px`;
  for (let b = 0; b < bars; b++) {
    const m = document.createElement('span');
    m.className = 'perf-bar-mark';
    m.style.left = `${b * pxPerBar}px`;
    m.textContent = String(b + 1);
    track.appendChild(m);
  }
  if (cb.loopEnabled) {
    const brace = document.createElement('div');
    brace.className = 'perf-loop-brace';
    brace.style.left = `${cb.loopStartBar * pxPerBar}px`;
    brace.style.width = `${(cb.loopEndBar - cb.loopStartBar) * pxPerBar}px`;
    const hL = document.createElement('span'); hL.className = 'perf-loop-handle l';
    const hR = document.createElement('span'); hR.className = 'perf-loop-handle r';
    brace.append(hL, hR);
    // Drag updates the brace imperatively against a rect captured at pointerdown,
    // committing once on pointerup. Calling onSetLoop mid-drag would re-render the
    // ruler (host.innerHTML = '') and detach the very track we measure, so the
    // drag would jump. Mirrors the clip-loop brace (core/clip-loop-brace.ts).
    const drag = (which: 'l' | 'r') => (down: PointerEvent) => {
      down.preventDefault();
      const rect = track.getBoundingClientRect();
      let region = { start: cb.loopStartBar, end: cb.loopEndBar };
      const move = (e: PointerEvent) => {
        const b = pxToBar(e.clientX - rect.left, pxPerBar);
        region = which === 'l' ? clampBarRegion(b, cb.loopEndBar, bars) : clampBarRegion(cb.loopStartBar, b, bars);
        brace.style.left = `${region.start * pxPerBar}px`;
        brace.style.width = `${(region.end - region.start) * pxPerBar}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        cb.onSetLoop(true, region.start, region.end);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    hL.addEventListener('pointerdown', drag('l')); hR.addEventListener('pointerdown', drag('r'));
    track.appendChild(brace);
  }
  ruler.appendChild(track);
  return ruler;
}

function makeClipBand(
  laneRec: import('./performance').ArrangementLaneRec,
  durationSec: number,
  bpm: number,
  pxPerBar: number,
  resolveClipColor: (clipId: string) => string,
  resolveClipName: (clipId: string) => string,
): HTMLElement {
  const barSec = barSecOf(bpm);
  const totalBars = Math.ceil(durationSec / barSec);

  const row = document.createElement('div');
  row.className = 'perf-row';
  row.appendChild(makeLabel(laneRec.laneId));
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${totalBars * pxPerBar}px`;
  const band = document.createElement('div');
  band.className = 'perf-clip-band';

  for (const ev of laneRec.clipEvents) {
    const x = (ev.atSec / barSec) * pxPerBar;
    const w = (Math.min(ev.untilSec, durationSec) - ev.atSec) / barSec * pxPerBar;
    const el = document.createElement('div');
    el.className = 'perf-clip';
    el.style.left = `${x}px`;
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

export interface PerfUICallbacks {
  onPlay: () => void;
  onStop: () => void;
  onGoToSession: () => void;
  resolveClipColor: (clipId: string) => string;
  resolveClipName: (clipId: string) => string;
  registry: Map<string, KnobHandle>;
  laneIds: readonly string[];
  pxPerBar: number;
  getBrush: () => AutoBrush;
  setBrush: (b: AutoBrush) => void;
  painterDeps: PainterDeps;
  onSetLengthBars: (bars: number) => void;
  onZoom: (pxPerBar: number) => void;
  onAddCurve: (paramId: string) => void;
  onRemoveCurve: (paramId: string) => void;
  onEdited: () => void;
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  onSetLoop: (enabled: boolean, startBar: number, endBar: number) => void;
}

function makeToolbar(state: ArrangementState, cb: PerfUICallbacks): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'perf-toolbar';

  const lenWrap = document.createElement('label');
  lenWrap.className = 'perf-length';
  lenWrap.append('Length: ');
  const len = document.createElement('input');
  len.type = 'number'; len.min = '1'; len.value = String(state.lengthBars || 0);
  len.className = 'perf-length-input';
  len.addEventListener('change', () => cb.onSetLengthBars(parseInt(len.value, 10) || 0));
  lenWrap.append(len, ' bars');

  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '16'; zoom.max = '400'; zoom.step = '1';
  zoom.value = String(cb.pxPerBar);
  zoom.className = 'perf-zoom';
  zoom.addEventListener('input', () => cb.onZoom(parseInt(zoom.value, 10)));

  const brushBar = document.createElement('span');
  brushBar.className = 'perf-brush-bar';
  const mkBrush = (b: AutoBrush, label: string) => {
    const btn = document.createElement('button');
    btn.className = 'rnd' + (cb.getBrush() === b ? ' primary' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      cb.setBrush(b);
      brushBar.querySelectorAll('button').forEach((x) => x.classList.remove('primary'));
      btn.classList.add('primary');
    });
    return btn;
  };
  brushBar.append(mkBrush('line', 'Line'), mkBrush('flat', 'Flat'));

  const bars = Math.ceil(effectiveDurationSec(state) / barSecOf(state.bpm));
  const readout = document.createElement('span');
  readout.className = 'perf-readout';
  readout.textContent = `${bars} bars · ${state.bpm} BPM`;

  const loopBtn = document.createElement('button');
  loopBtn.className = 'rnd perf-loop-toggle' + (cb.loopEnabled ? ' primary' : '');
  loopBtn.textContent = 'Loop A–B';
  loopBtn.addEventListener('click', () => cb.onSetLoop(!cb.loopEnabled, cb.loopStartBar, cb.loopEndBar));

  bar.append(lenWrap, ' · Zoom ', zoom, ' · ', brushBar, ' · ', loopBtn, ' · ', readout);
  return bar;
}

function attachWheelZoom(host: HTMLElement, cb: PerfUICallbacks): void {
  host.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(16, Math.min(400, cb.pxPerBar * factor));
    cb.onZoom(Math.round(next));
  }, { passive: false });
}

export function renderPerformanceView(host: HTMLElement, state: ArrangementState, cb: PerfUICallbacks): void {
  host.innerHTML = '';
  host.classList.add('performance-view');

  host.appendChild(makeToolbar(state, cb));
  const dur = effectiveDurationSec(state);

  if (dur === 0) {
    const empty = document.createElement('div');
    empty.className = 'perf-empty';
    empty.innerHTML = `
      <p>Sin grabación. Fija una <b>longitud</b> arriba para empezar a dibujar automatización,</p>
      <p>o arma <b>REC</b>, vuelve a Session, lanza clips y mueve knobs.</p>
      <button class="perf-empty-back">Volver a Session</button>`;
    empty.querySelector('.perf-empty-back')!.addEventListener('click', cb.onGoToSession);
    host.appendChild(empty);
    return;
  }

  attachWheelZoom(host, cb);

  const totalBars = Math.ceil(dur / barSecOf(state.bpm));
  const autoDeps: PerfAutoDeps = {
    registry: cb.registry,
    laneWidthPx: totalBars * cb.pxPerBar,
    getBrush: cb.getBrush,
    painterDeps: cb.painterDeps,
    onAdd: cb.onAddCurve,
    onRemove: cb.onRemoveCurve,
    onEdited: cb.onEdited,
  };

  host.appendChild(makeRuler(dur, state.bpm, cb.pxPerBar, cb));
  // Single "+ Automation" control; the chosen param's prefix routes it into a
  // lane section or the master section (arrangement-ops.routeParamId).
  host.appendChild(buildAutomationHeader(autoDeps));

  for (const lane of state.lanes) {
    host.appendChild(makeClipBand(lane, dur, state.bpm, cb.pxPerBar, cb.resolveClipColor, cb.resolveClipName));
    for (const curve of lane.automation) host.appendChild(buildAutomationLane(curve, autoDeps));
  }

  if (state.globalAutomation.length > 0) {
    const masterLabel = document.createElement('div');
    masterLabel.className = 'perf-row perf-master-header';
    masterLabel.appendChild(makeLabel('MASTER'));
    host.appendChild(masterLabel);
    for (const curve of state.globalAutomation) host.appendChild(buildAutomationLane(curve, autoDeps));
  }

  const playhead = document.createElement('div');
  playhead.className = 'perf-playhead';
  playhead.id = 'perf-playhead';
  host.appendChild(playhead);
}
