// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { alertDialog, confirmDialog, promptDialog } from './dialog';

// jsdom doesn't implement <dialog>.showModal()/close() — stub them so the module
// can open/close its singleton dialog without throwing.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLDialogElement.prototype as any).showModal = function () { this.open = true; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLDialogElement.prototype as any).close = function () { this.open = false; };
});

const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click'));

describe('dialog facility', () => {
  it('confirmDialog resolves true on OK', async () => {
    const p = confirmDialog('¿Seguro?');
    expect(document.getElementById('app-dialog')).not.toBeNull();
    click('app-dialog-ok');
    expect(await p).toBe(true);
  });

  it('confirmDialog resolves false on Cancel', async () => {
    const p = confirmDialog('¿Seguro?');
    click('app-dialog-cancel');
    expect(await p).toBe(false);
  });

  it('promptDialog returns the (edited) input value on OK', async () => {
    const p = promptDialog('Nombre?', 'def');
    const input = document.getElementById('app-dialog-input') as HTMLInputElement;
    expect(input.value).toBe('def');
    input.value = 'hola';
    click('app-dialog-ok');
    expect(await p).toBe('hola');
  });

  it('promptDialog returns null on Cancel', async () => {
    const p = promptDialog('Nombre?');
    click('app-dialog-cancel');
    expect(await p).toBeNull();
  });

  it('alertDialog has only an OK button and resolves on click', async () => {
    const p = alertDialog('Aviso');
    expect(document.getElementById('app-dialog-cancel')).toBeNull();
    click('app-dialog-ok');
    await expect(p).resolves.toBeUndefined();
  });

  it('danger option marks the OK button', async () => {
    const p = confirmDialog('¿Borrar?', { danger: true });
    expect(document.getElementById('app-dialog-ok')!.classList.contains('app-dialog-danger')).toBe(true);
    click('app-dialog-ok');
    await p;
  });
});
