// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createToolToggle, createHelpButton, createGridControl, createResolutionSelect,
} from './clip-editor-toolbar';
import { RESOLUTIONS } from './drum-grid-editing';

describe('createToolToggle', () => {
  it('builds Draw/Select buttons, bolds the active one, and reports changes', () => {
    const seen: string[] = [];
    const t = createToolToggle('draw', (tool) => seen.push(tool));
    expect(t.drawBtn.textContent).toContain('Draw');
    expect(t.selBtn.textContent).toContain('Select');
    // active tool is bold
    expect(t.drawBtn.style.fontWeight).toBe('700');
    expect(t.selBtn.style.fontWeight).toBe('400');
    // clicking Select switches the active tool + fires onChange
    t.selBtn.click();
    expect(t.get()).toBe('select');
    expect(t.selBtn.style.fontWeight).toBe('700');
    expect(t.drawBtn.style.fontWeight).toBe('400');
    expect(seen).toEqual(['select']);
    // programmatic set updates bold WITHOUT re-firing onChange (the keyboard path
    // sets the tool itself; onChange is for user clicks)
    t.set('draw');
    expect(t.drawBtn.style.fontWeight).toBe('700');
    expect(seen).toEqual(['select']);
  });
});

describe('createHelpButton', () => {
  it('builds a ? button and a hidden popover that toggles on click', () => {
    const { btn, popover } = createHelpButton('LEGEND TEXT');
    expect(btn.className).toContain('editor-help-btn');
    expect(btn.textContent).toBe('?');
    expect(popover.className).toContain('editor-help-popover');
    expect(popover.textContent).toBe('LEGEND TEXT');
    expect(popover.hidden).toBe(true);
    btn.click();
    expect(popover.hidden).toBe(false);
    btn.click();
    expect(popover.hidden).toBe(true);
  });
});

describe('createGridControl', () => {
  it('wraps children in a right-anchored .editor-grid-control', () => {
    const a = document.createElement('span');
    const b = document.createElement('button');
    const ctl = createGridControl(a, b);
    expect(ctl.className).toContain('editor-grid-control');
    expect(ctl.contains(a)).toBe(true);
    expect(ctl.contains(b)).toBe(true);
  });
});

describe('createResolutionSelect', () => {
  it('offers every RESOLUTION, starts at the initial value, and reports changes', () => {
    const seen: string[] = [];
    const { control, select } = createResolutionSelect('1/16', (r) => seen.push(r));
    expect(control.className).toContain('editor-grid-control');
    expect(control.textContent).toContain('Grid');
    expect([...select.options].map((o) => o.value)).toEqual(RESOLUTIONS);
    expect(select.value).toBe('1/16');
    select.value = '1/8';
    select.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['1/8']);
  });
  it('clamps an unknown change back to the default', () => {
    const seen: string[] = [];
    const { select } = createResolutionSelect('1/16', (r) => seen.push(r));
    select.value = 'bogus';
    select.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['1/16']); // DEFAULT_RESOLUTION
  });
});
