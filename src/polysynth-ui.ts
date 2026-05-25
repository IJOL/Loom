import { createKnob, type KnobHandle } from './knob';
import { PolySynth, type PolySynthParams, type LfoTarget, type LfoSync } from './polysynth';

// ── Formatters (local copies, shared with main.ts via caller) ──────────────
const fmtPct    = (v: number) => `${Math.round(v * 100)}%`;
const fmtSec    = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
const fmtCents  = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}¢`;
const fmtOct    = (v: number) => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`;

export const WAVE_OPTS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
];

export interface PolySynthUIDeps {
  getActivePolyTarget: () => PolySynth;
  registerKnob: (k: KnobHandle) => void;
}

// These are populated once by buildPolySynthUI and read by refreshPolyKnobsFromState.
const refreshFns: Array<() => void> = [];
// Exported so main.ts can push into it (e.g. from addPolyKnob calls in buildFxUI)
export { refreshFns };

let _deps: PolySynthUIDeps | null = null;

function getTarget(): PolySynth {
  return _deps!.getActivePolyTarget();
}

export function addPolyKnob(
  parent: HTMLElement,
  opts: Parameters<typeof createKnob>[0],
  getCurrent: () => number,
  deps?: PolySynthUIDeps,
): KnobHandle {
  const d = deps ?? _deps!;
  if (!opts.id && opts.label) {
    const sec = parent.id.replace(/^poly-/, '').replace(/-knobs$/, '').replace('-', '');
    const lab = (opts.label as string).toLowerCase().replace(/[^a-z0-9]+/g, '');
    opts.id = `poly.${sec}.${lab}`;
  }
  const k = createKnob(opts);
  parent.appendChild(k.el);
  refreshFns.push(() => k.setValue(getCurrent()));
  d.registerKnob(k);
  return k;
}

export function addPolySelect(
  parent: HTMLElement,
  label: string,
  options: Array<{ value: string; label: string }>,
  getCurrent: () => string,
  onChange: (v: string) => void,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  const lab = document.createElement('div');
  lab.className = 'knob-label';
  lab.textContent = label;
  wrap.appendChild(lab);
  const sel = document.createElement('select');
  sel.className = 'poly-wave-sel';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === getCurrent()) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  parent.appendChild(wrap);
  refreshFns.push(() => { sel.value = getCurrent(); });
}

export function refreshPolyKnobsFromState(): void {
  for (const fn of refreshFns) fn();
}

