import { fetchDemoSession } from './demo-loader';
import type { SessionHost } from '../session/session-host';

export interface DemoPickerDeps {
  sessionHost: SessionHost;
  selectEl: HTMLSelectElement;
  demos: { label: string; path: string }[];
}

export function wireDemoPicker(deps: DemoPickerDeps): void {
  const { sessionHost, selectEl, demos } = deps;
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
    } catch (err) {
      alert(`Demo load failed: ${(err as Error).message}`);
    }
  });
}
