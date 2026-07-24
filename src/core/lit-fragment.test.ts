// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { html } from 'lit-html';
import { renderElement } from './lit-fragment';

describe('renderElement', () => {
  it('returns the template root element as a plain detached node', () => {
    const el = renderElement<HTMLDivElement>(html`<div class="x" title="t">hi</div>`);
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('x');
    expect(el.title).toBe('t');
    expect(el.textContent).toBe('hi');
    expect(el.isConnected).toBe(false);
  });

  it('keeps @event bindings working after extraction from the fragment', () => {
    const onClick = vi.fn();
    const el = renderElement<HTMLButtonElement>(html`<button @click=${onClick}>go</button>`);
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('skips leading whitespace/markers and interpolates child nodes', () => {
    const child = document.createElement('span');
    const el = renderElement<HTMLUListElement>(html`
      <ul>${[html`<li>a</li>`, child]}</ul>
    `);
    expect(el.tagName).toBe('UL');
    expect(el.querySelectorAll('li').length).toBe(1);
    expect(el.contains(child)).toBe(true);
  });

  it('throws on a template with no root element', () => {
    expect(() => renderElement(html`just text`)).toThrow(/no root element/);
  });
});
