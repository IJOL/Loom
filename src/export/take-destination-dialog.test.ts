// @vitest-environment jsdom
// Characterisation of the take-destination modal after the lit-html migration:
// stable ids, lazy single build, and how each button settles the promise.
import { describe, it, expect, beforeAll } from 'vitest';
import { showTakeDestinationDialog } from './take-destination-dialog';

beforeAll(() => {
  // jsdom has no showModal/close implementation; give the dialog the minimal
  // open-state semantics the module relies on (`.open` reflects the attribute).
  const proto = window.HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  }
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('showTakeDestinationDialog', () => {
  it('lazily builds ONE #take-dialog with the e2e-stable ids and texts', async () => {
    const p = showTakeDestinationDialog();
    expect(document.querySelectorAll('#take-dialog').length).toBe(1);
    expect(byId('take-dialog').textContent).toContain('Take recorded');
    expect(byId('take-dest-audio').textContent).toBe('New audio channel');
    expect(byId('take-dest-file').textContent).toBe('Download WAV');
    expect(byId('take-dest-cancel').textContent).toBe('Discard take');
    byId('take-dest-audio').click();
    await expect(p).resolves.toBe('audio');

    // A later take reuses the same element instead of stacking a second dialog.
    const p2 = showTakeDestinationDialog();
    expect(document.querySelectorAll('#take-dialog').length).toBe(1);
    byId('take-dest-file').click();
    await expect(p2).resolves.toBe('file');
  });

  it('Discard resolves null and closes the dialog', async () => {
    const p = showTakeDestinationDialog();
    expect((byId('take-dialog') as HTMLDialogElement).open).toBe(true);
    byId('take-dest-cancel').click();
    await expect(p).resolves.toBe(null);
    expect((byId('take-dialog') as HTMLDialogElement).open).toBe(false);
  });

  it('Esc (native cancel event) resolves null', async () => {
    const p = showTakeDestinationDialog();
    byId('take-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(p).resolves.toBe(null);
  });

  it('a new take supersedes a pending one, dismissing it', async () => {
    const first = showTakeDestinationDialog();
    const second = showTakeDestinationDialog();
    await expect(first).resolves.toBe(null);
    byId('take-dest-audio').click();
    await expect(second).resolves.toBe('audio');
  });
});
