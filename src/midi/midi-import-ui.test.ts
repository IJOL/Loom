// @vitest-environment jsdom
// Characterisation of the MIDI import track-list DOM after the lit-html
// migration: picking a file renders one row per playable track (checkbox +
// label + preset select + audition button), and re-picking a file rebuilds
// FRESH rows — a checkbox the user cleared must come back checked, like the
// old wipe-and-rebuild guaranteed. The apply/branching logic is covered in
// midi-import-apply.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireMidiImportUI, type MidiImportUiDeps } from './midi-import-ui';

// Minimal SMF: format 1, one track, division 480 — a single C4 quarter note on
// channel 0 with program 33, then end-of-track.
const SMF = Uint8Array.from([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0x01, 0xe0, // MThd
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 16,                        // MTrk, 16 bytes
  0x00, 0xc0, 0x21,                                           // program 33
  0x00, 0x90, 0x3c, 0x64,                                     // note on C4
  0x83, 0x60, 0x80, 0x3c, 0x00,                               // Δ480 note off
  0x00, 0xff, 0x2f, 0x00,                                     // end of track
]);

function setup(): { input: HTMLInputElement; list: HTMLDivElement } {
  document.body.innerHTML = `
    <input type="file" id="poly-midi-file" />
    <div id="poly-midi-tracklist" style="display:none;"></div>
    <button id="poly-midi-load" disabled>Import MIDI</button>`;
  const deps = {
    session: { lanes: [], scenes: [] },
    setBpm: vi.fn(),
    audioContext: {} as AudioContext,
    auditionOutput: {} as AudioNode,
    onSessionChanged: vi.fn(),
    launchScene: vi.fn(),
    flashButton: vi.fn(),
  } as unknown as MidiImportUiDeps;
  wireMidiImportUI(deps);
  return {
    input: document.getElementById('poly-midi-file') as HTMLInputElement,
    list: document.getElementById('poly-midi-tracklist') as HTMLDivElement,
  };
}

async function pickFile(input: HTMLInputElement): Promise<void> {
  // jsdom's File does not implement Blob.arrayBuffer(), so hand the handler a
  // minimal stub with just the method it calls.
  const file = { name: 'test.mid', arrayBuffer: async () => SMF.slice().buffer } as unknown as File;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('wireMidiImportUI track list', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders one row per playable track and reveals the list', async () => {
    const { input, list } = setup();
    await pickFile(input);
    await vi.waitFor(() => expect(list.querySelectorAll('.midi-track-row')).toHaveLength(1));

    const row = list.querySelector('.midi-track-row')!;
    const cb = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(cb.checked).toBe(true);
    expect(cb.dataset.idx).toBe('0');

    const label = row.querySelector('span')!.textContent!;
    expect(label).toContain('[0]');
    expect(label).toContain('1 notes, 60-60');
    expect(label).toContain('prog 33');

    const sel = row.querySelector<HTMLSelectElement>('select.midi-preset-picker')!;
    expect(sel).toBeTruthy();
    // The divider between GM matches and the full list is always present.
    expect([...sel.options].some((o) => o.disabled && o.textContent === '── any preset ──')).toBe(true);

    const audition = row.querySelector<HTMLButtonElement>('button.midi-audition')!;
    expect(audition.title).toBe('Audition this preset');
    expect(audition.textContent).toBe('▶');

    expect(list.style.display).toBe('');
  });

  it('re-picking a file rebuilds fresh rows — cleared checkboxes come back checked', async () => {
    const { input, list } = setup();
    await pickFile(input);
    await vi.waitFor(() => expect(list.querySelectorAll('.midi-track-row')).toHaveLength(1));

    const cb = list.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = false;

    await pickFile(input);
    await vi.waitFor(() => {
      const fresh = list.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      expect(fresh.checked).toBe(true);
    });
    expect(list.querySelectorAll('.midi-track-row')).toHaveLength(1);
  });
});
