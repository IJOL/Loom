// src/core/lit-fragment.ts
// One-shot template instantiation for DOM that is built once and then owned
// imperatively: toolbar widgets whose element references the caller keeps,
// transient nodes (a context menu, an inline-rename <input>). Renders into a
// throwaway DocumentFragment and hands back the root element; the fragment
// (with lit's part markers) is discarded, so the result is a plain detached
// node — no re-render, no patching. Panels that DO repaint on state change use
// mountPanel (lit-panel.ts) instead; reach for this only when a re-rendering
// host is the wrong shape (the caller owns placement and lifetime of the node).

import { render, type TemplateResult } from 'lit-html';

/** Instantiates `tpl` once and returns its first root element. Event bindings
 *  (`@click` etc.) survive extraction — they are plain listeners on the node. */
export function renderElement<T extends HTMLElement>(tpl: TemplateResult): T {
  const frag = document.createDocumentFragment();
  render(tpl, frag);
  const el = frag.firstElementChild;
  if (!el) throw new Error('renderElement: template has no root element');
  return el as T;
}
