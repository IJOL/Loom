// src/session/session-tab-bar.ts
// Renders one tab per Session lane plus a trailing '+ Add' control.
// Replaces the static '#synth-tabs' Classic synth-tabs in Session mode.

import type { SessionState } from './session';
import { listEngines } from '../engines/registry';

export interface SessionTabBarDeps {
  state: SessionState;
  onPickLane: (laneId: string) => void;
  onAddLane:  (engineId: string) => void;
}

export function renderSessionTabBar(host: HTMLElement, deps: SessionTabBarDeps): void {
  host.innerHTML = '';
  host.classList.add('session-tabs');

  for (const lane of deps.state.lanes) {
    const btn = document.createElement('button');
    btn.className = 'tab session-lane-tab';
    btn.dataset.laneId = lane.id;
    btn.textContent = lane.name ?? lane.id.toUpperCase();
    btn.title = `Edit ${lane.name ?? lane.id}`;
    btn.addEventListener('click', () => deps.onPickLane(lane.id));
    host.appendChild(btn);
  }

  // Trailing engine picker + add button.
  const adder = document.createElement('span');
  adder.className = 'session-tabs-add';
  const sel = document.createElement('select');
  sel.className = 'session-tabs-engine';
  sel.title = 'Engine for new lane';
  // Populated lazily here AND defensively re-populated each render in case the
  // registry expands later. Cheap — just rebuild options.
  for (const engine of listEngines('polyhost')) {
    const opt = document.createElement('option');
    opt.value = engine.id;
    opt.textContent = engine.name;
    sel.appendChild(opt);
  }
  sel.value = 'subtractive';
  const btn = document.createElement('button');
  btn.className = 'tab session-tabs-add-btn';
  btn.textContent = '+';
  btn.title = 'Create a new lane with the selected engine';
  btn.addEventListener('click', () => deps.onAddLane(sel.value || 'subtractive'));
  adder.appendChild(sel);
  adder.appendChild(btn);
  host.appendChild(adder);
}
