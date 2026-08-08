// What the host hands a panel plugin when it mounts.
//
// A panel's code is compiled separately and cannot import ours, so this object
// is its ONLY way in. Every method here is a promise the host has to keep
// across versions, which is why it stays small: what WEAVE genuinely needs and
// nothing speculative.

import type { PanelContext, PanelLane, PanelLoopPhase, PanelWeave } from '@loom/plugin-sdk';
import { defaultLaneSelection } from '../weave/weave-state';
import { retopologise, positionOf, defaultSelection } from '../weave/weave-selection';
import { applyFlow, asDrift } from '../weave/flow';
import { weaveLoopChoices, weaveLoopContext, type WeaveLoopContext } from './weave-loops';
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
import { TICKS_PER_QUARTER } from '../core/notes';
import { listEngines } from '../engines/registry';
import { getCachedPresets } from '../presets/preset-loader';
import { pagePresetName } from '../instrument-presets/preset-select-state';
import { macroNeutral } from '../weave/weave-catalog';
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
  /** The mixer's OWN mute and solo tables, not copies. A panel that toggled a
   *  private flag would let a lane read soloed here and muted at the desk.
   *  Absent in fixtures with no audio graph — the buttons then do nothing
   *  rather than pretending to. */
  muteState?: Record<string, boolean>;
  soloState?: Record<string, boolean>;
  applyMuteSolo?: () => void;
  /** The project's key/scale/style, through main's ONE undoable writer — the
   *  same one Project Options uses. Absent in fixtures with no session. */
  setMusicality?: (m: MusicalityState) => void;
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
    );
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
      // with the ones started from the grid.
      const scene = deps.sessionHost.activeSceneIdx;
      const row = lane.clips[scene] ? scene : lane.clips.findIndex((c) => c !== null);
      if (row >= 0) deps.sessionHost.launchClipAt(laneId, row);
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
      deps.onWeaveChanged?.(laneId);
    },

    laneWeave(laneId) {
      return deps.sessionHost.state.lanes.some((l) => l.id === laneId)
        ? deps.weave.lanes[laneId]?.weave ?? null
        : null;
    },

    setLaneWeave(laneId, weave) {
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = { ...cur, weave };
      deps.onWeaveChanged?.(laneId);
    },

    flow() {
      const f = deps.weave.flow;
      // The position is read off the LANES, not kept beside the speed: the auto-
      // advance writes lane positions, and a second number remembered here would
      // be the one the panel shows while the music followed the other.
      const first = deps.sessionHost.state.lanes
        .map((l) => deps.weave.lanes[l.id]?.weave)
        .find((w) => w != null);
      return {
        position: positionOf(first),
        drift: f?.drift ?? 'together',
        speedBars: f?.speedBars ?? 0,
      };
    },

    setFlow(position, drift, speedBars) {
      const mode = asDrift(drift);
      deps.weave.flow = { drift: mode, speedBars: Math.max(0, speedBars || 0) };
      // The SAME writer the auto-advance uses. A hand on the fader and a clock
      // driving it must mean the same thing, or the scene would jump the moment
      // the transport started. No base: a gesture counts from where the lanes
      // are, which is what makes 'free' a nudge.
      applyFlow(
        deps.weave.lanes,
        deps.sessionHost.state.lanes.map((l) => l.id),
        position,
        mode,
      );
      deps.onWeaveChanged?.('*');
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
      // From the LIBRARY only. The carrier clip above is now in this lane's loop
      // list too, and it is empty by construction — picked as an end of the
      // crossfade it would make one extreme of the fader silence, which looks
      // exactly like a broken weave.
      const loopIds = weaveLoopChoices(loopContext(made.id))
        .map((c) => c.id)
        .filter((id) => id.startsWith('lib:'));
      const sel = defaultSelection('ab', loopIds);
      if (sel) {
        deps.weave.lanes[made.id] = { ...defaultLaneSelection(), weave: sel };
        deps.onWeaveChanged?.(made.id);
      }
      deps.refresh();
      return made.id;
    },

    reseed() {
      // A different deal from the same deck. The style MIX is untouched: how far
      // the lanes may wander is the user's setting, and re-dealing must not
      // quietly widen or narrow it.
      deps.weave.seed = (deps.weave.seed % 1_000_000) + 1;
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
