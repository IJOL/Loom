// @vitest-environment jsdom
// Characterisation tests for the VU meter's DOM contract (structure queried by
// mixer/master-strip CSS and tests) and the litCountForDb scale. The RAF
// drawing loop itself is exercised live; here we only pin what the lit-html
// migration could have changed.
import { describe, it, expect } from 'vitest';
import {
  createLevelMeter,
  litCountForDb,
  SEGMENT_COUNT,
  SEGMENT_ZONES,
  SEGMENT_TOPS_DB,
} from './level-meter';

// createLevelMeter only reads `fftSize` (buffer size) and calls
// `getFloatTimeDomainData` from its RAF loop; no real audio graph needed.
function fakeAnalyser(): AnalyserNode {
  return {
    fftSize: 512,
    getFloatTimeDomainData() {},
  } as unknown as AnalyserNode;
}

describe('createLevelMeter DOM structure', () => {
  it('builds .mix-vu-host > .mix-vu with SEGMENT_COUNT zone-classed segments', () => {
    const h = createLevelMeter({ analyser: fakeAnalyser() });
    expect(h.el.classList.contains('mix-vu-host')).toBe(true);
    const column = h.el.querySelector('.mix-vu');
    expect(column).not.toBeNull();
    const segs = [...h.el.querySelectorAll('.mix-vu-seg')];
    expect(segs.length).toBe(SEGMENT_COUNT);
    segs.forEach((seg, i) => {
      expect(seg.classList.contains(`mix-vu-seg--${SEGMENT_ZONES[i]}`)).toBe(true);
    });
    h.dispose();
  });

  it('starts with no segment lit', () => {
    const h = createLevelMeter({ analyser: fakeAnalyser() });
    expect(h.el.querySelectorAll('.mix-vu-seg.lit').length).toBe(0);
    h.dispose();
  });

  it('dispose() removes the element from its parent', () => {
    const parent = document.createElement('div');
    const h = createLevelMeter({ analyser: fakeAnalyser() });
    parent.appendChild(h.el);
    expect(parent.contains(h.el)).toBe(true);
    h.dispose();
    expect(parent.contains(h.el)).toBe(false);
  });
});

describe('litCountForDb', () => {
  it('is 0 in silence and full-scale at 0 dBFS', () => {
    expect(litCountForDb(-120)).toBe(0);
    expect(litCountForDb(0)).toBe(SEGMENT_COUNT);
  });

  it('lights one segment for any faint signal above the floor', () => {
    expect(litCountForDb(-80)).toBe(1);
  });

  it('segment i is fully lit exactly at its top threshold', () => {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      expect(litCountForDb(SEGMENT_TOPS_DB[i])).toBe(i + 1);
    }
  });
});
