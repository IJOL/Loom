import { fetchDemoSession } from './demo-loader';
import type { SessionHost } from '../session/session-host';

export interface DemoPickerDeps {
  sessionHost: SessionHost;
  selectEl: HTMLSelectElement;
  demos: { label: string; path: string }[];
  /** Called after every successful demo load — use to clear the undo stack. */
  onLoaded?: () => void;
}

export function wireDemoPicker(deps: DemoPickerDeps): void {
  const { sessionHost, selectEl, demos, onLoaded } = deps;
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
      onLoaded?.();
    } catch (err) {
      alert(`Demo load failed: ${(err as Error).message}`);
    }
  });
}
