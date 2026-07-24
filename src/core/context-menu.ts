// src/core/context-menu.ts
// Lightweight reusable right-click context menu: a floating <ul> positioned at
// the cursor. Closes on item click, outside pointerdown, scroll, resize, or
// Escape. Singleton — opening a new menu closes the previous one. DOM-only.
// Drive it from a `contextmenu` listener: el.addEventListener('contextmenu',
// (e) => openContextMenu(e, items)).

import { html, nothing, type TemplateResult } from 'lit-html';
import { renderElement } from './lit-fragment';

export interface ContextMenuItem {
  label: string;
  /** Omitted for swatch rows, which carry their own per-swatch handler. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Render in red (destructive action). */
  danger?: boolean;
  /** Draw a separator above this item. */
  separatorBefore?: boolean;
  /** Render a row of colour swatches under the label instead of a click target.
   *  Picking one closes the menu and calls onPick. `current` gets a ring. */
  swatches?: {
    colors: readonly string[];
    current?: string;
    onPick: (color: string) => void;
  };
}

let openMenu: HTMLElement | null = null;
let detach: (() => void) | null = null;

export function closeContextMenu(): void {
  detach?.();
  detach = null;
  openMenu?.remove();
  openMenu = null;
}

function itemTemplate(item: ContextMenuItem): TemplateResult {
  const sep = item.separatorBefore ? html`<li class="context-menu-sep"></li>` : nothing;
  if (item.swatches) {
    const { colors, current, onPick } = item.swatches;
    return html`${sep}<li class="context-menu-swatches">
      <div class="context-menu-swatches-label">${item.label}</div>
      <div class="context-menu-swatch-row">
        ${colors.map((color) => html`<button
          class="context-menu-swatch${color === current ? ' current' : ''}"
          style="background:${color}"
          title=${color}
          @click=${() => { closeContextMenu(); onPick(color); }}
        ></button>`)}
      </div>
    </li>`;
  }
  // No listener at all on a disabled item (an undefined @click binds nothing),
  // so clicking it neither fires nor closes the menu.
  return html`${sep}<li
    class="context-menu-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}"
    @click=${item.disabled ? undefined : () => { closeContextMenu(); item.onSelect?.(); }}
  >${item.label}</li>`;
}

export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void {
  e.preventDefault();
  closeContextMenu(); // supersede any menu already open

  // Transient DOM: built once per open through a one-shot fragment render,
  // removed wholesale on close — no mounted panel to keep in sync. Position
  // comes straight from the event (no layout read), so it rides in the template.
  const ul = renderElement<HTMLUListElement>(html`<ul
    class="context-menu"
    style="left:${e.clientX}px;top:${e.clientY}px"
  >${items.map(itemTemplate)}</ul>`);

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
