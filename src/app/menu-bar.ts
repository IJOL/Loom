// Self-built classic menu bar: click a top label to open its dropdown, hover-
// follow between open menus, Esc / outside-click closes, checkable + disabled +
// submenu items. Every item calls its spec.run() — no synthetic DOM clicks.
//
// Rendered as one lit-html template into the host: open/close/submenu state
// lives in closures and each change repaints, patching in place. Open submenus
// are tracked by item-object identity, which holds for the spec's single level
// of submenus (top-level items are stable; `submenu()` results are rebuilt per
// paint, so a nested sub-submenu would not stay open — none exist).
import { html, render, nothing, type TemplateResult } from 'lit-html';
import type { MenuSpec, MenuItemSpec } from './menu-spec';

export function createMenuBar(host: HTMLElement, menus: MenuSpec[]): { destroy(): void } {
  host.classList.add('menubar');
  host.setAttribute('role', 'menubar');
  let openIdx = -1;
  const openSubs = new Set<MenuItemSpec>();

  function itemTemplate(it: MenuItemSpec | 'divider'): TemplateResult {
    if (it === 'divider') return html`<div class="menubar-divider"></div>`;
    const enabled = it.enabled ? it.enabled() : true;
    const check = it.checked && it.checked() ? '● ' : (it.checked ? '○ ' : '');
    const cls = 'menubar-item' + (enabled ? '' : ' is-disabled') + (it.submenu ? ' has-submenu' : '');
    const onClick = (e: Event) => {
      // Never bubble to the top-level button — it would toggle the whole menu
      // shut. Only an enabled leaf item runs (submenu rows open on hover).
      e.stopPropagation();
      if (!it.submenu && enabled && it.run) { const r = it.run; close(); r(); }
    };
    return html`
      <button type="button" class=${cls} role="menuitem"
        @click=${onClick}
        @mouseenter=${it.submenu ? () => { if (!openSubs.has(it)) { openSubs.add(it); repaint(); } } : undefined}
        @mouseleave=${it.submenu ? () => { if (openSubs.delete(it)) repaint(); } : undefined}
      ><span class="menubar-item-label">${check + it.label}</span><span class="menubar-item-sc">${it.submenu ? '▸' : (it.shortcut ?? '')}</span>${
        it.submenu && openSubs.has(it)
          ? html`<div class="menubar-dropdown menubar-submenu">${it.submenu().map(itemTemplate)}</div>`
          : nothing
      }</button>`;
  }

  const topTemplate = (menu: MenuSpec, i: number): TemplateResult => html`
    <button type="button" class=${i === openIdx ? 'menubar-top is-open' : 'menubar-top'} role="menuitem"
      @click=${() => (openIdx === i ? close() : open(i))}
      @mouseenter=${() => { if (openIdx !== -1 && openIdx !== i) open(i); }}
    >${menu.label}${i === openIdx
      ? html`<div class="menubar-dropdown" role="menu">${menu.items.map(itemTemplate)}</div>`
      : nothing}</button>`;

  const repaint = () => render(menus.map(topTemplate), host);

  function open(i: number): void {
    // The document listeners exist exactly while some menu is open; a
    // hover-follow open keeps them (adding the same fn twice is a DOM no-op).
    if (openIdx === -1) {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }
    openIdx = i; openSubs.clear();
    repaint();
  }

  function close(): void {
    if (openIdx === -1) return;
    openIdx = -1; openSubs.clear();
    repaint();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e: PointerEvent): void { if (!host.contains(e.target as Node)) close(); }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); open((openIdx + 1) % menus.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); open((openIdx - 1 + menus.length) % menus.length); }
  }

  repaint();
  return { destroy: () => { close(); host.replaceChildren(); } };
}
