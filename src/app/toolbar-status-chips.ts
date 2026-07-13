// src/app/toolbar-status-chips.ts
// Read-only toolbar chips that surface state whose EDITING moved into a dialog.
import { SCALE_CATALOG, rootName, type ScaleId } from '../core/musicality';
import type { MusicalityState } from '../session/session-types';

function shortScale(scale: ScaleId): string {
  const s = SCALE_CATALOG.find((x) => x.id === scale);
  return s ? s.label : String(scale);
}

export function musicalityChipLabel(m: MusicalityState): string {
  return `${rootName(m.key)} ${shortScale(m.scale)}${m.lock ? ' 🔒' : ''}`;
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
