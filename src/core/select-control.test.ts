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

// Task (discrete-labels fix): the engine grid now wraps every discrete
// control in `.select-labeled` (a caption above the control) by default. The
// worry was height: does a captioned compact strip still fit the ~93px grid
// row a knob defines? jsdom runs no layout (getBoundingClientRect is always
// 0), so this reads the DECLARED CSS the same way the block above does and
// does the arithmetic by hand — a real-browser look confirmed the same
// numbers (see the discrete-labels report).
//   .select-labeled            → flex column, gap: 1px (no fixed height)
//   .ctl-label                 → font-size: 9px            (~13px w/ line-height, per the task's own measurement)
//   .radio-strip--compact      → 4 buttons × 15px + 3 × 1px gap = 63px (measured ~67px incl. border/padding)
//   caption + gap + strip      → ~13 + 1 + 67 = 81px
//   knob (the row's tallest sibling) → ~71px + row padding 20px + border 2px = ~93px row height
// 81px < 93px: the captioned strip stays shorter than the knob that already
// sets the row's height, so the row does not grow.
describe('.select-labeled caption does not exceed the knob-driven row height (CSS arithmetic)', () => {
  it('.select-labeled has no fixed/min height of its own (content-driven)', () => {
    const DRUM_RACK_SCSS = readFileSync(resolve(process.cwd(), 'src/styles/_drum-rack.scss'), 'utf8');
    const block = scssBlock(DRUM_RACK_SCSS, '.select-labeled');
    expect(block, '.select-labeled rule not found').toBeTruthy();
    expect(block!).not.toMatch(/height/);
  });

  it('.ctl-label is a small caption (9px), not a full-size label', () => {
    const KNOB_SCSS = readFileSync(resolve(process.cwd(), 'src/styles/_knob.scss'), 'utf8');
    const block = scssBlock(KNOB_SCSS, '.ctl-label');
    expect(block, '.ctl-label rule not found').toBeTruthy();
    expect(block!).toMatch(/font-size:\s*9px/);
    expect(block!).toMatch(/text-transform:\s*uppercase/);
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
