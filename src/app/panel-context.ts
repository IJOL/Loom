// What the host hands a panel plugin when it mounts.
//
// A panel's code is compiled separately and cannot import ours, so this object
// is its ONLY way in. Every method here is a promise the host has to keep
// across versions, which is why it stays small: what WEAVE genuinely needs and
// nothing speculative.

import type { PanelContext, PanelLane, PanelLoopPhase, PanelWeave } from '@loom/plugin-sdk';
import { defaultLaneSelection, defaultWeaveSteps } from '../weave/weave-state';
import {
  retopologise, positionOf, defaultSelection, selectionLoopIds,
} from '../weave/weave-selection';
import { applyFlow, asDrift } from '../weave/flow';
import { stepPreset } from '../automation/automation-steps';
import {
  weaveLoopChoices, weaveLoopContext, rehookOnArrival, type WeaveLoopContext,
} from './weave-loops';
import { stylesWithPatterns } from '../patterns/pattern-library';
import { STYLE_CATALOG, SCALE_CATALOG, rootName, type StyleId } from '../core/musicality';
import type { MusicalityState } from '../session/session-types';
import { isHarmonic } from '../plugins/capabilities';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { emptyClip } from '../session/session';
import type { SessionHost } from '../session/session-host';
import type { LanePlayState } from '../session/session-runtime';
import type { Sequencer } from '../core/sequencer';
import { sceneCountdown } from '../core/scene-countdown';
import { ticksPerBar } from '../core/meter';
import { applyClipLength } from '../core/clip-time-scale';
import { PROGRESSIONS, progressionById, type Chord, type Progression } from '../arranger/progression';
import {
  activeProgression, setDegree, setLength, insertAfter, removeAt,
} from '../arranger/chord-track';
import { TICKS_PER_QUARTER } from '../core/notes';
import { listEngines } from '../engines/registry';
import { getCachedPresets } from '../presets/preset-loader';
import { pagePresetName } from '../instrument-presets/preset-select-state';
import { macroNeutral } from '../weave/weave-catalog';
import { clipRowForLane } from '../weave/weave-transport';
import { STRIP_PARAM_SPECS } from '../core/channel-strip-params';
import type { WeaveState } from '../weave/weave-state';

