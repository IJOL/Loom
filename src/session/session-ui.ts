// Session view grid rendering. Pure DOM construction — no audio.
// Interactivity (click handlers) is wired by the host (main.ts) via callbacks.

import type { SessionState, SessionLane, SessionClip, ClipSlot } from './session';
import { CLIP_COLOR_PALETTE } from './session';
import type { LanePlayState } from './session-runtime';
import { openContextMenu } from '../core/context-menu';
import { beginInlineRename } from './inline-rename';
import { wireClipDrag } from './session-clip-drag';
import { listEngines } from '../engines/registry';
import type { SessionUICallbacks } from './session-ui-types';
export type { SessionUICallbacks } from './session-ui-types';

// Fallback fill for a filled clip that carries no `clip.color`. Filled cells force
// dark text (`color: #111`, see _session-grid.scss) so it reads against the light
// pastel palette — so this fallback MUST also be light, or the label goes
// black-on-dark-grey and unreadable.
const COLOR_IDLE = '#c9c9c9';

// Single-vs-double click disambiguation for scene buttons, keyed by ROW INDEX.
// A scene launch re-renders the whole grid (renderWithMixer), replacing the
// button — so the native `dblclick` event is unreliable here: the two clicks of
// a double land on different element instances. Tracking the last click time by
// index instead lets the second click (which lands on the freshly-rendered
// button) recognise the double and open the rename on the live element. This
// keeps launch INSTANT on a single click while making double-click rename work.
const sceneLastClick = new Map<number, number>();
const SCENE_DBLCLICK_MS = 350;
// Single-vs-double click disambiguation for lane headers, keyed by lane id —
// same rationale as sceneLastClick (a select re-renders the header, so the
// second click of a rename double lands on a fresh element).
const laneLastClick = new Map<string, number>();
const LANE_DBLCLICK_MS = 350;
/** Test-only: clear the click-timing state so module state can't leak
 *  between tests (clicks in different tests would otherwise read as a double). */
export function _resetSceneClickStateForTesting(): void { sceneLastClick.clear(); laneLastClick.clear(); }

/** Options for the active-lane marking + collapse state the host passes in. */
export interface RenderGridOpts { activeEditLane?: string | null; synthCollapsed?: boolean }

/** A small ✕ delete button. Stops pointer/click propagation so it never triggers
 *  the cell's clip drag nor the scene/lane click underneath it (mirrors the play
 *  icon's stopPropagation). */
