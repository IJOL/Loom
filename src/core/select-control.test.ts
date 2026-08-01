/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { quantiseSelectValue, normaliseSelectIndex, createSelectControl } from './select-control';

/** Extract one top-level SCSS block so a layout rule can be asserted from the
 *  stylesheet itself: jsdom applies inline/attribute styles but never our SCSS,
 *  so the strip's layout has nowhere else to be pinned. Same pattern as
 *  core/lane-fx-panel.test.ts's scssBlock. */
function scssBlock(src: string, selector: string): string | null {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return null;
}

// vitest runs with cwd = project root (vitest.config.ts lives there).
const KNOB_SCSS = readFileSync(resolve(process.cwd(), 'src/styles/_knob.scss'), 'utf8');

describe('quantiseSelectValue', () => {
  it('maps 0..1 to option index 0..N-1', () => {
    expect(quantiseSelectValue(0,    4)).toBe(0);
    expect(quantiseSelectValue(0.24, 4)).toBe(0);
    expect(quantiseSelectValue(0.25, 4)).toBe(1);
    expect(quantiseSelectValue(0.5,  4)).toBe(2);
    expect(quantiseSelectValue(0.99, 4)).toBe(3);
    expect(quantiseSelectValue(1,    4)).toBe(3);
  });
  it('handles 2 options (toggle)', () => {
    expect(quantiseSelectValue(0.49, 2)).toBe(0);
    expect(quantiseSelectValue(0.5,  2)).toBe(1);
  });
});

describe('normaliseSelectIndex', () => {
  it('inverse of quantiseSelectValue for the option mid-bucket', () => {
    expect(normaliseSelectIndex(0, 4)).toBeCloseTo(0.125, 5);
    expect(normaliseSelectIndex(3, 4)).toBeCloseTo(0.875, 5);
  });
});

// Task 8b: a vertical strip, compact enough to sit next to a knob — but
// (fix round 2) ONLY for param controls that opt in via `compact: true`.
// The base `.radio-strip` stays horizontal, since the modulator-config
// panel's LFO cards break when it goes vertical (that is exactly what
// leaked the first time: `.radio-strip` itself had `flex-direction: column`).
// jsdom does not run layout, so height/width here are the DECLARED CSS
// values, not a measured rendered box — a real pixel check needs a real
// browser (the coordinator's Chrome pass covers that).
describe('.radio-strip base layout stays horizontal (CSS, read from the stylesheet)', () => {
  it('declares no flex-direction (defaults to row)', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-strip');
    expect(block, '.radio-strip rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/display:\s*inline-flex/);
    expect(block!).not.toMatch(/flex-direction/);
    expect(block!).not.toMatch(/width:\s*50px/);
  });

  it('.radio-btn stays 22px tall by default, not the 15px compact height', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-btn');
    expect(block, '.radio-btn rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/height:\s*22px/);
  });
});

describe('.radio-strip--compact layout (CSS, read from the stylesheet)', () => {
  it('stacks vertically: flex-direction: column, ~50px wide', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-strip--compact');
    expect(block, '.radio-strip--compact rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/flex-direction:\s*column/);
    expect(block!).toMatch(/width:\s*50px/);
  });

  it('.radio-strip--compact .radio-btn is ~15px tall, so a 4-option strip stays under a 68px knob', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-strip--compact .radio-btn');
    expect(block, '.radio-strip--compact .radio-btn rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/height:\s*15px/);
  });
});

// The regression that just happened: createSelectControl building a strip
// through the param path (compact: true) must get the vertical/compact
// class; building one the modulator-config way (no `compact`) must NOT.
describe('createSelectControl compact opt-in', () => {
  const baseOpts = {
    id: 'x', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    initialValue: 'a', onChange: () => {},
  };

  it('compact: true adds radio-strip--compact (the param-control path)', () => {
    const { el } = createSelectControl({ ...baseOpts, compact: true });
    expect(el.classList.contains('radio-strip')).toBe(true);
    expect(el.classList.contains('radio-strip--compact')).toBe(true);
  });

  it('no compact option leaves the base horizontal strip (the modulator-config path)', () => {
    const { el } = createSelectControl(baseOpts);
    expect(el.classList.contains('radio-strip')).toBe(true);
    expect(el.classList.contains('radio-strip--compact')).toBe(false);
  });
});
