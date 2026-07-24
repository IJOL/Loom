// src/app/toolbar-status-chips.ts
// Read-only toolbar chips that surface state whose EDITING moved into a dialog.
import { html, render } from 'lit-html';
import { SCALE_CATALOG, STYLE_CATALOG, rootName, type ScaleId, type StyleId } from '../core/musicality';
import type { MusicalityState } from '../session/session-types';

function shortScale(scale: ScaleId): string {
  const s = SCALE_CATALOG.find((x) => x.id === scale);
  return s ? s.label : String(scale);
}

function styleLabel(style: StyleId): string {
  const s = STYLE_CATALOG.find((x) => x.id === style);
  return s ? s.label : String(style);
}

export function musicalityChipLabel(m: MusicalityState): string {
  // Show the padlock in BOTH states. Open is not the absence of information —
  // it is what decides whether a library pattern arrives exactly as written or
  // gets pulled into the project's key.
  return `${rootName(m.key)} ${shortScale(m.scale)} · ${styleLabel(m.style)} · ${m.lock ? '🔒' : '🔓'}`;
}

export interface StatusChipsDeps {
  getMusicality(): MusicalityState;
  onOpenProjectOptions(): void;
  onOpenMidiController(): void;
  isMidiEnabled(): boolean;
}

export function mountStatusChips(host: HTMLElement, deps: StatusChipsDeps): { refreshMusicality(): void; refreshMidi(on: boolean): void } {
  host.classList.add('status-chips');
  let midiOn = deps.isMidiEnabled();

  // Rendered straight into the host — no wrapper div, because `.status-chips`
  // is the inline-flex row and the chips must stay its direct children.
  const repaint = () => render(html`
    <button
      class="status-chip"
      title="Project key & style — open Project Options"
      @click=${deps.onOpenProjectOptions}
    >${musicalityChipLabel(deps.getMusicality())}</button>
    <button
      class=${midiOn ? 'status-chip on' : 'status-chip'}
      title="MIDI controller — open MIDI Controller"
      @click=${deps.onOpenMidiController}
    >${midiOn ? 'MIDI ●' : 'MIDI ○'}</button>
  `, host);

  repaint();
  return {
    refreshMusicality: repaint,
    refreshMidi: (on: boolean) => { midiOn = on; repaint(); },
  };
}
