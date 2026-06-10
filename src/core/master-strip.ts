// Master strip — the mixer column for the master bus.
//
// Lives in the last (scenes) column of the session mixer row, and is built with
// the SAME `.mix-col` layout as a lane column (buildMixerColumn) so it lines up
// pixel-for-pixel: a MASTER name, an EQ section (HI/MID/LO), an FX button (in the
// lane's SEND slot — the master has no sends), a PAN knob, a Mute button (no Solo
// — meaningless on the master), and a vertical fader + VU meter.
//
// Wiring:
//   - EQ / PAN / MUTE drive the MasterBusStrip (deps.masterStrip); EQ/PAN knob
//     gestures are bracketed for undo via attachKnobUndo, and all three are
//     captured in SavedStateV3.masterStrip on save (so they persist + undo).
//   - The fader is a PROXY of #volume: it writes `volInput.value` and dispatches
//     #volume's `input` event, reusing that handler (master.gain + its own undo
//     bracket). It never writes master.gain directly. This keeps save
//     (SavedStateV3.masterVol) and the volume undo working unchanged.
//   - The VU meter is fed by the dedicated master meter analyser.

import { createLevelMeter } from './level-meter';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import type { MasterBusStrip } from './master-bus-strip';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtPan = (v: number) =>
  v === 0 ? 'C' : (v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`);

export interface MasterStripDeps {
  /** The existing #volume range input; the master fader proxies it. */
  volInput: HTMLInputElement;
  /** Dedicated meter tap of the master bus (fftSize=512). */
  masterMeterAnalyser: AnalyserNode;
  /** The master bus EQ/pan/mute strip the tone controls drive. */
  masterStrip: MasterBusStrip;
  /** Whether the master FX panel is currently open (drives the button .active). */
  isFxOpen(): boolean;
  /** Called when the FX button is clicked. */
  onToggleFx(): void;
  /** Optional undo history — EQ/pan knob drags are bracketed as single entries. */
  historyDeps?: HistoryDeps;
  /** Optional teardown registration for the VU meter handle (RAF + analyser). */
  registerDisposable?(d: { dispose(): void }): void;
}

interface KnobOpts {
  label: string;
  min: number; max: number; step: number;
  value: number; defaultValue?: number;
  color?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function addKnob(parent: HTMLElement, deps: MasterStripDeps, opts: KnobOpts): void {
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const k: KnobHandle = createKnob({ ...opts, size: 28, ...undoHooks });
  parent.appendChild(k.el);
}

export function buildMasterStrip(deps: MasterStripDeps): HTMLElement {
  const strip = deps.masterStrip;
  const col = document.createElement('div');
  col.className = 'mix-col master-strip';

  // Name header
  const name = document.createElement('div');
  name.className = 'mix-name';
  name.textContent = 'MASTER';
  col.appendChild(name);

  // EQ (HI / MID / LO) — same params/colours as a lane column.
  const eqSec = document.createElement('div');
  eqSec.className = 'mix-section';
  const eqLab = document.createElement('div');
  eqLab.className = 'mix-sec-label';
  eqLab.textContent = 'EQ';
  eqSec.appendChild(eqLab);
  addKnob(eqSec, deps, { label: 'HI',  min: -18, max: 18, step: 0.5, value: strip.getEqHigh(), defaultValue: 0, color: '#2ee0c0', format: fmtDb, onChange: (v) => strip.setEqHigh(v) });
  addKnob(eqSec, deps, { label: 'MID', min: -18, max: 18, step: 0.5, value: strip.getEqMid(),  defaultValue: 0, color: '#f7d000', format: fmtDb, onChange: (v) => strip.setEqMid(v) });
  addKnob(eqSec, deps, { label: 'LO',  min: -18, max: 18, step: 0.5, value: strip.getEqLow(),  defaultValue: 0, color: '#c0392b', format: fmtDb, onChange: (v) => strip.setEqLow(v) });
  col.appendChild(eqSec);

  // FX section — occupies the lane's SEND slot (the master has no sends). Holds
  // the toggle for the Master FX panel (reverb/delay/comp/inserts).
  const fxSec = document.createElement('div');
  fxSec.className = 'mix-section master-fx-section';
  const fxLab = document.createElement('div');
  fxLab.className = 'mix-sec-label';
  fxLab.textContent = 'FX';
  fxSec.appendChild(fxLab);
  const fxBtn = document.createElement('button');
  fxBtn.className = 'master-fx-toggle';
  fxBtn.textContent = 'FX';
  fxBtn.title = 'Master effects (reverb / delay / comp / inserts)';
  if (deps.isFxOpen()) fxBtn.classList.add('active');
  fxBtn.addEventListener('click', () => deps.onToggleFx());
  fxSec.appendChild(fxBtn);
  col.appendChild(fxSec);

  // Pan
  const panSec = document.createElement('div');
  panSec.className = 'mix-section';
  addKnob(panSec, deps, { label: 'PAN', min: -1, max: 1, step: 0.01, value: strip.getPan(), defaultValue: 0, color: '#e67e22', format: fmtPan, onChange: (v) => strip.setPan(v) });
  col.appendChild(panSec);

  // Mute (no Solo — meaningless on the master).
  const ms = document.createElement('div');
  ms.className = 'mix-ms';
  const m = document.createElement('button');
  m.className = 'mix-btn mute';
  m.textContent = 'M';
  if (strip.isMuted()) m.classList.add('active');
  m.addEventListener('click', () => {
    strip.setMuted(!strip.isMuted());
    m.classList.toggle('active', strip.isMuted());
  });
  ms.appendChild(m);
  col.appendChild(ms);

  // Vertical fader (proxy of #volume) + VU meter.
  const faderWrap = document.createElement('div');
  faderWrap.className = 'mix-fader-wrap';

  const faderRow = document.createElement('div');
  faderRow.className = 'mix-fader-row';

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'mix-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.01';
  fader.value = deps.volInput.value;

  const faderVal = document.createElement('div');
  faderVal.className = 'mix-fader-val';
  const updateFaderText = () => { faderVal.textContent = fmtPct(parseFloat(fader.value)); };
  updateFaderText();

  // The fader writes volInput.value and dispatches volInput's `input` event so
  // the existing #volume handler does the real work (master.gain + undo).
  fader.addEventListener('input', () => {
    deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'));
    updateFaderText();
  });

  const vuMeter = createLevelMeter({ analyser: deps.masterMeterAnalyser });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);

  faderRow.appendChild(fader);
  faderRow.appendChild(vuMeter.el);
  faderWrap.appendChild(faderRow);
  faderWrap.appendChild(faderVal);
  col.appendChild(faderWrap);

  return col;
}

// ── Mini master (Performance toolbar) ──────────────────────────────────────
//
// The full master strip lives in #session-view-root, which is hidden in
// Performance mode — so a player loses the master VU + fader the moment they
// switch to Performance. This compact variant brings just those back into the
// performance-view toolbar: a MASTER label, a VU meter and a horizontal fader.
// It deliberately omits EQ/PAN/Mute/FX (the FX button would open the master FX
// panel, which is hidden with the session root anyway).
//
// Like the full strip, the fader is a PROXY of #volume (writes volInput.value +
// dispatches its `input` event), so save (SavedStateV3.masterVol) and the
// #volume undo bracket keep working unchanged. The VU registers a disposable so
// the host can tear it down on each re-render (renderPerformanceView wipes the
// toolbar) without leaking the meter's analyser registration.

export interface MiniMasterDeps {
  /** The existing #volume range input; the mini fader proxies it. */
  volInput: HTMLInputElement;
  /** Dedicated meter tap of the master bus. */
  masterMeterAnalyser: AnalyserNode;
  /** Optional teardown registration for the VU meter handle (RAF + analyser). */
  registerDisposable?(d: { dispose(): void }): void;
}

export function buildMiniMaster(deps: MiniMasterDeps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'perf-master-mini';

  const label = document.createElement('span');
  label.className = 'perf-master-mini-label';
  label.textContent = 'MASTER';
  wrap.appendChild(label);

  const vuMeter = createLevelMeter({ analyser: deps.masterMeterAnalyser });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);
  wrap.appendChild(vuMeter.el);

  const fader = document.createElement('input');
  fader.type = 'range';
  fader.className = 'perf-master-mini-fader';
  fader.min = '0'; fader.max = '1'; fader.step = '0.01';
  fader.value = deps.volInput.value;

  const val = document.createElement('span');
  val.className = 'perf-master-mini-val';
  const updateText = () => { val.textContent = fmtPct(parseFloat(fader.value)); };
  updateText();

  fader.addEventListener('input', () => {
    deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'));
    updateText();
  });

  wrap.append(fader, val);
  return wrap;
}
