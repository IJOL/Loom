import { fetchDemoSession } from './demo-loader';
import { alertDialog } from '../core/dialog';
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

/** Load a demo session by path and apply it. Extracted from the picker's
 *  `change` handler so the menu bar can call the SAME function (no synthetic
 *  clicks / no dispatching a `change` event on the hidden `<select>`). */
export async function loadDemoSession(
  path: string,
  deps: { sessionHost: { applyLoadedSessionState: (s: any) => void }; applyBpm?: (bpm: number) => void; onLoaded?: () => void },
): Promise<void> {
  if (!path) return;
  try {
    const state = await fetchDemoSession(path);
    deps.sessionHost.applyLoadedSessionState(state);
    if (typeof state.bpm === 'number') deps.applyBpm?.(state.bpm);
    deps.onLoaded?.();
  } catch (err) {
    void alertDialog(`Demo load failed: ${(err as Error).message}`);
  }
}

export function wireDemoPicker(deps: DemoPickerDeps): { demos: { label: string; path: string }[] } {
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
  selectEl.addEventListener('change', () => loadDemoSession(selectEl.value, { sessionHost, applyBpm, onLoaded }));
  return { demos };
}
