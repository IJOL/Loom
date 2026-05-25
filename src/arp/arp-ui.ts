import { createKnob } from '../core/knob';
import { ARP_DEFAULTS, type ArpPattern, type ArpScale, type ArpSettings } from './arp';
import type { PolyTrack } from '../core/pattern';

// ── Mutable ARP singleton — imported by main.ts trigger handlers ───────────
export const arp: ArpSettings = { ...ARP_DEFAULTS };

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

export interface ArpUIDeps {
  getExtraPolyTracks: () => PolyTrack[];
}

export function buildArpUI(deps: ArpUIDeps): void {
  const row = document.getElementById('poly-arp-controls') as HTMLDivElement;
  row.innerHTML = '';
  const SIZE = 44;
  const arpColor = '#9b59b6';

  // ENABLE toggle
  const enableWrap = document.createElement('div');
  enableWrap.className = 'knob';
  const enableLab = document.createElement('div');
  enableLab.className = 'knob-label';
  enableLab.textContent = 'ENABLE';
  const enableBtn = document.createElement('button');
  enableBtn.className = 'rnd';
  enableBtn.textContent = arp.enabled ? 'ON' : 'OFF';
  enableBtn.style.background = arp.enabled ? '#c0392b' : '#2a2a2a';
  enableBtn.style.color = arp.enabled ? 'white' : '#888';
  enableBtn.addEventListener('click', () => {
    arp.enabled = !arp.enabled;
    enableBtn.textContent = arp.enabled ? 'ON' : 'OFF';
    enableBtn.style.background = arp.enabled ? '#c0392b' : '#2a2a2a';
    enableBtn.style.color = arp.enabled ? 'white' : '#888';
  });
  enableWrap.append(enableLab, enableBtn);
  row.appendChild(enableWrap);

  const mkSel = (
    label: string,
    opts: { value: string; label: string }[],
    get: () => string,
    set: (v: string) => void,
  ) => {
    const wrap = document.createElement('div');
    wrap.className = 'knob';
    const lab = document.createElement('div'); lab.className = 'knob-label'; lab.textContent = label;
    const sel = document.createElement('select'); sel.className = 'poly-wave-sel';
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (o.value === get()) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => set(sel.value));
    wrap.append(lab, sel);
    row.appendChild(wrap);
  };

  // SCOPE — dynamic checkboxes, one per lane (303 + main + each extra)
  const scopeWrap = document.createElement('div');
  scopeWrap.className = 'knob arp-scope';
  scopeWrap.style.display = 'flex';
  scopeWrap.style.flexDirection = 'column';
  scopeWrap.style.alignItems = 'flex-start';
  const scopeLab = document.createElement('div');
  scopeLab.className = 'knob-label';
  scopeLab.textContent = 'SCOPE';
  scopeWrap.appendChild(scopeLab);
  const scopeBoxes = document.createElement('div');
  scopeBoxes.style.display = 'grid';
  scopeBoxes.style.gridTemplateColumns = 'repeat(2, auto)';
  scopeBoxes.style.gap = '2px 6px';
  scopeBoxes.style.fontSize = '10px';
  const addScopeBox = (laneId: string, label: string) => {
    const lab = document.createElement('label');
    lab.style.display = 'flex'; lab.style.alignItems = 'center'; lab.style.gap = '3px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = arp.scope.includes(laneId);
    cb.addEventListener('change', () => {
      const set = new Set(arp.scope);
      if (cb.checked) set.add(laneId); else set.delete(laneId);
      arp.scope = Array.from(set);
    });
    lab.append(cb, document.createTextNode(label));
    scopeBoxes.appendChild(lab);
  };
  addScopeBox('bass', '303');
  addScopeBox('main', 'MAIN');
  for (const track of deps.getExtraPolyTracks()) {
    addScopeBox(track.id, track.name.slice(0, 10));
  }
  scopeWrap.appendChild(scopeBoxes);
  row.appendChild(scopeWrap);

  mkSel('PATTERN',
    [{ value:'up',label:'Up' },{ value:'down',label:'Down' },{ value:'updown',label:'Up-Down' },
     { value:'random',label:'Random' },{ value:'cosmic',label:'Cosmic' }],
    () => arp.pattern, (v) => { arp.pattern = v as ArpPattern; });
  mkSel('SCALE',
    [{ value:'major',label:'Major' },{ value:'minor',label:'Minor' },{ value:'pentMinor',label:'Penta Min' },
     { value:'phrygian',label:'Phrygian' },{ value:'chromatic',label:'Chromatic' }],
    () => arp.scale, (v) => { arp.scale = v as ArpScale; });
  mkSel('RATE',
    [{ value:'free',label:'Free' },
     { value:'4/1',label:'4 bars' },{ value:'3/1',label:'3 bars' },{ value:'2/1',label:'2 bars' },{ value:'1/1',label:'1 bar' },
     { value:'1/2',label:'1/2' },{ value:'1/4',label:'1/4' },
     { value:'1/8.',label:'1/8.' },{ value:'1/8',label:'1/8' },{ value:'1/8t',label:'1/8t' },
     { value:'1/16',label:'1/16' },{ value:'1/16t',label:'1/16t' },{ value:'1/32',label:'1/32' }],
    () => arp.rate, (v) => { arp.rate = v as ArpSettings['rate']; });

  // Free-rate Hz (used when RATE = Free)
  const freeKnob = createKnob({
    min: 0.5, max: 32, step: 0.1, value: arp.rateFreeHz, defaultValue: 8,
    label: 'FREE Hz', color: arpColor, size: SIZE,
    format: (v) => `${v.toFixed(1)}Hz`,
    onChange: (v) => { arp.rateFreeHz = v; },
  });
  row.appendChild(freeKnob.el);

  // OCTAVES
  const octKnob = createKnob({
    min: 1, max: 4, step: 1, value: arp.octaves, defaultValue: 2,
    label: 'OCT', color: arpColor, size: SIZE, format: (v) => String(v),
    onChange: (v) => { arp.octaves = v; },
  });
  row.appendChild(octKnob.el);

  // GATE
  const gateKnob = createKnob({
    min: 0.05, max: 1, step: 0.01, value: arp.gate, defaultValue: 0.7,
    label: 'GATE', color: arpColor, size: SIZE, format: fmtPct,
    onChange: (v) => { arp.gate = v; },
  });
  row.appendChild(gateKnob.el);
}
