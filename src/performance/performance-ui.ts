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
  cb: PerfUICallbacks,
): HTMLElement {
  const barSec = barSecOf(bpm);
  const totalBars = Math.ceil(durationSec / barSec);
  const secPerPx = barSec / pxPerBar; // inverse of the draw scale

  const row = document.createElement('div');
  row.className = 'perf-row';
  // Lane header: name + (optional) mute/solo + VU, mirroring the session mixer.
  const label = document.createElement('div');
  label.className = 'perf-label';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'perf-lane-name';
  nameSpan.textContent = laneRec.laneId;
  label.appendChild(nameSpan);
  const ctrls = cb.buildLaneHeader?.(laneRec.laneId);
  if (ctrls) label.appendChild(ctrls);
  row.appendChild(label);
  const track = document.createElement('div');
  track.className = 'perf-track';
  track.style.width = `${totalBars * pxPerBar}px`;
  const band = document.createElement('div');
  band.className = 'perf-clip-band';

  laneRec.clipEvents.forEach((ev, i) => {
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

    // resize handles
    const hL = document.createElement('span'); hL.className = 'perf-clip-handle l';
    const hR = document.createElement('span'); hR.className = 'perf-clip-handle r';
    // delete button
    const del = document.createElement('button'); del.className = 'perf-clip-del'; del.textContent = '×';
    del.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    del.addEventListener('click', (e) => { e.stopPropagation(); cb.onDeleteBand(laneRec.laneId, i); });
    // body drag = move
    el.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const baseAt = ev.atSec;
      const move = (e: PointerEvent) => {
        const dxSec = (e.clientX - startX) * secPerPx;
        el.style.left = `${((baseAt + dxSec) / barSec) * pxPerBar}px`;
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const dxSec = (e.clientX - startX) * secPerPx;
        cb.onMoveBand(laneRec.laneId, i, baseAt + dxSec);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    const resize = (edge: 'start' | 'end') => (down: PointerEvent) => {
      down.preventDefault(); down.stopPropagation();
      const move = (e: PointerEvent) => {
        const rect = track.getBoundingClientRect();
        const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
        if (edge === 'start') el.style.left = `${(sec / barSec) * pxPerBar}px`;
        else el.style.width = `${Math.max(8, (sec - ev.atSec) / barSec * pxPerBar)}px`;
      };
      const up = (e: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const rect = track.getBoundingClientRect();
        const sec = ((e.clientX - rect.left) / pxPerBar) * barSec;
        cb.onResizeBand(laneRec.laneId, i, edge, sec);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    hL.addEventListener('pointerdown', resize('start'));
    hR.addEventListener('pointerdown', resize('end'));
    el.append(hL, hR, del);

    band.appendChild(el);
  });
  track.appendChild(band);
  // Loop A–B span across this lane: a translucent column with A/B edges. Every
  // lane draws it at the same x (same pxPerBar), so it reads as one continuous
  // marker down the whole arrangement, not just a brace in the ruler.
  if (cb.loopEnabled && cb.loopEndBar > cb.loopStartBar) {
    const span = document.createElement('div');
    span.className = 'perf-loop-span';
    span.style.left = `${cb.loopStartBar * pxPerBar}px`;
    span.style.width = `${(cb.loopEndBar - cb.loopStartBar) * pxPerBar}px`;
    track.appendChild(span);
  }
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
  onMoveBand: (laneId: string, index: number, newAtSec: number) => void;
  onResizeBand: (laneId: string, index: number, edge: 'start' | 'end', newSec: number) => void;
  onDeleteBand: (laneId: string, index: number) => void;
  /** Optional: build the compact master strip (VU + fader) for the toolbar.
   *  Returns null when no audio graph is wired (test fixtures). */
  buildMaster?: () => HTMLElement | null;
  /** Optional: build per-lane header controls (mute/solo + VU) for a lane row.
   *  Returns null when the lane isn't allocated (no strip). */
  buildLaneHeader?: (laneId: string) => HTMLElement | null;
}

function makeToolbar(state: ArrangementState, cb: PerfUICallbacks): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'perf-toolbar';

  const lenWrap = document.createElement('label');
  lenWrap.className = 'perf-length';
  lenWrap.append('Length: ');
  const len = document.createElement('input');
  // Show the length the timeline ACTUALLY has, not the raw `lengthBars`.
  // `lengthBars` is the user's explicit MINIMUM (0 = auto//derive-from-content),
  // so the field read "0 bars" over 8 bars of copied content. Typing still sets an
  // explicit minimum; it just can't shrink the field below the real content.
  len.type = 'number'; len.min = '1';
  len.value = String(Math.ceil(effectiveDurationSec(state) / barSecOf(state.bpm)));
  len.className = 'perf-length-input';
  len.addEventListener('change', () => cb.onSetLengthBars(parseInt(len.value, 10) || 0));
  lenWrap.append(len, ' bars');

  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '16'; zoom.max = '400'; zoom.step = '1';
  zoom.value = String(cb.pxPerBar);
  zoom.className = 'perf-zoom';
  // 'change' (fires on release), NOT 'input': re-rendering on every drag tick
  // rebuilt the whole view — including this slider — under the pointer, breaking
  // the drag and flooding the main thread. One re-render when the user lets go.
  zoom.addEventListener('change', () => cb.onZoom(parseInt(zoom.value, 10)));

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

  // Editable A/B bar fields — dragging the brace on a long song is a pain. Typing
  // a value sets AND enables the loop (the button still toggles it off).
  const loopFields = document.createElement('span');
  loopFields.className = 'perf-loop-fields';
  const mkLoopInput = (val: number, title: string) => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.className = 'perf-loop-input';
    inp.value = String(val); inp.title = title;
    return inp;
  };
  const aIn = mkLoopInput(cb.loopStartBar, 'Loop start (bar)');
  const bIn = mkLoopInput(cb.loopEndBar, 'Loop end (bar)');
  const commitLoop = () => {
    const a = Math.max(0, Math.floor(parseFloat(aIn.value) || 0));
    const b = Math.max(a + 1, Math.floor(parseFloat(bIn.value) || a + 1));
    cb.onSetLoop(true, a, b);
  };
  aIn.addEventListener('change', commitLoop);
  bIn.addEventListener('change', commitLoop);
  loopFields.append('A', aIn, 'B', bIn);

  bar.append(lenWrap, ' · Zoom ', zoom, ' · ', brushBar, ' · ', loopBtn, loopFields, ' · ', readout);

  // Compact master (VU + fader) pushed to the right — the full master strip is
  // hidden with the session root in Performance mode (see buildMiniMaster).
  if (cb.buildMaster) {
    const master = cb.buildMaster();
    if (master) bar.appendChild(master);
  }
  return bar;
}

type HostWithWheel = HTMLElement & { __wheelZoom?: EventListener };

export function attachWheelZoom(host: HTMLElement, cb: PerfUICallbacks): void {
  // `host` (#performance-view-root) PERSISTS across re-renders: host.innerHTML=''
  // clears its children but NOT the host's own listeners. renderPerformanceView
  // calls this every render, so wheel handlers stacked — each wheel fired ALL of
  // them → N onZoom → N re-renders → +N handlers: an exponential blow-up that
  // froze the tab. Remove the previous handler before adding the current one.
  const h = host as HostWithWheel;
  if (h.__wheelZoom) host.removeEventListener('wheel', h.__wheelZoom);
  const handler: EventListener = (e) => {
    const we = e as WheelEvent;
    if (!we.ctrlKey) return;
    we.preventDefault();
    const factor = we.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(16, Math.min(400, cb.pxPerBar * factor));
    cb.onZoom(Math.round(next));
  };
  host.addEventListener('wheel', handler, { passive: false });
  h.__wheelZoom = handler;
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
      <p>No recording. Set a <b>length</b> above to start drawing automation,</p>
      <p>or arm <b>REC</b>, go back to Session, launch clips and move knobs.</p>
      <button class="perf-empty-back">Back to Session</button>`;
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
    host.appendChild(makeClipBand(lane, dur, state.bpm, cb.pxPerBar, cb.resolveClipColor, cb.resolveClipName, cb));
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
