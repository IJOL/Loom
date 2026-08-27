// What the host hands a panel plugin when it mounts.
//
// A panel's code is compiled separately and cannot import ours, so this object
// is its ONLY way in. Every method here is a promise the host has to keep
// across versions, which is why it stays small: what WEAVE genuinely needs and
// nothing speculative.

import type { PanelContext, PanelLane, PanelLoopPhase, PanelWeave } from '@loom/plugin-sdk';
import { DEFAULT_LEVEL } from '../harmony/follow-source';
import { defaultLaneSelection, defaultWeaveSteps, finitePosition } from '../weave/weave-state';
import {
  retopologise, positionOf, defaultSelection, selectionLoopIds, redrawQuietest,
} from '../weave/weave-selection';
import {
  applyFlow, asDrift, alignPositions, placeAt as placeWeave, wrap01,
  type PositionedWeave,
} from '../weave/flow';
import { stepPreset } from '../automation/automation-steps';
import {
  weaveLoopChoices, weaveLoopEntry, weaveLoopContext, rehookOnArrival, rehookOnRewind, pushTrail,
  type WeaveLoopContext,
} from './weave-loops';
import { evolveCloudLanes } from './weave-cloud-evolve';
import { stylesWithPatterns } from '../patterns/pattern-library';
import { STYLE_CATALOG, SCALE_CATALOG, rootName, type StyleId } from '../core/musicality';
import type { MusicalityState, LaneRole } from '../session/session-types';
import { isHarmonic, usesKitPresets } from '../plugins/capabilities';
import { laneLayers } from '../engines/layers-engine';
import {
  slotChoices, setLayerEngine, recallLayerPreset, fillEmptyLayerSlots,
} from '../engines/layers-rack-ui';
import { layerPrefix } from '../audio-dsp/layers/layer-spec';
import { commitParamForLane } from '../engines/engine-param-commit';
import { dbfsOf } from '../core/level-meter';
import { roleMembers } from './panel-context-role';
import { followMembers } from './panel-context-follow';
import { generatorMembers } from './panel-context-generator';
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
import { pagePresetName, presetControlsDeps } from '../instrument-presets/preset-select-state';
import { presetsFor, applyPresetToLane } from '../instrument-presets/preset-catalogue';
import { getDrumKits, loadDrumKits } from '../presets/drum-kits-loader';
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
  /** The panel takes a lane back from the grid.
   *
   *  Launching a scene — or a clip from the grid — hands its lanes over: they
   *  play what the grid says and weave nothing. This is the way back, and it
   *  belongs to the gestures that mean "weave this lane": its own ▶ in the
   *  panel, choosing a topology, choosing a loop. Absent in fixtures with no
   *  weave runtime. */
  resumeWeaving?: (laneId: string) => void;
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
  /** Repaint the grid and the mixer, at most ONCE per frame.
   *
   *  It used to be a direct call, and a fader is what made that untenable: a
   *  range input fires `input` several times per frame under a drag, and each
   *  one rebuilt the whole desk. The main thread spent the gesture re-rendering
   *  instead of following the pointer, so the fader stalled and you had to let
   *  go and grab it again. Reported exactly that way.
   *
   *  Coalescing is the honest fix rather than repainting less often: the desk
   *  still shows the move as it happens, it just does it once per frame like
   *  everything else that draws. The GAIN is written on every event regardless —
   *  what is deferred is the picture, never the sound. */
  let deskPending = false;
  const repaintDesk = () => {
    if (deskPending) return;
    deskPending = true;
    // A frame when there is one, a timeout when there is not. Half this file's
    // callers run in a fixture with no DOM at all, and a repaint that THREW
    // there would make every unrelated test depend on the browser.
    const soon = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 0);
    soon(() => {
      deskPending = false;
      deps.sessionHost.renderWithMixer();
    });
  };

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
        // The leg travels with the rest for the reason stated just above: the
        // style is now re-thrown per leg, so a list built without it would
        // offer the loops of the style this lane had two legs ago.
        legs: deps.weave.lanes[laneId]?.legs ?? 0,
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

  /** The SHELF this lane may weave — everything it is offered that is not one of
   *  its own clips. Rotated by where the lane sits so two tracks added in a row
   *  are not weaving the same pair.
   *
   *  "Not a clip", not "starts with lib:". A chordal lane reads no pattern shelf
   *  at all — its material is generated and its ids start `chord:` — so the
   *  narrower test handed it an EMPTY shelf, and a reseed of a lane marked Pad
   *  produced no selection: the lane silently stopped weaving at the moment it
   *  was told what to play. */
  const libraryFor = (laneId: string, offset = 0): string[] => {
    const lanes = deps.sessionHost.state.lanes;
    const library = weaveLoopChoices(loopContext(laneId))
      .map((c) => c.id)
      .filter((id) => !id.startsWith('clip:'));
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
  /** The song's tonality, which is where the progression lives since
   *  2026-08-25. Read through one accessor: seven call sites below reach for
   *  it, and seven copies of the path is seven chances to read the weave's
   *  old field back into existence. */
  const tonality = () => deps.sessionHost.state.musicality;

  const editChords = (op: (t: Progression) => Chord[]): void => {
    tonality().chords = op(activeProgression(tonality()));
    deps.onWeaveChanged?.('*');
    deps.refresh();
  };

  /** Is this lane a RACK of instruments rather than one?
   *
   *  Asked of the destination CATALOGUE rather than of the lane's engine id: it
   *  is the live truth — a lane converted once and swapped back still carries
   *  the stored rack — it is the same question the sound-fader applier asks
   *  before each write, and it needs no core comparison against the name of an
   *  engine. */
  /** One reading buffer per lane, kept for the life of the panel context. */
  const meterBuffers = new Map<string, Float32Array<ArrayBuffer>>();

  const isRack = (laneId: string): boolean =>
    (deps.destinations?.() ?? []).some((d) => d.id === `${laneId}.l0.gain`);

  /** How many instruments this lane's SOUND control has ends for.
   *
   *  The sound control wears the shape of the lane's LOOP control: a lane
   *  crossing two loops crosses two sounds on a fader, a lane on a square of
   *  four crosses four on a square. One shape per lane rather than one shape
   *  for the panel — the row already reads as "this is how this lane moves",
   *  and a hand that has learnt the loop control has learnt the other one. */
  const soundEnds = (laneId: string): number =>
    deps.weave.lanes[laneId]?.weave?.kind === 'cloud' ? 4 : 2;

  /** Give this lane a rack deep enough for the control it is about to show.
   *
   *  Three cases and they are genuinely different. Not a rack at all: convert,
   *  which carries the lane's own sound into slot 0 and fills the rest. A rack
   *  that is deep enough: nothing, and NOT a re-deal — the instruments you were
   *  crossing between are the ones you chose. A rack that is too shallow — a
   *  lane converted on A→B and since moved to a cloud — grows, keeping every
   *  slot it already had, because the alternative is two corners of the square
   *  that are silent with nothing on screen saying why. */
  const ensureSoundRack = (laneId: string): void => {
    const want = soundEnds(laneId);
    if (!isRack(laneId)) {
      deps.sessionHost.callbacks.onConvertToLayered?.(laneId, { slots: want });
      return;
    }
    const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
    const rack = laneLayers(lane);
    const held = rack.map((l) => l.engineId).filter(Boolean);
    if (held.length >= want) return;

    // Nothing to write to, nothing to do — and checked BEFORE `slotChoices`,
    // which builds every engine's descriptor and so needs a live registry. A
    // fixture with no audio graph has neither, and asking the expensive question
    // first made it throw rather than answer "not here".
    const resources = deps.sessionHost.deps?.laneResources;
    if (!resources?.get(laneId)?.engine) return;

    // A COPY of what slot 0 holds, for the same reason converting duplicates:
    // a new corner is somewhere to put an instrument, not a stranger dealt into
    // your lane. It dealt instruments the rack did not already hold, which read
    // as the lane changing by itself.
    const base = laneLayers(lane)[0];
    if (!base?.engineId) return;
    const add = Array.from({ length: want - held.length }, () => base.engineId);
    const grown = fillEmptyLayerSlots(lane, add);
    // Re-read AFTER the fill: it wrote the rack, which rebuilds the lane, so the
    // engine to write to is the one that exists now and not the one checked
    // above.
    const engine = resources.get(laneId)?.engine;
    if (!engine) return;
    // Slot 0's own params, so the new corner really is the same sound rather
    // than that engine's factory defaults — the lane may be on a patch no preset
    // names. Read off the LIVE engine, which is the only place a lane's current
    // values all exist.
    const from = layerPrefix(0);
    const copy = engine.params
      .filter((p) => p.id.startsWith(from) && p.id !== `${from}gain`)
      .map((p) => [p.id.slice(from.length), engine.getBaseValue(p.id)] as const);
    for (const i of grown) {
      const id = laneLayers(lane)[i]?.engineId;
      if (!id) continue;
      // Silent until the sound applier writes the real figure a moment later.
      // Belt and braces on purpose: the rebuild put every slot back at its spec
      // default, and `l1.gain` defaults to 1 — a new corner at full level for
      // even one tick is four instruments at once.
      commitParamForLane(engine, deps.sessionHost.state, laneId, `l${i}.gain`, 0);
      // The preset FIRST — it carries the envelopes, which are not params, and
      // the label, without which the new corner's dropdown reads "— pick —"
      // while playing the sound copied into it. Then slot 0's own values on top,
      // because a lane whose knobs were turned is on a sound no preset names.
      if (base.presetName) {
        recallLayerPreset(engine, deps.sessionHost.state, laneId, i, id, base.presetName);
      }
      const pre = layerPrefix(i);
      for (const [id2, v] of copy) {
        commitParamForLane(engine, deps.sessionHost.state, laneId, `${pre}${id2}`, v);
      }
    }
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
    // What part each lane plays — the list, the mark and the write, which are
    // one control and live together in panel-context-role.ts.
    ...roleMembers({
      getState: () => deps.sessionHost.state,
      reseedLoops: reseedLaneIfLoopsMoved,
      onWeaveChanged: (id) => deps.onWeaveChanged?.(id),
      refresh: () => deps.refresh(),
      history: () => deps.sessionHost.deps?.historyDeps,
    }),

    // Which lane each one ACCOMPANIES — the same three-member shape, in
    // panel-context-follow.ts, and next to the role members because the two
    // controls are read together: a follower's role is what part it plays.
    ...followMembers({
      getState: () => deps.sessionHost.state,
      // Straight at the weave state rather than through setLaneWeave, which
      // refuses on a LOCKED lane. The lock exists to hold a crossfade still,
      // and a lane that is no longer crossfading has nothing to hold.
      clearWeave: (laneId) => {
        const cur = deps.weave.lanes[laneId];
        // SHELVED, not discarded. Follow wins over a weave while it lasts; it
        // does not get to destroy one. Only the first shelving counts, so
        // re-pointing a follower at a different leader cannot overwrite the
        // weave it had before it started following at all.
        if (cur && cur.shelvedWeave === undefined) cur.shelvedWeave = cur.weave;
        if (cur) cur.weave = null;
      },
      restoreWeave: (laneId) => {
        const cur = deps.weave.lanes[laneId];
        if (!cur || cur.shelvedWeave === undefined) return;
        cur.weave = cur.shelvedWeave;
        delete cur.shelvedWeave;
      },
      onWeaveChanged: (id) => deps.onWeaveChanged?.(id),
      refresh: () => deps.refresh(),
      history: () => deps.sessionHost.deps?.historyDeps,
    }),

    // Whether each lane GENERATES, and the controls if it does — the third
    // answer to "what does this lane play", in panel-context-generator.ts. It
    // shelves the weave exactly the way follow does above, and for the same
    // reason: it wins while it lasts, and does not get to destroy one.
    ...generatorMembers({
      getState: () => deps.sessionHost.state,
      clearWeave: (laneId) => {
        const cur = deps.weave.lanes[laneId];
        if (cur && cur.shelvedWeave === undefined) cur.shelvedWeave = cur.weave;
        if (cur) cur.weave = null;
      },
      restoreWeave: (laneId) => {
        const cur = deps.weave.lanes[laneId];
        if (!cur || cur.shelvedWeave === undefined) return;
        cur.weave = cur.shelvedWeave;
        delete cur.shelvedWeave;
      },
      onWeaveChanged: (id) => deps.onWeaveChanged?.(id),
      refresh: () => deps.refresh(),
      history: () => deps.sessionHost.deps?.historyDeps,
    }),

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
        // The MARK, not `laneRoleOf` — a summary that resolved the fallback
        // would leave a panel unable to tell "the user said Bass" from "the
        // instrument is a bass machine and nobody has said anything".
        role: l.role,
      }));
    },

    engines() {
      // The SAME list the lane selector paints from. A panel that built its own
      // would drift the moment a plugin engine registered.
      return listEngines('polyhost').map((e) => ({ id: e.id, name: e.name }));
    },

    presets(engineId) {
      // The ONE catalogue, the same one the instrument page's dropdown reads.
      //
      // This used to derive its own list, and it was shorter: a sampler lane was
      // offered the inline presets alone, with no bundled instruments and no
      // loops. That was not a filter someone chose — it was the limit of what
      // this file could APPLY, since the ids for the rest were understood by one
      // module and it was not this one. Two lists for one question is a promise
      // to keep them in step, and this one had already been broken.
      //
      // `onReady` is the shelves that load once: the panel can open before they
      // resolve, and a dropdown that is empty for no visible reason is worse
      // than one that fills in a moment later.
      return presetsFor(engineId, () => deps.refresh());
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
      // Recorded BEFORE applying, and that order is not cosmetic: applying a kit
      // re-populates the pickers synchronously and reads this, so setting it
      // afterwards makes them snap back to "(custom)".
      //
      // Recorded HERE rather than inside the door, because remembering what
      // someone picked is the third question — it already has three answers and
      // no owner, and giving the catalogue a fourth would make it the problem it
      // was written to fix.
      pagePresetName.set(laneId, presetId);
      // One door for every kind. It knows that `engine:<name>` is a drum kit on
      // a kit engine and a factory preset everywhere else, which is exactly the
      // distinction this function used to carry itself — and the reason a lane
      // it did not recognise got a dropdown that changed and did nothing.
      applyPresetToLane(laneId, presetId);
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
      // The panel starting a lane is the panel claiming it: it weaves again,
      // whatever the grid last said. Launched with origin 'panel' for the same
      // reason — the grid's launch is what hands a lane OVER, and this one
      // must not undo the claim it just made.
      deps.resumeWeaving?.(laneId);
      if (row >= 0) deps.sessionHost.launchClipAt(laneId, row, 'panel');
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
      const c = loopContext(laneId);
      const out = weaveLoopChoices(c);

      // Plus WHATEVER THIS LANE IS ACTUALLY PLAYING, named, even when it came
      // off another shelf.
      //
      // A lane that has travelled is very often weaving loops drawn under an
      // earlier style, and a list built from today's shelf alone does not
      // contain them — so the row could not name what you were listening to and
      // fell back to reading the id out loud, "breakbeat drums #3". Worse than
      // ugly: the two ends of a crossfade were unpickable, so you could hear a
      // loop and not swap it.
      //
      // Appended rather than merged into the shelf groups: they are a different
      // answer to a different question — not "what may this lane play" but
      // "what is it playing" — and burying them among two hundred entries would
      // hide the two that matter.
      const seen = new Set(out.map((x) => x.id));
      const sel = deps.weave.lanes[laneId]?.weave;
      for (const id of sel ? selectionLoopIds(sel) : []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const entry = weaveLoopEntry(id, c);
        if (entry) out.push({ ...entry, group: 'Playing now · ' + entry.group });
      }
      return out;
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
      // NO reseed. It used to replace both ends at once, and both ends is the
      // whole problem: the lane cut to two loops it had never been travelling
      // towards, mid-phrase, from whatever position the crossfade happened to
      // be at. Musically that is not a style change, it is a splice.
      //
      // The style lands on the NEXT loop instead. `rehookOnArrival` draws from
      // `weaveLoopChoices`, which reads the style as it is NOW, so the first
      // loop drawn after this is already in the new one and the lane crosses
      // into it the way it crosses into everything else.
      //
      // What the reseed was guarding is real but smaller than it looks: the
      // selection goes on naming the old style's ids, and those still resolve,
      // so the lane keeps playing the style you just left until it arrives.
      // That IS the wanted behaviour here. The picker says so rather than
      // showing a dash — `picker` labels a loop that is off the shelf this list
      // shows, which is exactly this case and why that path exists.
      //
      // With EVOLVE off there is no next loop, and that is coherent rather than
      // broken: STATIC means the pair you chose is the pair you keep. The list
      // still moves, so the change is one pick away.
      deps.onWeaveChanged?.(laneId);
      deps.refresh();
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

    progression() { return tonality().progression ?? 'static'; },

    chordNow() {
      return deps.weaveChordNow?.() ?? null;
    },

    setProgression(id) {
      tonality().progression = progressionById(id) ? id : 'static';
      // Picking from the shelf throws away what was written, or the written one
      // would go on winning and the dropdown would be naming a progression
      // nobody is playing.
      delete tonality().chords;
      // Every lane's fold moves onto different chords, so every cached one is
      // stale — this is material, not a param.
      deps.onWeaveChanged?.('*');
      deps.refresh();
    },

    chordTrack() {
      // A COPY. The array is the scene's harmony; handing the real one over
      // would let a panel edit it behind the host's back, which is the same
      // reason `lanes()` hands out a flat summary.
      return activeProgression(tonality()).map((c) => ({ ...c }));
    },

    isCustomProgression() {
      return !!tonality().chords && tonality().chords!.length > 0;
    },

    setChordDegree(index, degree) { editChords((t) => setDegree(t, index, degree)); },
    setChordBars(index, bars)     { editChords((t) => setLength(t, index, bars)); },
    insertChordAfter(index)       { editChords((t) => insertAfter(t, index)); },
    removeChord(index)            { editChords((t) => removeAt(t, index)); },

    resetChordTrack() {
      delete tonality().chords;
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
      const cur = deps.weave.lanes[laneId];
      // `sound` is the pad's x AND the switch that says the pad exists at all,
      // so absent means no pad rather than a pad at the origin.
      return cur?.sound === undefined ? null : { x: cur.sound, y: cur.soundY ?? 0 };
    },

    setLaneSound(laneId, value, y) {
      // Turning it ON is also what BUILDS the thing it moves.
      //
      // The control writes `l0.gain`, `l1.gain` and so on, which only exist on a
      // lane that is a rack of instruments. On an ordinary lane those
      // destinations are absent, every write was skipped, and the control did
      // nothing with nothing on screen saying why — while the steps that would
      // have made it work lived on another page entirely.
      //
      // Deep enough for the control this lane is about to show: two ends on
      // A→B, four corners on a cloud.
      if (value !== null) ensureSoundRack(laneId);

      // Whether the CONTROL is appearing or disappearing, as opposed to merely
      // moving. It decides whether the row is rebuilt below, and getting that
      // wrong is not cosmetic: `refresh` remounts the whole panel, so rebuilding
      // on a value change destroys the very element the pointer is dragging. A
      // click survived it — one event — and a drag died on the second, which is
      // exactly how it was reported.
      const appearing = (deps.weave.lanes[laneId]?.sound === undefined) !== (value === null);

      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      const sound = value === null ? undefined : Math.min(1, Math.max(0, value));
      // The vertical axis KEEPS its place when only x is given, so a control
      // that moves one axis cannot silently reset the other.
      const soundY = value === null ? undefined
        : Math.min(1, Math.max(0, y ?? cur.soundY ?? 0));
      deps.weave.lanes[laneId] = { ...cur, sound, soundY };
      // MATERIAL, not a param: turning the control on or off changes whether the
      // fold tags its notes with the loop they came from, so every cached
      // source for this lane is answering the wrong question.
      deps.onWeaveChanged?.(laneId);
      // The row is redrawn only when the control APPEARS or DISAPPEARS, because
      // turning it on can have made the lane a rack — which is what its
      // instrument and preset dropdowns then point at, and without a redraw the
      // slot buttons showed up some time later, whenever something else happened
      // to repaint the panel.
      //
      // Never while it is merely MOVING. `refresh` remounts the panel, so a
      // redraw per drag event replaces the control under the pointer holding it.
      if (appearing) deps.refresh();
    },

    setLaneWeave(laneId, weave) {
      // A locked lane keeps the loops it has — by hand as well as by clock. The
      // lock exists to hold an arrangement still, and a dropdown that swapped
      // the material under it would be the one hole in that promise.
      if (deps.weave.locked || deps.weave.lanes[laneId]?.locked) return;
      // The panel is a PLUGIN, and this is where its numbers enter the host's
      // state. A position that is not a number survives every clamp on the way
      // in — `Math.min(1, Math.max(0, NaN))` is NaN, and so is the ternary form
      // — and ends as two NaN weights, which `blendLoops` drops (nothing is
      // ever "above 0.005"). The lane then plays SILENCE with its row, its
      // loops and its lights all still saying otherwise.
      //
      // Refused rather than repaired, and refused HERE: guessing a position
      // moves someone's crossfade to a place they did not put it, and the five
      // separate clamps downstream would each have to guess the same way.
      if (weave && !finitePosition(weave)) return;
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      // Choosing a weave STOPS the lane following, and until now it did not.
      //
      // The exclusivity was enforced in one direction only: setLaneFollow put
      // the weave away, and this wrote a weave and left the follow standing.
      // The host resolves follow FIRST, so the lane went on accompanying while
      // its row showed a topology, two loops and a moving crossfade — which
      // from the outside is indistinguishable from a lane that put itself back
      // into follow on its own. Reported as exactly that: "solo hace follow y
      // aunque esté en normal, e incluso se cambia sola a follow".
      //
      // Only a real weave clears it. Turning the topology OFF is not a claim on
      // the lane, so a follower whose topology dropdown is set to "off" is
      // simply a follower.
      if (weave) {
        const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
        if (lane?.follow) delete lane.follow;
        // And the shelved copy goes with it: the user has just chosen a weave
        // by hand, so there is nothing older worth coming back to.
        delete cur.shelvedWeave;
      }
      // A HAND has moved this lane, so this is where it stands from now on: its
      // base moves by exactly what the hand moved, and the journey carries the
      // new distance instead of undoing it on the next tick. Without this the
      // flow kept recomputing the lane from a base captured before the gesture,
      // and the gesture survived until the next tick and not one moment longer.
      const moved = positionOf(weave) - positionOf(cur.weave);
      if (weave && cur.weave && moved !== 0 && deps.weave.flow?.base) {
        const base = deps.weave.flow.base;
        base[laneId] = wrap01((base[laneId] ?? 0) + moved);
      }
      deps.weave.lanes[laneId] = { ...cur, weave };
      // Choosing a weave by hand is a claim on the lane: it weaves again even
      // if a scene had handed it back to the grid. Turning it OFF is not, and
      // does not need to be — a lane with no weave has nothing to suspend.
      if (weave) deps.resumeWeaving?.(laneId);
      deps.onWeaveChanged?.(laneId);
    },

    laneArrangeLevel(laneId) {
      // Only a lane whose notes are DERIVED has an arrangement to lengthen.
      // A weaving lane already has the weave to travel with, and a drum lane
      // has no part at all — offering the control there would be a knob that
      // moves nothing, which is worse than an absent one.
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      if (!lane?.follow) return null;
      // The SAME default the source falls back to, imported rather than
      // repeated: a readout that disagreed with what the lane is playing is
      // the one thing a knob must never do.
      return deps.weave.lanes[laneId]?.arrangeLevel ?? DEFAULT_LEVEL;
    },

    setLaneArrangeLevel(laneId, level) {
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      const v = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
      deps.weave.lanes[laneId] = { ...cur, arrangeLevel: v };
      deps.onWeaveChanged?.(laneId);
    },

    flow() {
      const f = deps.weave.flow;
      return {
        position: positionOf(leadWeave()),
        drift: f?.drift ?? 'together',
        speedBars: f?.speedBars ?? 0,
        evolve: !!f?.evolve,
        pingPongLaps: f?.pingPongLaps ?? 0,
      };
    },

    setFlow(position, drift, speedBars, evolve, pingPongLaps) {
      const mode = asDrift(drift);
      const was = deps.weave.flow;
      const evolving = !!evolve;

      // Where each lane stands at flow 0 — its own place in the scene, which
      // the journey carries and never replaces. Needed because a slider sends
      // its ABSOLUTE value on every pointer move: counted from where the lanes
      // are now, a single drag would add the same amount dozens of times and
      // the scene would run away.
      //
      // Kept across calls, and rewritten in exactly two places: here, when the
      // user PICKS a drift mode (which lays the lanes out once, below), and in
      // setLaneWeave, when a hand moves one lane. Everything else travels.
      const laneIds = deps.sessionHost.state.lanes.map((l) => l.id);
      const held = () => Object.fromEntries(laneIds.map((id) =>
        [id, positionOf(deps.weave.lanes[id]?.weave)]));

      // A drift mode is a LAYOUT now, applied the moment it is chosen: together
      // puts the lanes on one number, offset fans them across the journey. It
      // used to be a law enforced on every tick, which is why moving a lane by
      // hand did nothing that lasted — "si cambias un knob de lane debería
      // conservar el cambio relativo a la posición de los demás loops".
      const layout = mode !== was?.drift
        ? alignPositions(mode, laneIds.length, position)
        : null;
      if (layout) {
        laneIds.forEach((id, i) => {
          const entry = deps.weave.lanes[id];
          // Same two exemptions the journey itself honours: a lane with no
          // weave is not in the scene, and a LOCKED one is sitting the journey
          // out — laying it out would be the flow touching it after all.
          if (!entry?.weave || entry.locked) return;
          // The cast is the same one applyFlow makes internally: `placeAt`
          // writes a POSITION into a selection and knows nothing else about it,
          // which is why it is typed on the position rather than on the union.
          deps.weave.lanes[id] = {
            ...entry,
            weave: placeWeave(entry.weave as unknown as PositionedWeave, layout[i]) as unknown as PanelWeave,
          };
        });
      }

      // base + pos = where a lane stands. Kept across gestures, and recomputed
      // only for a lane that has just been laid out or that the journey has
      // never seen — the latter from where the dial WAS, not where it is going,
      // or the very first drag of a session would cancel itself.
      const prev = was?.base ?? {};
      // Where the dial stood before this gesture. Absent — no journey yet — it
      // is what the panel was SHOWING, which is the leading lane's own place:
      // the fader reads the scene when it is not driving it, so a drag that
      // starts there must move the lanes by what the hand moved and no more.
      // Zero instead would make the first drag of a session cancel itself on
      // a scene that was not sitting at zero.
      const wasPos = was?.pos ?? positionOf(leadWeave());
      const now = held();
      const base: Record<string, number> = {};
      for (const id of laneIds) {
        base[id] = layout ? wrap01(now[id] - position)
          : prev[id] ?? wrap01(now[id] - wasPos);
      }

      deps.weave.flow = {
        drift: mode, speedBars: Math.max(0, speedBars || 0), base, pos: position,
        evolve: evolving,
        // Floored, not trusted: the count comes off a dropdown but reaches the
        // clock's arithmetic, and a fractional or negative one would turn round
        // in the middle of a lap for ever.
        pingPongLaps: Math.max(0, Math.floor(pingPongLaps || 0)),
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
        // The trail goes IN as well as out: the draw avoids the loops this lane
        // has already played, or the journey circles back onto two of them.
        const next = rehookOnArrival(
          entry?.weave, loopContext(laneId), deps.weave.seed, laneId, entry?.trail,
        );
        if (!next || !entry) return;
        // Remember what it is leaving, so winding the wheel back can find it.
        // The loop left behind is the NEAR end of the leg just finished, not
        // the far one — the far one is where the lane still is.
        const leaving = entry.weave?.kind === 'ab' ? entry.weave.a : undefined;
        deps.weave.lanes[laneId] = {
          ...entry,
          weave: next,
          trail: leaving ? pushTrail(entry.trail, leaving) : entry.trail,
        };
      };

      /** The wheel turned BACK: walk the loops already played instead of
       *  drawing new ones. Winding to and fro must review the journey, not
       *  shred it into a different one. */
      const rewind = (laneId: string) => {
        const entry = deps.weave.lanes[laneId];
        const back = rehookOnRewind(entry?.weave, entry?.trail);
        if (!back || !entry) return;
        deps.weave.lanes[laneId] = { ...entry, weave: back.weave, trail: back.trail };
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
        new Map(Object.entries(base)),
        evolving && advancing ? rehook : undefined,
        // Going back needs no EVOLVE. Handing over to a FRESH loop is what
        // EVOLVE decides; re-hearing one you already played is not evolution,
        // it is the way back — and a STATIC scene that could not be wound back
        // would be the same dead end this whole thing is about.
        advancing ? undefined : rewind,
        // A HAND, and here the flag is right: with EVOLVE on, dragging to the
        // far end IS arriving, so it folds and hands over; STATIC gives the
        // fader ends to stop at. That is a fader's behaviour and it is tested.
        //
        // The CLOCK does not share it — see weave-wiring's advance. Its journey
        // always laps, because a fanned scene that clamped parked its lanes at
        // the far end one at a time.
        evolving,
      );
      // Same event, found the other way: a square arrives at a corner four times
      // a lap and none of those is a wrap, so `rehook` above never hears them.
      if (evolving && advancing) {
        evolveCloudLanes(
          deps.weave.lanes,
          deps.sessionHost.state.lanes.map((l) => l.id),
          loopContext,
          deps.weave.seed,
        );
      }
      deps.onWeaveChanged?.('*');
    },

    setLaneTime(laneId, factor) {
      if (!(factor > 0)) return;
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      // Two presses each way and no further. Past that a phrase is either one
      // note every four bars or a chord, and both read as a broken control
      // rather than as a tempo.
      const next = Math.min(4, Math.max(0.25, (cur.timeScale ?? 1) * factor));
      deps.weave.lanes[laneId] = { ...cur, timeScale: next };

      // The ROOM, not the material. A half-time phrase is delivered whole and
      // simply needs two bars to say it in, so the carrier clip grows with it —
      // and shrinks back on the way down. This is the only thing here that
      // touches the session, and it is the one thing that has to: the clip's
      // LENGTH is what a weaving lane still hears.
      //
      // Through the clip editor's own operation, never note maths of its own:
      // applyClipLength keeps the bar count, the loop region and the automation
      // curves in step, and rebuilding that here is how a clip ends up with
      // automation that no longer lines up.
      const clip = deps.sessionHost.state.lanes
        .find((l) => l.id === laneId)?.clips.find((c) => c);
      if (clip) applyClipLength(clip, factor, 'repeat', ticksPerBar(deps.seq.meter));

      // The phrase just changed shape in both ways: the cached fold has to go.
      deps.onWeaveChanged?.(laneId);
      repaintDesk();
      deps.refresh();
    },

    laneSlots(laneId) {
      // Only a lane that IS one. `engineState.layers` alone would answer yes for
      // a lane converted once and swapped back since — the stored rack outlives
      // the instrument. The catalogue is the live truth and it is the same
      // question the sound fader asks.
      if (!isRack(laneId)) return [];
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      return laneLayers(lane)
        .filter((l) => l.engineId !== '')
        .map((l) => ({ engineId: l.engineId, presetName: l.presetName }));
    },

    slotEngines() {
      // The host's own rule, not a list assembled here: a rack inside a rack is
      // an unbounded tower of synths in the audio callback, and the Sampler and
      // the drum machine are unreachable from the worklet's renderer registry.
      return slotChoices().map((e) => ({ id: e.id, name: e.name }));
    },

    setLaneSlotEngine(laneId, slot, engineId) {
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      // The rack door, which rebuilds the lane: what a slot HOLDS changes the
      // lane's param numbering, and a lane is numbered once for its lifetime.
      setLayerEngine(lane, slot, engineId);
      // And the rebuild is exactly why this has to say the weave moved.
      //
      // A rebuilt engine takes every param from its SPEC default, and `l1.gain`
      // defaults to 1 — so every slot comes back at FULL LEVEL and the lane
      // plays all of its instruments at once, however the sound control is set.
      // Reported as "ahora suena simultáneamente".
      //
      // Announcing it re-runs the sound applier, which writes the gains from the
      // control's own position. One owner for "how loud is each slot", rather
      // than this file writing a second set of numbers that can disagree with
      // the pad.
      deps.onWeaveChanged?.(laneId);
      deps.refresh();
    },

    setLaneSlotPreset(laneId, slot, presetName) {
      const engine = deps.sessionHost.deps?.laneResources?.get(laneId)?.engine;
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      const held = lane && laneLayers(lane)[slot]?.engineId;
      if (!engine || !held) return;
      // Sound AND label, through the one door that owns both — and NEVER through
      // the rack door, which would rebuild the engine and throw the preset's
      // params away one line after they were written.
      recallLayerPreset(engine, deps.sessionHost.state, laneId, slot, held, presetName);
      deps.refresh();
    },

    laneLevelNow(laneId) {
      // The strip's OWN meter analyser, the one the mixer column reads. A second
      // tap would meter a different point in the chain and the two would
      // disagree about a number the user can see in both places at once.
      const strip = deps.sessionHost.deps?.laneResources?.get(laneId)?.strip;
      if (!strip) return -Infinity;
      const analyser = strip.getMeterAnalyser();
      // Per lane and kept, because this is called once per frame per lane: a
      // fresh Float32Array sixty times a second per track is garbage the audio
      // thread eventually pays for.
      let buf = meterBuffers.get(laneId);
      if (!buf || buf.length !== analyser.fftSize) {
        buf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        meterBuffers.set(laneId, buf);
      }
      return dbfsOf(analyser, buf);
    },

    laneOctave(laneId) {
      return deps.weave.lanes[laneId]?.octave ?? 0;
    },

    setLaneOctave(laneId, delta) {
      if (!Number.isFinite(delta) || delta === 0) return;
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      // Three each way. Past that a part is either under the bass or above the
      // top of the keyboard, and both read as a control that broke rather than
      // as a register.
      const next = Math.min(3, Math.max(-3, (cur.octave ?? 0) + Math.round(delta)));
      deps.weave.lanes[laneId] = { ...cur, octave: next };
      // MATERIAL: the fold now hands out different pitches, so every cached
      // source for this lane is answering the wrong question. This is also what
      // carries it to PRINT — `lapNotes` reads the same sources.
      deps.onWeaveChanged?.(laneId);
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

    reseed(scope = 'quiet') {
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
        const shelf = libraryFor(lane.id, rollOffset(lane.id));

        // A press deals the QUIET end only: what you are listening to survives
        // and what the lane is travelling towards is new, so the dice is
        // something you can hit at any moment rather than only between phrases.
        // Holding the button is how you ask for the other thing — leave here
        // entirely — and that is the one that replaces every slot.
        if (scope === 'quiet') {
          const next = redrawQuietest(cur, shelf);
          if (next) deps.weave.lanes[lane.id] = { ...entry, weave: next };
          continue;
        }

        const next = defaultSelection(cur.kind, shelf);
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
      // The sound control wears the shape of this one, so a lane that just
      // gained two corners needs two more instruments to put in them. Grown,
      // never re-dealt: the sounds it was already crossing between stay.
      //
      // Only when the control is actually on. Building a rack for a lane that is
      // not morphing would swap its instrument for a reason it never asked for.
      if (cur.sound !== undefined) ensureSoundRack(laneId);
      // Picking a topology is the gesture that means "weave this lane", so it
      // takes the lane back from the grid — see setLaneWeave.
      deps.resumeWeaving?.(laneId);
      deps.onWeaveChanged?.(laneId);
      deps.refresh();
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
