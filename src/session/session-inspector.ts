// Session inspector panel + per-clip editor.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded clip editor (piano roll, step grids, drum grids).

import type { SessionState, SessionClip } from './session';
import type { LanePlayState } from './session-runtime';
import type { Sequencer } from '../core/sequencer';
import { renderClipEditor, type ClipEditorDeps } from './clip-editors/clip-editor-router';
import { renderClipAutomationLanes } from './clip-automation-lanes';
import type { PianoRollHandle } from '../core/pianoroll';
import type { HistoryDeps } from '../save/history-wiring';
import { withUndo, isTextEditTarget } from '../save/history-wiring';
import type { LaneResourceMap } from '../core/lane-resources';
import { buildLaneInsertUI } from './lane-insert-ui';
import { randomizeClipNotes } from './clip-randomize';
import { ensureScenesForRows } from '../core/scene-ensure';

export interface InspectorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  renderWithMixer: () => void;
  midiLabel: (m: number) => string;
  automationRegistry: Map<string, import('../core/knob').KnobHandle>;
  getAutoAbsSubIdx: () => number;
  historyDeps?: HistoryDeps;
  /** Phase H: per-lane resource map — provides the InsertChain for each lane.
   *  Optional so test fixtures without an audio graph still compile. */
  laneResources?: LaneResourceMap;
  /** Phase H: persist the session after the user edits an insert slot. */
  saveSession?: () => void;
  /** Scale + root for scale-aware clip-note randomization. Optional so test
   *  fixtures without a global scale picker still compile. */
  scaleSel?: HTMLSelectElement;
  rootSel?: HTMLSelectElement;
  /** Host note trigger, used to audition pitches from the keyboard editor.
   *  Optional so test fixtures without an audio graph still compile. */
  triggerForLane?: (
    laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean,
    sample?: import('./session').ClipSample,
    velocity?: number,
  ) => void;
}

export class SessionInspector {
  roll: PianoRollHandle | null = null;
  private selectedClip: { laneId: string; clipIdx: number } | null = null;
  /** Aborted (and replaced) each time openInspector() is called so stale
   *  field-level listeners from the previous clip don't accumulate. */
  private _fieldAc: AbortController = new AbortController();

  constructor(private deps: InspectorDeps) {
    this.wireKeyboardShortcuts();
    // When a lane's engine UI changes its editor kind (e.g. the sampler loads a
    // drumkit → drum-grid), re-render the editor if that lane's clip is open.
    document.addEventListener('loom:lane-engine-ui-changed', (e) => {
      const laneId = (e as CustomEvent<{ laneId: string }>).detail?.laneId;
      if (laneId && this.selectedClip && laneId === this.selectedClip.laneId) this.renderEditor();
    });
  }

