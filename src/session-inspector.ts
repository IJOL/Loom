// Session inspector panel + per-clip piano roll.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded piano roll editor for bass/poly clips.

import type { SessionState, SessionClip } from './session';
import type { LanePlayState } from './session-runtime';
import type { Sequencer } from './sequencer';
import { createPianoRoll, type PianoRollHandle } from './pianoroll';
import { TICKS_PER_STEP, type NoteEvent } from './notes';

export interface InspectorDeps {
  ctx: AudioContext;
  seq: Sequencer;
  state: SessionState;
  laneStates: Map<string, LanePlayState>;
  renderWithMixer: () => void;
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
    document.getElementById('insp-open-roll')!.onclick = () => this.openPianoRoll();
  }

  openPianoRoll(): void {
    const host = document.getElementById('insp-roll-host');
    if (!host || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;

    host.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(800, clip.lengthBars * 240);
    canvas.height = 240;
    canvas.style.height = '240px';
    canvas.style.width = `${canvas.width}px`;
    host.appendChild(canvas);

    const isBass = lane.kind === 'bass';
    const getNotes = (): NoteEvent[] => isBass ? (clip.bassNotes ?? []) : (clip.polyNotes ?? []);
    const setNotes = (notes: NoteEvent[]) => {
      if (isBass) clip.bassNotes = notes;
      else        clip.polyNotes = notes;
    };

    const { ctx, seq } = this.deps;
    const sel = this.selectedClip;
    this.roll = createPianoRoll({
      canvas,
      getNotes,
      setNotes,
      patternTicks: clip.lengthBars * 16 * TICKS_PER_STEP,
      minMidi: isBass ? 24 : 36,
      maxMidi: isBass ? 60 : 96,
      onChange: () => {},
      getPlayheadTick: () => {
        const lp = this.deps.laneStates.get(sel.laneId);
        if (!lp || !lp.playing || lp.playing.id !== clip.id) return -1;
        const now = ctx.currentTime;
        const stepDur = 60 / seq.bpm / 4;
        const stepsElapsed = Math.max(0, (now - lp.startTime) / stepDur);
        const clipSteps = clip.lengthBars * 16;
        const stepInClip = stepsElapsed % clipSteps;
        return stepInClip * TICKS_PER_STEP;
      },
    });
  }
}
