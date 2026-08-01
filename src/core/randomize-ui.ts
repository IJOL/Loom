import { withUndo, type HistoryDeps } from '../save/history-wiring';
import { markPresetCustomForLane } from '../polysynth/polysynth-presets';
import { commitEngineBaseValues } from '../engines/engine-param-commit';
import type { SynthEngine } from '../engines/engine-types';
import type { SessionState } from '../session/session';

// ── The "🎲 Sound" dice ────────────────────────────────────────────────────
// ONE action, for every lane and every page. It rolls the engine's declared
// params (engine.randomize() → engines/engine-randomize.ts, generic over the
// spec) and repaints the lane's knobs IN PLACE. Note content is not touched.
//
// It used to be written twice, and the two copies had drifted:
//
//   #bass-random-sound (303 page)  repainted with refreshKnobsFromSynth  ✅
//   #poly-randomize    (inspector) called rebuildEngineParamUI           ❌
//
// rebuildEngineParamUI is the ENGINE-SWAP tool: it unregisters every knob of
// the lane and only re-mounts them for Subtractive. On fm / wavetable /
// westcoast / karplus that left the knobs on screen but OUT of the automation
// registry — and automation-tick.ts walks that registry every frame to paint
// the amber modulation rings, so the rings froze and the knobs kept showing the
// value from before the roll. Same bug, two faces.
//
// The drums dice used to live here too. It never called engine.randomize(): it
// picked a kit at random from the UI layer. `drums-machine` declares
// `isRandomizable: false` (a kit is a loaded preset, not a bag of params), so
// it is gone — the kit dropdown covers that gesture.

export interface RandomizeDeps {
  /** The live engine of a lane, or null before it is allocated. */
  getEngine: (laneId: string) => SynthEngine | null;
  /** The lane's engine id — the key the capability door is asked about. */
  getLaneEngineId: (laneId: string) => string;
  /** The lane the poly-page editor is currently pointing at. */
  getActiveLaneId: () => string;
  /** Live session, so a rolled sound is mirrored into the lane and survives a save. */
  getSessionState?: () => SessionState | undefined;
  /** Repaint the lane's mounted knobs from the engine's base values. IN PLACE:
   *  that is the whole point. Rebuilding instead would evict them from the
   *  automation registry, and a knob outside it never gets its modulation ring
   *  painted again. */
  refreshLaneKnobs: (laneId: string, engine: SynthEngine) => void;
  historyDeps: HistoryDeps;
}

/** The ONE dice action. Rolls `laneId`'s engine and leaves its UI consistent. */
export function randomizeLaneSound(deps: RandomizeDeps, laneId: string): void {
  const engine = deps.getEngine(laneId);
  if (!engine?.randomize) return;
  withUndo(deps.historyDeps, () => {
    engine.randomize!();
    // The engine writes through setBaseValue, so no knob onChange fires and
    // commitParam never runs: mirror the whole bag or the rolled sound is lost
    // on save (the bulk sibling exists for exactly this — presets, Randomize).
    commitEngineBaseValues(engine, deps.getSessionState?.(), laneId);
    deps.refreshLaneKnobs(laneId, engine);
    markPresetCustomForLane(laneId);
  });
}

let _deps: RandomizeDeps | null = null;

/** Hand the dice its dependencies once, at boot. */
export function initRandomize(deps: RandomizeDeps): void { _deps = deps; }

/** The wired action for a lane. A no-op before boot has run. */
export function randomizeLane(laneId: string): void {
  if (_deps) randomizeLaneSound(_deps, laneId);
}

/** Wire the "🎲 Sound" button. Call once at boot, after initRandomize.
 *
 *  There is exactly ONE. There used to be three — one per page — because each
 *  page hand-copied the PRESET row: the TB-303's (whose page is now gone, the
 *  bass being edited in the common panel like every other melodic lane), the
 *  drums one (deleted: a kit is a preset, not a bag of params) and this one. */
export function wireRandomizeUI(): void {
  const btn = document.getElementById('poly-randomize') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => {
    if (_deps) randomizeLane(_deps.getActiveLaneId());
  });
}
