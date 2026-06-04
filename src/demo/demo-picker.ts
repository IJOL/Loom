import { fetchDemoSession } from './demo-loader';
import type { SessionHost } from '../session/session-host';

export interface DemoPickerDeps {
  sessionHost: SessionHost;
  selectEl: HTMLSelectElement;
  demos: { label: string; path: string }[];
  /** Called after every successful demo load — use to clear the undo stack. */
  onLoaded?: () => void;
  /** Apply a demo's optional transport tempo (clamped + reflected in the BPM
   *  input). Called after the session is applied, only when the demo carries a
   *  `bpm`. Demos without one keep the current transport tempo. */
  applyBpm?: (bpm: number) => void;
}

export function wireDemoPicker(deps: DemoPickerDeps): void {
  const { sessionHost, selectEl, demos, onLoaded, applyBpm } = deps;
  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— load a demo —';
  selectEl.appendChild(placeholder);
  for (const d of demos) {
    const o = document.createElement('option');
    o.value = d.path;
    o.textContent = d.label;
    selectEl.appendChild(o);
  }
  selectEl.addEventListener('change', async () => {
    if (!selectEl.value) return;
    try {
      const state = await fetchDemoSession(selectEl.value);
      sessionHost.applyLoadedSessionState(state);
      if (typeof state.bpm === 'number') applyBpm?.(state.bpm);
      onLoaded?.();
    } catch (err) {
      alert(`Demo load failed: ${(err as Error).message}`);
    }
  });
}
