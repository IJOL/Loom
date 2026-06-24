import type { Sequencer } from '../core/sequencer';
import type { Wave } from '../core/synth';
import type { SessionHost } from '../session/session-host';
import type { SessionState } from '../session/session';
import type { LaneAllocator } from '../app/lane-allocator';
import { LANE_ID_BASS, LANE_ID_DRUMS } from '../core/lane-ids';
import type { TB303 } from '../core/synth';
import type { ArrangementState } from '../performance/performance';
import { resolveMeter, formatMeter, type TimeSignature } from '../core/meter';

export interface SavedStateV3 {
  schemaVersion: 3;
  bpm: number;
  swing: number;
  /** Global time signature — optional/additive; absent ⇒ 4/4 on load. */
  timeSignature?: TimeSignature;
  masterVol: number;
  /** Master bus EQ/pan/mute — optional/additive; absent ⇒ flat/centred/unmuted. */
  masterStrip?: import('../core/master-bus-strip').MasterBusState;
  kit: string;
  wave: Wave;
  synthParams: import('../core/synth').TB303['params'];
  sessionState: SessionState;
  /** Performance view — optional, absent in older saves. */
  mode?: 'session' | 'performance';
  arrangement?: ArrangementState;
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
  refreshKnobsFromSynth: () => void;
  renderLanes: () => void;
  fx: import('../core/fx').FxBus;
  masterInsertChain: import('../plugins/fx/insert-chain').InsertChain;
  master: GainNode;
  /** Master bus EQ/pan/mute strip — serialized/restored alongside masterVol.
   *  Optional so callers without an audio graph (tests) keep working. */
  masterStrip?: import('../core/master-bus-strip').MasterBusStrip;
  /** Performance view persistence — optional; when absent the take is not
   *  saved/restored (older callers keep working unchanged). */
  getMode?: () => 'session' | 'performance';
  getArrangement?: () => ArrangementState;
  setMode?: (m: 'session' | 'performance') => void;
  setArrangement?: (a: ArrangementState) => void;
}

// Phase 4 cutover: the legacy node-per-note TB303 / DrumMachine instances are
// gone (lanes synthesise through the worklet). The top-level v3 `kit`/`wave`/
// `synthParams` fields are now vestigial — the authoritative per-lane sound
// lives in sessionState.lanes[].engineState. getSynth/getDrums therefore always
// return null; the fields stay in the schema for back-compat with old saves
// (load tolerates a null instance), and save writes harmless defaults.
interface LegacyTB303Instance { params: TB303['params']; setKit?(k: string): void; }
interface LegacyDrumsInstance { kitId?: string; setKit(k: string): void; }
function getSynth(deps: SavedStateV3Deps): LegacyTB303Instance | null {
  const engine = deps.lanes.resources.get(LANE_ID_BASS)?.engine as
    { getInstance?(): LegacyTB303Instance | null } | undefined;
  return engine?.getInstance?.() ?? null;
}
function getDrums(deps: SavedStateV3Deps): LegacyDrumsInstance | null {
  const engine = deps.lanes.resources.get(LANE_ID_DRUMS)?.engine as
    { getInstance?(): LegacyDrumsInstance | null } | undefined;
  return engine?.getInstance?.() ?? null;
}

export function buildSavedStateV3(deps: SavedStateV3Deps): SavedStateV3 {
  const { seq, volInput, sessionHost } = deps;
  const synth = getSynth(deps);
  const drums = getDrums(deps);
  const state: SavedStateV3 = {
    schemaVersion: 3,
    bpm: seq.bpm,
    swing: seq.swing,
    timeSignature: { ...seq.meter },
    masterVol: parseFloat(volInput.value),
    masterStrip: deps.masterStrip?.serialize(),
    kit: drums?.kitId ?? 'default',
    wave: synth?.params.wave ?? 'sawtooth',
    synthParams: synth?.params ? { ...synth.params } : {} as import('../core/synth').TB303['params'],
    sessionState: sessionHost.getStateForSave(),
  };
  if (deps.getMode) state.mode = deps.getMode();
  if (deps.getArrangement) state.arrangement = deps.getArrangement();
  return state;
}

export function applyLoadedStateV3(s: SavedStateV3, deps: SavedStateV3Deps): void {
  const {
    seq, volInput, bpmInput, swingInput, meterSel,
    sessionHost, refreshKnobsFromSynth, renderLanes, master,
  } = deps;

  if (typeof s.bpm === 'number') { seq.bpm = s.bpm; bpmInput.value = String(s.bpm); }
  if (typeof s.swing === 'number') { seq.swing = s.swing; swingInput.value = String(s.swing); }
  {
    const m = resolveMeter(s.timeSignature);
    seq.meter = m;
    if (meterSel) meterSel.value = formatMeter(m);
  }
  if (typeof s.masterVol === 'number') { master.gain.value = s.masterVol; volInput.value = String(s.masterVol); }
  deps.masterStrip?.restore(s.masterStrip);

  // Session state is applied first so lane resources are allocated before
  // we try to get synth/drums instances from them.
  if (s.sessionState) {
    // Normalise optional arrays so downstream code can use ??= [] safely.
    s.sessionState.masterInserts ??= [];
    for (const lane of s.sessionState.lanes) lane.inserts ??= [];
    sessionHost.applyLoadedSessionState(s.sessionState);
  }

  const synth = getSynth(deps);
  const drums = getDrums(deps);

  if (typeof s.kit === 'string') {
    if (drums) { drums.setKit(s.kit); }
  }
  if (s.wave && synth) { synth.params.wave = s.wave; }
  if (s.synthParams && synth) synth.params = { ...synth.params, ...s.synthParams };

  refreshKnobsFromSynth();
  renderLanes();

  // Performance view (optional — older saves omit these). Restore the take
  // first so the view has content, then switch to the saved mode.
  if (s.arrangement && deps.setArrangement) {
    migrateArrangementCurves(s.arrangement);
    deps.setArrangement(s.arrangement);
  }
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
 *  backfill `lengthBars`. Mutates in place. */
export function migrateArrangementCurves(arr: ArrangementState): void {
  if (typeof (arr as { lengthBars?: number }).lengthBars !== 'number') {
    (arr as { lengthBars: number }).lengthBars = 0;
  }
  const fix = (c: { samples?: number[]; values?: number[]; enabled?: boolean; stepped?: boolean }) => {
    if (!c.values && Array.isArray(c.samples)) { c.values = c.samples; delete c.samples; }
    if (!c.values) c.values = [];
    if (c.enabled === undefined) c.enabled = true;
    if (c.stepped === undefined) c.stepped = false;
  };
  for (const lane of arr.lanes ?? []) for (const c of lane.automation ?? []) fix(c);
  for (const c of arr.globalAutomation ?? []) fix(c);
}
