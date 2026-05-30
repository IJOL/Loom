// Session view grid rendering. Pure DOM construction — no audio.
// Interactivity (click handlers) is wired by the host (main.ts) via callbacks.

import type { SessionState, SessionLane, SessionClip, ClipSlot } from './session';
import { canDropClip } from './session';
import type { LanePlayState } from './session-runtime';

export interface SessionUICallbacks {
  /** Click on the clip body (anywhere except the ▶ icon): open the clip in
   *  the inspector and focus the editor. Does not affect transport. */
  onClipClick: (laneId: string, clipIdx: number) => void;
  /** Click on the ▶ / ⏸ icon: launch the clip (or stop it if already
   *  playing/queued). Respects launchQuantize when transport is running;
   *  starts immediately if transport is idle. */
  onClipPlayPause: (laneId: string, clipIdx: number) => void;
  onCellClick: (laneId: string, clipIdx: number) => void;
  /** An audio file was dropped onto an EMPTY clip cell of a sampler lane. The
   *  host imports it and creates a loop clip carrying clip.sample. */
  onCellDropAudio?: (laneId: string, clipIdx: number, file: File) => void;
  /** Drop a clip onto another slot. `copy=true` when the user held Ctrl
   *  during the drag (Ctrl=copy, plain drag=move). Caller is responsible
   *  for wrapping the mutation in withUndo. */
  onMoveClip: (from: ClipSlot, to: ClipSlot, copy: boolean) => void;
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
    for (const lane of state.lanes) row.appendChild(clipCell(lane, r, laneStates, cb, state));
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
  name.textContent = lane.name ?? lane.id.toUpperCase();
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
  state: SessionState,
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
    playIcon.textContent = isPlaying ? '⏸' : '▶';
    playIcon.title = isPlaying ? 'Stop' : (isQueued ? 'Queued — click to cancel' : 'Play');
    playIcon.addEventListener('pointerdown', (e) => e.stopPropagation());
    playIcon.addEventListener('pointerup',   (e) => e.stopPropagation());
    playIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.onClipPlayPause(lane.id, rowIdx);
    });
    cell.appendChild(playIcon);
    wireClipDrag(cell, { laneId: lane.id, clipIdx: rowIdx }, cb, state);
  } else {
    cell.classList.add('session-cell-empty');
    cell.addEventListener('click', () => cb.onCellClick(lane.id, rowIdx));
  }
  // Sampler lanes accept an audio file dropped onto ANY cell (empty or filled)
  // → create/replace a loop clip. Guarded to file drags so it does not interfere
  // with the internal clip-move drag (wireClipDrag) on filled cells.
  if (lane.engineId === 'sampler' && cb.onCellDropAudio) {
    const onDrop = cb.onCellDropAudio;
    const isFileDrag = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    cell.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      cell.classList.add('session-cell-drop');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('session-cell-drop'));
    cell.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      cell.classList.remove('session-cell-drop');
      const file = e.dataTransfer!.files[0];
      if (file) onDrop(lane.id, rowIdx, file);
    });
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

// ── Clip drag ──────────────────────────────────────────────────────────────

const DRAG_THRESHOLD_PX = 4;

interface DragState {
  source: ClipSlot;
  startX: number;
  startY: number;
  ghost: HTMLElement | null;
  hoverCell: HTMLElement | null;
  active: boolean;            // true once movement past threshold
  cancelled: boolean;
  pointerId: number;
  onKey: (e: KeyboardEvent) => void;
}

let activeDrag: DragState | null = null;

