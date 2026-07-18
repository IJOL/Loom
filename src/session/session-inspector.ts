// Session inspector panel + per-clip editor.
// Manages the clip detail panel (name, length, quantize, duplicate, delete)
// and the embedded clip editor (piano roll, step grids, drum grids).

import type { SessionState, SessionClip, SessionLane } from './session';
import { resolveTonality, DEFAULT_MUSICALITY, resolveClipContext } from './session';
import { beginInlineRename } from './inline-rename';
import { rootName, SCALE_CATALOG, STYLE_CATALOG, type StyleId } from '../core/musicality';
import { patternNotes } from '../patterns/pattern-library';
import { patternKindFor, fillStyleSelect, fillPatternSelect, patternRootFor } from '../patterns/pattern-picker-ui';
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
import { shouldCloseClipEditorOnLaneSwitch } from './session-host-util';
import { loadAllExamples, renderExampleNotes, clipToExample, exampleToJson, saveUserExample, type Example } from './example-loader';
import { renderChordComp } from '../core/harmony';
import { emptyClip } from './session';
import { scaleClipTempo } from '../core/clip-time-scale';

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
  /** When provided, per-lane insert-rack continuous-param knobs are registered
   *  as Performance-automation destinations.  Optional so test fixtures that do
   *  not build an audio graph still compile. */
  registerKnob?: (k: import('../core/knob').KnobHandle) => void;
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
  /** Transcribe an audio clip's effective loop region to a new note/drums lane.
   *  Set late (after the stem client + host both exist) via setTranscribeLoop. */
  transcribeLoop?: (clip: import('./session').SessionClip, kind: 'melodic' | 'drums') => void | Promise<void>;
  /** Seek the global song position to a bar (fractional). Wired from session-host. */
  onSeekBar?: (bar: number) => void;
  /** Returns true when the editing scene's loop is currently linked. */
  isSceneLinked?: () => boolean;
  /** Called when the user toggles the Link button in the loop overlay. */
  onSetSceneLinked?: (linked: boolean) => void;
  /** Called after each loop edit commit. When the scene is linked the host
   *  propagates the edited clip's loop to every other clip in the scene. */
  onClipLoopEdited?: () => void;
  /** Called when a clip is opened, so the host can make that clip's lane the
   *  active (keyboard-driven) lane. Wired to SessionHost.focusLane. */
  onClipFocused?: (laneId: string) => void;
  /** Audition the open clip from its own editor, so picking a pattern and
   *  hearing it does not mean a trip back to the session grid.
   *  Wired to SessionHost.launchClipAt / stopLaneClips. */
  onPlayClip?: (laneId: string, clipIdx: number) => void;
  onStopClip?: (laneId: string) => void;
  /** True while the clip's lane is sounding — drives the ▶/■ face. */
  isLanePlaying?: (laneId: string) => boolean;
}

export class SessionInspector {
  roll: PianoRollHandle | null = null;
  private selectedClip: { laneId: string; clipIdx: number } | null = null;
  /** The open clip's automation panel, so its destination picker can be
   *  rebuilt when the session gains or loses a param (e.g. a new insert). */
  private autoBox: HTMLElement | null = null;
  /** Aborted (and replaced) each time openInspector() is called so stale
   *  field-level listeners from the previous clip don't accumulate. */
  private _fieldAc: AbortController = new AbortController();
  /** Loop-record over live MIDI (Task 5/6), bound late via setMidiCapture once
   *  the facade exists (mirrors setHistoryDeps/setTranscribeLoop). */
  private midiCapture: { toggle: (mode: 'merge' | 'replace') => void; isRecording: () => boolean; canRecord: () => boolean } | null = null;

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

  /** Called after the stem client + host exist (both needed before the audio→
   *  notes closure can be built), mirroring setHistoryDeps' late binding. */
  setTranscribeLoop(fn: InspectorDeps['transcribeLoop']): void {
    this.deps = { ...this.deps, transcribeLoop: fn };
  }

  /** Bind the loop-record capture toggle once the facade exists (mirrors
   *  setHistoryDeps/setTranscribeLoop's late-binding). */
  setMidiCapture(c: SessionInspector['midiCapture']): void {
    this.midiCapture = c;
    this.refreshRecButton();
    this.refreshPlayButton();
  }

