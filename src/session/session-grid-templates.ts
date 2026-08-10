// Per-piece templates for the Session grid: lane column headers, clip cells,
// scene launch cells, and the scenes header (capture + the add-lane menu).
// Extracted from session-ui.ts in the lit-html migration; the grid shell that
// composes these (and the mountPanel lifecycle) stays in session-ui.ts. All
// state mutations run via SessionUICallbacks — templates never touch state.

import { html, nothing, type TemplateResult } from 'lit-html';
import type { SessionState, SessionLane, SessionClip, ClipSlot } from './session';
import { CLIP_COLOR_PALETTE } from './session';
import type { LanePlayState } from './session-runtime';
import { openContextMenu } from '../core/context-menu';
import { beginInlineRename } from './inline-rename';
import { clipDragHandlers } from './session-clip-drag';
import { listEngines, getEngine } from '../engines/registry';
import type { SessionUICallbacks } from './session-ui-types';
import { acceptsAudioFile, isAudioEngine } from '../plugins/capabilities';
import { melodicSynthEngineIds } from '../engines/engine-selector-ui';
import { LAYERS_ENGINE_ID } from '../engines/layers-engine';

/** Whether this lane could become a rack of instruments.
 *
 *  The SAME list a layer slot offers, asked rather than restated: a rack holds
 *  melodic engines, so the drum machine, the sampler and the audio channel are
 *  out — a slot holding one is silently skipped at spawn, which reads as a
 *  broken instrument. And a lane that is already layered has nowhere to go. */
const canLayer = (engineId: string): boolean =>
  engineId !== LAYERS_ENGINE_ID && melodicSynthEngineIds().includes(engineId);

// The audio channel gets its OWN entry in the "+" menu, appended right below
// the engine list (see addLaneHeaderTemplate). That is a layout decision made
// BY THE MENU, not a property of the engine — an engine cannot know it will be
// given a second, explicit entry elsewhere in the same menu, so it has no
// business declaring that fact about itself in its manifest. A local constant
// means the one thing that owns "audio gets its own row" is this file, in one
// place, for both halves of the decision: the filter below and the explicit
// item further down.
const EXPLICIT_ENTRY_ENGINE = 'audio';

// Fallback fill for a filled clip that carries no `clip.color`. Filled cells force
// dark text (`color: #111`, see _session-grid.scss) so it reads against the light
// pastel palette — so this fallback MUST also be light, or the label goes
// black-on-dark-grey and unreadable.
const COLOR_IDLE = '#c9c9c9';

// Single-vs-double click disambiguation for scene buttons, keyed by ROW INDEX.
// A scene launch re-renders the whole grid (renderWithMixer); under lit the
// button element is patched in place, but the timing state stays keyed by index
// (not element) so the second click of a double is recognised regardless of
// what the re-render did. This keeps launch INSTANT on a single click while
// making double-click rename work.
const sceneLastClick = new Map<number, number>();
const SCENE_DBLCLICK_MS = 350;
// Single-vs-double click disambiguation for lane headers, keyed by lane id —
// same rationale as sceneLastClick.
const laneLastClick = new Map<string, number>();
const LANE_DBLCLICK_MS = 350;
/** Test-only: clear the click-timing state so module state can't leak
 *  between tests (clicks in different tests would otherwise read as a double). */
export function _resetSceneClickStateForTesting(): void { sceneLastClick.clear(); laneLastClick.clear(); }

const stopProp = (e: Event) => e.stopPropagation();

/** A small ✕ delete button. Stops pointer/click propagation so it never triggers
 *  the cell's clip drag nor the scene/lane click underneath it (mirrors the play
 *  icon's stopPropagation). */
function deleteCross(title: string, onDelete: () => void): TemplateResult {
  return html`<button
    class="session-del-cross"
    title=${title}
    @pointerdown=${stopProp}
    @pointerup=${stopProp}
    @click=${(e: Event) => { e.stopPropagation(); onDelete(); }}
  >✕</button>`;
}

