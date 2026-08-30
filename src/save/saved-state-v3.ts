import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';
import type { LaneAllocator } from '../app/lane-allocator';
import { migrateArrangementBands, type ArrangementState } from '../performance/performance';
import { resolveMeter, formatMeter, type TimeSignature } from '../core/meter';
import { defaultWeaveState } from '../weave/weave-state';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  /** Global time signature — optional/additive; absent ⇒ 4/4 on load. */
  timeSignature?: TimeSignature;
  masterVol: number;
  /** Master bus EQ/pan/mute — optional/additive; absent ⇒ flat/centred/unmuted. */
  masterStrip?: import('../core/master-bus-strip').MasterBusState;
  /** Master-bus compressor (THR/RAT/ATK/REL/KNEE/MKUP + bypass) at the tail of
   *  the master chain — optional/additive; absent ⇒ compressor keeps its
   *  constructed defaults. Separate from masterStrip, which is EQ/pan/mute only. */
  masterComp?: ReturnType<import('../core/fx').MasterCompressor['getState']>;
  /** Master shaper (air / multiband glue / stereo width) — optional/additive;
   *  absent ⇒ the shaper keeps its constructed defaults. */
  masterShaper?: import('../core/master-shaper').MasterShaperState;
  sessionState: SessionState;
  /** Performance view — optional, absent in older saves. */
  /** 'session', 'performance', or the id of a panel plugin. A save made with a
   *  panel installed can name a mode this build has never heard of, so the
   *  restore side falls back rather than trusting it. */
  mode?: string;
  arrangement?: ArrangementState;
  /** WEAVE — optional/additive; absent ⇒ nothing is weaving, which is what a
   *  save from before the panel existed means.
   *
   *  It holds loop IDS, not notes: `clip:<id>` resolves against the clips in
   *  `sessionState` (saved right here, with their ids intact) and `lib:` ids
   *  are stable by construction. A loop that no longer resolves is substituted
   *  rather than blanking the lane, so a save carrying a deleted clip still
   *  plays. */
  weave?: import('../weave/weave-state').WeaveState;
}

// Phase G: SavedStateV3Deps no longer holds direct synth/drums/polysynth
// references. Lane resources are resolved from lanes.resources at save/load
// time, after applyLoadedSessionState has allocated the boot lanes.
export interface SavedStateV3Deps {
  seq: Sequencer;
  lanes: LaneAllocator;
  volInput: HTMLInputElement;
  bpmInput: HTMLInputElement;
  swingInput: HTMLInputElement;
  meterSel: HTMLSelectElement;
  sessionHost: SessionHost;
  renderLanes: () => void;
  fx: import('../core/fx').FxBus;
  masterInsertChain: import('../core/insert-chain').InsertChain;
  master: GainNode;
  /** Master bus EQ/pan/mute strip — serialized/restored alongside masterVol.
   *  Optional so callers without an audio graph (tests) keep working. */
  masterStrip?: import('../core/master-bus-strip').MasterBusStrip;
  /** Master-bus compressor — serialized/restored alongside masterStrip.
   *  Optional so callers without an audio graph (tests) keep working. */
  masterComp?: import('../core/fx').MasterCompressor;
  /** Master shaper — serialized/restored alongside masterComp. Optional so
   *  callers without an audio graph (tests) keep working. */
  masterShaper?: import('../core/master-shaper').MasterShaper;
  /** Performance view persistence — optional; when absent the take is not
   *  saved/restored (older callers keep working unchanged). */
  getMode?: () => string;
  getArrangement?: () => ArrangementState;
  setMode?: (m: string) => void;
  setArrangement?: (a: ArrangementState) => void;
  /** WEAVE persistence — optional; absent and the weave is neither saved nor
   *  restored, which is how every caller without a panel keeps working. */
  getWeave?: () => import('../weave/weave-state').WeaveState;
  setWeave?: (w: import('../weave/weave-state').WeaveState) => void;
}