export interface PanelContextDeps {
  sessionHost: SessionHost;
  seq: Sequencer;
  /** The audio clock. Passed in rather than read off the sequencer, whose own
   *  context is private — and it is the right clock anyway: an animation driven
   *  by the audio time cannot drift away from what is sounding. */
  ctx: AudioContext;
  weave: WeaveState;
  /** Called after a macro moves, so the host can re-derive whatever depends on
   *  it (the live layer, the destination values). */
  onMacroChanged?: (id: string, value: number) => void;
  /** Called after a lane's weave changes — a loop chosen, a topology switched,
   *  the fader moved. The host drops its cached gate so the next tick folds the
   *  new selection. */
  onWeaveChanged?: (laneId: string) => void;
  /** Re-render the panel. Supplied by whoever mounted it. */
  refresh: () => void;
  /** Swap a lane's instrument. main hands in its own undoable wrapper, so a
   *  swap made from the panel undoes exactly like one made from the grid —
   *  there is one engine-swap path in the app and a panel does not get a
   *  second. Absent in fixtures with no audio graph. */
  swapLaneEngine?: (laneId: string, engineId: string) => void;
  /** Apply a preset to a lane, likewise through the host's own path. */
  applyLanePreset?: (laneId: string, presetName: string) => void;
  /** Freeze the weave into a new scene. Returns how many lanes were written.
   *  Absent in fixtures with no session — the button then reports nothing
   *  written rather than pretending. */
  printWeaveScene?: () => number;
  /** The app's unified stop — the one that also finalizes a live take and
   *  resets the Play button, rather than `seq.stop` on its own. Absent in
   *  fixtures with no transport, where unplugging simply stops nothing. */
  stopTransport?: () => void;
  /** Where the chord walk is, read off the SAME bar cursor the fold uses. A
   *  readout that counted its own bars would eventually disagree with the music
   *  by one, which is the most confusing thing a position display can do. */
  weaveChordNow?: () => { bar: number; bars: number; degree: number } | null;
  /** The mixer's OWN mute and solo tables, not copies. A panel that toggled a
   *  private flag would let a lane read soloed here and muted at the desk.
   *  Absent in fixtures with no audio graph — the buttons then do nothing
   *  rather than pretending to. */
  muteState?: Record<string, boolean>;
  soloState?: Record<string, boolean>;
  applyMuteSolo?: () => void;
  /** A lane's fader, read and written through the SAME strip door the mixer
   *  column uses, in the mixer's own units — not a second scale the panel
   *  invents, which is how two faders for one gain end up disagreeing. Absent
   *  in fixtures with no audio graph, where the control reads 1 and moves
   *  nothing. */
  laneLevel?: (laneId: string) => number;
  setLaneLevel?: (laneId: string, level: number) => void;
  /** The project's key/scale/style, through main's ONE undoable writer — the
   *  same one Project Options uses. Absent in fixtures with no session. */
  setMusicality?: (m: MusicalityState) => void;
  /** The ONE destination catalogue, read at ask time. A stale list offers a
   *  destination that is gone. */
  destinations?: () => readonly import('../automation/automation-targets').AutomationTarget[];
  /** The weave's own note source, the one the scheduler reads. Handed in so a
   *  panel can DRAW the bar that is about to play — from the same fold, never a
   *  second one. Absent in fixtures with no weave wiring. */
  weaveNotesFor?: (laneId: string) => (() => readonly {
    start: number; duration: number; midi: number; velocity: number;
  }[] | undefined) | undefined;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const SILENT_PHASE: PanelLoopPhase = { state: 'silent', frac: 0, bars: 0, centerText: '' };

// sceneCountdown reads a map and keeps nothing, so one scratch map serves every
// lane and every frame. Building a fresh Map per lane per frame is the kind of
// allocation that costs nothing until there are eight lanes at sixty hertz.
const scratch = new Map<string, LanePlayState>();

export function createPanelContext(deps: PanelContextDeps): PanelContext {
  /** The mixer column paints its M and S lit state when it is BUILT, so a mute
   *  toggled from a panel changes the audio immediately and leaves the desk's
   *  button looking untouched until something else rebuilds it. Rebuilding here
   *  is what keeps the two surfaces telling the same story. */
  const repaintDesk = () => deps.sessionHost.renderWithMixer();

  /** The weave the master flow READS as its own position.
   *
   *  Off the LANES, not kept beside the speed: the auto-advance writes lane
   *  positions, and a second number remembered here would be the one the panel
   *  shows while the music followed the other.
   *
   *  The first lane that is TRAVELLING. Reading the first lane with a selection
   *  pinned the master readout to a LOCKED one — a number frozen at 0.04 while
   *  the rest of the scene crossed, which reads as a broken control. All locked
   *  falls back to the first, which is then honest: the journey really is not
   *  moving anything. */
  const leadWeave = () => {
    const withWeave = deps.sessionHost.state.lanes
      .filter((l) => deps.weave.lanes[l.id]?.weave != null);
    const lead = withWeave.find((l) => !deps.weave.lanes[l.id]?.locked) ?? withWeave[0];
    return lead ? deps.weave.lanes[lead.id]?.weave ?? null : null;
  };

  /** The last flow the PANEL sent, so the next one can tell a hand going forward
   *  from a hand going back.
   *
   *  Against the panel's own previous number rather than against a lane's
   *  position, because they are not the same thing: the panel's dial winds past
   *  1 and keeps counting, a lane's position always folds into 0..1, and in
   *  'free' the flow is a delta from a fixed base rather than a position at all.
   *  Comparing across those was right for exactly one of the three. */
  let lastFlowSent: number | undefined;

  /** Everything the loop list and the loop resolver need about a lane, gathered
   *  once. Built per call rather than cached: the style, the key and the lock
   *  all move, and a stale copy would list loops the lane no longer draws. */
  const loopContext = (laneId: string): WeaveLoopContext => {
    const lanes = deps.sessionHost.state.lanes;
    const macro = (id: string) => {
      const v = deps.weave.macros[id];
      return Number.isFinite(v) ? v : macroNeutral(id);
    };
    return weaveLoopContext(
      lanes.find((l) => l.id === laneId),
      deps.sessionHost.state.musicality ?? DEFAULT_MUSICALITY,
      deps.weave.lanes[laneId]?.forcedStyle,
      // The macros are passed here for the same reason the scheduler passes
      // them: this LISTS the loops and that RESOLVES them, so a lane that
      // strayed to another style in one and not the other would offer loops it
      // then refuses to play.
      {
        styleMix: macro('styleMix'),
        darkness: macro('darkness'),
        laneIndex: Math.max(0, lanes.findIndex((l) => l.id === laneId)),
        seed: deps.weave.seed,
      },
      // The same length the scheduler resolves against, for the same reason the
      // macros are passed: this lists the loops and that plays them.
      {
        clipBars: lanes.find((l) => l.id === laneId)?.clips
          .find((c) => c && c.lengthBars > 0)?.lengthBars,
        barTicks: ticksPerBar(deps.seq.meter),
      },
    );
  };

  /** The library loops this lane may weave, in list order and nothing else.
   *  Rotated by where the lane sits so two tracks added in a row are not
   *  weaving the same pair. */
  const libraryFor = (laneId: string, offset = 0): string[] => {
    const lanes = deps.sessionHost.state.lanes;
    const library = weaveLoopChoices(loopContext(laneId))
      .map((c) => c.id)
      .filter((id) => id.startsWith('lib:'));
    const i = Math.max(0, lanes.findIndex((l) => l.id === laneId));
    const at = (2 * i + offset) % (library.length || 1);
    return [...library.slice(at), ...library.slice(0, at)];
  };

  /** How far into its shelf a lane starts, for a given roll of the dice.
   *
   *  A hash and not a counter, and seeded by the SCENE's seed, so a re-roll is
   *  reproducible: the same session dealt the same way twice. Per lane, so one
   *  press moves every lane somewhere different rather than sliding them all by
   *  the same amount — which would keep whatever relationship they had and read
   *  as no roll at all. */
  const rollOffset = (laneId: string): number => {
    let v = 2166136261;
    for (const s of [String(deps.weave.seed), laneId]) {
      for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 16777619) >>> 0;
    }
    return v % 4096;
  };