export function laneHeaderTemplate(
  lane: SessionLane,
  cb: SessionUICallbacks,
  isActive: boolean,
  synthCollapsed: boolean,
): TemplateResult {
  const displayName = lane.name ?? lane.id.toUpperCase();
  const rename = (nameEl: HTMLElement | null) => {
    if (nameEl) beginInlineRename(nameEl, displayName, { commit: (v) => cb.onRenameLane?.(lane.id, v) });
  };
  const nameElOf = (e: Event) =>
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.session-lane-name');

  // Whole header selects the lane (opens its editor). A quick second click
  // renames instead — id-timed (see laneLastClick) because the select
  // re-renders the grid between the two clicks.
  const onHeaderClick = (e: Event) => {
    const now = performance.now();
    const prev = laneLastClick.get(lane.id);
    if (prev !== undefined && now - prev < LANE_DBLCLICK_MS) {
      laneLastClick.delete(lane.id);
      rename(nameElOf(e));
    } else {
      laneLastClick.set(lane.id, now);
      cb.onEditLane(lane.id);
    }
  };

  const onCtx = (e: MouseEvent) => {
    const nameEl = nameElOf(e);
    openContextMenu(e, [
      { label: 'Rename track', onSelect: () => rename(nameEl) },
      { label: 'Edit instrument', onSelect: () => cb.onEditLane(lane.id) },
      { label: 'Duplicate track', onSelect: () => cb.onDuplicateLane(lane.id) },
      // Only where it means something. A rack holds melodic engines, so the
      // drum machine and the audio channel cannot be layered; an already
      // layered lane has nowhere to go. Hidden rather than disabled: a menu of
      // things you cannot do is longer and says less.
      ...(cb.onConvertToLayered && canLayer(lane.engineId)
        ? [{ label: 'Convert to layered', onSelect: () => cb.onConvertToLayered!(lane.id) }]
        : []),
      { label: 'Stop track', onSelect: () => cb.onStopLane(lane.id) },
      { label: 'Delete track', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteLane(lane.id) },
    ]);
  };

  // The active header carries a chevron that collapses / reopens the synth
  // editor. Only the chevron collapses — the header click never does.
  const chevron = isActive
    ? html`<button
        class="session-lane-collapse"
        title=${synthCollapsed ? 'Show the instrument editor' : 'Collapse the instrument editor'}
        @pointerdown=${stopProp}
        @pointerup=${stopProp}
        @click=${(e: Event) => { e.stopPropagation(); cb.onToggleSynthEditor?.(); }}
      >${synthCollapsed ? '▸' : '▾'}</button>`
    : nothing;

  // Nothing registered this engine — its plugin is not installed here. The lane
  // editor says so too, but that only shows once you OPEN the lane, and the
  // whole point is that a silent lane must be legible from the session grid:
  // otherwise the user just sees a track that mysteriously does not sound.
  // Its settings are intact; only the thing that plays them is missing.
  const missing = !getEngine(lane.engineId);
  const missingMark = missing
    ? html`<span
        class="session-lane-missing"
        title=${`Engine not installed: ${lane.engineId}. This lane keeps its settings — install the plugin and reload.`}
      >⚠</span>`
    : nothing;

  return html`<div
    class=${`session-lane-header lane-engine-${lane.engineId}${isActive ? ' session-lane-header-active' : ''}${missing ? ' session-lane-header-missing' : ''}`}
    data-lane-id=${lane.id}
    title=${missing
      ? `Engine not installed: ${lane.engineId} — this lane keeps its settings`
      : 'Click to edit this instrument · double-click the name to rename'}
    @click=${onHeaderClick}
    @contextmenu=${onCtx}
  >${deleteCross('Delete track', () => cb.onDeleteLane(lane.id))}<div
      class=${isActive ? 'session-lane-name session-lane-name-active' : 'session-lane-name'}
    >${missingMark}${displayName}</div>${chevron}</div>`;
}

