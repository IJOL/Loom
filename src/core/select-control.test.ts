import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { quantiseSelectValue, normaliseSelectIndex } from './select-control';

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

// Task 8b: a vertical strip, compact enough to sit next to a knob. jsdom does
// not run layout, so height/width here are the DECLARED CSS values, not a
// measured rendered box — a real pixel check needs a real browser (the
// coordinator's Chrome pass covers that).
describe('.radio-strip layout (CSS, read from the stylesheet)', () => {
  it('stacks vertically: flex-direction: column', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-strip');
    expect(block, '.radio-strip rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/display:\s*inline-flex/);
    expect(block!).toMatch(/flex-direction:\s*column/);
  });

  it('is ~50px wide, matching a default knob so a mixed row aligns', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-strip');
    expect(block!).toMatch(/width:\s*50px/);
  });

  it('.radio-btn is ~15px tall, so a 4-option strip stays under a 68px knob', () => {
    const block = scssBlock(KNOB_SCSS, '.radio-btn');
    expect(block, '.radio-btn rule not found in _knob.scss').toBeTruthy();
    expect(block!).toMatch(/height:\s*15px/);
  });
});
