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
import { withUndo } from '../save/history-wiring';

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
}

export class SessionInspector {
  roll: PianoRollHandle | null = null;
  private selectedClip: { laneId: string; clipIdx: number } | null = null;

  constructor(private deps: InspectorDeps) {}

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

    nameEl.oninput = () => { clip.name = nameEl.value || undefined; this.deps.renderWithMixer(); };
    lenEl.oninput  = () => { clip.lengthBars = Math.max(1, parseInt(lenEl.value, 10) || 1); };
    qEl.onchange   = () => {
      const d = this.deps.historyDeps;
      const run = () => {
        clip.launchQuantize = (qEl.value || undefined) as import('./session').LaunchQuantize | undefined;
      };
      if (d) withUndo(d, run); else run();
    };

    document.getElementById('insp-duplicate')!.onclick = () => {
      if (!this.selectedClip) return;
      const d = this.deps.historyDeps;
      const run = () => {
        const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
        const dup: SessionClip = JSON.parse(JSON.stringify(clip));
        dup.id = `clip-${Date.now().toString(36)}`;
        dup.name = (clip.name ?? '') + ' copy';
        ln.clips.push(dup);
        this.deps.renderWithMixer();
      };
      if (d) withUndo(d, run); else run();
    };
    document.getElementById('insp-delete')!.onclick = () => {
      if (!this.selectedClip) return;
      const d = this.deps.historyDeps;
      const run = () => {
        const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
        ln.clips[this.selectedClip!.clipIdx] = null;
        panel.hidden = true;
        this.selectedClip = null;
        this.deps.renderWithMixer();
      };
      if (d) withUndo(d, run); else run();
    };

    // Copy / paste
    document.getElementById('insp-copy')!.onclick = () => {
      clipClipboard = JSON.parse(JSON.stringify(clip)) as SessionClip;
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
let clipClipboard: SessionClip | null = null;

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
