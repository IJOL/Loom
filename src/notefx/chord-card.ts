// src/notefx/chord-card.ts
// The chord card's body — the Scales & Chords surface. Split out of
// notefx-ui because this card alone grew a preset bank, a diatonic voicing
// row, a per-card tonality and a 12-key painter; the panel keeps the frame
// (title row, enable, remove) and hands this file the inside.

import { html, nothing, type TemplateResult } from 'lit-html';
import { SCALE_CATALOG } from '../core/musicality';
import type { NoteFxState } from './notefx-types';
import { CHORD_FX_PRESETS, applyChordFxPreset } from './chord-presets';
import { selectField, pairedSelectField, numberField } from './notefx-fields';

/** How the card writes. `set` is a value-only write (the control being held
 *  already shows it); `setShape` also repaints, for a write that changes which
 *  controls exist; `apply` brackets MANY writes as one undo entry + repaint —
 *  what a preset needs, so undo takes the whole patch back in one step. */
export interface ChordCardHelpers {
  set: (k: string, v: string | number | boolean) => void;
  setShape: (k: string, v: string | number | boolean) => void;
  apply: (fn: () => void) => void;
}

// 'diatonic' before 'free': the two modes that replace the named voicing with
// something else — the scale, or three numbers.
const CHORD_TYPES = ['maj', 'min', 'maj7', 'min7', 'sus2', 'sus4', 'dim', 'diatonic', 'free'];
// off — play the intervals as dialled.
// scale — correct out-of-scale notes into the key.
// chord — lock to the tones of the chord sounding now (falls back to scale
//         when the session names no progression).
// filter — SILENCE out-of-scale notes instead of correcting them (Reason's
//          "Filter Notes: on"). Hidden in diatonic mode, whose output is
//          in-scale by construction.
const CONFORM_MODES = ['off', 'scale', 'chord', 'filter'];
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_PAIRS: ReadonlyArray<readonly [string, string]> =
  [['session', 'Session'], ...ROOT_NAMES.map((n, i) => [String(i), n] as const)];
const SCALE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['session', 'Session'],
  ...SCALE_CATALOG.map((s) => [s.id, s.label] as const),
  ['custom', 'Custom'],
];
// The painter labels DEGREES, not note names: the mask is relative to the key,
// so '1' is the root wherever the key sits and the painted shape transposes.
// The ♭ glyph, not a lowercase b — the buttons uppercase their text and 'b2'
// came out as "B2", which reads as the note B2.
const DEGREE_LABELS = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
const PRESET_PAIRS: ReadonlyArray<readonly [string, string]> =
  [['', '—'], ...CHORD_FX_PRESETS.map((p) => [p.id, p.name] as const)];

export function chordCardTemplate(fx: NoteFxState, h: ChordCardHelpers): TemplateResult {
  const type = String(fx.params.chordType ?? 'maj');
  const diatonic = type === 'diatonic';
  const octaveOn = fx.params.octaveOn === true;
  const fxScale = String(fx.params.fxScale ?? 'session');
  const toggle = (label: string, key: string) => {
    const on = fx.params[key] === true;
    return html`<button class=${on ? 'rnd primary' : 'rnd'}
      @click=${() => h.setShape(key, !on)}>${label}</button>`;
  };
  return html`
    ${/* Stateless on purpose: a preset is a starting point, not a state the
        card tracks — the dropdown snaps back to '—' once applied. */ ''}
    ${pairedSelectField('PRESET', PRESET_PAIRS, '', (id) => {
      if (id !== '') h.apply(() => applyChordFxPreset(fx.params, id));
    })}
    ${selectField('CHORD', CHORD_TYPES, type, (v) => h.setShape('chordType', v))}
    ${type === 'free' ? html`
      ${numberField('INT 1', -24, 24, 1, Number(fx.params.i1 ?? 4), (v) => h.set('i1', v))}
      ${numberField('INT 2', -24, 24, 1, Number(fx.params.i2 ?? 7), (v) => h.set('i2', v))}
      ${numberField('INT 3', -24, 24, 1, Number(fx.params.i3 ?? 0), (v) => h.set('i3', v))}
    ` : nothing}
    ${diatonic ? html`
      ${numberField('NOTES', 1, 5, 1, Number(fx.params.notes ?? 3), (v) => h.set('notes', v))}
      ${numberField('INV', 0, 4, 1, Number(fx.params.inversion ?? 0), (v) => h.set('inversion', v))}
      <div class="notefx-field notefx-chord-toggles">
        ${toggle('OPEN', 'open')}
        ${toggle('+8VA', 'addOctUp')}
        ${toggle('-8VA', 'addOctDown')}
        ${toggle('COLOR', 'color')}
        ${toggle('ALTER', 'alter')}
      </div>
    ` : nothing}
    ${pairedSelectField('KEY', KEY_PAIRS, String(fx.params.fxKey ?? 'session'),
      (v) => h.set('fxKey', v))}
    ${pairedSelectField('SCALE', SCALE_PAIRS, fxScale, (v) => h.setShape('fxScale', v))}
    ${fxScale === 'custom' ? painterTemplate(fx, h) : nothing}
    ${diatonic ? nothing
      : selectField('IN KEY', CONFORM_MODES, String(fx.params.conform ?? 'off'),
          (v) => h.set('conform', v))}
    <div class="notefx-field notefx-oct-toggle">
      <span>OCT SHIFT</span>
      <button class=${octaveOn ? 'rnd primary' : 'rnd'}
        @click=${() => h.setShape('octaveOn', !octaveOn)}>${octaveOn ? 'ON' : 'OFF'}</button>
    </div>
    ${octaveOn
      ? numberField('OCT', -2, 2, 1, Number(fx.params.octave ?? 0), (v) => h.set('octave', v))
      : nothing}
  `;
}

function painterTemplate(fx: NoteFxState, h: ChordCardHelpers): TemplateResult {
  const mask = Math.round(Number(fx.params.customMask ?? 0)) & 0xfff;
  return html`<div class="notefx-field notefx-custom-scale">
    ${DEGREE_LABELS.map((label, pc) => {
      const on = (mask & (1 << pc)) !== 0;
      return html`<button class=${on ? 'rnd primary' : 'rnd'} title=${`degree ${label}`}
        @click=${() => h.setShape('customMask', mask ^ (1 << pc))}>${label}</button>`;
    })}
  </div>`;
}
