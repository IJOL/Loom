// Session view grid rendering. Pure DOM construction — no audio.
// Interactivity (click handlers) is wired by the host (main.ts) via callbacks.

import type { SessionState, SessionLane, SessionClip } from './session';
import type { LanePlayState } from './session-runtime';

export interface SessionUICallbacks {
  onClipClick: (laneId: string, clipIdx: number) => void;
  onCellClick: (laneId: string, clipIdx: number) => void;
  onStopLane:  (laneId: string) => void;
  onLaunchScene: (sceneIdx: number) => void;
  onStopAll:   () => void;
  onAddScene:  () => void;
  onAddLane: (engineId: string) => void;
  onAddClipRow: () => void;
  onEditLane:  (laneId: string) => void;
  onToggleDrumsExpanded: () => void;
  _mixerRow?: HTMLElement;
}

const COLOR_IDLE = '#2a2a2a';

export function renderSessionGrid(
  host: HTMLElement,
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
): void {
  host.innerHTML = '';
  host.classList.add('session-grid-root');

  let rowCount = state.scenes.length;
  for (const lane of state.lanes) rowCount = Math.max(rowCount, lane.clips.length);
  rowCount = Math.max(1, rowCount);

  const table = document.createElement('div');
  table.className = 'session-table';
  table.style.setProperty('--lane-count', String(state.lanes.length));

  const headerRow = document.createElement('div');
  headerRow.className = 'session-row session-row-header';
  headerRow.appendChild(spacer());
  for (const lane of state.lanes) headerRow.appendChild(laneHeader(lane, cb));
  headerRow.appendChild(scenesHeader());
  table.appendChild(headerRow);

  for (let r = 0; r < rowCount; r++) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const rowLabel = document.createElement('div');
    rowLabel.className = 'session-row-label';
    rowLabel.textContent = String(r + 1);
    row.appendChild(rowLabel);
    for (const lane of state.lanes) row.appendChild(clipCell(lane, r, laneStates, cb));
    row.appendChild(sceneLaunchCell(state.scenes[r], r, cb));
    table.appendChild(row);
  }

  const addRow = document.createElement('div');
  addRow.className = 'session-row';
  addRow.appendChild(spacer('+'));
  for (let i = 0; i < state.lanes.length; i++) addRow.appendChild(spacer());
  const addSceneBtn = document.createElement('button');
  addSceneBtn.className = 'session-add-scene';
  addSceneBtn.textContent = '+';
  addSceneBtn.title = 'Add scene';
  addSceneBtn.addEventListener('click', cb.onAddScene);
  addRow.appendChild(addSceneBtn);
  table.appendChild(addRow);

  const stopRow = document.createElement('div');
  stopRow.className = 'session-row session-row-stop';
  stopRow.appendChild(spacer());
  for (const lane of state.lanes) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'session-lane-stop';
    stopBtn.textContent = '⏹';
    stopBtn.title = `Stop ${lane.id}`;
    stopBtn.addEventListener('click', () => cb.onStopLane(lane.id));
    stopRow.appendChild(stopBtn);
  }
  const stopAllBtn = document.createElement('button');
  stopAllBtn.className = 'session-stop-all';
  stopAllBtn.textContent = '⏹ all';
  stopAllBtn.addEventListener('click', cb.onStopAll);
  stopRow.appendChild(stopAllBtn);
  table.appendChild(stopRow);

  const mixerRow = document.createElement('div');
  mixerRow.className = 'session-row session-row-mixer';
  table.appendChild(mixerRow);
  cb._mixerRow = mixerRow;

  host.appendChild(table);

  function spacer(text = '') {
    const d = document.createElement('div');
    d.className = 'session-spacer';
    d.textContent = text;
    return d;
  }

  function scenesHeader() {
    const d = document.createElement('div');
    d.className = 'session-scenes-header';
    d.textContent = 'Scenes';
    return d;
  }
}

function laneHeader(lane: SessionLane, cb: SessionUICallbacks): HTMLElement {
  const el = document.createElement('div');
  el.className = `session-lane-header lane-engine-${lane.engineId}`;
  const name = document.createElement('div');
  name.className = 'session-lane-name';
  name.textContent = lane.id.toUpperCase();
  el.appendChild(name);

  const edit = document.createElement('button');
  edit.className = 'session-lane-edit';
  edit.textContent = '⚙';
  edit.title = 'Edit instrument (switches to Classic tab)';
  edit.addEventListener('click', () => cb.onEditLane(lane.id));
  el.appendChild(edit);

  return el;
}

function clipCell(
  lane: SessionLane,
  rowIdx: number,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
): HTMLElement {
  const clip: SessionClip | null = lane.clips[rowIdx] ?? null;
  const cell = document.createElement('div');
  cell.className = 'session-cell';
  cell.dataset.laneId = lane.id;
  cell.dataset.clipIdx = String(rowIdx);

  const lp = laneStates.get(lane.id);
  const isPlaying = !!(clip && lp?.playing && lp.playing.id === clip.id);
  const isQueued  = !!(clip && lp?.queued  && lp.queued.id  === clip.id);

  if (clip) {
    cell.classList.add('session-cell-filled');
    if (isPlaying) cell.classList.add('session-cell-playing');
    if (isQueued)  cell.classList.add('session-cell-queued');
    cell.style.backgroundColor = clip.color ?? COLOR_IDLE;
    const label = document.createElement('span');
    label.className = 'session-cell-label';
    label.textContent = clip.name ?? `${rowIdx + 1}`;
    cell.appendChild(label);
    const playIcon = document.createElement('span');
    playIcon.className = 'session-cell-play';
    playIcon.textContent = '▶';
    cell.appendChild(playIcon);
    cell.addEventListener('click', () => cb.onClipClick(lane.id, rowIdx));
  } else {
    cell.classList.add('session-cell-empty');
    cell.addEventListener('click', () => cb.onCellClick(lane.id, rowIdx));
  }
  return cell;
}

function sceneLaunchCell(scene: { name?: string } | undefined, idx: number, cb: SessionUICallbacks): HTMLElement {
  const el = document.createElement('div');
  el.className = 'session-scene-cell';
  if (scene) {
    const btn = document.createElement('button');
    btn.className = 'session-scene-launch';
    btn.textContent = `▶ ${scene.name ?? idx + 1}`;
    btn.addEventListener('click', () => cb.onLaunchScene(idx));
    el.appendChild(btn);
  } else {
    el.classList.add('session-scene-cell-empty');
  }
  return el;
}