function deleteCross(title: string, onDelete: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'session-del-cross';
  b.title = title;
  b.textContent = '✕';
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('pointerup', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
  return b;
}

export function renderSessionGrid(
  host: HTMLElement,
  state: SessionState,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  openClip?: ClipSlot,
  opts: RenderGridOpts = {},
): void {
  host.innerHTML = '';
  host.classList.add('session-grid-root');

  let rowCount = state.scenes.length;
  for (const lane of state.lanes) rowCount = Math.max(rowCount, lane.clips.length);
  rowCount = Math.max(1, rowCount);

  const table = document.createElement('div');
  table.className = 'session-table';
  // The full row-grid column template. Stored as a complete value (not a bare
  // repeat() count) because CSS `repeat(0, 120px)` is INVALID and collapses the
  // whole template to one auto column — a deformed grid when the session has no
  // lanes. With zero lanes we emit just the label + scenes/master columns.
  const n = state.lanes.length;
  table.style.setProperty(
    '--session-cols',
    n > 0 ? `24px repeat(${n}, 120px) 140px` : '24px 140px',
  );

  const headerRow = document.createElement('div');
  headerRow.className = 'session-row session-row-header';
  headerRow.appendChild(spacer());
  for (const lane of state.lanes) headerRow.appendChild(laneHeader(lane, cb, lane.id === opts.activeEditLane, !!opts.synthCollapsed));
  // The "+ add lane" control lives at the END of the scenes-header cell (see
  // scenesHeader) — NOT as its own header child. As a separate child it was an
  // (n+3)th element in an (n+2)-column grid, so it consumed the scenes column
  // and auto-flowed the scenes header onto a wrapped second row.
  headerRow.appendChild(scenesHeader());
  table.appendChild(headerRow);

  for (let r = 0; r < rowCount; r++) {
    const row = document.createElement('div');
    row.className = 'session-row';
    if (openClip && openClip.clipIdx === r) row.classList.add('session-row-editing');
    const rowLabel = document.createElement('div');
    rowLabel.className = 'session-row-label';
    rowLabel.textContent = String(r + 1);
    row.appendChild(rowLabel);
    for (const lane of state.lanes) row.appendChild(clipCell(lane, r, laneStates, cb, state, openClip, lane.id === opts.activeEditLane));
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

  function addLaneHeader(cb: SessionUICallbacks) {
    const wrap = document.createElement('div');
    wrap.className = 'session-lane-add-wrap';
    const btn = document.createElement('button');
    btn.className = 'session-lane-add';
    btn.textContent = '+';
    btn.title = 'Add a lane';
    const menu = document.createElement('div');
    menu.className = 'session-lane-add-menu';
    menu.hidden = true;

    const addItem = (label: string, onClick: () => void, engineId?: string) => {
      const it = document.createElement('button');
      it.className = 'session-add-item';
      if (engineId) it.dataset.engineId = engineId;
      it.textContent = label;
      it.addEventListener('click', () => { menu.hidden = true; onClick(); });
      menu.appendChild(it);
    };
    for (const engine of listEngines('polyhost')) {
      if (engine.id === 'audio') continue; // audio is added via the explicit entry below
      addItem(engine.name, () => cb.onAddLane(engine.id), engine.id);
    }
    if (cb.onAddAudioChannel) addItem('Audio channel', () => cb.onAddAudioChannel!());

    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    wrap.append(btn, menu);
    return wrap;
  }

  function scenesHeader() {
    const d = document.createElement('div');
    d.className = 'session-scenes-header';
    const label = document.createElement('span');
    label.textContent = 'Scenes';
    d.appendChild(label);
    const cap = document.createElement('button');
    cap.className = 'session-capture-scene';
    cap.textContent = '⊙';
    cap.title = 'New scene from currently playing clips (Ctrl+I)';
    cap.addEventListener('click', cb.onCaptureScene);
    d.appendChild(cap);
    // "+ add lane" sits at the end of this same cell (last grid column), so it
    // shares the scenes column instead of consuming its own — no wrapped row.
    d.appendChild(addLaneHeader(cb));
    return d;
  }
}

function laneHeader(lane: SessionLane, cb: SessionUICallbacks, isActive: boolean, synthCollapsed: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `session-lane-header lane-engine-${lane.engineId}`;
  if (isActive) el.classList.add('session-lane-header-active');
  el.dataset.laneId = lane.id;
  el.title = 'Click to edit this instrument · double-click the name to rename';
  el.appendChild(deleteCross('Delete track', () => cb.onDeleteLane(lane.id)));

  const name = document.createElement('div');
  name.className = isActive ? 'session-lane-name session-lane-name-active' : 'session-lane-name';
  name.textContent = lane.name ?? lane.id.toUpperCase();
  el.appendChild(name);

  // The active header carries a chevron that collapses / reopens the synth
  // editor. Only the chevron collapses — the header click never does.
  if (isActive) {
    const chevron = document.createElement('button');
    chevron.className = 'session-lane-collapse';
    chevron.textContent = synthCollapsed ? '▸' : '▾';
    chevron.title = synthCollapsed ? 'Show the instrument editor' : 'Collapse the instrument editor';
    chevron.addEventListener('pointerdown', (e) => e.stopPropagation());
    chevron.addEventListener('pointerup', (e) => e.stopPropagation());
    chevron.addEventListener('click', (e) => { e.stopPropagation(); cb.onToggleSynthEditor?.(); });
    el.appendChild(chevron);
  }

  // Whole header selects the lane (opens its editor). A quick second click
  // renames instead — index-timed like the scene launch, because the select
  // re-renders the grid and the rename must land on the fresh element.
  el.addEventListener('click', () => {
    const now = performance.now();
    const prev = laneLastClick.get(lane.id);
    if (prev !== undefined && now - prev < LANE_DBLCLICK_MS) {
      laneLastClick.delete(lane.id);
      beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), { commit: (v) => cb.onRenameLane?.(lane.id, v) });
    } else {
      laneLastClick.set(lane.id, now);
      cb.onEditLane(lane.id);
    }
  });

  el.addEventListener('contextmenu', (e) =>
    openContextMenu(e, [
      { label: 'Rename track', onSelect: () => beginInlineRename(name, lane.name ?? lane.id.toUpperCase(), { commit: (v) => cb.onRenameLane?.(lane.id, v) }) },
      { label: 'Edit instrument', onSelect: () => cb.onEditLane(lane.id) },
      { label: 'Duplicate track', onSelect: () => cb.onDuplicateLane(lane.id) },
      { label: 'Stop track', onSelect: () => cb.onStopLane(lane.id) },
      { label: 'Delete track', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteLane(lane.id) },
    ]),
  );

  return el;
}

