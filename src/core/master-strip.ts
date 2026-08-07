// Master strip — the mixer column for the master bus.
//
// Lives in the last (scenes) column of the session mixer row, and is built with
// the SAME `.mix-col` layout as a lane column (buildMixerColumn) so it lines up
// pixel-for-pixel: a MASTER name, an EQ section (HI/MID/LO), an FX button (in the
// lane's SEND slot — the master has no sends), a PAN knob, a Mute button (no Solo
// — meaningless on the master), and a vertical fader + VU meter.
//
// Like buildMixerColumn, the strip is a one-shot lit template (renderElement):
// the caller owns the returned node and rebuilds it wholesale, so there is no
// re-render path. Knobs and the VU meter are imperative widgets interpolated by
// node — the meter's per-frame updates never touch the template.
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

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import { createLevelMeter } from './level-meter';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import type { MasterBusStrip } from './master-bus-strip';
import type { SceneRingHandle } from './scene-ring';

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
  /** Optional pre-built scene countdown ring, rendered inline with the MASTER
   *  label. Pre-built rather than constructed here so the CALLER owns its
   *  lifetime and can register it for teardown next to the VU meter. */
  sceneRing?: SceneRingHandle;
}

interface KnobOpts {
  label: string;
  min: number; max: number; step: number;
  value: number; defaultValue?: number;
  color?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** Builds a knob (no registry — the master strip's knobs are not automatable)
 *  and hands back its root node for template interpolation. */
function knobEl(deps: MasterStripDeps, opts: KnobOpts): HTMLElement {
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const k: KnobHandle = createKnob({ ...opts, size: 28, ...undoHooks });
  return k.el;
}

export function buildMasterStrip(deps: MasterStripDeps): HTMLElement {
  const strip = deps.masterStrip;

  const vuMeter = createLevelMeter({ analyser: deps.masterMeterAnalyser });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);

  // Assigned after render; the handler only fires on user input, long after.
  // The fader writes volInput.value and dispatches volInput's `input` event so
  // the existing #volume handler does the real work (master.gain + undo).
  let faderVal: HTMLElement | null = null;
  const onFaderInput = (e: Event) => {
    const fader = e.currentTarget as HTMLInputElement;
    deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'));
    if (faderVal) faderVal.textContent = fmtPct(parseFloat(fader.value));
  };

  const col = renderElement(html`
    <div class="mix-col master-strip">
      <div class="mix-name">${deps.sceneRing ? deps.sceneRing.el : ''}<span>MASTER</span></div>
      <div class="mix-section">
        <div class="mix-sec-label">EQ</div>
        ${knobEl(deps, { label: 'HI',  min: -18, max: 18, step: 0.5, value: strip.getEqHigh(), defaultValue: 0, color: '#2ee0c0', format: fmtDb, onChange: (v) => strip.setEqHigh(v) })}
        ${knobEl(deps, { label: 'MID', min: -18, max: 18, step: 0.5, value: strip.getEqMid(),  defaultValue: 0, color: '#f7d000', format: fmtDb, onChange: (v) => strip.setEqMid(v) })}
        ${knobEl(deps, { label: 'LO',  min: -18, max: 18, step: 0.5, value: strip.getEqLow(),  defaultValue: 0, color: '#c0392b', format: fmtDb, onChange: (v) => strip.setEqLow(v) })}
      </div>
      <div class="mix-section master-fx-section">
        <div class="mix-sec-label">FX</div>
        <button
          class=${deps.isFxOpen() ? 'master-fx-toggle active' : 'master-fx-toggle'}
          title="Master effects (reverb / delay / comp / inserts)"
          @click=${() => deps.onToggleFx()}
        >FX</button>
      </div>
      <div class="mix-section">
        ${knobEl(deps, { label: 'PAN', min: -1, max: 1, step: 0.01, value: strip.getPan(), defaultValue: 0, color: '#e67e22', format: fmtPan, onChange: (v) => strip.setPan(v) })}
      </div>
      <div class="mix-ms">
        <button
          class=${strip.isMuted() ? 'mix-btn mute active' : 'mix-btn mute'}
          @click=${(e: Event) => {
            strip.setMuted(!strip.isMuted());
            (e.currentTarget as HTMLElement).classList.toggle('active', strip.isMuted());
          }}
        >M</button>
      </div>
      <div class="mix-fader-wrap">
        <div class="mix-fader-row">
          <input
            type="range" class="mix-fader" min="0" max="1" step="0.01"
            .value=${deps.volInput.value}
            @input=${onFaderInput}
          />
          ${vuMeter.el}
        </div>
        <div class="mix-fader-val"></div>
      </div>
    </div>
  `);

  const fader = col.querySelector('.mix-fader') as HTMLInputElement;
  faderVal = col.querySelector('.mix-fader-val') as HTMLElement;
  faderVal.textContent = fmtPct(parseFloat(fader.value));

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
  const vuMeter = createLevelMeter({ analyser: deps.masterMeterAnalyser });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);

  let val: HTMLElement | null = null;
  const onFaderInput = (e: Event) => {
    const fader = e.currentTarget as HTMLInputElement;
    deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'));
    if (val) val.textContent = fmtPct(parseFloat(fader.value));
  };

  const wrap = renderElement(html`
    <div class="perf-master-mini">
      <span class="perf-master-mini-label">MASTER</span>
      ${vuMeter.el}
      <input
        type="range" class="perf-master-mini-fader" min="0" max="1" step="0.01"
        .value=${deps.volInput.value}
        @input=${onFaderInput}
      />
      <span class="perf-master-mini-val"></span>
    </div>
  `);

  const fader = wrap.querySelector('.perf-master-mini-fader') as HTMLInputElement;
  val = wrap.querySelector('.perf-master-mini-val') as HTMLElement;
  val.textContent = fmtPct(parseFloat(fader.value));

  return wrap;
}
