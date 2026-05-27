import { type FxBus, type FilterChain, type MasterFilter, type SyncDiv } from './fx';
import { createKnob, type KnobHandle } from './knob';

const WAVE_OPTS = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square',   label: 'Sqr' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine',     label: 'Sin' },
];

/** Local replacement for the deleted addPolyKnob helper:
 *  builds a knob, appends to parent, registers in the automation registry. */
function appendKnob(
  parent: HTMLElement,
  opts: Parameters<typeof createKnob>[0],
  registerKnob: (k: KnobHandle) => void,
): KnobHandle {
  const k = createKnob(opts);
  parent.appendChild(k.el);
  registerKnob(k);
  return k;
}

/** Local replacement for the deleted addPolySelect helper. */
function appendSelect(
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
}

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtSec = (v: number) => v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;

export const SYNC_OPTS: Array<{ value: SyncDiv; label: string }> = [
  { value: 'off',   label: 'Free' },
  { value: '4/1',   label: '4 bars' },
  { value: '3/1',   label: '3 bars' },
  { value: '2/1',   label: '2 bars' },
  { value: '1/1',   label: '1 bar' },
  { value: '1/2',   label: '1/2' },
  { value: '1/4',   label: '1/4' },
  { value: '1/8.',  label: '1/8.' },
  { value: '1/8',   label: '1/8' },
  { value: '1/8t',  label: '1/8t' },
  { value: '1/16',  label: '1/16' },
  { value: '1/16t', label: '1/16t' },
  { value: '1/32',  label: '1/32' },
];

export interface FxUIDeps {
  fx: FxBus;
  filterChain: FilterChain;
  getBpm: () => number;
  registerKnob: (k: KnobHandle) => void;
}

let _deps: FxUIDeps | null = null;
let _delaySyncDiv: SyncDiv = '1/8.';

export function getDelaySyncDiv(): SyncDiv { return _delaySyncDiv; }

export function applyDelaySync(deps: FxUIDeps) {
  const beatFractions: Record<SyncDiv, number> = {
    'off': 0.375,
    '4/1': 4, '3/1': 3, '2/1': 2, '1/1': 1,
    '1/2': 0.5, '1/4': 0.25, '1/8': 0.125, '1/8.': 0.1875, '1/8t': 1/12,
    '1/16': 0.0625, '1/16t': 1/24, '1/32': 0.03125,
  };
  const frac = beatFractions[_delaySyncDiv];
  deps.fx.setBpmSync(deps.getBpm(), frac);
}

function appendFilterRow(mf: MasterFilter, deps: FxUIDeps) {
  const container = document.getElementById('fx-filters') as HTMLDivElement;
  const row = document.createElement('div');
  row.className = 'fx-filter-row';

  const typeSel = document.createElement('select');
  typeSel.className = 'poly-wave-sel';
  for (const t of ['lowpass', 'highpass', 'bandpass', 'notch'] as BiquadFilterType[]) {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t.toUpperCase();
    if (t === mf.state.type) opt.selected = true;
    typeSel.appendChild(opt);
  }
  typeSel.addEventListener('change', () => mf.setType(typeSel.value as BiquadFilterType));
  const typeWrap = document.createElement('div'); typeWrap.className = 'knob';
  const typeLab = document.createElement('div'); typeLab.className = 'knob-label'; typeLab.textContent = 'TYPE';
  typeWrap.append(typeLab, typeSel);
  row.appendChild(typeWrap);

  const cutoffKnob = createKnob({
    min: 40, max: 18000, step: 1, value: mf.state.cutoff, defaultValue: 8000,
    label: 'CUTOFF', color: '#16a085', size: 44, format: (v) => `${Math.round(v)}Hz`,
    onChange: (v) => mf.setCutoff(v),
  });
  row.appendChild(cutoffKnob.el);

  const qKnob = createKnob({
    min: 0.1, max: 30, step: 0.1, value: mf.state.q, defaultValue: 1,
    label: 'Q', color: '#16a085', size: 44, format: (v) => v.toFixed(1),
    onChange: (v) => mf.setQ(v),
  });
  row.appendChild(qKnob.el);

  // LFO sub-section for this filter
  const lfoWaveSel = document.createElement('select');
  lfoWaveSel.className = 'poly-wave-sel';
  for (const o of WAVE_OPTS) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === mf.state.lfoWave) opt.selected = true;
    lfoWaveSel.appendChild(opt);
  }
  const lwWrap = document.createElement('div'); lwWrap.className = 'knob';
  const lwLab = document.createElement('div'); lwLab.className = 'knob-label'; lwLab.textContent = 'LFO';
  lwWrap.append(lwLab, lfoWaveSel);
  row.appendChild(lwWrap);

  const syncSel = document.createElement('select');
  syncSel.className = 'poly-wave-sel';
  for (const s of SYNC_OPTS) {
    const opt = document.createElement('option');
    opt.value = s.value; opt.textContent = s.label;
    if (s.value === mf.state.lfoSync) opt.selected = true;
    syncSel.appendChild(opt);
  }
  const ssWrap = document.createElement('div'); ssWrap.className = 'knob';
  const ssLab = document.createElement('div'); ssLab.className = 'knob-label'; ssLab.textContent = 'SYNC';
  ssWrap.append(ssLab, syncSel);
  row.appendChild(ssWrap);

  const depthKnob = createKnob({
    min: 0, max: 1, step: 0.01, value: mf.state.lfoDepth, defaultValue: 0,
    label: 'DEPTH', color: '#3498db', size: 44, format: fmtPct,
    onChange: (v) => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, v, deps.getBpm()),
  });
  row.appendChild(depthKnob.el);
  lfoWaveSel.addEventListener('change', () => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, mf.state.lfoDepth, deps.getBpm()));
  syncSel.addEventListener('change', () => mf.setLfo(lfoWaveSel.value as OscillatorType, syncSel.value as SyncDiv, mf.state.lfoDepth, deps.getBpm()));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'io';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove filter';
  removeBtn.addEventListener('click', () => {
    deps.filterChain.remove(mf);
    row.remove();
  });
  row.appendChild(removeBtn);

  container.appendChild(row);
}

