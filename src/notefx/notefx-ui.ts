// src/notefx/notefx-ui.ts
// The per-lane NOTE FX panel (arp + chord + random cards), a lit-html panel
// mounted via mountPanel: add/remove/enable-toggle repaint in place instead of
// the old innerHTML-wipe rebuild. Param edits (selects/sliders) mutate chain
// state and sync WITHOUT a repaint — the control the user is holding already
// shows the value they just picked.

import { html, nothing, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { mountPanel, type PanelHandle } from '../core/lit-panel';
import { SCALE_CATALOG, type ScaleId } from '../core/musicality';
import type { NoteFxChain } from './notefx-chain';
import type { NoteFxState } from './notefx-types';
import { DEFAULT_ARP_STEPS } from './arp-steps';
import { createArpStepsEditor, type ArpStepsEditor } from './arp-steps-editor';
import { withUndo, type HistoryDeps } from '../save/history-wiring';

export interface NoteFxUIDeps {
  laneId: string;
  chain: NoteFxChain;
  /** Mirror chain state into the session so it persists + loads with demos. */
  onChange: (noteFx: NoteFxState[]) => void;
  /** Optional undo history deps. When present, every note-FX add/remove/
   *  enable-toggle/param edit is bracketed as a single undo entry — matching
   *  the modulators panel this mirrors. */
  historyDeps?: HistoryDeps;
}

/** Run `fn`, bracketed as one undo entry when history deps are present. */
function withMaybeUndo(deps: NoteFxUIDeps, fn: () => void): void {
  if (deps.historyDeps) withUndo(deps.historyDeps, fn);
  else fn();
}

// 'steps' last: it is the one that replaces a shape with a pattern you write.
const ARP_PATTERNS = ['up', 'down', 'updown', 'random', 'cosmic', 'steps'];
const ARP_SCALES = ['global', 'major', 'minor', 'pentMinor', 'phrygian', 'chromatic'];
const ARP_RATES = ['free', '1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'];
// 'free' last: it is the one that replaces the named voicing with three numbers.
const CHORD_TYPES = ['maj', 'min', 'maj7', 'min7', 'sus2', 'sus4', 'dim', 'free'];
// off  — play the intervals as dialled.
// scale — stay in the key.
// chord — lock to the tones of the chord sounding now (falls back to scale
//         when the session names no progression).
const CONFORM_MODES = ['off', 'scale', 'chord'];
const RANDOM_MODES = ['random', 'alt'];
const RANDOM_SIGNS = ['add', 'sub', 'bi'];
const SCALE_IDS: ScaleId[] = SCALE_CATALOG.map((s) => s.id);
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Follow the session's tonality. It is the DEFAULT, and it is shown by name:
// the card used to paint a concrete root ("A") while the stored value meant
// "follow", so what you read and what you heard were different things.
const FOLLOW = 'Global';

type Ctx = PanelHandle<NoteFxUIDeps>;

export function renderNoteFxPanel(container: HTMLElement, deps: NoteFxUIDeps): void {
  // The mount host IS the .notefx-panel box (a grid), so the template's
  // title/header/cards land as its direct children — same DOM shape as before.
  mountPanel({ container, className: 'notefx-panel', deps, template: panelTemplate });
}

function panelTemplate(ctx: Ctx): TemplateResult {
  const { deps } = ctx;
  const add = (kind: 'arp' | 'chord' | 'random') => () => {
    withMaybeUndo(deps, () => { deps.chain.addNoteFx(kind); deps.onChange(deps.chain.serialize()); });
    ctx.rerender();
  };
  return html`
    <div class="mod-panel-title">NOTE FX</div>
    <div class="mod-panel-header">
      <button class="rnd" @click=${add('arp')}>+ Arp</button>
      <button class="rnd" @click=${add('chord')}>+ Chord</button>
      <button class="rnd" @click=${add('random')}>+ Random</button>
    </div>
    ${repeat(deps.chain.noteFx, (fx) => fx.id, (fx) => cardTemplate(fx, ctx))}
  `;
}

function cardTemplate(fx: NoteFxState, ctx: Ctx): TemplateResult {
  const { deps } = ctx;
  const sync = () => deps.onChange(deps.chain.serialize());
  const set = (k: string, v: string | number | boolean) => {
    withMaybeUndo(deps, () => { fx.params[k] = v; sync(); });
  };
  /** A write that changes which CONTROLS the card has, rather than only a
   *  value. `set` alone leaves the card as it was — right for every knob on it,
   *  and wrong for PATTERN, which decides whether the STEPS field exists at
   *  all. It shipped that way for one browser check: the dropdown offered
   *  `steps`, choosing it worked, and no field appeared. */
  const setShape = (k: string, v: string | number | boolean) => {
    set(k, v);
    ctx.rerender();
  };
  const octaveOn = fx.params.octaveOn === true;
  const chordFree = String(fx.params.chordType ?? 'maj') === 'free';
  // Three-way now: off / scale / chord. The middle one is what IN KEY used
  // to mean; the third locks to the chord sounding now.
  const conform = String(fx.params.conform ?? 'off');
  const scaleAware = fx.params.scaleAware !== false;
  return html`
    <div class="notefx-card notefx-${fx.kind}">
      <div class="notefx-card-row">
        <span>${fx.id.toUpperCase()}</span>
        <button class=${fx.enabled ? 'rnd primary' : 'rnd'} @click=${() => {
          withMaybeUndo(deps, () => { fx.enabled = !fx.enabled; sync(); });
          ctx.rerender();
        }}>${fx.enabled ? 'ON' : 'OFF'}</button>
        <button class="rnd" @click=${() => {
          withMaybeUndo(deps, () => { deps.chain.removeNoteFx(fx.id); sync(); });
          ctx.rerender();
        }}>×</button>
      </div>
      ${fx.kind === 'arp' ? html`
        ${selectField('PATTERN', ARP_PATTERNS, String(fx.params.pattern ?? 'up'), (v) => setShape('pattern', v))}
        ${fx.params.pattern === 'steps' ? stepsField(fx, set) : nothing}
        ${selectField('SCALE', ARP_SCALES, String(fx.params.scale ?? 'global'), (v) => set('scale', v))}
        ${selectField('RATE', ARP_RATES, String(fx.params.rate ?? '1/16'), (v) => set('rate', v))}
        ${numberField('OCT', 1, 4, 1, Number(fx.params.octaves ?? 2), (v) => set('octaves', v))}
        ${numberField('GATE', 0.05, 1, 0.01, Number(fx.params.gate ?? 0.7), (v) => set('gate', v))}
        ${numberField('FREE Hz', 0.5, 32, 0.1, Number(fx.params.rateFreeHz ?? 8), (v) => set('rateFreeHz', v))}
      ` : fx.kind === 'random' ? html`
        ${numberField('CHANCE', 0, 1, 0.01, Number(fx.params.chance ?? 0), (v) => set('chance', v))}
        ${numberField('CHOICES', 1, 24, 1, Number(fx.params.choices ?? 6), (v) => set('choices', v))}
        ${numberField('INTERVAL', 1, 12, 1, Number(fx.params.interval ?? 1), (v) => set('interval', v))}
        ${selectField('MODE', RANDOM_MODES, String(fx.params.mode ?? 'random'), (v) => set('mode', v))}
        ${selectField('SIGN', RANDOM_SIGNS, String(fx.params.sign ?? 'bi'), (v) => set('sign', v))}
        <div class="notefx-field notefx-oct-toggle">
          <span>SCALE</span>
          <button class=${scaleAware ? 'rnd primary' : 'rnd'} @click=${() => {
            set('scaleAware', !scaleAware);
            ctx.rerender();
          }}>${scaleAware ? 'ON' : 'OFF'}</button>
        </div>
        ${scaleAware ? html`
          ${selectField('ROOT', [FOLLOW, ...ROOT_NAMES],
            Number(fx.params.key ?? -1) < 0 ? FOLLOW : ROOT_NAMES[Number(fx.params.key)],
            (v) => set('key', v === FOLLOW ? -1 : ROOT_NAMES.indexOf(v)))}
          ${selectField('SCALE', [FOLLOW, ...SCALE_IDS],
            String(fx.params.scale ?? '') === '' ? FOLLOW : String(fx.params.scale),
            (v) => set('scale', v === FOLLOW ? '' : v))}
        ` : ''}
        ${numberField('VEL CHANCE', 0, 1, 0.01, Number(fx.params.velChance ?? 0), (v) => set('velChance', v))}
        ${numberField('VEL RND', 0, 1, 0.01, Number(fx.params.velRandom ?? 0.3), (v) => set('velRandom', v))}
        ${numberField('VEL SMOOTH', 0, 1, 0.01, Number(fx.params.velSmooth ?? 0), (v) => set('velSmooth', v))}
        ${numberField('VEL DRIFT', 0.05, 8, 0.05, Number(fx.params.velSmoothRate ?? 1), (v) => set('velSmoothRate', v))}
        ${numberField('DUR CHANCE', 0, 1, 0.01, Number(fx.params.durChance ?? 0), (v) => set('durChance', v))}
        ${numberField('DUR RND', 0, 1, 0.01, Number(fx.params.durRandom ?? 0.3), (v) => set('durRandom', v))}
        ${numberField('DROP', 0, 1, 0.01, Number(fx.params.dropChance ?? 0), (v) => set('dropChance', v))}
      ` : html`
        ${/* 'free' shows three more fields; the named types hide them. */ ''}
        ${selectField('CHORD', CHORD_TYPES, String(fx.params.chordType ?? 'maj'), (v) => setShape('chordType', v))}
        ${chordFree ? html`
          ${numberField('INT 1', -24, 24, 1, Number(fx.params.i1 ?? 4), (v) => set('i1', v))}
          ${numberField('INT 2', -24, 24, 1, Number(fx.params.i2 ?? 7), (v) => set('i2', v))}
          ${numberField('INT 3', -24, 24, 1, Number(fx.params.i3 ?? 0), (v) => set('i3', v))}
        ` : ''}
        ${selectField('IN KEY', CONFORM_MODES, conform, (v) => set('conform', v))}
        <div class="notefx-field notefx-oct-toggle">
          <span>OCT SHIFT</span>
          <button class=${octaveOn ? 'rnd primary' : 'rnd'} @click=${() => {
            set('octaveOn', !octaveOn);
            ctx.rerender();
          }}>${octaveOn ? 'ON' : 'OFF'}</button>
        </div>
        ${octaveOn
          ? numberField('OCT', -2, 2, 1, Number(fx.params.octave ?? 0), (v) => set('octave', v))
          : ''}
      `}
    </div>
  `;
}

function selectField(
  label: string, opts: string[], value: string, onChange: (v: string) => void,
): TemplateResult {
  return html`<label class="notefx-field">${label}<select
    @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
  >${opts.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}</select></label>`;
}

/** The arp's pattern editor, kept ALIVE across repaints.
 *
 *  Weak, keyed on the FX state object, so an editor dies with the card it
 *  belongs to and no bookkeeping is needed to remove it. Rebuilding one per
 *  paint would be wasteful and, worse, would destroy the row a pointer is
 *  painting on — the same fault the WEAVE panel shipped twice as "the fader
 *  cannot be dragged". */
const stepsEditors = new WeakMap<NoteFxState, { ed: ArpStepsEditor; emitted: string }>();

function stepsField(
  fx: NoteFxState, set: (k: string, v: string | number | boolean) => void,
): TemplateResult {
  const value = String(fx.params.steps ?? DEFAULT_ARP_STEPS);
  let entry = stepsEditors.get(fx);
  if (!entry) {
    const ed = createArpStepsEditor({
      value,
      label: `${fx.id} pattern`,
      onChange: (src) => {
        const e = stepsEditors.get(fx);
        if (e) e.emitted = src;
        set('steps', src);
      },
    });
    entry = { ed, emitted: value };
    stepsEditors.set(fx, entry);
  } else if (value !== entry.emitted) {
    // Something OTHER than this editor moved the pattern — an undo, a preset,
    // a session load. Repaint from it. Skipped when the value is the editor's
    // own last word, so a paint never fights the hand that is painting.
    entry.ed.set(value);
    entry.emitted = value;
  }
  return html`<div class="notefx-field notefx-steps"><span>STEPS</span>${entry.ed.el}</div>`;
}

function numberField(
  label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void,
): TemplateResult {
  return html`<label class="notefx-field">${label}<input
    type="range" min=${min} max=${max} step=${step} .value=${String(value)}
    @input=${(e: Event) => onChange(Number((e.target as HTMLInputElement).value))}
  /></label>`;
}
