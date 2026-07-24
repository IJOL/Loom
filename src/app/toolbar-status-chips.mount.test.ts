// @vitest-environment jsdom
// Characterisation of mountStatusChips after the lit-html migration: chip
// structure (direct children of the host — the inline-flex row), click wiring,
// and that refreshes patch the SAME elements instead of rebuilding them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountStatusChips, musicalityChipLabel } from './toolbar-status-chips';
import type { StatusChipsDeps } from './toolbar-status-chips';
import type { MusicalityState } from '../session/session-types';

function makeDeps(state: MusicalityState) {
  return {
    getMusicality: () => state,
    onOpenProjectOptions: vi.fn(),
    onOpenMidiController: vi.fn(),
    isMidiEnabled: () => false,
  } satisfies StatusChipsDeps;
}

describe('mountStatusChips', () => {
  let host: HTMLElement;
  let state: MusicalityState;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    state = { key: 9, scale: 'minor', style: 'acid-techno', lock: false } as MusicalityState;
  });

  it('renders two chips as DIRECT children of the host (flex row contract)', () => {
    mountStatusChips(host, makeDeps(state));
    expect(host.classList.contains('status-chips')).toBe(true);
    const chips = host.querySelectorAll(':scope > button.status-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe(musicalityChipLabel(state));
    expect(chips[0].getAttribute('title')).toBe('Project key & style — open Project Options');
    expect(chips[1].textContent).toBe('MIDI ○');
    expect(chips[1].getAttribute('title')).toBe('MIDI controller — open MIDI Controller');
  });

  it('clicking each chip opens its dialog', () => {
    const deps = makeDeps(state);
    mountStatusChips(host, deps);
    const chips = host.querySelectorAll<HTMLElement>('.status-chip');
    chips[0].click();
    expect(deps.onOpenProjectOptions).toHaveBeenCalledOnce();
    chips[1].click();
    expect(deps.onOpenMidiController).toHaveBeenCalledOnce();
  });

  it('refreshMidi toggles the on class + text; refreshMusicality re-reads state — both patch in place', () => {
    const handle = mountStatusChips(host, makeDeps(state));
    const [mus, midi] = Array.from(host.querySelectorAll<HTMLElement>('.status-chip'));

    handle.refreshMidi(true);
    expect(midi.textContent).toBe('MIDI ●');
    expect(midi.classList.contains('on')).toBe(true);
    handle.refreshMidi(false);
    expect(midi.textContent).toBe('MIDI ○');
    expect(midi.classList.contains('on')).toBe(false);

    state.lock = true;
    handle.refreshMusicality();
    expect(mus.textContent).toContain('🔒');

    // Same element identity after repaints: lit patches, never rebuilds.
    const after = host.querySelectorAll('.status-chip');
    expect(after[0]).toBe(mus);
    expect(after[1]).toBe(midi);
  });
});