  /** Show/hide + label the clip-header Rec button and mode select. Hidden
   *  entirely when no capture facade is bound; disabled when no clip is open
   *  or the facade reports no capture destination available. */
  private refreshRecButton(): void {
    const btn = document.getElementById('insp-rec') as HTMLButtonElement | null;
    const mode = document.getElementById('insp-rec-mode') as HTMLSelectElement | null;
    if (!btn || !mode) return;
    const c = this.midiCapture;
    btn.hidden = !c;
    mode.hidden = !c;
    if (!c) return;
    btn.disabled = !this.selectedClip || !c.canRecord();
    btn.textContent = c.isRecording() ? '■ Stop' : '● Rec';
    btn.onclick = () => { c.toggle((mode.value as 'merge' | 'replace') || 'merge'); this.refreshRecButton(); };
  }

  /** Play/stop the open clip from its own header. One button, two faces: it
   *  shows ■ while the clip's lane is sounding, ▶ otherwise — so auditioning a
   *  pattern is pick → hear → pick again, without leaving the editor. */
  refreshPlayButton(): void {
    const btn = document.getElementById('insp-play') as HTMLButtonElement | null;
    if (!btn) return;
    const sel = this.selectedClip;
    btn.disabled = !sel || !this.deps.onPlayClip;
    if (!sel) { btn.textContent = '▶'; return; }

    const playing = this.deps.isLanePlaying?.(sel.laneId) ?? false;
    btn.textContent = playing ? '■' : '▶';
    btn.classList.toggle('is-playing', playing);
    btn.title = playing ? 'Stop this clip' : 'Play this clip';
    btn.onclick = () => {
      if (this.deps.isLanePlaying?.(sel.laneId)) this.deps.onStopClip?.(sel.laneId);
      else this.deps.onPlayClip?.(sel.laneId, sel.clipIdx);
      this.refreshPlayButton();
    };
  }

  getSelectedClip(): { laneId: string; clipIdx: number } | null {
    return this.selectedClip;
  }

  setSelectedClip(sel: { laneId: string; clipIdx: number } | null): void {
    this.selectedClip = sel;
  }

  /** Close the clip editor: hide the inspector panel and drop the selection.
   *  Called when the selected clip's lane/clip vanishes (New, load, Replace) and
   *  when the user selects a lane that does not own the open clip. */
  closeInspector(): void {
    const panel = document.getElementById('session-inspector');
    // Blur BEFORE hiding, while the selection still stands: the name/length
    // fields and an in-flight inline rename commit on blur, so hiding first would
    // strand the edit (and leave its undo gesture open).
    const active = document.activeElement;
    if (panel && active instanceof HTMLElement && panel.contains(active)) active.blur();
    this._fieldAc.abort();
    this._fieldAc = new AbortController();
    if (panel) panel.hidden = true;
    this.selectedClip = null;
    this.refreshPlayButton();
    this.refreshRecButton();
  }

  /** Close the editor when `laneId` is not the open clip's lane. The seam every
   *  lane-selection path calls, so the editor always shows the active lane. */
  closeIfOtherLane(laneId: string): void {
    if (shouldCloseClipEditorOnLaneSwitch(this.selectedClip, laneId)) this.closeInspector();
  }

