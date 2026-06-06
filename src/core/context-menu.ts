// src/core/context-menu.ts
// Lightweight reusable right-click context menu: a floating <ul> positioned at
// the cursor. Closes on item click, outside pointerdown, scroll, resize, or
// Escape. Singleton — opening a new menu closes the previous one. DOM-only.
// Drive it from a `contextmenu` listener: el.addEventListener('contextmenu',
// (e) => openContextMenu(e, items)).

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Render in red (destructive action). */
  danger?: boolean;
  /** Draw a separator above this item. */
  separatorBefore?: boolean;
}

let openMenu: HTMLElement | null = null;
let detach: (() => void) | null = null;

export function closeContextMenu(): void {
  detach?.();
  detach = null;
  openMenu?.remove();
  openMenu = null;
}

export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void {
  e.preventDefault();
  closeContextMenu(); // supersede any menu already open

  const ul = document.createElement('ul');
  ul.className = 'context-menu';
  ul.style.left = `${e.clientX}px`;
  ul.style.top = `${e.clientY}px`;

  for (const item of items) {
    if (item.separatorBefore) {
      const sep = document.createElement('li');
      sep.className = 'context-menu-sep';
      ul.appendChild(sep);
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item';
    if (item.disabled) li.classList.add('disabled');
    if (item.danger) li.classList.add('danger');
    li.textContent = item.label;
    if (!item.disabled) {
      li.addEventListener('click', () => { closeContextMenu(); item.onSelect(); });
    }
    ul.appendChild(li);
  }

  document.body.appendChild(ul);
  openMenu = ul;

  // The opening gesture is a 'contextmenu' event; its preceding pointerdown has
  // already fired, so registering pointerdown now won't self-close the menu.
  const onPointer = (ev: Event) => { if (!ul.contains(ev.target as Node)) closeContextMenu(); };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeContextMenu(); };
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu, true);
  detach = () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', closeContextMenu, true);
    window.removeEventListener('resize', closeContextMenu, true);
  };
}
