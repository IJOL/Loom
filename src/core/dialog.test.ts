// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { alertDialog, confirmDialog, promptDialog, choiceDialog } from './dialog';

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

  it('choiceDialog resolves the picked choice id and renders a button per choice', async () => {
    const p = choiceDialog('MIDI: 3 pistas', [
      { id: 'replace', label: 'Sustituir', danger: true },
      { id: 'add', label: 'Añadir', primary: true },
    ], { title: 'Importar MIDI' });
    const replace = document.getElementById('app-dialog-choice-replace')!;
    const add = document.getElementById('app-dialog-choice-add')!;
    expect(replace.textContent).toBe('Sustituir');
    expect(replace.classList.contains('app-dialog-danger')).toBe(true);
    expect(add.classList.contains('app-dialog-primary')).toBe(true);
    click('app-dialog-choice-replace');
    expect(await p).toBe('replace');
  });

  it('choiceDialog resolves the OTHER choice when picked', async () => {
    const p = choiceDialog('x', [{ id: 'replace', label: 'Sustituir' }, { id: 'add', label: 'Añadir' }]);
    click('app-dialog-choice-add');
    expect(await p).toBe('add');
  });

  it('choiceDialog resolves null on Cancel (abort, not a hidden action)', async () => {
    const p = choiceDialog('x', [{ id: 'replace', label: 'Sustituir' }, { id: 'add', label: 'Añadir' }]);
    click('app-dialog-cancel');
    expect(await p).toBeNull();
  });
});