  openInspector(): void {
    const panel = document.getElementById('session-inspector');
    if (!panel || !this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!clip) { panel.hidden = true; return; }
    this.deps.onClipFocused?.(this.selectedClip.laneId);
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
    nameEl.addEventListener('focus',  () => { this.deps.historyDeps?.beginGesture?.(); }, { signal: sig });
    nameEl.addEventListener('blur',   () => { this.deps.historyDeps?.endGesture?.(); }, { signal: sig });
    lenEl.addEventListener('input',   () => { clip.lengthBars = Math.max(1, parseInt(lenEl.value, 10) || 1); }, { signal: sig });
    lenEl.addEventListener('focus',   () => { this.deps.historyDeps?.beginGesture?.(); }, { signal: sig });
    lenEl.addEventListener('blur',    () => { this.deps.historyDeps?.endGesture?.(); }, { signal: sig });
    lenEl.addEventListener('pointerdown', () => { this.deps.historyDeps?.beginGesture?.(); }, { signal: sig });
    lenEl.addEventListener('pointerup',   () => { this.deps.historyDeps?.endGesture?.(); }, { signal: sig });
    qEl.addEventListener('change', () => {
      const d = this.deps.historyDeps;
      const run = () => {
        clip.launchQuantize = (qEl.value || undefined) as import('./session').LaunchQuantize | undefined;
      };
      if (d) withUndo(d, run); else run();
    }, { signal: sig });

    // *2 / /2 tempo scale — next to the Length field. Note clips and drum clips
    // only (audio clips have no notes). `.onclick` replaces on each open, so no
    // listener accumulation. `kind` was computed above.
    const dblBtn  = document.getElementById('insp-tempo-double') as HTMLButtonElement;
    const halfBtn = document.getElementById('insp-tempo-halve')  as HTMLButtonElement;
    const isNoteClip = kind !== 'audio';
    dblBtn.hidden  = !isNoteClip;
    halfBtn.hidden = !isNoteClip;
    dblBtn.onclick  = () => this.applyTempoScale(2);   // double tempo (compress)
    halfBtn.onclick = () => this.applyTempoScale(0.5); // halve tempo (stretch)

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
        const style = this.deps.state.musicality?.style ?? 'acid-techno';
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
    const style = () => this.deps.state.musicality?.style ?? 'acid-techno';
    const exKind = genKindFor(lane!.engineId);

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

    // ── Pattern library: style ▸ pattern ──────────────────────────────────────
    // Two native selects. The style one drives the whole project (it is the same
    // musicality.style the generators read), so picking a style here is not a
    // local filter — it is the project's style, and the chips follow.
    const styleSel = document.getElementById('insp-style-select') as HTMLSelectElement | null;
    const patSel = document.getElementById('insp-pattern-select') as HTMLSelectElement | null;
    // Saving an example must make it show up in the list; assigned below.
    let reloadPatternList: () => void = () => {};
    if (styleSel && patSel) {
      const kind = patternKindFor(lane!.engineId);
      // Our own examples for the style live in the same dropdown, under their
      // own group — they do the same job, so one list, not two.
      const exampleKinds = exKind === 'beat' ? ['beat'] : ['bass', 'melody'];
      let ourExamples: Example[] = [];
      const fillPatterns = (s: StyleId): void =>
        fillPatternSelect(patSel, s, kind, ourExamples.map((e) => ({ id: e.id, name: e.name, source: e.source })));
      const refreshExamples = (s: StyleId): void => {
        void loadAllExamples(s)
          .then((list) => { ourExamples = list.filter((e) => exampleKinds.includes(e.kind)); fillPatterns(s); })
          .catch(() => { ourExamples = []; fillPatterns(s); });
      };

      reloadPatternList = () => refreshExamples(style());
      fillStyleSelect(styleSel, style());
      fillPatterns(style());
      refreshExamples(style());

      styleSel.onchange = () => {
        const next = styleSel.value as StyleId;
        const apply = (): void => {
          this.deps.state.musicality = { ...(this.deps.state.musicality ?? DEFAULT_MUSICALITY), style: next };
          fillPatterns(next);
          refreshExamples(next);
          this.deps.saveSession?.();
        };
        const d = this.deps.historyDeps;
        if (d) withUndo(d, apply); else apply();
      };

      patSel.onchange = () => {
        if (patSel.value === '') return;
        const [source, ref] = patSel.value.split(':');

        // An example of ours: scale degrees rendered into the project tonality.
        if (source === 'ex') {
          const chosen = ourExamples.find((e) => e.id === ref);
          patSel.value = '';
          if (!chosen) return;
          const viewOctave = this.roll?.getOctaveBase?.() ?? 60;
          withClipEdit(() => {
            clip.notes = renderExampleNotes(
              chosen, resolveTonality(lane!, this.deps.state), viewOctave - 12,
              clip.lengthBars, ticksPerBar(this.deps.seq.meter),
            );
          });
          return;
        }

        const index = Number(ref);
        // Melodic patterns are semitone offsets: root them at the octave the
        // roll is showing, minus one — same convention as the 🎲 generator.
        const octaveBase = (this.roll?.getOctaveBase?.() ?? 60) - 12;
        withClipEdit(() => {
          // The lock is the only thing allowed to touch the pattern: closed, the
          // notes are pulled into key; open, they arrive exactly as written.
          const ton = resolveTonality(lane!, this.deps.state);
          const locked = this.deps.state.musicality?.lock ?? false;
          // Library patterns are one bar; clips are two by default. Tile to fill,
          // or the back half of the clip plays nothing.
          const notes = patternNotes(
            style(), kind, index, patternRootFor(octaveBase, ton.key),
            clip.lengthBars, ticksPerBar(this.deps.seq.meter),
            locked ? { key: ton.key, scale: ton.scale } : undefined,
          );
          if (notes.length) clip.notes = notes;
        });
        patSel.value = '';   // back to the placeholder: the pick was an action
      };
    }

    // ── Chords (chord accompaniment) ──────────────────────────────────────────
    // Only show the button for melodic lanes (not drums/audio/sampler-drumkit).
    const chordsBtn = document.getElementById('insp-chords') as HTMLButtonElement | null;
    if (chordsBtn) {
      chordsBtn.hidden = exKind === 'beat' || lane!.engineId === 'audio' || lane!.engineId === 'sampler';
      chordsBtn.onclick = () => {
        // Guard the INPUT: an empty melody has nothing to harmonise.
        if (!clip.notes || clip.notes.length === 0) { void alertDialog('Draw or generate a melody first.'); return; }
        void (async () => {
          const ton = resolveTonality(lane!, this.deps.state);
          const barTicks = ticksPerBar(this.deps.seq.meter);
          const chordNotes = renderChordComp(clip.notes ?? [], {
            key: ton.key,
            scale: ton.scale,
            style: this.deps.state.musicality?.style ?? 'acid-techno',
            bars: clip.lengthBars,
            barTicks,
            octaveBase: 48,
          });
          // Build choice list: melodic lanes (not drums/audio/sampler) + new lane
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
            if (!this.selectedClip) return; // inspector closed mid-dialog
            const chordClip = emptyClip(clip.lengthBars);
            chordClip.notes = chordNotes;
            chordClip.name = 'Chords';
            this.deps.placeChordClip?.(picked, this.selectedClip.clipIdx, chordClip);
          }
        })();
      };
    }

