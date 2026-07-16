// src/app/toolbar-status-chips.ts
// Read-only toolbar chips that surface state whose EDITING moved into a dialog.
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

  const mus = document.createElement('button');
  mus.className = 'status-chip'; mus.title = 'Project key & style — open Project Options';
  mus.addEventListener('click', deps.onOpenProjectOptions);

  const midi = document.createElement('button');
  midi.className = 'status-chip'; midi.title = 'MIDI controller — open MIDI Controller';
  midi.addEventListener('click', deps.onOpenMidiController);

  host.append(mus, midi);

  const refreshMusicality = () => { mus.textContent = musicalityChipLabel(deps.getMusicality()); };
  const refreshMidi = (on: boolean) => {
    midi.textContent = on ? 'MIDI ●' : 'MIDI ○';
    midi.classList.toggle('on', on);
  };
  refreshMusicality(); refreshMidi(deps.isMidiEnabled());
  return { refreshMusicality, refreshMidi };
}
