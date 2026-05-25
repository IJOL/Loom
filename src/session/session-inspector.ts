// Session inspector panel + per-clip editor.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded clip editor (piano roll, step grids, drum grids).

import type { SessionState, SessionClip } from './session';
import type { LanePlayState } from './session-runtime';
import type { Sequencer } from '../core/sequencer';
import { renderClipEditor, type ClipEditorDeps } from './clip-editors/clip-editor-router';
import type { PianoRollHandle } from '../core/pianoroll';
import { DRUM_LANES } from '../core/drums';

export interface InspectorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  renderWithMixer: () => void;
  midiLabel: (m: number) => string;
}

export class SessionInspector {
  roll: PianoRollHandle | null = null;
  private selectedClip: { laneId: string; clipIdx: number } | null = null;

  constructor(private deps: InspectorDeps) {}

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
      clip.launchQuantize = (qEl.value || undefined) as import('./session').LaunchQuantize | undefined;
    };

    document.getElementById('insp-duplicate')!.onclick = () => {
      if (!this.selectedClip) return;
      const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
      const dup: SessionClip = JSON.parse(JSON.stringify(clip));
      dup.id = `clip-${Date.now().toString(36)}`;
      dup.name = (clip.name ?? '') + ' copy';
      ln.clips.push(dup);
      this.deps.renderWithMixer();
    };
    document.getElementById('insp-delete')!.onclick = () => {
      if (!this.selectedClip) return;
      const ln = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId)!;
      ln.clips[this.selectedClip.clipIdx] = null;
      panel.hidden = true;
      this.selectedClip = null;
      this.deps.renderWithMixer();
    };

    // Copy / paste
    document.getElementById('insp-copy')!.onclick = () => {
      clipClipboard = JSON.parse(JSON.stringify(clip)) as SessionClip;
      updatePasteBtnState();
    };
    document.getElementById('insp-paste-replace')!.onclick = () => this.pasteReplace();
    document.getElementById('insp-paste-layer')!.onclick   = () => this.pasteLayer();
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

    const editorDeps: ClipEditorDeps = {
      ctx: this.deps.ctx,
      seq: this.deps.seq,
      laneStates: this.deps.laneStates,
      midiLabel: this.deps.midiLabel,
    };

    this.roll = renderClipEditor(host, lane, clip, editorDeps);
  }

  // ── Copy / paste ───────────────────────────────────────────────────────────

  private pasteReplace(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    const src = clipClipboard;

    // Cross-kind guard: drum → poly is disallowed
    if ((src.drumSteps || src.drumLaneSteps) && lane.kind === 'poly') {
      alert('Cannot paste drum clip into a poly lane');
      return;
    }

    const dst = clip;

    // Replace content fields based on target lane kind
    if (lane.kind === 'drum-bus' && src.drumSteps) {
      dst.drumSteps = JSON.parse(JSON.stringify(src.drumSteps));
    } else if (lane.kind === 'drum-lane' && src.drumLane && src.drumLaneSteps) {
      dst.drumLaneSteps = JSON.parse(JSON.stringify(src.drumLaneSteps));
    } else if (lane.kind === 'drum-bus' && src.drumLane && src.drumLaneSteps && src.drumLane) {
      // drum-lane → drum-bus: put steps at the matching slot
      if (!dst.drumSteps) dst.drumSteps = {} as import('./session').SessionClip['drumSteps'] & {};
      dst.drumSteps![src.drumLane] = JSON.parse(JSON.stringify(src.drumLaneSteps));
    } else if (lane.kind === 'drum-lane' && src.drumSteps && clip.drumLane) {
      // drum-bus → drum-lane: use that lane's steps
      const laneSteps = src.drumSteps[clip.drumLane];
      if (laneSteps) dst.drumLaneSteps = JSON.parse(JSON.stringify(laneSteps));
    } else if (lane.kind === 'bass' && (src.bassNotes || src.bassSteps)) {
      if (clip.bassMode === 'piano') {
        // bass-piano → bass-piano, OR poly-piano → bass-piano (clamp midi)
        const notes: import('../core/notes').NoteEvent[] =
          src.bassNotes
            ? JSON.parse(JSON.stringify(src.bassNotes))
            : src.polyNotes
              ? JSON.parse(JSON.stringify(src.polyNotes))
              : [];
        for (const n of notes) n.midi = Math.max(24, Math.min(60, n.midi));
        dst.bassNotes = notes;
      } else {
        dst.bassSteps = JSON.parse(JSON.stringify(src.bassSteps ?? []));
      }
    } else if (lane.kind === 'poly' && (src.polyNotes || src.polySteps || src.bassNotes)) {
      if (clip.polyMode === 'piano') {
        dst.polyNotes = JSON.parse(JSON.stringify(src.polyNotes ?? src.bassNotes ?? []));
      } else {
        dst.polySteps = JSON.parse(JSON.stringify(src.polySteps ?? []));
      }
    }

    this.renderEditor();
    this.deps.renderWithMixer();
  }

  private pasteLayer(): void {
    if (!clipClipboard || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    const src = clipClipboard;

    if ((src.drumSteps || src.drumLaneSteps) && lane.kind === 'poly') {
      alert('Cannot paste drum clip into a poly lane');
      return;
    }

    // Layer (additive merge) per kind
    if (lane.kind === 'drum-bus' && clip.drumSteps && src.drumSteps) {
      for (const dl of DRUM_LANES) {
        const srcLane = src.drumSteps[dl];
        const dstLane = clip.drumSteps[dl];
        if (!srcLane || !dstLane) continue;
        for (let i = 0; i < Math.min(srcLane.length, dstLane.length); i++) {
          if (srcLane[i].on) {
            dstLane[i].on = true;
            if (srcLane[i].accent) dstLane[i].accent = true;
          }
        }
      }
      this.renderEditor();
      this.deps.renderWithMixer();
      return;
    }

    if (lane.kind === 'drum-lane' && clip.drumLaneSteps && src.drumLaneSteps) {
      const s = src.drumLaneSteps;
      const d = clip.drumLaneSteps;
      for (let i = 0; i < Math.min(s.length, d.length); i++) {
        if (s[i].on) { d[i].on = true; if (s[i].accent) d[i].accent = true; }
      }
    } else if (lane.kind === 'bass') {
      if (clip.bassMode === 'piano' && clip.bassNotes) {
        clip.bassNotes = [...clip.bassNotes, ...JSON.parse(JSON.stringify(src.bassNotes ?? src.polyNotes ?? []))];
      } else if (clip.bassMode === 'step' && clip.bassSteps && src.bassSteps) {
        const s = src.bassSteps;
        const d = clip.bassSteps;
        for (let i = 0; i < Math.min(s.length, d.length); i++) {
          if (s[i].on) { d[i].on = true; d[i].note = s[i].note; if (s[i].accent) d[i].accent = true; if (s[i].slide) d[i].slide = true; }
        }
      }
    } else if (lane.kind === 'poly') {
      if (clip.polyMode === 'piano' && clip.polyNotes) {
        clip.polyNotes = [...clip.polyNotes, ...JSON.parse(JSON.stringify(src.polyNotes ?? src.bassNotes ?? []))];
      } else if (clip.polyMode === 'step' && clip.polySteps && src.polySteps) {
        const s = src.polySteps;
        const d = clip.polySteps;
        for (let i = 0; i < Math.min(s.length, d.length); i++) {
          if (s[i].on) {
            d[i].on = true;
            for (const n of s[i].notes) if (!d[i].notes.includes(n)) d[i].notes.push(n);
            if (s[i].accent) d[i].accent = true;
          }
        }
      }
    }

    this.renderEditor();
    this.deps.renderWithMixer();
  }
}

// ── Module-level clipboard ─────────────────────────────────────────────────
let clipClipboard: SessionClip | null = null;

function updatePasteBtnState(): void {
  const hasClip = clipClipboard !== null;
  const pasteR = document.getElementById('insp-paste-replace') as HTMLButtonElement | null;
  const pasteL = document.getElementById('insp-paste-layer')   as HTMLButtonElement | null;
  if (pasteR) pasteR.disabled = !hasClip;
  if (pasteL) pasteL.disabled = !hasClip;
}
