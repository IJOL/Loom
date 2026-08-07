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

import { html, nothing } from 'lit-html';
import { renderElement } from './lit-fragment';
import type { ChannelStrip } from './fx';
import { createKnob, type KnobHandle } from './knob';
import { attachKnobUndo, type HistoryDeps } from '../save/history-wiring';
import { createLevelMeter } from './level-meter';
import { STRIP_PARAM_SPECS } from './channel-strip-params';

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
  /** Selects this column's lane. Fires only for clicks on the column's DEAD
   *  ZONES — the name, the section labels, the padding. A click that lands on a
   *  live control (fader, knob, mute/solo, an insert slot, a dropdown) does that
   *  control's job and nothing else, so moving a fader never pulls the user out
   *  of the clip they are editing. Optional: the Classic mixer panel does not
   *  own a lane selection. */
  onSelect?:     (trackId: string) => void;
  /** Fold / unfold this lane's instrument editor, from the column's own toggle
   *  next to the track name. The grid header's chevron only ever appears on the
   *  ACTIVE lane, so the mixer is where you can reach any lane's editor. */
  onToggleSynth?: (trackId: string) => void;
  /** Whether this lane's editor is currently open — drives the ▾/▸ face. */
  isSynthOpenFor?: (trackId: string) => boolean;
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

/** The automation id of one of the lane strip's seven params, e.g.
 *  `subtractive-1.bus.eq.high`. The lane id is the SCOPE — the first segment —
 *  which is what makes these ordinary lane params: the catalogue lists them, the
 *  resolver finds their clip, and the replay path routes them, all without a
 *  special case. (They used to be `mix.<lane>.<param>`, whose scope parsed as
 *  "mix", a lane that does not exist — hence no menu and no destination.) */
function stripParamId(trackId: string, paramId: string): string {
  return `${trackId}.${paramId}`;
}

/** Give the level fader the identity every other control already has.
 *
 *  It is an `<input type="range">`, not a knob, and it stays one — the look does
 *  not change. What changes is that a KnobHandle now stands in front of it, so
 *  the automation registry, the right-click menu and the replay tick can see it.
 *  Same trick select-control.ts uses for the discrete radio strips: synthesise
 *  the handle, do not convert the widget.
 *
 *  `setValue` is the REPLAY entry point (automation, undo, a session load), so it
 *  moves the slider, refreshes the readout AND writes the gain — a handle that
 *  only moved the slider would show a fade that cannot be heard. */
function faderHandle(
  fader: HTMLInputElement,
  readout: HTMLElement,
  strip: ChannelStrip,
  id: string,
): KnobHandle {
  const spec = STRIP_PARAM_SPECS.find((s) => s.id === 'bus.level')!;
  const handle: KnobHandle = {
    el: fader,
    meta: { id, label: 'LEVEL', min: spec.min, max: spec.max },
    setValue: (v: number) => {
      const clamped = Math.max(spec.min, Math.min(spec.max, v));
      fader.value = String(clamped);
      readout.textContent = fmtPct(clamped);
      strip.setLevel(clamped);
      fader.setAttribute('data-value-norm', String((clamped - spec.min) / (spec.max - spec.min)));
    },
    // A slider has no ring to draw a modulation offset on.
    setModulationOffset: () => { /* no ring on a fader */ },
  };
  return handle;
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
  let faderKnob: KnobHandle | null = null;
  const onFaderInput = (e: Event) => {
    const fader = e.currentTarget as HTMLInputElement;
    const v = parseFloat(fader.value);
    strip.setLevel(v);
    if (faderVal) faderVal.textContent = fmtPct(v);
    // `fromUser: true` — this is the branch REC records and the automation writer
    // mirrors. Programmatic moves go through the handle's setValue instead, which
    // deliberately does not fire this.
    faderKnob?.onValueChanged?.(v, true);
  };

  // Fader layout: faderWrap (column) → faderRow (row: fader + vuHost) → faderVal
  // The value readout sits below the fader/meter row so its 9px label stays
  // outside the fixed-height 110 px row.
  const col = renderElement(html`
    <div class=${`mix-col ${trackId}`}>
      <div class="mix-name-row">
        <span class="mix-name">${deps.label(trackId)}</span>
        ${deps.onToggleSynth
          ? html`<button
              class="mix-synth-toggle"
              title=${deps.isSynthOpenFor?.(trackId)
                ? 'Collapse this track’s instrument editor'
                : 'Show this track’s instrument editor'}
              @click=${() => deps.onToggleSynth!(trackId)}
            >${deps.isSynthOpenFor?.(trackId) ? '▾' : '▸'}</button>`
          : nothing}
      </div>
      <div class="mix-section">
        <div class="mix-sec-label">EQ</div>
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.eq.high'), label: 'HI', min: -18, max: 18, step: 0.5,
          value: state.eqHigh, defaultValue: 0, color: '#2ee0c0', format: fmtDb,
          onChange: (v) => strip.setEqHigh(v),
        })}
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.eq.mid'), label: 'MID', min: -18, max: 18, step: 0.5,
          value: state.eqMid,  defaultValue: 0, color: '#f7d000', format: fmtDb,
          onChange: (v) => strip.setEqMid(v),
        })}
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.eq.low'), label: 'LO', min: -18, max: 18, step: 0.5,
          value: state.eqLow,  defaultValue: 0, color: '#c0392b', format: fmtDb,
          onChange: (v) => strip.setEqLow(v),
        })}
      </div>
      <div class="mix-section">
        <div class="mix-sec-label">SEND</div>
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.delaySend'), label: 'A', min: 0, max: 1, step: 0.01,
          value: state.sendA, defaultValue: 0, color: '#3498db', format: fmtPct,
          onChange: (v) => strip.setSendA(v),
        })}
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.reverbSend'), label: 'B', min: 0, max: 1, step: 0.01,
          value: state.sendB, defaultValue: 0, color: '#9b59b6', format: fmtPct,
          onChange: (v) => strip.setSendB(v),
        })}
      </div>
      <div class="mix-section">
        ${knobEl(deps, {
          id: stripParamId(trackId, 'bus.pan'), label: 'PAN', min: -1, max: 1, step: 0.01,
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

  // Registered here rather than inside the template: the handle has to wrap the
  // real <input>, which only exists after renderElement.
  faderKnob = faderHandle(fader, faderVal, strip, stripParamId(trackId, 'bus.level'));
  fader.setAttribute(
    'data-value-norm',
    String(parseFloat(fader.value) / 1.5),
  );
  deps.registerKnob(faderKnob);

  // One listener on the root, not one per dead zone: the column is rebuilt whole
  // on every render, and enumerating the dead zones would need updating each time
  // a control is added. Ask what was hit instead.
  if (deps.onSelect) {
    const onSelect = deps.onSelect;
    col.addEventListener('click', (e) => {
      const hit = e.target as Element | null;
      if (hit?.closest('button, input, select, .knob, [role="slider"]')) return;
      onSelect(trackId);
    });
  }

  return col;
}