function wireClipDrag(cell: HTMLElement, source: ClipSlot, cb: SessionUICallbacks, state: SessionState): void {
  cell.classList.add('session-cell-draggable');

  cell.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (activeDrag) return;
    activeDrag = {
      source,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      hoverCell: null,
      active: false,
      cancelled: false,
      pointerId: e.pointerId,
      onKey: () => {},
    };
  });

  cell.addEventListener('pointermove', (e) => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;
    const dx = e.clientX - activeDrag.startX;
    const dy = e.clientY - activeDrag.startY;
    if (!activeDrag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      activeDrag.active = true;
      cell.setPointerCapture(e.pointerId);
      cell.classList.add('drop-source');
      activeDrag.ghost = buildGhost(cell);
      document.body.appendChild(activeDrag.ghost);
      document.body.classList.toggle('drag-copy', e.ctrlKey);
      activeDrag.onKey = (k) => {
        if (k.key === 'Escape') cancelDrag();
        else if (k.key === 'Control') {
          document.body.classList.toggle('drag-copy', k.type === 'keydown');
        }
      };
      document.addEventListener('keydown', activeDrag.onKey);
      document.addEventListener('keyup', activeDrag.onKey);
    }
    positionGhost(activeDrag.ghost!, e.clientX, e.clientY);
    document.body.classList.toggle('drag-copy', e.ctrlKey);
    updateHover(e.clientX, e.clientY, activeDrag.source, state);
  });

  const finish = (e: PointerEvent) => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== e.pointerId) return;
    if (!activeDrag.active) {
      // No drag happened — treat as a click (preserves the cell-body click semantics).
      cb.onClipClick(source.laneId, source.clipIdx);
      activeDrag = null;
      return;
    }
    const target = activeDrag.hoverCell;
    const valid = target?.classList.contains('drop-valid') ?? false;
    if (valid && target && !activeDrag.cancelled) {
      const to: ClipSlot = {
        laneId:  target.dataset.laneId!,
        clipIdx: Number(target.dataset.clipIdx),
      };
      cb.onMoveClip(activeDrag.source, to, e.ctrlKey);
    }
    teardownDrag();
  };
  cell.addEventListener('pointerup', finish);
  cell.addEventListener('pointercancel', finish);
}

function cancelDrag(): void {
  if (!activeDrag) return;
  activeDrag.cancelled = true;
  teardownDrag();
}

function teardownDrag(): void {
  if (!activeDrag) return;
  document.removeEventListener('keydown', activeDrag.onKey);
  document.removeEventListener('keyup', activeDrag.onKey);
  if (activeDrag.ghost) activeDrag.ghost.remove();
  document.querySelectorAll('.session-cell.drop-valid, .session-cell.drop-invalid')
    .forEach((el) => el.classList.remove('drop-valid', 'drop-invalid'));
  document.querySelectorAll('.session-cell.drop-source')
    .forEach((el) => el.classList.remove('drop-source'));
  document.body.classList.remove('drag-copy');
  activeDrag = null;
}

function buildGhost(cell: HTMLElement): HTMLElement {
  const g = cell.cloneNode(true) as HTMLElement;
  g.className = 'session-ghost';
  g.style.position = 'fixed';
  g.style.pointerEvents = 'none';
  g.style.width  = `${cell.offsetWidth}px`;
  g.style.height = `${cell.offsetHeight}px`;
  g.style.zIndex = '9999';
  return g;
}

function positionGhost(g: HTMLElement, x: number, y: number): void {
  g.style.left = `${x - g.offsetWidth / 2}px`;
  g.style.top  = `${y - g.offsetHeight / 2}px`;
}

function updateHover(x: number, y: number, source: ClipSlot, state: SessionState): void {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest('.session-cell') as HTMLElement | null;
  if (activeDrag!.hoverCell && activeDrag!.hoverCell !== cell) {
    activeDrag!.hoverCell.classList.remove('drop-valid', 'drop-invalid');
  }
  activeDrag!.hoverCell = cell;
  if (!cell) return;
  const to: ClipSlot = {
    laneId:  cell.dataset.laneId ?? '',
    clipIdx: Number(cell.dataset.clipIdx ?? -1),
  };
  if (!to.laneId || to.clipIdx < 0) return;
  const ok = canDropClip(state, source, to);
  cell.classList.toggle('drop-valid', ok);
  cell.classList.toggle('drop-invalid', !ok);
}