  /** Delete / Backspace on a selected clip removes it (one undo entry).
   *  Skipped when typing in a text field so renaming a clip still works. */
  private wireKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTextEditTarget(e.target)) return;
      if (!this.selectedClip) return;
      e.preventDefault();
      this.deleteSelectedClip();
    });
  }

  private deleteSelectedClip(): void {
    if (!this.selectedClip) return;
    const sel = this.selectedClip;
    const d = this.deps.historyDeps;
    const run = () => {
      const lane = this.deps.state.lanes.find((l) => l.id === sel.laneId);
      if (!lane) return;
      lane.clips[sel.clipIdx] = null;
      const panel = document.getElementById('session-inspector');
      if (panel) panel.hidden = true;
      this.selectedClip = null;
      this.deps.renderWithMixer();
    };
    if (d) withUndo(d, run); else run();
  }

  /** Called after historyDeps is available (it may be constructed after the
   *  inspector is initialised, because the save-wiring deps close over
   *  sessionHost itself). */
  setHistoryDeps(hd: HistoryDeps): void {
    this.deps = { ...this.deps, historyDeps: hd };
  }

  getSelectedClip(): { laneId: string; clipIdx: number } | null {
    return this.selectedClip;
  }

  setSelectedClip(sel: { laneId: string; clipIdx: number } | null): void {
    this.selectedClip = sel;
  }

  openInspector(): void {
    const panel = document.getElementById('session-inspector');
    if (!panel || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!clip) { panel.hidden = true; return; }
    panel.hidden = false;

    const nameEl = document.getElementById('insp-name') as HTMLInputElement;
    const lenEl  = document.getElementById('insp-length') as HTMLInputElement;
    const qEl    = document.getElementById('insp-quantize') as HTMLSelectElement;

    nameEl.value = clip.name ?? '';
    lenEl.value  = String(clip.lengthBars);
    qEl.value    = clip.launchQuantize ?? '';

    // Abort previous field listeners so re-opening the inspector for a
    // different clip never accumulates stale handlers.
    this._fieldAc.abort();
    this._fieldAc = new AbortController();
    const sig = this._fieldAc.signal;

    nameEl.addEventListener('input',  () => { clip.name = nameEl.value || undefined; this.deps.renderWithMixer(); }, { signal: sig });
    nameEl.addEventListener('focus',  () => { this.deps.historyDeps?.history.beginGesture(this.deps.historyDeps.snapshot()); }, { signal: sig });
    nameEl.addEventListener('blur',   () => { this.deps.historyDeps?.history.commitGesture(); }, { signal: sig });
    lenEl.addEventListener('input',   () => { clip.lengthBars = Math.max(1, parseInt(lenEl.value, 10) || 1); }, { signal: sig });
    lenEl.addEventListener('focus',   () => { this.deps.historyDeps?.history.beginGesture(this.deps.historyDeps.snapshot()); }, { signal: sig });
    lenEl.addEventListener('blur',    () => { this.deps.historyDeps?.history.commitGesture(); }, { signal: sig });
    lenEl.addEventListener('pointerdown', () => { this.deps.historyDeps?.history.beginGesture(this.deps.historyDeps.snapshot()); }, { signal: sig });
    lenEl.addEventListener('pointerup',   () => { this.deps.historyDeps?.history.commitGesture(); }, { signal: sig });
    qEl.addEventListener('change', () => {
      const d = this.deps.historyDeps;
      const run = () => {
        clip.launchQuantize = (qEl.value || undefined) as import('./session').LaunchQuantize | undefined;
      };
      if (d) withUndo(d, run); else run();
    }, { signal: sig });

    document.getElementById('insp-duplicate')!.onclick = () => {
      if (!this.selectedClip) return;
      const d = this.deps.historyDeps;
      const run = () => {
        const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
        const dup: SessionClip = JSON.parse(JSON.stringify(clip));
        dup.id = `clip-${Date.now().toString(36)}`;
        dup.name = (clip.name ?? '') + ' copy';
        ln.clips.push(dup);
        // Append can push the clip past the last scene row; seed a scene so the
        // new row gets a launchable ▶ (same guarantee as placeClipEnsuringScene).
        ensureScenesForRows(this.deps.state);
        this.deps.renderWithMixer();
      };
      if (d) withUndo(d, run); else run();
    };
    document.getElementById('insp-delete')!.onclick = () => this.deleteSelectedClip();

    // Copy / paste — Copy only lifts the NOTES (the button says "Copy notes"),
    // not the whole clip, so paste never carries name/sample/launchQuantize.
    document.getElementById('insp-copy')!.onclick = () => {
      clipClipboard = { notes: JSON.parse(JSON.stringify(clip.notes ?? [])) };
      updatePasteBtnState();
    };
    document.getElementById('insp-paste-replace')!.onclick = () => this.pasteReplace();
    document.getElementById('insp-paste-layer')!.onclick   = () => this.pasteLayer();
    document.getElementById('insp-toggle-editor')!.onclick = () => {
      if (!this.selectedClip) return;
      const cur = editorOverride.get(clip.id) ?? null;
      const next: 'piano-roll' | 'drum-grid' =
        cur === 'piano-roll' ? 'drum-grid' : 'piano-roll';
      editorOverride.set(clip.id, next);
      this.renderEditor();
    };
    document.getElementById('insp-random-notes')!.onclick = () => {
      if (!this.selectedClip) return;
      const d = this.deps.historyDeps;
      const run = () => {
        const scaleSel = this.deps.scaleSel;
        const rootSel  = this.deps.rootSel;
        randomizeClipNotes(clip, lane!, {
          scale: scaleSel?.value ?? 'pentMinor',
          rootMidi: parseInt(rootSel?.value ?? '36', 10) || 36,
        }, this.deps.seq.meter);
        this.renderEditor();
      };
      if (d) withUndo(d, run); else run();
    };
    updatePasteBtnState();

    // Auto-render editor
    this.renderEditor();
  }

  private renderEditor(): void {
    const host = document.getElementById('insp-roll-host');
    if (!host || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    host.innerHTML = '';

    // Editor area (piano-roll or drum-grid).
    const editorBox = document.createElement('div');
    editorBox.className = 'insp-editor-box';
    host.appendChild(editorBox);

    const editorDeps: ClipEditorDeps = {
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      laneStates: this.deps.laneStates,
      midiLabel: this.deps.midiLabel,
      historyDeps: this.deps.historyDeps,
      triggerForLane: this.deps.triggerForLane,
    };
    this.roll = renderClipEditor(editorBox, lane, clip, editorDeps, editorOverride.get(clip.id));

    // Per-clip automation lanes below the editor.
    const autoBox = document.createElement('div');
    autoBox.className = 'insp-auto-box';
    host.appendChild(autoBox);

    renderClipAutomationLanes(autoBox, clip, {
      seq: this.deps.seq,
      getAutoAbsSubIdx: this.deps.getAutoAbsSubIdx,
      automationRegistry: this.deps.automationRegistry,
    });
  }

  // ── Lane inserts panel ────────────────────────────────────────────────────

  /** Mount the insert-chain panel for `laneId` into `host`.
   *  Called from SessionHost.injectEngineModulatorPanel after the engine
   *  controls are placed so the insert strip appears below them for every
   *  active lane (no boot-lane carve-out). */
  mountLaneInserts(laneId: string, host: HTMLElement): void {
    const laneRes = this.deps.laneResources?.get(laneId);
    const sessionLane = this.deps.state.lanes.find((l) => l.id === laneId);
    if (!laneRes || !sessionLane) return;
    sessionLane.inserts ??= [];
    const insertsPanel = document.createElement('div');
    insertsPanel.className = 'lane-inserts';
    buildLaneInsertUI({
      ctx: this.deps.ctx,
      container: insertsPanel,
      chain: laneRes.inserts,
      slots: sessionLane.inserts,
      onChange: () => this.deps.saveSession?.(),
    });
    host.appendChild(insertsPanel);
  }

  // ── Copy / paste ───────────────────────────────────────────────────────────

  private pasteReplace(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;
    const d = this.deps.historyDeps;
    const run = () => {
      clip.notes = JSON.parse(JSON.stringify(clipClipboard!.notes ?? []));
      this.renderEditor();
      this.deps.renderWithMixer();
    };
    if (d) withUndo(d, run); else run();
  }

  private pasteLayer(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;
    const d = this.deps.historyDeps;
    const run = () => {
      clip.notes = [
        ...(clip.notes ?? []),
        ...JSON.parse(JSON.stringify(clipClipboard!.notes ?? [])) as import('../core/notes').NoteEvent[],
      ];
      this.renderEditor();
      this.deps.renderWithMixer();
    };
    if (d) withUndo(d, run); else run();
  }
}

// ── Module-level clipboard ─────────────────────────────────────────────────
// Copy lifts only the notes (honest "Copy notes"): never the whole clip.
let clipClipboard: { notes: import('../core/notes').NoteEvent[] } | null = null;

/** Test-only peek at the notes clipboard (it is module-local). */
export function _getClipClipboardForTesting(): { notes: import('../core/notes').NoteEvent[] } | null {
  return clipClipboard;
}

// Drum clips can be edited as grid or piano-roll. This map stores the user's
// per-clip preference. Default is the engine's editor (drum-grid for drums).
const editorOverride = new Map<string, 'piano-roll' | 'drum-grid'>();

function updatePasteBtnState(): void {
  const hasClip = clipClipboard !== null;
  const pasteR = document.getElementById('insp-paste-replace') as HTMLButtonElement | null;
  const pasteL = document.getElementById('insp-paste-layer')   as HTMLButtonElement | null;
  if (pasteR) pasteR.disabled = !hasClip;
  if (pasteL) pasteL.disabled = !hasClip;
}