export function buildSavedStateV3(deps: SavedStateV3Deps): SavedStateV3 {
  const { seq, volInput, sessionHost } = deps;
  const state: SavedStateV3 = {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    timeSignature: { ...seq.meter },
    masterVol: parseFloat(volInput.value),
    masterStrip: deps.masterStrip?.serialize(),
    masterComp: deps.masterComp?.getState(),
    masterShaper: deps.masterShaper?.getState(),
    sessionState: sessionHost.getStateForSave(),
  };
  if (deps.getMode) state.mode = deps.getMode();
  // Deep-copied for the same reason as the weave below: the live arrangement
  // keeps being edited, and a save holding the feature's own object would go on
  // changing after it was written.
  if (deps.getArrangement) state.arrangement = structuredClone(deps.getArrangement());
  // Deep-copied, because the live weave keeps moving: a save holding the panel's
  // own object would go on changing after it was written, and what landed on
  // disk would be wherever the fader stopped rather than where it was.
  if (deps.getWeave) state.weave = structuredClone(deps.getWeave());
  return state;
}

export function applyLoadedStateV3(s: SavedStateV3, deps: SavedStateV3Deps): void {
  const {
    seq, volInput, bpmInput, swingInput, meterSel,
    sessionHost, renderLanes, master,
  } = deps;

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  const meter = resolveMeter(s.timeSignature);
  seq.meter = meter;
  if (meterSel) meterSel.value = formatMeter(meter);
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }

  // ORDER MATTERS, and it is the reverse of what it used to be. `replaceSession`
  // releases the whole desk — including the master strip/comp/shaper — before
  // applying, so restoring those first would hand them straight to the reset.
  // The session goes in first; the master fields this file owns go on top.
  if (s.sessionState) sessionHost.replaceSession(s.sessionState);

  deps.masterStrip?.restore(s.masterStrip);
  if (s.masterComp) deps.masterComp?.setState(s.masterComp);
  if (s.masterShaper) deps.masterShaper?.setState(s.masterShaper);

  renderLanes();

  // Performance view (optional — older saves omit these). Restore the take
  // first so the view has content, then switch to the saved mode.
  if (s.arrangement && deps.setArrangement) {
    migrateArrangementCurves(s.arrangement);
    migrateArrangementBands(s.arrangement);
    deps.setArrangement(s.arrangement);
  }
  // AFTER replaceSession, because the weave names clips by id and those clips
  // have to exist before anything resolves them. Restored UNCONDITIONALLY when
  // the caller can: a save with no weave must CLEAR the live one, or loading an
  // untouched session would inherit whatever the previous one was weaving.
  deps.setWeave?.(s.weave ?? defaultWeaveState());

  if (s.mode && deps.setMode) deps.setMode(s.mode);
}

/** Runtime guard: untrusted JSON (file load, localStorage) → typed shape or null. */
export function parseSavedStateV3(raw: unknown): SavedStateV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 3) return null;
  return r as unknown as SavedStateV3;
}

/** Older performance takes stored automation as `samples` with no flags.
 *  Normalize to the painter-compatible `{ values, enabled, stepped }` shape and
 *  backfill `lengthBars`. Mutates in place.
 *
 *  A take carries no meter of its own — the save's `timeSignature` (applied to
 *  seq.meter above) is the file's one meter, and the Performance view reads it
 *  from there. A save written while the arrangement still carried a copy keeps
 *  the dead field; nothing reads it. */
export function migrateArrangementCurves(arr: ArrangementState): void {
  if (typeof (arr as { lengthBars?: number }).lengthBars !== 'number') {
    (arr as { lengthBars: number }).lengthBars = 0;
  }
  const fix = (c: { values?: number[]; enabled?: boolean; stepped?: boolean }) => {
    if (!c.values) c.values = [];
    if (c.enabled === undefined) c.enabled = true;
    if (c.stepped === undefined) c.stepped = false;
  };
  for (const lane of arr.lanes ?? []) for (const c of lane.automation ?? []) fix(c);
  for (const c of arr.globalAutomation ?? []) fix(c);
}