  /** Re-pick a lane's loops when the shelves it reads have moved under it.
   *
   *  Only when one of its named loops is no longer OFFERED: a selection that
   *  still lists is the user's choice and must survive. This is deliberately not
   *  "the engine changed" — an id that resolves to the wrong kind of material is
   *  the failure, and that is a question about the LIST, not about the id. */
  /** Every chord edit, through one seam: read what is PLAYING, apply the pure
   *  op, store the result as a written track.
   *
   *  Reading through `activeProgression` is what makes the first edit of a
   *  catalogue entry a copy rather than damage — the entry is read, the edit
   *  lands on the copy, and the copy is what gets stored. The catalogue is
   *  never written to.
   *
   *  `'*'` because the harmony belongs to no single lane: every lane's fold now
   *  sits on different chords, so every cached one is stale. And this is the
   *  only thing that tells the autosave the weave moved — a weave edit is
   *  deliberately not an undo entry, so nothing else would. */
  const editChords = (op: (t: Progression) => Chord[]): void => {
    deps.weave.chords = op(activeProgression(deps.weave));
    deps.onWeaveChanged?.('*');
    deps.refresh();
  };

  const reseedLaneIfLoopsMoved = (laneId: string): void => {
    const sel = deps.weave.lanes[laneId]?.weave;
    if (!sel) return;
    const offered = new Set(weaveLoopChoices(loopContext(laneId)).map((c) => c.id));
    if (selectionLoopIds(sel).every((id) => offered.has(id))) return;
    const next = defaultSelection(sel.kind, libraryFor(laneId));
    deps.weave.lanes[laneId] = { ...deps.weave.lanes[laneId]!, weave: next };
    deps.onWeaveChanged?.(laneId);
  };