function clipCell(
  lane: SessionLane,
  rowIdx: number,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  state: SessionState,
  openClip?: ClipSlot,
  colActive = false,
): HTMLElement {
  const clip: SessionClip | null = lane.clips[rowIdx] ?? null;
  const cell = document.createElement('div');
  cell.className = 'session-cell';
  if (colActive) cell.classList.add('session-cell-col-active');
  cell.dataset.laneId = lane.id;
  cell.dataset.clipIdx = String(rowIdx);

  const lp = laneStates.get(lane.id);
  const isPlaying = !!(clip && lp?.playing && lp.playing.id === clip.id);
  const isQueued  = !!(clip && lp?.queued  && lp.queued.id  === clip.id);
  const isStopping = !!(clip && lp?.playing && lp.playing.id === clip.id && lp.queuedStop != null);

  if (clip) {
    cell.classList.add('session-cell-filled');
    if (openClip && openClip.laneId === lane.id && openClip.clipIdx === rowIdx) {
      cell.classList.add('session-cell-editing');
    }
    if (isPlaying) cell.classList.add('session-cell-playing');
    if (isQueued)  cell.classList.add('session-cell-queued');
    if (isStopping) cell.classList.add('session-cell-stopping');
    cell.style.backgroundColor = clip.color ?? COLOR_IDLE;
    cell.appendChild(deleteCross('Delete clip', () => cb.onDeleteClip(lane.id, rowIdx)));
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
    cell.addEventListener('contextmenu', (e) =>
      openContextMenu(e, [
        { label: 'Open editor', onSelect: () => cb.onClipClick(lane.id, rowIdx) },
        { label: 'Play / Stop', onSelect: () => cb.onClipPlayPause(lane.id, rowIdx) },
        ...(cb.onSetClipColor
          ? [{
              label: 'Color',
              separatorBefore: true,
              swatches: {
                colors: CLIP_COLOR_PALETTE,
                current: clip.color,
                onPick: (color: string) => cb.onSetClipColor!(lane.id, rowIdx, color),
              },
            }]
          : []),
        { label: 'Delete clip', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteClip(lane.id, rowIdx) },
      ]),
    );
  } else {
    cell.classList.add('session-cell-empty');
    cell.addEventListener('click', () => cb.onCellClick(lane.id, rowIdx));
    // Audio lanes pick a WAV per clip: clicking the empty cell opens the file
    // picker (you can also drop a WAV). Every other engine creates an empty clip.
    const isAudio = lane.engineId === 'audio';
    cell.addEventListener('contextmenu', (e) =>
      openContextMenu(e, [
        {
          label: isAudio ? 'Import audio (WAV)…' : 'Create clip',
          onSelect: () => cb.onCellClick(lane.id, rowIdx),
        },
      ]),
    );
  }
  // Sampler and audio lanes accept an audio file dropped onto ANY cell (empty or filled)
  // → create/replace a loop clip. Guarded to file drags so it does not interfere
  // with the internal clip-move drag (wireClipDrag) on filled cells.
  if ((lane.engineId === 'sampler' || lane.engineId === 'audio') && cb.onCellDropAudio) {
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
    el.appendChild(deleteCross('Delete scene', () => cb.onDeleteScene(idx)));
    const play = document.createElement('span');
    play.className = 'session-scene-play';
    play.textContent = '▶';

    const name = document.createElement('span');
    name.className = 'session-scene-name';
    name.textContent = scene.name ?? `Scene ${idx + 1}`;
    name.title = 'Click to launch · double-click to rename';

    const btn = document.createElement('button');
    btn.className = 'session-scene-launch';
    btn.append(play, name);
    el.appendChild(btn);

    // Whole button is the launch zone: a single click launches instantly. A
    // quick second click renames instead (double tracked by index — see
    // sceneLastClick — because the first click's launch re-rendered this button).
    btn.addEventListener('click', () => {
      const now = performance.now();
      const prev = sceneLastClick.get(idx);
      if (prev !== undefined && now - prev < SCENE_DBLCLICK_MS) {
        sceneLastClick.delete(idx);
        beginInlineRename(name, scene.name ?? `Scene ${idx + 1}`, {
          commit: (v) => cb.onRenameScene?.(idx, v),
        });
      } else {
        sceneLastClick.set(idx, now);
        cb.onLaunchScene(idx);
      }
    });

    el.addEventListener('contextmenu', (e) =>
      openContextMenu(e, [
        { label: 'Rename scene', onSelect: () => beginInlineRename(name, scene.name ?? `Scene ${idx + 1}`, { commit: (v) => cb.onRenameScene?.(idx, v) }) },
        { label: 'Launch scene', onSelect: () => cb.onLaunchScene(idx) },
        { label: 'Duplicate scene', onSelect: () => cb.onDuplicateScene(idx) },
        { label: 'Capture playing → scene', onSelect: () => cb.onCaptureScene() },
        { label: 'Add scene', onSelect: () => cb.onAddScene() },
        { label: 'Delete scene', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteScene(idx) },
      ]),
    );
  } else {
    el.classList.add('session-scene-cell-empty');
  }
  return el;
}


