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
  /** Wipe the weave back to nothing, the same door New uses.
   *
   *  Not optional in spirit, only in type: every real call site passes it. A
   *  demo carries no weave of its own, and the weave is keyed by LANE ID —
   *  which every demo reuses (`drums-1`, `subtractive-2`). Without this, the
   *  previous session's loops keep weaving on the new session's lanes. */
  resetWeave?: () => void;
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
    resetWeave?: () => void;
  },
): Promise<void> {
  if (!path) return;
  try {
    const state = await fetchDemoSession(path);
    // replaceSession = New + load. A demo carries no per-lane mixer, no master
    // rack and no master processing, so anything the previous session left on
    // the desk would otherwise still be colouring this demo's sound.
    deps.sessionHost.replaceSession(state);
    // …and no weave either, which replaceSession cannot know about: the weave
    // lives BESIDE the session and is keyed by lane id. Every demo reuses the
    // same generic ids, so the lanes that arrive here are exactly the ones the
    // previous session's selections name.
    deps.resetWeave?.();
    if (state.timeSignature) deps.applyMeter?.(state.timeSignature);
    if (typeof state.bpm === 'number') deps.applyBpm?.(state.bpm);
    deps.onLoaded?.();
  } catch (err) {
    void alertDialog(`Demo load failed: ${(err as Error).message}`);
  }
}

export function wireDemoPicker(deps: DemoPickerDeps): { demos: { label: string; path: string }[] } {
  const { sessionHost, selectEl, demos, onLoaded, applyBpm, applyMeter, resetWeave } = deps;
  renderInto(selectEl, html`<option value="">— load a demo —</option>${demos.map((d) =>
    html`<option value=${d.path}>${d.label}</option>`)}`);
  // The listener rides on the caller-owned <select> itself (not on anything
  // inside the template), so it stays a plain addEventListener.
  selectEl.addEventListener('change', () => loadDemoSession(selectEl.value, { sessionHost, applyBpm, applyMeter, onLoaded, resetWeave }));
  return { demos };
}
