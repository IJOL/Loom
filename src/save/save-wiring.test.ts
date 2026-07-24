// @vitest-environment jsdom
// Characterisation of the save-manager modal list after the lit-html migration:
// row structure (autosave first, entries newest-first, data-act buttons) and
// that re-opening PATCHES the list instead of duplicating rows (the innerHTML
// wipe is gone — lit must converge on its own).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wireSaveManager, type SaveWiringDeps } from './save-wiring';

const INDEX_KEY = 'tb303-saves';

function scaffold(): void {
  document.body.innerHTML = `
    <button id="save"></button>
    <button id="load"></button>
    <div id="save-manager-modal" hidden>
      <div class="save-manager-backdrop"></div>
      <button id="save-manager-close"></button>
      <input id="save-manager-name" />
      <button id="save-manager-save"></button>
      <div id="save-manager-list"></div>
      <button id="save-manager-load-file"></button>
      <input id="save-manager-file" type="file" />
      <button id="save-manager-clear-all"></button>
      <span id="save-manager-size"></span>
    </div>`;
}

function fakeDeps(): SaveWiringDeps {
  return {
    sessionHost: { state: { name: '' } },
    flashButton: vi.fn(),
    history: { clear: vi.fn() },
  } as unknown as SaveWiringDeps;
}

describe('save-manager list rendering', () => {
  beforeEach(() => {
    scaffold();
    localStorage.clear();
    localStorage.setItem(INDEX_KEY, JSON.stringify([
      { id: 'a', name: 'Alpha', timestamp: 1_000, sizeKB: 1 },
      { id: 'b', name: 'Beta',  timestamp: 2_000, sizeKB: 2 },
    ]));
  });

  it('renders the autosave row first, then entries newest-first, with the act buttons', () => {
    wireSaveManager(fakeDeps()).openForLoad();

    const modal = document.getElementById('save-manager-modal')!;
    expect(modal.hidden).toBe(false);

    const rows = document.querySelectorAll('#save-manager-list .save-manager-row');
    expect(rows.length).toBe(3);
    expect(rows[0].classList.contains('autosave')).toBe(true);
    expect(rows[0].textContent).toContain('Auto-save (latest)');
    expect(rows[1].textContent).toContain('Beta');   // newest first
    expect(rows[1].textContent).toContain('2 KB');
    expect(rows[2].textContent).toContain('Alpha');
    for (const act of ['load', 'dl', 'ren', 'del']) {
      expect(rows[1].querySelector(`button[data-act=${act}]`)).toBeTruthy();
    }
    expect(document.getElementById('save-manager-size')!.textContent).toBe('Total: 3 KB');
  });

  it('re-opening does not duplicate rows and reflects index changes', () => {
    const mgr = wireSaveManager(fakeDeps());
    mgr.openForLoad();
    mgr.openForLoad();
    expect(document.querySelectorAll('#save-manager-list .save-manager-row').length).toBe(3);

    // Entry removed elsewhere (e.g. delete flow) → the next open drops its row.
    localStorage.setItem(INDEX_KEY, JSON.stringify([
      { id: 'b', name: 'Beta', timestamp: 2_000, sizeKB: 2 },
    ]));
    mgr.openForLoad();
    const rows = document.querySelectorAll('#save-manager-list .save-manager-row');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Beta');
  });
});
