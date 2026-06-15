// Session inspector panel + per-clip editor.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded clip editor (piano roll, step grids, drum grids).

import type { SessionState, SessionClip, SessionLane } from './session';
import { resolveTonality, DEFAULT_MUSICALITY } from './session';
import { rootName, SCALE_CATALOG, STYLE_CATALOG } from '../core/musicality';
import type { LanePlayState } from './session-runtime';
import type { Sequencer } from '../core/sequencer';
import { renderClipEditor, classifyClip, chooseClipEditor, type ClipEditorDeps } from './clip-editors/clip-editor-router';
import { getEngine } from '../engines/registry';
import { renderClipAutomationLanes } from './clip-automation-lanes';
import type { PianoRollHandle } from '../core/pianoroll';
import type { HistoryDeps } from '../save/history-wiring';
import { withUndo, isTextEditTarget } from '../save/history-wiring';
import type { LaneResourceMap } from '../core/lane-resources';
import { buildLaneInsertUI } from './lane-insert-ui';
import { generate, type GenKind } from '../core/generators';
import { variateNotes, invertMelodic, invertRetrograde } from '../core/note-transform';
import { stepsPerBar, ticksPerBar } from '../core/meter';
import { ensureScenesForRows } from '../core/scene-ensure';
import { alertDialog, promptDialog, choiceDialog } from '../core/dialog';
import { loadAllExamples, renderExampleNotes, clipToExample, exampleToJson, saveUserExample, type Example } from './example-loader';
import { renderChordComp } from '../core/harmony';
import { emptyClip } from './session';