    // (The examples dropdown used to live here. Examples now share the pattern
    // dropdown above — both fill the clip, so one list is enough.)

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
      reloadPatternList();
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
    this.renderContextHeader(lane, clip);
    this.refreshRecButton();
    this.refreshPlayButton();

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

  /** Populate the editor context breadcrumb (Track ▸ Scene ▸ Clip). The clip
   *  name is the relocated #insp-name input (wired in openInspector); here we
   *  fill the track swatch + track/scene labels and wire their inline rename. */
  private renderContextHeader(lane: SessionLane, clip: SessionClip): void {
    if (!this.selectedClip) return;
    const ctx = resolveClipContext(this.deps.state, lane.id, this.selectedClip.clipIdx);
    if (!ctx) return;

    const swatch = document.getElementById('insp-context-swatch');
    if (swatch) swatch.style.background = clip.color ?? '#8a8278';

    const trackEl = document.getElementById('insp-context-track');
    if (trackEl) {
      trackEl.textContent = ctx.trackName;
      trackEl.ondblclick = (e) => {
        e.preventDefault();
        beginInlineRename(trackEl, ctx.trackName, { commit: (v) => this.commitTrackName(lane.id, v) });
      };
    }

    const sceneEl = document.getElementById('insp-context-scene');
    if (sceneEl) {
      sceneEl.textContent = ctx.sceneName;
      sceneEl.ondblclick = (e) => {
        e.preventDefault();
        beginInlineRename(sceneEl, ctx.sceneName, { commit: (v) => this.commitSceneName(this.selectedClip!.clipIdx, v) });
      };
    }

    const rowEl = document.getElementById('insp-context-row');
    if (rowEl) rowEl.textContent = `(row ${ctx.rowNumber})`;

    this.refreshRecButton();
    this.refreshPlayButton();
  }

