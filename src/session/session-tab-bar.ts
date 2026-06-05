// src/session/session-tab-bar.ts
// Renders one tab per Session lane plus a trailing '+ Add' control.
// Replaces the static '#synth-tabs' Classic synth-tabs in Session mode.

import type { SessionState } from './session';
import { listEngines } from '../engines/registry';

export interface SessionTabBarDeps {
  state: SessionState;
  onPickLane: (laneId: string) => void;
  onAddLane:  (engineId: string) => void;
  onAddAudioChannel?: (file: File) => void;
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
    if (engine.id === 'audio') continue; // audio lanes are created via "+ Audio"
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

  if (deps.onAddAudioChannel) {
    const audioAdder = document.createElement('span');
    audioAdder.className = 'session-tabs-add-audio';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.className = 'session-add-audio-input';
    fileInput.style.display = 'none';
    const audioBtn = document.createElement('button');
    audioBtn.className = 'tab session-add-audio-btn';
    audioBtn.textContent = '+ Audio';
    audioBtn.title = 'Drop a WAV loop as a tempo-locked audio channel';
    audioBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) deps.onAddAudioChannel!(f);
      fileInput.value = '';
    });
    audioAdder.append(fileInput, audioBtn);
    host.appendChild(audioAdder);
  }
}