export function buildPolySynthUI(deps: PolySynthUIDeps): void {
  _deps = deps;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const osc1Row  = $<HTMLDivElement>('poly-osc1-knobs');
  const osc2Row  = $<HTMLDivElement>('poly-osc2-knobs');
  const subRow   = $<HTMLDivElement>('poly-sub-knobs');
  const noiseRow = $<HTMLDivElement>('poly-noise-knobs');
  const filtRow  = $<HTMLDivElement>('poly-filter-knobs');
  const ampRow   = $<HTMLDivElement>('poly-amp-knobs');
  const masterRow= $<HTMLDivElement>('poly-master-knobs');
  const lfo1Row  = $<HTMLDivElement>('poly-lfo1-knobs');
  const lfo2Row  = $<HTMLDivElement>('poly-lfo2-knobs');

  const SIZE = 44;
  const oscColor    = '#e67e22';
  const subColor    = '#9b59b6';
  const noiseColor  = '#7f8c8d';
  const filtColor   = '#16a085';
  const ampColor    = '#2ecc71';
  const lfoColor    = '#3498db';
  const masterColor = '#f7d000';

  // OSC 1
  addPolySelect(osc1Row, 'WAVE', WAVE_OPTS, () => getTarget().params.osc1.wave,
    (v) => { getTarget().params.osc1.wave = v as OscillatorType; });
  addPolyKnob(osc1Row, { min: 0, max: 1, step: 0.01, value: getTarget().params.osc1.level, defaultValue: 0.6,
    label: 'LEVEL', color: oscColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.osc1.level = v; }, }, () => getTarget().params.osc1.level);
  addPolyKnob(osc1Row, { min: -2, max: 2, step: 1, value: getTarget().params.osc1.octave, defaultValue: 0,
    label: 'OCT', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.osc1.octave = v; }, }, () => getTarget().params.osc1.octave);
  addPolyKnob(osc1Row, { min: -12, max: 12, step: 1, value: getTarget().params.osc1.semi, defaultValue: 0,
    label: 'SEMI', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.osc1.semi = v; }, }, () => getTarget().params.osc1.semi);
  addPolyKnob(osc1Row, { min: -100, max: 100, step: 1, value: getTarget().params.osc1.detune, defaultValue: 0,
    label: 'DETUNE', color: oscColor, size: SIZE, format: fmtCents,
    onChange: (v) => { getTarget().params.osc1.detune = v; }, }, () => getTarget().params.osc1.detune);

  // OSC 2
  addPolySelect(osc2Row, 'WAVE', WAVE_OPTS, () => getTarget().params.osc2.wave,
    (v) => { getTarget().params.osc2.wave = v as OscillatorType; });
  addPolyKnob(osc2Row, { min: 0, max: 1, step: 0.01, value: getTarget().params.osc2.level, defaultValue: 0.4,
    label: 'LEVEL', color: oscColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.osc2.level = v; }, }, () => getTarget().params.osc2.level);
  addPolyKnob(osc2Row, { min: -2, max: 2, step: 1, value: getTarget().params.osc2.octave, defaultValue: 0,
    label: 'OCT', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.osc2.octave = v; }, }, () => getTarget().params.osc2.octave);
  addPolyKnob(osc2Row, { min: -12, max: 12, step: 1, value: getTarget().params.osc2.semi, defaultValue: 0,
    label: 'SEMI', color: oscColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.osc2.semi = v; }, }, () => getTarget().params.osc2.semi);
  addPolyKnob(osc2Row, { min: -100, max: 100, step: 1, value: getTarget().params.osc2.detune, defaultValue: 7,
    label: 'DETUNE', color: oscColor, size: SIZE, format: fmtCents,
    onChange: (v) => { getTarget().params.osc2.detune = v; }, }, () => getTarget().params.osc2.detune);

  // SUB
  addPolyKnob(subRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.sub.level, defaultValue: 0.3,
    label: 'LEVEL', color: subColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.sub.level = v; }, }, () => getTarget().params.sub.level);
  addPolyKnob(subRow, { min: -2, max: -1, step: 1, value: getTarget().params.sub.octave, defaultValue: -1,
    label: 'OCT', color: subColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.sub.octave = v; }, }, () => getTarget().params.sub.octave);

  // NOISE
  addPolyKnob(noiseRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.noise.level, defaultValue: 0,
    label: 'LEVEL', color: noiseColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.noise.level = v; }, }, () => getTarget().params.noise.level);
  addPolyKnob(noiseRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.noise.color, defaultValue: 0.6,
    label: 'COLOR', color: noiseColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.noise.color = v; }, }, () => getTarget().params.noise.color);

  // FILTER
  addPolySelect(filtRow, 'TYPE',
    [{ value: 'lowpass', label: 'LP' }, { value: 'highpass', label: 'HP' }, { value: 'bandpass', label: 'BP' }],
    () => getTarget().params.filter.type, (v) => { getTarget().params.filter.type = v as 'lowpass' | 'highpass' | 'bandpass'; });
  addPolyKnob(filtRow, { id: 'poly.filter.cutoff', min: 0, max: 1, step: 0.001, value: getTarget().params.filter.cutoff, defaultValue: 0.55,
    label: 'CUTOFF', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.cutoff = v; }, }, () => getTarget().params.filter.cutoff);
  addPolyKnob(filtRow, { id: 'poly.filter.resonance', min: 0, max: 1, step: 0.001, value: getTarget().params.filter.resonance, defaultValue: 0.25,
    label: 'RES', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.resonance = v; }, }, () => getTarget().params.filter.resonance);
  addPolyKnob(filtRow, { id: 'poly.filter.envAmount', min: 0, max: 1, step: 0.001, value: getTarget().params.filter.envAmount, defaultValue: 0.45,
    label: 'ENV', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.envAmount = v; }, }, () => getTarget().params.filter.envAmount);
  addPolyKnob(filtRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.filter.keyTrack, defaultValue: 0,
    label: 'KEY TRK', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.keyTrack = v; }, }, () => getTarget().params.filter.keyTrack);
  addPolyKnob(filtRow, { id: 'poly.filter.drive', min: 0, max: 1, step: 0.01, value: getTarget().params.filter.drive, defaultValue: 0,
    label: 'DRIVE', color: '#c0392b', size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.drive = v; }, }, () => getTarget().params.filter.drive);
  addPolyKnob(filtRow, { min: 0.001, max: 2, step: 0.001, value: getTarget().params.filter.attack, defaultValue: 0.01,
    label: 'ATK', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.filter.attack = v; }, }, () => getTarget().params.filter.attack);
  addPolyKnob(filtRow, { min: 0.001, max: 2, step: 0.001, value: getTarget().params.filter.decay, defaultValue: 0.3,
    label: 'DEC', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.filter.decay = v; }, }, () => getTarget().params.filter.decay);
  addPolyKnob(filtRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.filter.sustain, defaultValue: 0.4,
    label: 'SUS', color: filtColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.filter.sustain = v; }, }, () => getTarget().params.filter.sustain);
  addPolyKnob(filtRow, { min: 0.001, max: 3, step: 0.001, value: getTarget().params.filter.release, defaultValue: 0.35,
    label: 'REL', color: filtColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.filter.release = v; }, }, () => getTarget().params.filter.release);

  // AMP
  addPolyKnob(ampRow, { min: 0.001, max: 2, step: 0.001, value: getTarget().params.amp.attack, defaultValue: 0.01,
    label: 'ATK', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.amp.attack = v; }, }, () => getTarget().params.amp.attack);
  addPolyKnob(ampRow, { min: 0.001, max: 2, step: 0.001, value: getTarget().params.amp.decay, defaultValue: 0.2,
    label: 'DEC', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.amp.decay = v; }, }, () => getTarget().params.amp.decay);
  addPolyKnob(ampRow, { min: 0, max: 1, step: 0.01, value: getTarget().params.amp.sustain, defaultValue: 0.7,
    label: 'SUS', color: ampColor, size: SIZE, format: fmtPct,
    onChange: (v) => { getTarget().params.amp.sustain = v; }, }, () => getTarget().params.amp.sustain);
  addPolyKnob(ampRow, { min: 0.001, max: 3, step: 0.001, value: getTarget().params.amp.release, defaultValue: 0.3,
    label: 'REL', color: ampColor, size: SIZE, format: fmtSec,
    onChange: (v) => { getTarget().params.amp.release = v; }, }, () => getTarget().params.amp.release);

  // MASTER
  addPolyKnob(masterRow, { id: 'poly.master.tune', min: -24, max: 24, step: 1, value: getTarget().params.master.tune, defaultValue: 0,
    label: 'TUNE', color: masterColor, size: SIZE, format: fmtOct,
    onChange: (v) => { getTarget().params.master.tune = v; }, }, () => getTarget().params.master.tune);

  // LFOs
  const LFO_TARGET_OPTS = [
    { value: 'off',    label: 'Off' },
    { value: 'pitch',  label: 'Pitch' },
    { value: 'cutoff', label: 'Cutoff' },
    { value: 'amp',    label: 'Amp' },
  ];
  for (const idx of [1, 2] as const) {
    const row = idx === 1 ? lfo1Row : lfo2Row;
    const lfo = () => getTarget().params[`lfo${idx}` as 'lfo1' | 'lfo2'];
    addPolySelect(row, 'WAVE', WAVE_OPTS, () => lfo().wave, (v) => { lfo().wave = v as OscillatorType; });
    addPolySelect(row, 'TARGET', LFO_TARGET_OPTS, () => lfo().target, (v) => { lfo().target = v as LfoTarget; });
    addPolySelect(row, 'SYNC',
      [{ value:'free',label:'Free' },
       { value:'4/1',label:'4 bars' },{ value:'3/1',label:'3 bars' },{ value:'2/1',label:'2 bars' },{ value:'1/1',label:'1 bar' },
       { value:'1/2',label:'1/2' },{ value:'1/4',label:'1/4' },
       { value:'1/8.',label:'1/8.' },{ value:'1/8',label:'1/8' },{ value:'1/8t',label:'1/8t' },
       { value:'1/16',label:'1/16' },{ value:'1/16t',label:'1/16t' },{ value:'1/32',label:'1/32' }],
      () => lfo().sync ?? 'free', (v) => { lfo().sync = v as LfoSync; });
    addPolyKnob(row, { id: `poly.lfo${idx}.rate`, min: 0.01, max: 200, step: 0.01, value: lfo().rate, defaultValue: idx === 1 ? 4 : 0.5,
      label: 'RATE', color: lfoColor, size: SIZE,
      format: (v) => v < 1 ? `${v.toFixed(2)}Hz` : v < 100 ? `${v.toFixed(1)}Hz` : `${Math.round(v)}Hz`,
      onChange: (v) => { lfo().rate = v; }, }, () => lfo().rate);
    addPolyKnob(row, { id: `poly.lfo${idx}.depth`, min: 0, max: 1, step: 0.01, value: lfo().depth, defaultValue: 0,
      label: 'DEPTH', color: lfoColor, size: SIZE, format: fmtPct,
      onChange: (v) => { lfo().depth = v; }, }, () => lfo().depth);
  }
}
