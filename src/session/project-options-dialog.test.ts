// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderProjectOptionsDialog } from './project-options-dialog';
import { DEFAULT_MUSICALITY } from './session-types';

function fixture() {
  document.body.innerHTML = `
    <dialog id="project-options-dialog" class="app-modal">
      <div class="app-modal-body" id="project-options-body"></div>
      <button data-dialog-close>Close</button>
    </dialog>`;
  // jsdom lacks showModal/close — stub them.
  const dlg = document.getElementById('project-options-dialog') as HTMLDialogElement;
  (dlg as any).showModal = function () { this.open = true; };
  (dlg as any).close = function () { this.open = false; };
}

describe('Project Options dialog', () => {
  beforeEach(fixture);

  it('renders the current name and writes edits back through setName', () => {
    let name = 'My Track';
    let mus = { ...DEFAULT_MUSICALITY };
    const h = renderProjectOptionsDialog({
      getName: () => name, setName: (n) => { name = n; },
      getMusicality: () => mus, setMusicality: (m) => { mus = m; },
    });
    h.open();
    const input = document.querySelector<HTMLInputElement>('#project-options-body input[data-po="name"]')!;
    expect(input.value).toBe('My Track');
    input.value = 'Renamed';
    input.dispatchEvent(new Event('change'));
    expect(name).toBe('Renamed');
  });

  it('writes a scale change back through setMusicality', () => {
    let mus = { ...DEFAULT_MUSICALITY };
    const h = renderProjectOptionsDialog({
      getName: () => 'x', setName: () => {},
      getMusicality: () => mus, setMusicality: (m) => { mus = m; },
    });
    h.open();
    const scaleSel = document.querySelector<HTMLSelectElement>('#project-options-body select[data-po="scale"]')!;
    const other = Array.from(scaleSel.options).find((o) => o.value !== mus.scale)!;
    scaleSel.value = other.value;
    scaleSel.dispatchEvent(new Event('change'));
    expect(mus.scale).toBe(other.value);
  });
});
