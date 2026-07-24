// Reusable mixer column builder.
//
// Used by:
//   - The horizontal Classic mixer panel (one column per active track)
//   - The Session view column strips (one column per session lane)
//
// Both call buildMixerColumn(trackId, deps) to construct identical DOM with
// the real knob instances (no cloning). The knobs are registered into the
// caller-provided automation registry via deps.registerKnob.
//
// The column is a one-shot lit template (renderElement): callers own the node
// and rebuild the whole column on structural change, so there is no re-render
// path. Knobs and the VU meter are imperative widgets interpolated by node —
// the meter's per-frame segment updates never touch the template.

import { html } from 'lit-html';
import { renderElement } from './lit-fragment';
import type { ChannelStrip } from './fx';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { createLevelMeter } from './level-meter';

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDb  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
const fmtPan = (v: number) =>
  v === 0 ? 'C' : (v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`);

export interface MixerColumnDeps {
  stripFor:      (trackId: string) => ChannelStrip;
  label:         (trackId: string) => string;
  muteState:     Record<string, boolean>;
  soloState:     Record<string, boolean>;
  applyMuteSolo: () => void;
  registerKnob:  (k: KnobHandle) => void;
  /** Optional undo history deps. When present, knob drags/wheel/dblclick
   *  are bracketed as single undo entries. */
  historyDeps?:  HistoryDeps;
  /**
   * Optional teardown registration. When provided, the column calls
   * `registerDisposable(handle)` with the VU meter handle so the caller can
   * dispose meters when the column is rebuilt or torn down. If omitted the
   * meter is still created but the caller must track disposal separately.
   */
  registerDisposable?: (d: { dispose(): void }) => void;
}

interface KnobOpts {
  id?: string;
  label?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  color?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** Builds + registers a knob and hands back its root node for interpolation.
 *  Evaluation order inside the template literal keeps the registration order
 *  identical to the old appendChild sequence (eqhi → … → pan). */
function knobEl(deps: MixerColumnDeps, opts: KnobOpts): HTMLElement {
  const undoHooks = deps.historyDeps ? attachKnobUndo(deps.historyDeps) : {};
  const k = createKnob({ ...opts, size: 28, ...undoHooks });
  deps.registerKnob(k);
  return k.el;
}

export function buildMixerColumn(trackId: string, deps: MixerColumnDeps): HTMLElement {
  const strip = deps.stripFor(trackId);
  const state = strip.serialize();

  // IMPORTANT: callers must dispose the VU meter handle when removing the
  // column (via deps.registerDisposable or manual tracking). Failing to do so
  // will keep the meter's RAF registration alive and the analyser connected.
  const vuMeter = createLevelMeter({ analyser: strip.getMeterAnalyser() });
  if (deps.registerDisposable) deps.registerDisposable(vuMeter);

  // Assigned after render; the handler only fires on user input, long after.
  let faderVal: HTMLElement | null = null;
  const onFaderInput = (e: Event) => {
    const fader = e.currentTarget as HTMLInputElement;
    strip.setLevel(parseFloat(fader.value));
    if (faderVal) faderVal.textContent = fmtPct(parseFloat(fader.value));
  };

  // Fader layout: faderWrap (column) → faderRow (row: fader + vuHost) → faderVal
  // The value readout sits below the fader/meter row so its 9px label stays
  // outside the fixed-height 110 px row.
  const col = renderElement(html`
    <div class=${`mix-col ${trackId}`}>
      <div class="mix-name">${deps.label(trackId)}</div>
      <div class="mix-section">
        <div class="mix-sec-label">EQ</div>
        ${knobEl(deps, {
          id: `mix.${trackId}.eqhi`,  label: 'HI',  min: -18, max: 18, step: 0.5,
          value: state.eqHigh, defaultValue: 0, color: '#2ee0c0', format: fmtDb,
          onChange: (v) => strip.setEqHigh(v),
        })}
        ${knobEl(deps, {
          id: `mix.${trackId}.eqmid`, label: 'MID', min: -18, max: 18, step: 0.5,
          value: state.eqMid,  defaultValue: 0, color: '#f7d000', format: fmtDb,
          onChange: (v) => strip.setEqMid(v),
        })}
        ${knobEl(deps, {
          id: `mix.${trackId}.eqlow`, label: 'LO',  min: -18, max: 18, step: 0.5,
          value: state.eqLow,  defaultValue: 0, color: '#c0392b', format: fmtDb,
          onChange: (v) => strip.setEqLow(v),
        })}
      </div>
      <div class="mix-section">
        <div class="mix-sec-label">SEND</div>
        ${knobEl(deps, {
          id: `mix.${trackId}.sendA`, label: 'A', min: 0, max: 1, step: 0.01,
          value: state.sendA, defaultValue: 0, color: '#3498db', format: fmtPct,
          onChange: (v) => strip.setSendA(v),
        })}
        ${knobEl(deps, {
          id: `mix.${trackId}.sendB`, label: 'B', min: 0, max: 1, step: 0.01,
          value: state.sendB, defaultValue: 0, color: '#9b59b6', format: fmtPct,
          onChange: (v) => strip.setSendB(v),
        })}
      </div>
      <div class="mix-section">
        ${knobEl(deps, {
          id: `mix.${trackId}.pan`, label: 'PAN', min: -1, max: 1, step: 0.01,
          value: state.pan ?? 0, defaultValue: 0, color: '#e67e22', format: fmtPan,
          onChange: (v) => strip.setPan(v),
        })}
      </div>
      <div class="mix-ms">
        <button
          class=${deps.muteState[trackId] ? 'mix-btn mute active' : 'mix-btn mute'}
          @click=${(e: Event) => {
            deps.muteState[trackId] = !deps.muteState[trackId];
            (e.currentTarget as HTMLElement).classList.toggle('active', deps.muteState[trackId]);
            deps.applyMuteSolo();
          }}
        >M</button>
        <button
          class=${deps.soloState[trackId] ? 'mix-btn solo active' : 'mix-btn solo'}
          @click=${(e: Event) => {
            deps.soloState[trackId] = !deps.soloState[trackId];
            (e.currentTarget as HTMLElement).classList.toggle('active', deps.soloState[trackId]);
            deps.applyMuteSolo();
          }}
        >S</button>
      </div>
      <div class="mix-fader-wrap">
        <div class="mix-fader-row">
          <input
            type="range" class="mix-fader" min="0" max="1.5" step="0.01"
            .value=${String(state.level)}
            @input=${onFaderInput}
            @pointerdown=${() => deps.historyDeps?.beginGesture?.()}
            @pointerup=${() => deps.historyDeps?.endGesture?.()}
            @focus=${() => deps.historyDeps?.beginGesture?.()}
            @blur=${() => deps.historyDeps?.endGesture?.()}
          />
          ${vuMeter.el}
        </div>
        <div class="mix-fader-val"></div>
      </div>
    </div>
  `);

  // Initial readout comes from the live input (the range clamps out-of-range
  // levels), exactly like the old updateFaderText().
  const fader = col.querySelector('.mix-fader') as HTMLInputElement;
  faderVal = col.querySelector('.mix-fader-val') as HTMLElement;
  faderVal.textContent = fmtPct(parseFloat(fader.value));

  return col;
}