export function clipCellTemplate(
  lane: SessionLane,
  rowIdx: number,
  laneStates: Map<string, LanePlayState>,
  cb: SessionUICallbacks,
  state: SessionState,
  openClip?: ClipSlot,
  colActive = false,
): TemplateResult {
  const clip: SessionClip | null = lane.clips[rowIdx] ?? null;

  // Sampler and audio lanes accept an audio file dropped onto ANY cell (empty or
  // filled) → create/replace a loop clip. Guarded to file drags so it does not
  // interfere with the internal clip-move drag (clipDragHandlers) on filled cells.
  const acceptsFileDrop = acceptsAudioFile(lane.engineId) && !!cb.onCellDropAudio;
  const isFileDrag = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  const onDragOver = acceptsFileDrop ? (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add('session-cell-drop');
  } : nothing;
  const onDragLeave = acceptsFileDrop
    ? (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('session-cell-drop')
    : nothing;
  const onDrop = acceptsFileDrop ? (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('session-cell-drop');
    const file = e.dataTransfer!.files[0];
    if (file) cb.onCellDropAudio!(lane.id, rowIdx, file);
  } : nothing;

  if (!clip) {
    // Audio lanes pick a WAV per clip: clicking the empty cell opens the file
    // picker (you can also drop a WAV). Every other engine creates an empty clip.
    const isAudio = isAudioEngine(lane.engineId);
    return html`<div
      class=${`session-cell session-cell-empty${colActive ? ' session-cell-col-active' : ''}`}
      data-lane-id=${lane.id}
      data-clip-idx=${String(rowIdx)}
      @click=${() => cb.onCellClick(lane.id, rowIdx)}
      @contextmenu=${(e: MouseEvent) => openContextMenu(e, [
        {
          label: isAudio ? 'Import audio (WAV)…' : 'Create clip',
          onSelect: () => cb.onCellClick(lane.id, rowIdx),
        },
      ])}
      @dragover=${onDragOver}
      @dragleave=${onDragLeave}
      @drop=${onDrop}
    ></div>`;
  }

  const lp = laneStates.get(lane.id);
  const isPlaying = !!(lp?.playing && lp.playing.id === clip.id);
  const isQueued  = !!(lp?.queued  && lp.queued.id  === clip.id);
  const isStopping = !!(lp?.playing && lp.playing.id === clip.id && lp.queuedStop != null);
  const isEditing = !!(openClip && openClip.laneId === lane.id && openClip.clipIdx === rowIdx);

  const cls = 'session-cell session-cell-filled session-cell-draggable'
    + (colActive ? ' session-cell-col-active' : '')
    + (isEditing ? ' session-cell-editing' : '')
    + (isPlaying ? ' session-cell-playing' : '')
    + (isQueued  ? ' session-cell-queued' : '')
    + (isStopping ? ' session-cell-stopping' : '');

  const drag = clipDragHandlers({ laneId: lane.id, clipIdx: rowIdx }, cb, state);

  const onCtx = (e: MouseEvent) => openContextMenu(e, [
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
  ]);

  return html`<div
    class=${cls}
    data-lane-id=${lane.id}
    data-clip-idx=${String(rowIdx)}
    style=${`background-color: ${clip.color ?? COLOR_IDLE}`}
    @pointerdown=${drag.pointerdown}
    @contextmenu=${onCtx}
    @dragover=${onDragOver}
    @dragleave=${onDragLeave}
    @drop=${onDrop}
  >${deleteCross('Delete clip', () => cb.onDeleteClip(lane.id, rowIdx))}<span
      class="session-cell-label"
    >${clip.name ?? `${rowIdx + 1}`}</span><span
      class="session-cell-play"
      title=${isPlaying ? 'Stop' : (isQueued ? 'Queued — click to cancel' : 'Play')}
      @pointerdown=${stopProp}
      @pointerup=${stopProp}
      @click=${(e: Event) => { e.stopPropagation(); cb.onClipPlayPause(lane.id, rowIdx); }}
    >${isPlaying ? '⏸' : '▶'}</span></div>`;
}

export function sceneLaunchCellTemplate(
  scene: { name?: string } | undefined,
  idx: number,
  cb: SessionUICallbacks,
): TemplateResult {
  if (!scene) return html`<div class="session-scene-cell session-scene-cell-empty"></div>`;

  const sceneName = () => scene.name ?? `Scene ${idx + 1}`;
  const rename = (nameEl: HTMLElement | null) => {
    if (nameEl) beginInlineRename(nameEl, sceneName(), { commit: (v) => cb.onRenameScene?.(idx, v) });
  };

  // Whole button is the launch zone: a single click launches instantly. A
  // quick second click renames instead (double tracked by index — see
  // sceneLastClick — because the first click's launch re-rendered the grid).
  const onLaunchClick = (e: Event) => {
    const now = performance.now();
    const prev = sceneLastClick.get(idx);
    if (prev !== undefined && now - prev < SCENE_DBLCLICK_MS) {
      sceneLastClick.delete(idx);
      rename((e.currentTarget as HTMLElement).querySelector<HTMLElement>('.session-scene-name'));
    } else {
      sceneLastClick.set(idx, now);
      cb.onLaunchScene(idx);
    }
  };

  const onCtx = (e: MouseEvent) => {
    const nameEl = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.session-scene-name');
    openContextMenu(e, [
      { label: 'Rename scene', onSelect: () => rename(nameEl) },
      { label: 'Launch scene', onSelect: () => cb.onLaunchScene(idx) },
      { label: 'Duplicate scene', onSelect: () => cb.onDuplicateScene(idx) },
      { label: 'Capture playing → scene', onSelect: () => cb.onCaptureScene() },
      { label: 'Add scene', onSelect: () => cb.onAddScene() },
      { label: 'Delete scene', danger: true, separatorBefore: true, onSelect: () => cb.onDeleteScene(idx) },
    ]);
  };

  return html`<div class="session-scene-cell" @contextmenu=${onCtx}>${deleteCross('Delete scene', () => cb.onDeleteScene(idx))}<button
      class="session-scene-launch"
      @click=${onLaunchClick}
    ><span class="session-scene-play">▶</span><span
      class="session-scene-name"
      title="Click to launch · double-click to rename"
    >${sceneName()}</span></button></div>`;
}

/** The scenes-header cell. The "+ add lane" control lives at the END of this
 *  same cell (last grid column) so it shares the scenes column instead of
 *  consuming its own — as a separate header child it was an (n+3)th element in
 *  an (n+2)-column grid and auto-flowed onto a wrapped second row. */
export function scenesHeaderTemplate(cb: SessionUICallbacks): TemplateResult {
  return html`<div class="session-scenes-header"><span>Scenes</span><button
      class="session-capture-scene"
      title="New scene from currently playing clips (Ctrl+I)"
      @click=${cb.onCaptureScene}
    >⊙</button>${addLaneHeaderTemplate(cb)}</div>`;
}

function addLaneHeaderTemplate(cb: SessionUICallbacks): TemplateResult {
  // The menu's open/closed state is DOM-held (the [hidden] attribute, static in
  // the template so lit never resets it): the wrap element survives repaints, and
  // the menu opens only from the + click — no state to mirror anywhere.
  const toggleMenu = (e: Event) => {
    e.stopPropagation();
    const menu = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    if (menu) menu.hidden = !menu.hidden;
  };
  const item = (label: string, onPick: () => void, engineId?: string) =>
    html`<button
      class="session-add-item"
      data-engine-id=${engineId ?? nothing}
      @click=${(e: Event) => {
        const menu = (e.currentTarget as HTMLElement).closest<HTMLElement>('.session-lane-add-menu');
        if (menu) menu.hidden = true;
        onPick();
      }}
    >${label}</button>`;

  const engineItems = listEngines('polyhost')
    .filter((engine) => engine.id !== EXPLICIT_ENTRY_ENGINE) // audio is added via the explicit entry below
    .map((engine) => item(engine.name, () => cb.onAddLane(engine.id), engine.id));

  return html`<div class="session-lane-add-wrap"><button
      class="session-lane-add"
      title="Add a lane"
      @click=${toggleMenu}
    >+</button><div class="session-lane-add-menu" hidden>${engineItems}${
      cb.onAddAudioChannel ? item('Audio channel', () => cb.onAddAudioChannel!()) : nothing
    }</div></div>`;
}