  return {
    lanes(): PanelLane[] {
      // A flat, serialisable summary. Handing the real lane objects over would
      // let a plugin mutate the session behind the host's back.
      return deps.sessionHost.state.lanes.map((l) => ({
        id: l.id,
        name: l.name || l.id,
        engineId: l.engineId,
        // Which preset a lane is on lives in THREE places today, and none of
        // them owns it: `enginePresetName` (persists, but only engine-swap,
        // the kit picker and the MIDI importer ever write it), `pagePresetName`
        // (what the live dropdown records, module state, dies on reload), and
        // the mirrored params (the SOUND, not the label). This reads the same
        // one the existing lane dropdown reads, then falls back — inventing a
        // fourth answer here would make the asymmetry worse rather than expose
        // it. See REMAINING-WORK.
        presetId: pagePresetName.get(l.id) ?? l.enginePresetName,
      }));
    },

    engines() {
      // The SAME list the lane selector paints from. A panel that built its own
      // would drift the moment a plugin engine registered.
      return listEngines('polyhost').map((e) => ({ id: e.id, name: e.name }));
    },

    presets(engineId) {
      // The same preset cache the lane's own dropdown reads, in the same
      // vocabulary: `engine:<name>` is what recordPagePresetForLane stores
      // verbatim, so offering bare names here would guarantee the current
      // selection never matched an option.
      return getCachedPresets(engineId).map((p) => ({
        id: `engine:${p.name}`,
        name: p.name,
      }));
    },

    setEngine(laneId, engineId) {
      // main's undoable wrapper around swapLaneEngineFlow — one engine-swap
      // path in the app, and a swap made here undoes like one made in the grid.
      deps.swapLaneEngine?.(laneId, engineId);
      // Which library shelves this lane reads may have just changed: melodic
      // lanes get bass and lead, a drum machine gets drums. A selection left
      // naming bass loops on a drum lane still RESOLVES — the id carries the
      // kind — so it would quietly play a bassline through the drum voices.
      reseedLaneIfLoopsMoved(laneId);
      deps.refresh();
    },

    setPreset(laneId, presetId) {
      deps.applyLanePreset?.(laneId, presetId);
      deps.refresh();
    },

    macro(id) {
      const v = deps.weave.macros[id];
      return Number.isFinite(v) ? v : macroNeutral(id);
    },

    setMacro(id, value) {
      const v = clamp01(value);
      deps.weave.macros[id] = v;
      deps.onMacroChanged?.(id, v);
    },

    refresh: deps.refresh,

    barPhase() {
      if (!deps.seq.isPlaying()) return -1;
      const bar = ticksPerBar(deps.seq.meter);
      const secPerTick = (60 / deps.seq.bpm) / TICKS_PER_QUARTER;
      const barSec = bar * secPerTick;
      // Derived from the audio clock rather than from a UI timer, so the
      // animation cannot drift away from what is actually sounding.
      const t = deps.ctx.currentTime;
      return barSec > 0 ? (((t % barSec) + barSec) % barSec) / barSec : 0;
    },

    isPlaying() {
      return deps.seq.isPlaying();
    },

    laneTransport(laneId) {
      return {
        playing: deps.sessionHost.laneStates.get(laneId)?.playing != null,
        muted: deps.muteState?.[laneId] ?? false,
        soloed: deps.soloState?.[laneId] ?? false,
      };
    },

    setLanePlaying(laneId, playing) {
      if (!playing) {
        // The host's own stop seam, which also releases the lane's still-
        // sounding voices — a long audio clip otherwise plays to its end.
        deps.sessionHost.callbacks.onStopLane?.(laneId);
        return;
      }
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      // The launched scene's row if this lane has a clip there, else the first
      // clip it has. Following the scene keeps a lane started from here in step
      // with the ones started from the grid — and the rule lives in ONE place,
      // because the transport's Play now starts weaving lanes by the same one.
      const row = clipRowForLane(lane.clips, deps.sessionHost.activeSceneIdx);
      if (row >= 0) deps.sessionHost.launchClipAt(laneId, row);
    },

    laneLevelRange() {
      // Straight from the spec the mixer's own fader reads, so the two controls
      // cannot end up with different tops.
      const spec = STRIP_PARAM_SPECS.find((s) => s.id === 'bus.level');
      return { min: spec?.min ?? 0, max: spec?.max ?? 1.5 };
    },

    laneLevel(laneId) {
      // 1 is unity, and it is what a lane with no strip should read: a control
      // that showed 0 for "no audio graph" would look like a muted lane.
      return deps.laneLevel?.(laneId) ?? 1;
    },

    setLaneLevel(laneId, level) {
      deps.setLaneLevel?.(laneId, level);
      // The mixer column shows the same gain. Repainting keeps the two faders
      // from telling different stories about one number.
      repaintDesk();
    },

    setLaneMuted(laneId, muted) {
      if (!deps.muteState) return;
      deps.muteState[laneId] = muted;
      deps.applyMuteSolo?.();
      repaintDesk();
    },

    setLaneSoloed(laneId, soloed) {
      if (!deps.soloState) return;
      deps.soloState[laneId] = soloed;
      deps.applyMuteSolo?.();
      repaintDesk();
    },

    loops(laneId) {
      // The pattern library first-class, the lane's own clips alongside it. One
      // list, one vocabulary, so a weave can cross-fade a library loop into a
      // clip without either side knowing which is which.
      return weaveLoopChoices(loopContext(laneId));
    },

    styles() {
      // Only the styles the library actually ships loops for. Offering the rest
      // would be a dropdown whose entries empty the loop list.
      //
      // Ordered by the ONE catalogue the whole program uses, so neighbours here
      // are the neighbours the Project Options dropdown shows.
      const shipped = new Set<string>(stylesWithPatterns());
      return STYLE_CATALOG
        .filter((s) => shipped.has(s.id))
        .map((s) => ({ id: s.id, name: s.label }));
    },

    laneStyle(laneId) {
      return loopContext(laneId).style;
    },

    setLaneStyle(laneId, styleId) {
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = { ...cur, forcedStyle: styleId as StyleId };
      // The whole point of this control is WHICH shelf the lane draws from, so
      // the loops have to move with it. Left alone the selection went on naming
      // the old style's ids — which still RESOLVE, so the lane kept playing the
      // style you just left while every picker showed a dash.
      reseedLaneIfLoopsMoved(laneId);
      deps.onWeaveChanged?.(laneId);
    },

    laneLocked(laneId) {
      return deps.weave.lanes[laneId]?.locked ?? false;
    },

    setLaneLocked(laneId, locked) {
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = { ...cur, locked };
      // No onWeaveChanged: the lock does not change what this lane is PLAYING
      // right now, only whether the flow may move it next tick. Invalidating
      // would rebuild every source to fold exactly the same notes.
    },

    locked() {
      return deps.weave.locked === true;
    },

    setLocked(on) {
      // No onWeaveChanged: locking changes nothing about what is playing RIGHT
      // NOW, only whether anything may move it next tick. Invalidating would
      // rebuild every source to fold exactly the same notes — the same reason
      // the per-lane lock does not invalidate either.
      deps.weave.locked = on;
      deps.refresh();
    },

    bypassed() {
      return deps.weave.bypass === true;
    },

    setBypassed(on) {
      // Unplug the weave from the clock — and stop the clock with it.
      //
      // Carrying on was the first reading and it is the one that surprised
      // people: after ten minutes of listening to the weave, switching it off
      // uncovered whatever the session grid had launched, which nobody
      // remembered was under there. Off should mean off.
      //
      // The TRANSPORT, never the lanes. Muting and stopping the driven lanes
      // was tried and reverted, and those reasons still hold — it reached into
      // the mixer to answer a question about this panel, and it left a session
      // saved silent with the button unable to undo it. Stopping the transport
      // touches no mixer state, saves nothing, and is undone by pressing play.
      deps.weave.bypass = on;
      if (on) deps.stopTransport?.();
      // Every cached fold is now answering the wrong question, and the next tick
      // has to ask again — off, so the lanes weave once more; on, so nothing is
      // left holding a source the gate no longer consults.
      deps.onWeaveChanged?.('*');
    },

    stepRows() {
      return deps.weave.steps.map((s) => (
        { destId: s.destId, values: [...s.values], mode: s.mode, on: s.on }
      ));
    },

    addStepRow() {
      deps.weave.steps.push(defaultWeaveSteps());
      deps.refresh();
      return deps.weave.steps.length - 1;
    },

    removeStepRow(row) {
      if (row < 0 || row >= deps.weave.steps.length) return;
      deps.weave.steps.splice(row, 1);
      // Never down to nothing: an empty rack leaves the panel with a "+" and no
      // hint of what it adds. The last row is emptied instead of removed.
      if (deps.weave.steps.length === 0) deps.weave.steps.push(defaultWeaveSteps());
      deps.refresh();
    },

    setStep(row, index, value) {
      const s = deps.weave.steps[row];
      if (!s || index < 0 || index >= s.values.length) return;
      s.values[index] = Math.min(1, Math.max(0, value));
      // No onWeaveChanged: a step is a PARAM write, not material. Dropping every
      // cached fold because a knob-row moved would rebuild the notes of every
      // lane for a value that has nothing to do with them.
    },

    // Out-of-range does nothing rather than throwing: a row can be removed while
    // a handler built over it is still on screen holding its index.
    setStepsDest(row, destId) {
      const s = deps.weave.steps[row];
      if (s) s.destId = destId;
    },
    setStepsOn(row, on) {
      const s = deps.weave.steps[row];
      if (s) s.on = on;
    },
    setStepsMode(row, mode) {
      const s = deps.weave.steps[row];
      if (s) s.mode = mode === 'ramp' ? 'ramp' : 'hold';
    },

    progressions() {
      // The `feel` line is what the panel shows beside each name: nobody should
      // have to read roman numerals to pick one.
      return PROGRESSIONS.map((p) => ({ id: p.id, name: p.name, group: p.feel }));
    },

    progression() { return deps.weave.progression ?? 'static'; },

    chordNow() {
      return deps.weaveChordNow?.() ?? null;
    },

    setProgression(id) {
      deps.weave.progression = progressionById(id) ? id : 'static';
      // Picking from the shelf throws away what was written, or the written one
      // would go on winning and the dropdown would be naming a progression
      // nobody is playing.
      delete deps.weave.chords;
      // Every lane's fold moves onto different chords, so every cached one is
      // stale — this is material, not a param.
      deps.onWeaveChanged?.('*');
      deps.refresh();
    },

    chordTrack() {
      // A COPY. The array is the scene's harmony; handing the real one over
      // would let a panel edit it behind the host's back, which is the same
      // reason `lanes()` hands out a flat summary.
      return activeProgression(deps.weave).map((c) => ({ ...c }));
    },

    isCustomProgression() {
      return !!deps.weave.chords && deps.weave.chords.length > 0;
    },

    setChordDegree(index, degree) { editChords((t) => setDegree(t, index, degree)); },
    setChordBars(index, bars)     { editChords((t) => setLength(t, index, bars)); },
    insertChordAfter(index)       { editChords((t) => insertAfter(t, index)); },
    removeChord(index)            { editChords((t) => removeAt(t, index)); },

    resetChordTrack() {
      delete deps.weave.chords;
      deps.onWeaveChanged?.('*');
      deps.refresh();
    },

    stepsTool(row, tool) {
      const s = deps.weave.steps[row];
      if (!s) return;
      // The painter's own presets, not a second set: there is one right answer
      // to "what does invert mean" and it already lives in automation-steps.
      // `Math.random` is injected there so a test can pin the random one; a
      // live press is the case that genuinely wants the dice.
      s.values = stepPreset(tool, s.values.length, s.values, Math.random);
      deps.refresh();
    },

    destinations() {
      // The ONE catalogue. Enumerating knobs or building a parallel list here is
      // how four inconsistent pickers happened once already.
      return (deps.destinations?.() ?? []).map((d) => ({
        id: d.id,
        name: d.label,
        group: d.laneName,
      }));
    },

    laneNotes(laneId) {
      // The SAME source the scheduler reads. Folding again here would be a
      // picture of a bar nobody plays — and this drawing exists precisely to be
      // trusted: it is the only place the result of all this is visible.
      const notes = deps.weaveNotesFor?.(laneId)?.();
      if (!notes || notes.length === 0) return [];
      const bar = ticksPerBar(deps.seq.meter);
      if (!(bar > 0)) return [];
      return notes.map((n) => ({
        at: n.start / bar,
        length: Math.max(1, n.duration) / bar,
        midi: n.midi,
        velocity: n.velocity,
        from: (n as { layerIndex?: number }).layerIndex,
      }));
    },

    laneWeave(laneId) {
      return deps.sessionHost.state.lanes.some((l) => l.id === laneId)
        ? deps.weave.lanes[laneId]?.weave ?? null
        : null;
    },

    laneSound(laneId) {
      return deps.weave.lanes[laneId]?.sound ?? null;
    },

    setLaneSound(laneId, value) {
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      const sound = value === null ? undefined : Math.min(1, Math.max(0, value));
      deps.weave.lanes[laneId] = { ...cur, sound };
      // MATERIAL, not a param: turning the fader on or off changes whether the
      // fold tags its notes with the loop they came from, so every cached
      // source for this lane is answering the wrong question.
      deps.onWeaveChanged?.(laneId);
    },

    setLaneWeave(laneId, weave) {
      // A locked lane keeps the loops it has — by hand as well as by clock. The
      // lock exists to hold an arrangement still, and a dropdown that swapped
      // the material under it would be the one hole in that promise.
      if (deps.weave.locked || deps.weave.lanes[laneId]?.locked) return;
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = { ...cur, weave };
      deps.onWeaveChanged?.(laneId);
    },

    flow() {
      const f = deps.weave.flow;
      return {
        position: positionOf(leadWeave()),
        drift: f?.drift ?? 'together',
        speedBars: f?.speedBars ?? 0,
        evolve: !!f?.evolve,
      };
    },

    setFlow(position, drift, speedBars, evolve) {
      const mode = asDrift(drift);
      const was = deps.weave.flow;
      const evolving = !!evolve;

      // 'free' positions each lane relative to where it ALREADY was, so it needs
      // a fixed starting line or every call compounds the last one. A slider
      // sends its absolute value on every pointer move, so without this a single
      // drag added the same amount dozens of times and the lanes ran away.
      //
      // Captured when the mode is ENTERED and kept until it is left. The other
      // two modes say where a lane IS, so they carry no base at all.
      const base = mode !== 'free' ? undefined
        : was?.drift === 'free' && was.base ? was.base
          : Object.fromEntries(deps.sessionHost.state.lanes.map((l) =>
            [l.id, positionOf(deps.weave.lanes[l.id]?.weave)]));

      deps.weave.flow = {
        drift: mode, speedBars: Math.max(0, speedBars || 0), base, evolve: evolving,
      };
      // The SAME writer the auto-advance uses, with the SAME starting line. A
      // hand on the fader and a clock driving it are one journey; two answers
      // would make the scene jump the moment the transport started.
      //
      // And the same handover, for the same reason: the far end is the far end
      // whether the clock reached it or a hand dragged it there. Passing no
      // re-hook here was the original bug written down — a hand wrapped back to
      // the start AND the pair never advanced, which is the worst of both.
      //
      // But ONLY going forward. `applyFlow` reads "arrived" as "the position
      // dropped by more than half a lap", which is exactly right for the clock —
      // it only ever advances, so a big drop can only be the far end folding
      // round — and a false positive for a hand, which can go back. Seen in the
      // browser: dragging from 0.95 to 0.20 in one move handed over, so rewinding
      // the fader quietly changed the material under you.
      //
      // The FIRST gesture cannot have crossed anything, so it does not hand
      // over; after that the panel's own previous number says which way the
      // hand went.
      //
      // And a call that merely FLIPS the switch never hands over, whatever the
      // numbers say. Seen in the browser: turned to the far end in STATIC, then
      // pressed EVOLVE, and the pair advanced on the spot — because the newly
      // wrapping position folded 1 to 0, which looks exactly like a lap. Reading
      // a mode change as travel is wrong on its own terms: nothing moved.
      const modeChanged = !!was?.evolve !== evolving;
      const advancing = !modeChanged
        && lastFlowSent !== undefined && position >= lastFlowSent - 1e-9;
      lastFlowSent = position;

      const rehook = (laneId: string) => {
        const entry = deps.weave.lanes[laneId];
        const next = rehookOnArrival(
          entry?.weave, loopContext(laneId), deps.weave.seed, laneId,
        );
        if (next && entry) deps.weave.lanes[laneId] = { ...entry, weave: next };
      };

      // Locked, the SETTINGS above are still written — drift, speed and EVOLVE
      // are how the journey will behave when it is let go, and refusing to
      // record them would make the panel forget what the user chose. What the
      // lock stops is the journey MOVING, which is everything below.
      if (deps.weave.locked) { deps.refresh(); return; }

      applyFlow(
        deps.weave.lanes,
        deps.sessionHost.state.lanes.map((l) => l.id),
        position,
        mode,
        base && new Map(Object.entries(base)),
        evolving && advancing ? rehook : undefined,
        evolving,
      );
      deps.onWeaveChanged?.('*');
    },

    setClipLength(laneId, factor) {
      // The clip editor's own operation, not a second one: applyClipLength keeps
      // the bar count, the loop region and the automation curves in step with
      // the notes. Building this on the note maths alone is how a clip ends up
      // with automation that no longer lines up.
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      const clip = lane?.clips.find((c) => c);
      if (!clip) return;
      applyClipLength(clip, factor, 'repeat', ticksPerBar(deps.seq.meter));
      // The weave folds into a clip of a given length, so the phrase it plays
      // just changed shape: the cached source has to go.
      deps.onWeaveChanged?.(laneId);
      repaintDesk();
      deps.refresh();
    },

    musicality() {
      const m = deps.sessionHost.state.musicality ?? DEFAULT_MUSICALITY;
      return { key: m.key, scale: m.scale, style: m.style, bpm: deps.seq.bpm };
    },

    setMusicality(key, scale, style) {
      const m = deps.sessionHost.state.musicality ?? DEFAULT_MUSICALITY;
      // The host's own path, so this undoes like a change made in Project
      // Options and repaints the toolbar chip. `lock` is carried through
      // untouched: it is a different decision and the panel does not show it.
      deps.setMusicality?.({
        key, lock: m.lock,
        scale: scale as MusicalityState['scale'],
        style: style as StyleId,
      });
      // Which style each lane draws from moved, so the loop lists and every
      // built source are stale.
      deps.onWeaveChanged?.('*');
    },

    keys() {
      return Array.from({ length: 12 }, (_, pc) => ({ id: String(pc), name: rootName(pc) }));
    },

    scales() {
      return SCALE_CATALOG.map((s) => ({ id: s.id, name: s.label }));
    },

    addLane(engineId) {
      // The host's own add-lane path — undoable, allocates the strip and the
      // engine, seeds a launchable scene. A panel that pushed a lane onto the
      // array itself would get a row in the grid with no audio behind it.
      const before = new Set(deps.sessionHost.state.lanes.map((l) => l.id));
      deps.sessionHost.callbacks.onAddLane?.(engineId);
      const made = deps.sessionHost.state.lanes.find((l) => !before.has(l.id));
      if (!made) return '';

      // A clip to carry it. The weave REPLACES a clip's notes rather than
      // existing beside them, and the scheduler skips a lane with nothing
      // playing — so a track with a weave and no clip is silent, however well
      // the weave folds. The clip is the vessel: one bar, no notes, and the
      // weave fills it every tick.
      const clip = emptyClip(1);
      clip.name = 'Weave';
      made.clips.push(clip);
      const row = deps.sessionHost.state.scenes[0];
      if (row) row.clipPerLane[made.id] = 0;

      // Born weaving. A lane that arrived empty would leave the panel exactly as
      // useless as it was, and picking the first two loops for you is the whole
      // difference between "add a track" and "start weaving".
      // From the LIBRARY only, rotated by position. The carrier clip above is in
      // this lane's loop list too, and it is empty by construction — picked as an
      // end of the crossfade it would make one extreme of the fader silence,
      // which looks exactly like a broken weave.
      const sel = defaultSelection('ab', libraryFor(made.id));
      if (sel) {
        deps.weave.lanes[made.id] = { ...defaultLaneSelection(), weave: sel };
        deps.onWeaveChanged?.(made.id);
      }
      deps.refresh();
      return made.id;
    },

    reseed() {
      // The dice, and it deals LOOPS.
      //
      // It used to move the seed and nothing else, which fed exactly one thing:
      // styleForLane — and that returns the base style untouched whenever Style
      // mix sits at 0, its neutral and its default. So the button did nothing at
      // all in the configuration everyone starts in. mpump's MIX is the whole
      // creative loop of that program; a dice that no-ops is worse than none.
      deps.weave.seed = (deps.weave.seed % 1_000_000) + 1;

      for (const lane of deps.sessionHost.state.lanes) {
        const entry = deps.weave.lanes[lane.id];
        // LOCKED lanes are the point of the dice. You roll, you keep what you
        // like by locking it, you roll again — that loop is what lets someone
        // arrive at a scene without ever opening a list, and it only works if
        // the lock is what the dice obeys.
        if (!entry?.weave || entry.locked) continue;
        const cur = entry.weave;
        const next = defaultSelection(cur.kind, libraryFor(lane.id, rollOffset(lane.id)));
        // The MATERIAL is re-dealt; WHERE the scene is in its journey is not.
        // Rolling the dice mid-crossfade must not snap every lane back to the
        // start — that would be a cut, and a cut is the one thing this panel is
        // for avoiding.
        if (!next) continue;
        const kept = cur.kind === 'cloud' && next.kind === 'cloud'
          ? { ...next, x: cur.x, y: cur.y }
          : { ...next, x: cur.x };
        deps.weave.lanes[lane.id] = { ...entry, weave: kept };
      }

      deps.onWeaveChanged?.('*');
      deps.refresh();
    },

    printScene() {
      return deps.printWeaveScene?.() ?? 0;
    },

    setLaneTopology(laneId, kind) {
      // The same list the dropdown offers, so a first selection is filled from
      // what the user can actually see — the library included, not just the two
      // clips that happen to be in the grid.
      const loopIds = weaveLoopChoices(loopContext(laneId)).map((c) => c.id);
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = {
        ...cur,
        weave: retopologise(cur.weave, kind, loopIds),
      };
      deps.onWeaveChanged?.(laneId);
    },

    loopPhase(laneId): PanelLoopPhase {
      const lp = deps.sessionHost.laneStates.get(laneId);
      if (!lp) return SILENT_PHASE;

      // The scene ring's own reading, narrowed to one lane: with a single entry
      // `governingLoopSec` returns that lane's loop and `sceneSwitchBoundary`
      // its next wrap, so a ring in a WEAVE row and the one in the master strip
      // cannot disagree about where the bar is. Deriving a second phase here
      // would be a second answer to a question that already has an owner.
      scratch.clear();
      scratch.set(laneId, lp);
      const c = sceneCountdown(scratch, deps.ctx.currentTime, deps.seq.bpm, deps.seq.meter);
      return { state: c.state, frac: c.frac, bars: c.bars, centerText: c.centerText };
    },
  };
}
