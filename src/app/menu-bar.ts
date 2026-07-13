// Self-built classic menu bar: click a top label to open its dropdown, hover-
// follow between open menus, Esc / outside-click closes, checkable + disabled +
// submenu items. Every item calls its spec.run() — no synthetic DOM clicks.
import type { MenuSpec, MenuItemSpec } from './menu-spec';

export function createMenuBar(host: HTMLElement, menus: MenuSpec[]): { destroy(): void } {
  host.classList.add('menubar');
  host.setAttribute('role', 'menubar');
  let openIdx = -1;
  let dropdown: HTMLElement | null = null;

  const tops: HTMLElement[] = menus.map((menu, i) => {
    const t = document.createElement('button');
    t.className = 'menubar-top'; t.textContent = menu.label; t.setAttribute('role', 'menuitem');
    t.addEventListener('click', () => (openIdx === i ? close() : open(i)));
    t.addEventListener('mouseenter', () => { if (openIdx !== -1 && openIdx !== i) open(i); });
    host.appendChild(t);
    return t;
  });

  function renderItems(items: (MenuItemSpec | 'divider')[], container: HTMLElement): void {
    for (const it of items) {
      if (it === 'divider') {
        const d = document.createElement('div'); d.className = 'menubar-divider'; container.appendChild(d); continue;
      }
      const enabled = it.enabled ? it.enabled() : true;
      const row = document.createElement('button');
      row.className = 'menubar-item'; row.setAttribute('role', 'menuitem');
      if (!enabled) row.classList.add('is-disabled');
      const check = it.checked && it.checked() ? '● ' : (it.checked ? '○ ' : '');
      const left = document.createElement('span'); left.className = 'menubar-item-label'; left.textContent = check + it.label;
      const right = document.createElement('span'); right.className = 'menubar-item-sc';
      right.textContent = it.submenu ? '▸' : (it.shortcut ?? '');
      row.append(left, right);
      if (it.submenu) {
        row.classList.add('has-submenu');
        let sub: HTMLElement | null = null;
        row.addEventListener('mouseenter', () => {
          if (sub) return;
          sub = document.createElement('div'); sub.className = 'menubar-dropdown menubar-submenu';
          renderItems(it.submenu!(), sub); row.appendChild(sub);
        });
        row.addEventListener('mouseleave', () => { sub?.remove(); sub = null; });
      } else if (enabled && it.run) {
        row.addEventListener('click', (e) => { e.stopPropagation(); const r = it.run!; close(); r(); });
      } else {
        row.addEventListener('click', (e) => e.stopPropagation());
      }
      container.appendChild(row);
    }
  }

  function open(i: number): void {
    close();
    openIdx = i; tops[i].classList.add('is-open');
    dropdown = document.createElement('div'); dropdown.className = 'menubar-dropdown'; dropdown.setAttribute('role', 'menu');
    renderItems(menus[i].items, dropdown);
    tops[i].appendChild(dropdown);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  function close(): void {
    if (openIdx === -1) return;
    tops[openIdx].classList.remove('is-open');
    dropdown?.remove(); dropdown = null; openIdx = -1;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e: PointerEvent): void { if (!host.contains(e.target as Node)) close(); }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); open((openIdx + 1) % menus.length); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); open((openIdx - 1 + menus.length) % menus.length); }
  }

  return { destroy: () => { close(); host.replaceChildren(); } };
}