function genKindFor(engineId: string): GenKind {
  if (engineId === 'tb303') return 'bass';
  if (engineId === 'drums-machine') return 'beat';
  return 'melody';
}

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
  /** Host note trigger, used to audition pitches from the keyboard editor.
   *  Optional so test fixtures without an audio graph still compile. */
  triggerForLane?: (
    laneId: string, note: number, time: number, gate: number, accent: boolean, slidingIn: boolean,
    sample?: import('./session').ClipSample,
    velocity?: number,
  ) => void;
  /** Create a new melodic lane with the given notes (Chords flow).
   *  Optional so test fixtures without a SessionHost still compile. */
  addNoteLane?: (engineId: string, notes: import('../core/notes').NoteEvent[], lengthBars: number, name: string) => void;
  /** Place a chord clip into an existing lane at the given clip index (Chords flow).
   *  Optional so test fixtures without a SessionHost still compile. */
  placeChordClip?: (laneId: string, clipIdx: number, clip: import('./session').SessionClip) => void;
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

    // Classify the clip so the inspector can hide the note-editing controls for
    // audio-channel clips (which have no note editor). notes/drums → show.
    const kind = classifyClip(lane, clip, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id));
    const editRow = document.getElementById('insp-edit-row');
    if (editRow) editRow.hidden = kind === 'audio';

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
    // View toggle. Hidden for audio clips (no note editor); visible for both
    // note and drum clips so either can be edited the other way.
    const toggleBtn = document.getElementById('insp-toggle-editor') as HTMLButtonElement;
    toggleBtn.hidden = kind === 'audio';
    toggleBtn.onclick = () => {
      if (!this.selectedClip) return;
      // Compute the next view from the RESOLVED editor (what the user is seeing),
      // not the stored override — otherwise the first click on a melodic lane with
      // no override (cur=null → 'piano-roll') is a no-op.
      const resolved = chooseClipEditor(lane!, getEngine(lane!.engineId)?.editor, editorOverride.get(clip.id), clip);
      const next: 'piano-roll' | 'drum-grid' = resolved === 'piano-roll' ? 'drum-grid' : 'piano-roll';
      editorOverride.set(clip.id, next);
      this.renderEditor();
      this.refreshToggleLabel();
    };
    this.refreshToggleLabel();
    document.getElementById('insp-random-notes')!.onclick = () => {
      if (!this.selectedClip) return;
      const d = this.deps.historyDeps;
      const run = () => {
        // Capture the octave BEFORE re-rendering — renderEditor() recreates the
        // piano-roll, which resets its octave base to the C4 default. We restore
        // it afterwards so the stepper (and the view) stay where the user left it.
        const octaveBase = this.roll?.getOctaveBase?.() ?? 60;
        const ton = resolveTonality(lane!, this.deps.state);
        const style = this.deps.state.musicality?.style ?? 'acid';
        const stepsPerBarVal = stepsPerBar(this.deps.seq.meter);
        clip.notes = generate(genKindFor(lane!.engineId), style, {
          key: ton.key, scale: ton.scale,
          bars: clip.lengthBars, stepsPerBar: stepsPerBarVal,
          octaveBase: octaveBase - 12,   // bass sounds one octave below the view
          rng: Math.random,
        });
        this.renderEditor();
        this.roll?.setOctaveBase?.(octaveBase);
      };
      if (d) withUndo(d, run); else run();
    };
    const style = () => this.deps.state.musicality?.style ?? 'acid';
    const exKind = genKindFor(lane!.engineId);
    const exSelect = document.getElementById('insp-examples-select') as HTMLSelectElement;

    // ── Vary / Mirror / Reverse ───────────────────────────────────────────────
    // Shared helper: wraps any clip-note mutation in undo + octave-restore,
    // mirroring the 🎲 handler's pattern.
    const withClipEdit = (fn: () => void): void => {
      const d = this.deps.historyDeps;
      const viewOctave = this.roll?.getOctaveBase?.() ?? 60;
      const run = () => { fn(); this.renderEditor(); this.roll?.setOctaveBase?.(viewOctave); };
      if (d) withUndo(d, run); else run();
    };

    document.getElementById('insp-variate')!.onclick = () => {
      withClipEdit(() => {
        const ton = resolveTonality(lane!, this.deps.state);
        clip.notes = variateNotes(clip.notes ?? [], {
          key: ton.key, scale: ton.scale, melodic: exKind !== 'beat',
          clipTicks: clip.lengthBars * ticksPerBar(this.deps.seq.meter),
          rng: Math.random,
        });
      });
    };

    const invMelodicBtn = document.getElementById('insp-invert-melodic') as HTMLButtonElement;
    invMelodicBtn.hidden = exKind === 'beat'; // melodic inversion is meaningless for drums
    invMelodicBtn.onclick = () => {
      withClipEdit(() => {
        const ton = resolveTonality(lane!, this.deps.state);
        clip.notes = invertMelodic(clip.notes ?? [], ton.key, ton.scale);
      });
    };

    document.getElementById('insp-retrograde')!.onclick = () => {
      withClipEdit(() => {
        clip.notes = invertRetrograde(
          clip.notes ?? [],
          clip.lengthBars * ticksPerBar(this.deps.seq.meter),
        );
      });
    };

    // ── Chords (chord accompaniment) ──────────────────────────────────────────
    // Only show the button for melodic lanes (not drums/audio/sampler-drumkit).
    const chordsBtn = document.getElementById('insp-chords') as HTMLButtonElement | null;
    if (chordsBtn) {
      chordsBtn.hidden = exKind === 'beat' || lane!.engineId === 'audio';
      chordsBtn.onclick = () => {
        void (async () => {
          const ton = resolveTonality(lane!, this.deps.state);
          const barTicks = ticksPerBar(this.deps.seq.meter);
          const chordNotes = renderChordComp(clip.notes ?? [], {
            key: ton.key,
            scale: ton.scale,
            style: this.deps.state.musicality?.style ?? 'acid',
            bars: clip.lengthBars,
            barTicks,
            octaveBase: 48,
          });
          if (chordNotes.length === 0) {
            void alertDialog('Draw or generate a melody first.');
            return;
          }
          // Build choice list: melodic lanes (not drums/audio/sampler-drumkit) + new lane
          const melodicLanes = this.deps.state.lanes.filter(
            (l) => l.engineId !== 'drums-machine' && l.engineId !== 'audio' && l.engineId !== 'sampler',
          );
          const choices = [
            ...melodicLanes.map((l) => ({ id: l.id, label: l.name ?? l.id })),
            { id: '__new__', label: '➕ New chord lane', primary: true as const },
          ];
          const picked = await choiceDialog(
            'Which lane should the chords go to?',
            choices,
            { title: 'Chords' },
          );
          if (!picked) return; // cancelled
          if (picked === '__new__') {
            this.deps.addNoteLane?.('subtractive', chordNotes, clip.lengthBars, 'Chords');
          } else {
            const chordClip = emptyClip(clip.lengthBars);
            chordClip.notes = chordNotes;
            chordClip.name = 'Chords';
            this.deps.placeChordClip?.(picked, this.selectedClip!.clipIdx, chordClip);
          }
        })();
      };
    }

    // Show ALL examples regardless of the project's global style/key. Filter only by
    // editor category: a piano-roll lane shows melodic riffs (bass+melody); a drum lane
    // shows beats. Group by style with <optgroup> headers (like the preset picker).
    const kindsToShow: string[] = exKind === 'beat' ? ['beat'] : ['bass', 'melody'];

    const repopulate = async () => {
      exSelect.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— example… —';
      exSelect.appendChild(ph);
      const perStyle = await Promise.all(
        STYLE_CATALOG.map((s) =>
          loadAllExamples(s.id).then((list) => ({ s, list })).catch(() => ({ s, list: [] as Example[] }))),
      );
      for (const { s, list } of perStyle) {
        const matching = list.filter((e) => kindsToShow.includes(e.kind));
        if (matching.length === 0) continue;
        const group = document.createElement('optgroup');
        group.label = s.label;
        for (const e of matching) {
          const o = document.createElement('option');
          o.value = e.id;
          o.textContent = e.source === 'user' ? `★ ${e.name}` : e.name;
          group.appendChild(o);
        }
        exSelect.appendChild(group);
      }
    };
    void repopulate();

    exSelect.onchange = async () => {
      const id = exSelect.value;
      exSelect.value = ''; // reset to placeholder
      if (!id) return;
      const perStyle = await Promise.all(STYLE_CATALOG.map((s) => loadAllExamples(s.id).catch(() => []))).catch(() => null);
      if (!perStyle) { void alertDialog('Could not load examples.'); return; }
      const chosen = perStyle.flat().find((e) => e.id === id);
      if (!chosen) return;
      const d = this.deps.historyDeps;
      const viewOctave = this.roll?.getOctaveBase?.() ?? 60;
      const run = () => {
        const ton = resolveTonality(lane!, this.deps.state);
        clip.notes = renderExampleNotes(chosen, ton, viewOctave - 12, clip.lengthBars, ticksPerBar(this.deps.seq.meter));
        this.renderEditor();
        this.roll?.setOctaveBase?.(viewOctave);
      };
      if (d) withUndo(d, run); else run();
    };

    document.getElementById('insp-save-example')!.onclick = async () => {
      if (!clip.notes || clip.notes.length === 0) { void alertDialog('The clip is empty: draw or generate notes before saving it as an example.'); return; }
      const name = await promptDialog('Example name:', '');
      if (!name) return;
      const viewOctave = this.roll?.getOctaveBase?.() ?? 60;
      const ton = resolveTonality(lane!, this.deps.state);
      const ex = clipToExample({
        id: `user-${exKind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
        name, style: style(), kind: exKind, notes: clip.notes, bars: clip.lengthBars,
        ton, octaveBase: viewOctave - 12, ticksPerBar: ticksPerBar(this.deps.seq.meter),
      });
      try { saveUserExample(ex); } catch (e) { void alertDialog((e as Error).message); return; }
      await repopulate();
    };

    document.getElementById('insp-export-example')!.onclick = () => {
      if (!clip.notes || clip.notes.length === 0) { void alertDialog('The clip is empty.'); return; }
      const viewOctave = this.roll?.getOctaveBase?.() ?? 60;
      const ton = resolveTonality(lane!, this.deps.state);
      const ex = clipToExample({
        id: `${exKind}-export`, name: clip.name || `${exKind} export`, style: style(), kind: exKind,
        notes: clip.notes, bars: clip.lengthBars, ton, octaveBase: viewOctave - 12,
        ticksPerBar: ticksPerBar(this.deps.seq.meter),
      });
      const blob = new Blob([exampleToJson(ex)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${ex.id}.json`; a.click();
      URL.revokeObjectURL(url);
    };
    updatePasteBtnState();
    this.renderTonalityOverride(lane!);

    // Auto-render editor
    this.renderEditor();
  }

  /** Update the view-toggle button label to read what it WILL switch to,
   *  based on the currently resolved editor. Re-resolves lane/clip from the
   *  selection so it is safe to call from openInspector and after a toggle. */
  private refreshToggleLabel(): void {
    const btn = document.getElementById('insp-toggle-editor') as HTMLButtonElement | null;
    if (!btn || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!lane || !clip) return;
    const resolved = chooseClipEditor(lane, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id), clip);
    btn.textContent = resolved === 'drum-grid' ? 'View as piano roll' : 'View as grid';
  }

  private renderTonalityOverride(lane: SessionLane): void {
    const host = document.getElementById('insp-tonality');
    if (!host) return;
    host.innerHTML = '';
    const g = this.deps.state.musicality ?? DEFAULT_MUSICALITY;
    const eff = resolveTonality(lane, this.deps.state);
    const overridden = !!lane.musicalityOverride;
    const scaleLabel = (id: string) => SCALE_CATALOG.find((s) => s.id === id)?.label ?? id;
    const label = document.createElement('span');
    label.textContent = overridden
      ? `Key: custom (${rootName(eff.key)} ${scaleLabel(eff.scale)})`
      : `Key: inherits ${rootName(g.key)} ${scaleLabel(g.scale)}`;
    const btn = document.createElement('button');
    btn.className = 'rnd';
    btn.textContent = overridden ? 'Use global' : 'Override';
    btn.onclick = () => {
      const d = this.deps.historyDeps;
      const run = () => {
        if (overridden) delete lane.musicalityOverride;
        else lane.musicalityOverride = { key: g.key, scale: g.scale };
        this.renderTonalityOverride(lane);
        this.renderEditor();
      };
      if (d) withUndo(d, run); else run();
    };
    host.append(label, btn);
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
      laneResources: this.deps.laneResources,
      automationRegistry: this.deps.automationRegistry,
      sessionState: this.deps.state,
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