  /** Re-fill the breadcrumb from the current selection (after a rename). */
  private refreshContextHeader(): void {
    if (!this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (lane && clip) this.renderContextHeader(lane, clip);
  }

  /** Public: re-sync the breadcrumb with current state. Called by the host on
   *  every grid render so a grid-side rename of the open clip's track/scene
   *  (or an undo) is reflected immediately. No-op when no clip is selected. */
  refreshContext(): void {
    this.refreshContextHeader();
  }

  /** Re-render the open clip editor against current state. Called after an
   *  undo/redo so the mounted piano-roll/drum-grid (which closes over the clip
   *  object) reflects the restored notes instead of the stale ones. No-op when
   *  the inspector panel is hidden or nothing is selected. */
  refreshOpenEditor(): void {
    const panel = document.getElementById('session-inspector');
    if (!panel || panel.hidden) return;
    if (!this.selectedClip) return;
    this.renderEditor();
  }

  private commitTrackName(laneId: string, name: string): void {
    const d = this.deps.historyDeps;
    const run = () => {
      const lane = this.deps.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      lane.name = name || undefined;
      this.deps.renderWithMixer();
      this.refreshContextHeader();
    };
    if (d) withUndo(d, run); else run();
  }

  private commitSceneName(sceneIdx: number, name: string): void {
    const d = this.deps.historyDeps;
    const run = () => {
      const scene = this.deps.state.scenes[sceneIdx];
      if (!scene) return;
      scene.name = name || undefined;
      this.deps.renderWithMixer();
      this.refreshContextHeader();
    };
    if (d) withUndo(d, run); else run();
  }

  /** Double (tempoMult 2) or halve (tempoMult 0.5) the open clip's perceived
   *  tempo in one undoable gesture: *2 compresses the notes and repeats the
   *  pattern to fill the clip (length unchanged); /2 stretches the notes and grows
   *  the clip length. Then re-render the editor (new patternTicks), the Length
   *  field, and the grid. */
  private applyTempoScale(tempoMult: number): void {
    if (!this.selectedClip) return;
    const lane = this.deps.state.lanes.find((l) => l.id === this.selectedClip!.laneId);
    const clip = lane?.clips[this.selectedClip.clipIdx];
    if (!clip) return;
    const d = this.deps.historyDeps;
    const run = () => {
      // Preserve the editor octave across the rebuild (renderEditor recreates the
      // piano-roll, which resets its octave base to C4) — mirrors insp-random-notes.
      const octaveBase = this.roll?.getOctaveBase?.() ?? 60;
      scaleClipTempo(clip, tempoMult, ticksPerBar(this.deps.seq.meter));
      const lenEl = document.getElementById('insp-length') as HTMLInputElement | null;
      if (lenEl) lenEl.value = String(clip.lengthBars);
      this.renderEditor();
      this.roll?.setOctaveBase?.(octaveBase);
      this.deps.renderWithMixer();
    };
    if (d) withUndo(d, run); else run();
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
      transcribeLoop: this.deps.transcribeLoop,
      onSeekBar: this.deps.onSeekBar,
      isSceneLinked: this.deps.isSceneLinked,
      onSetSceneLinked: this.deps.onSetSceneLinked,
      onClipLoopEdited: this.deps.onClipLoopEdited,
    };
    this.roll = renderClipEditor(editorBox, lane, clip, editorDeps, editorOverride.get(clip.id));

    // Per-clip automation lanes below the editor. Kept on the instance so
    // adding an insert can refresh the destination picker without a full
    // editor rebuild (which would fight whatever the user is dragging).
    const autoBox = document.createElement('div');
    autoBox.className = 'insp-auto-box';
    host.appendChild(autoBox);
    this.autoBox = autoBox;

    renderClipAutomationLanes(autoBox, clip, {
      seq: this.deps.seq,
      getAutoAbsSubIdx: this.deps.getAutoAbsSubIdx,
      automationRegistry: this.deps.automationRegistry,
      sessionState: this.deps.state,
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
      onChange: () => {
        this.deps.saveSession?.();
        // The chain just changed shape — the open clip's picker is now stale.
        this.refreshClipAutomation();
      },
      registerKnob: this.deps.registerKnob,
      automationScopeId: this.deps.registerKnob ? laneId : undefined,
    });
    host.appendChild(insertsPanel);
  }

  /** Rebuild the open clip's automation panel in place. No-op when no clip is
   *  open. Cheap: it only re-renders the lanes, never the note editor. */
  refreshClipAutomation(): void {
    const sel = this.selectedClip;
    if (!this.autoBox || !sel) return;
    const clip = this.deps.state.lanes.find((l) => l.id === sel.laneId)?.clips[sel.clipIdx];
    if (!clip) return;
    renderClipAutomationLanes(this.autoBox, clip, {
      seq: this.deps.seq,
      getAutoAbsSubIdx: this.deps.getAutoAbsSubIdx,
      automationRegistry: this.deps.automationRegistry,
      sessionState: this.deps.state,
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