export function wireFxUI(deps: FxUIDeps): void {
  _deps = deps;

  const revRow = document.getElementById('fx-reverb-knobs') as HTMLDivElement;
  const dlyRow = document.getElementById('fx-delay-knobs') as HTMLDivElement;
  const SIZE = 44;
  const revColor = '#9b59b6';
  const dlyColor = '#3498db';

  // REVERB
  appendKnob(revRow, { id: 'fx.reverb.wet', min: 0, max: 1, step: 0.01, value: deps.fx.getReverbWet(), defaultValue: 0.9,
    label: 'WET', color: revColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setReverbWet(v) }, deps.registerKnob);
  appendKnob(revRow, { id: 'fx.reverb.size', min: 0.1, max: 6, step: 0.1, value: deps.fx.getReverbSize(), defaultValue: 2.5,
    label: 'SIZE', color: revColor, size: SIZE, format: (v) => `${v.toFixed(1)}s`,
    onChange: (v) => deps.fx.setReverbSize(v) }, deps.registerKnob);
  appendKnob(revRow, { id: 'fx.reverb.decay', min: 0.5, max: 8, step: 0.1, value: deps.fx.getReverbDecay(), defaultValue: 3,
    label: 'DECAY', color: revColor, size: SIZE, format: (v) => v.toFixed(1),
    onChange: (v) => deps.fx.setReverbDecay(v) }, deps.registerKnob);
  appendKnob(revRow, { id: 'fx.reverb.predly', min: 0, max: 0.5, step: 0.005, value: deps.fx.getReverbPredelay(), defaultValue: 0,
    label: 'PREDLY', color: revColor, size: SIZE, format: fmtSec,
    onChange: (v) => deps.fx.setReverbPredelay(v) }, deps.registerKnob);

  // DELAY
  appendSelect(dlyRow, 'SYNC', SYNC_OPTS, () => _delaySyncDiv, (v) => {
    _delaySyncDiv = v as SyncDiv;
    applyDelaySync(deps);
  });
  appendKnob(dlyRow, { id: 'fx.delay.feedback', min: 0, max: 0.95, step: 0.01, value: deps.fx.getDelayFeedback(), defaultValue: 0.45,
    label: 'FBACK', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setDelayFeedback(v) }, deps.registerKnob);
  appendKnob(dlyRow, { id: 'fx.delay.wet', min: 0, max: 1, step: 0.01, value: deps.fx.getDelayWet(), defaultValue: 0.8,
    label: 'WET', color: dlyColor, size: SIZE, format: fmtPct,
    onChange: (v) => deps.fx.setDelayWet(v) }, deps.registerKnob);
  appendKnob(dlyRow, { id: 'fx.delay.damp', min: 200, max: 16000, step: 50, value: deps.fx.getDelayDamping(), defaultValue: 4500,
    label: 'DAMP', color: dlyColor, size: SIZE, format: (v) => `${Math.round(v)}Hz`,
    onChange: (v) => deps.fx.setDelayDamping(v) }, deps.registerKnob);

  // Add Filter button
  (document.getElementById('fx-add-filter') as HTMLButtonElement).addEventListener('click', () => {
    const mf = deps.filterChain.add();
    appendFilterRow(mf, deps);
  });
}
