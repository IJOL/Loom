// src/notefx/notefx-ui.ts
import type { NoteFxChain } from './notefx-chain';
import type { NoteFxState } from './notefx-types';

export interface NoteFxUIDeps {
  laneId: string;
  chain: NoteFxChain;
  /** Mirror chain state into the session so it persists + loads with demos. */
  onChange: (noteFx: NoteFxState[]) => void;
}

const ARP_PATTERNS = ['up', 'down', 'updown', 'random', 'cosmic'];
const ARP_SCALES = ['major', 'minor', 'pentMinor', 'phrygian', 'chromatic'];
const ARP_RATES = ['free', '1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'];
const CHORD_TYPES = ['maj', 'min', 'maj7', 'min7', 'sus2', 'sus4', 'dim'];

export function renderNoteFxPanel(container: HTMLElement, deps: NoteFxUIDeps): void {
  const box = document.createElement('div');
  box.className = 'notefx-panel';
  const title = document.createElement('div');
  title.className = 'mod-panel-title';
  title.textContent = 'NOTE FX';
  box.appendChild(title);

  const sync = () => deps.onChange(deps.chain.serialize());
  const rerender = () => { container.innerHTML = ''; renderNoteFxPanel(container, deps); };

  const header = document.createElement('div');
  header.className = 'mod-panel-header';
  for (const kind of ['arp', 'chord'] as const) {
    const b = document.createElement('button');
    b.className = 'rnd';
    b.textContent = `+ ${kind === 'arp' ? 'Arp' : 'Chord'}`;
    b.addEventListener('click', () => { deps.chain.addNoteFx(kind); sync(); rerender(); });
    header.appendChild(b);
  }
  box.appendChild(header);

  for (const fx of deps.chain.noteFx) box.appendChild(renderCard(fx, deps, sync, rerender));
  container.appendChild(box);
}

function mkSelect(
  label: string, opts: string[], value: string, onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'notefx-field';
  wrap.append(document.createTextNode(label));
  const sel = document.createElement('select');
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

function renderCard(
  fx: NoteFxState, deps: NoteFxUIDeps, sync: () => void, rerender: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `notefx-card notefx-${fx.kind}`;

  const row = document.createElement('div');
  row.className = 'notefx-card-row';
  const titleEl = document.createElement('span');
  titleEl.textContent = fx.id.toUpperCase();
  row.appendChild(titleEl);

  const enable = document.createElement('button');
  enable.className = 'rnd' + (fx.enabled ? ' primary' : '');
  enable.textContent = fx.enabled ? 'ON' : 'OFF';
  enable.addEventListener('click', () => { fx.enabled = !fx.enabled; sync(); rerender(); });
  row.appendChild(enable);

  const rm = document.createElement('button');
  rm.className = 'rnd';
  rm.textContent = '×';
  rm.addEventListener('click', () => { deps.chain.removeNoteFx(fx.id); sync(); rerender(); });
  row.appendChild(rm);
  card.appendChild(row);

  const set = (k: string, v: string | number) => { fx.params[k] = v; sync(); };

  if (fx.kind === 'arp') {
    card.appendChild(mkSelect('PATTERN', ARP_PATTERNS, String(fx.params.pattern ?? 'up'), (v) => set('pattern', v)));
    card.appendChild(mkSelect('SCALE', ARP_SCALES, String(fx.params.scale ?? 'pentMinor'), (v) => set('scale', v)));
    card.appendChild(mkSelect('RATE', ARP_RATES, String(fx.params.rate ?? '1/16'), (v) => set('rate', v)));
    card.appendChild(numberField('OCT', 1, 4, 1, Number(fx.params.octaves ?? 2), (v) => set('octaves', v)));
    card.appendChild(numberField('GATE', 0.05, 1, 0.01, Number(fx.params.gate ?? 0.7), (v) => set('gate', v)));
    card.appendChild(numberField('FREE Hz', 0.5, 32, 0.1, Number(fx.params.rateFreeHz ?? 8), (v) => set('rateFreeHz', v)));
  } else {
    card.appendChild(mkSelect('CHORD', CHORD_TYPES, String(fx.params.chordType ?? 'maj'), (v) => set('chordType', v)));
    card.appendChild(numberField('OCT', -2, 2, 1, Number(fx.params.octave ?? 0), (v) => set('octave', v)));
  }
  return card;
}

function numberField(
  label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'notefx-field';
  wrap.append(document.createTextNode(label));
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  inp.addEventListener('input', () => onChange(Number(inp.value)));
  wrap.appendChild(inp);
  return wrap;
}
