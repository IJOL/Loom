import { html } from 'lit-html';
import { renderInto } from '../core/lit-fill';
import { fetchDemoSession } from './demo-loader';
import { alertDialog } from '../core/dialog';
import type { SessionHost } from '../session/session-host';
import type { TimeSignature } from '../core/meter';

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
  /** Apply a demo's optional time signature, the sibling of applyBpm. Called
   *  BEFORE applyBpm so the grid is in the right meter when the tempo lands. */
  applyMeter?: (meter: TimeSignature) => void;
}

/** Load a demo session by path and apply it. Extracted from the picker's
 *  `change` handler so the menu bar can call the SAME function (no synthetic
 *  clicks / no dispatching a `change` event on the hidden `<select>`). */
export async function loadDemoSession(
  path: string,
  deps: {
    sessionHost: { replaceSession: (s: any) => void };
    applyBpm?: (bpm: number) => void;
    applyMeter?: (meter: TimeSignature) => void;
    onLoaded?: () => void;
  },
): Promise<void> {
  if (!path) return;
  try {
    const state = await fetchDemoSession(path);
    // replaceSession = New + load. A demo carries no per-lane mixer, no master
    // rack and no master processing, so anything the previous session left on
    // the desk would otherwise still be colouring this demo's sound.
    deps.sessionHost.replaceSession(state);
    if (state.timeSignature) deps.applyMeter?.(state.timeSignature);
    if (typeof state.bpm === 'number') deps.applyBpm?.(state.bpm);
    deps.onLoaded?.();
  } catch (err) {
    void alertDialog(`Demo load failed: ${(err as Error).message}`);
  }
}

export function wireDemoPicker(deps: DemoPickerDeps): { demos: { label: string; path: string }[] } {
  const { sessionHost, selectEl, demos, onLoaded, applyBpm, applyMeter } = deps;
  renderInto(selectEl, html`<option value="">— load a demo —</option>${demos.map((d) =>
    html`<option value=${d.path}>${d.label}</option>`)}`);
  // The listener rides on the caller-owned <select> itself (not on anything
  // inside the template), so it stays a plain addEventListener.
  selectEl.addEventListener('change', () => loadDemoSession(selectEl.value, { sessionHost, applyBpm, applyMeter, onLoaded }));
  return { demos };
}
