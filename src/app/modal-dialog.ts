// Thin wrapper over a native <dialog>: open (showModal), close, light-dismiss on
// backdrop click, and any [data-dialog-close] button closes it. Esc is native.
export interface ModalHandle {
  open(): void;
  close(): void;
  el: HTMLDialogElement;
}

export function bindModalDialog(id: string): ModalHandle {
  const el = document.getElementById(id) as HTMLDialogElement | null;
  if (!el) throw new Error(`bindModalDialog: #${id} not found`);
  const close = () => { if (el.open) el.close(); };
  el.querySelectorAll('[data-dialog-close]').forEach((b) => b.addEventListener('click', close));
  // Backdrop click: the <dialog> element itself is the event target only when the
  // click lands on the ::backdrop area, not on inner content.
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  return { open: () => { if (!el.open) el.showModal(); }, close, el };
}
