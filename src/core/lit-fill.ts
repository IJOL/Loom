// src/core/lit-fill.ts
// lit-html rendering into a caller-owned element: a static <select> from
// index.html, a fill-me <div>. The element is ADOPTED on first render — its
// existing markup wiped once, because lit only manages nodes it rendered
// itself — and every later fill goes through lit's patching render. Wiping an
// adopted element's innerHTML would orphan lit's part markers and silently
// break every subsequent render, which is why the one legal wipe lives here
// and nowhere else. Panels that own a host + widget cache use mountPanel
// (lit-panel.ts); one-shot detached nodes use renderElement (lit-fragment.ts).

import { render, type TemplateResult } from 'lit-html';

const adopted = new WeakSet<Element>();

/** Renders `tpl` as the full content of `el`, adopting it on first use. */
export function renderInto(el: HTMLElement, tpl: TemplateResult): void {
  if (!adopted.has(el)) {
    el.innerHTML = '';
    adopted.add(el);
  }
  render(tpl, el);
}
