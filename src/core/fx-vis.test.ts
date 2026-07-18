// The insert thumbnails are pure geometry, so they test without a DOM.
// Assertions are about SHAPE — a higher feedback reaches further, a lower
// cutoff turns down sooner — never about exact coordinates.
import { describe, it, expect } from 'vitest';
import { buildFxVis, hasFxVis, VIS_H, type ParamReader } from './fx-vis';

/** A reader over a plain bag, so each test states only what it cares about. */
const reader = (bag: Record<string, number>): ParamReader => (id) => bag[id] ?? 0;

/** Every y coordinate in a path, in draw order. */
function ys(path: string): number[] {
  return [...path.matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) => parseFloat(m[1]));
}
/** Lower y = louder, so the "height" of a point is the inverse. */
const heights = (path: string) => ys(path).map((v) => VIS_H - v);

describe('buildFxVis — coverage', () => {
  it('draws the effects whose state is visible at a glance', () => {
    for (const id of ['delay', 'reverb', 'tremolo', 'multifilter', 'compressor', 'distortion', 'bitcrusher']) {
      expect(hasFxVis(id)).toBe(true);
    }
  });

  it('draws nothing for effects whose whole point is movement', () => {
    // A still frame of a chorus is a straight line: it would say nothing.
    for (const id of ['chorus', 'flanger', 'phaser']) {
      expect(hasFxVis(id)).toBe(false);
      expect(buildFxVis(id, reader({}))).toBeNull();
    }
  });
});

describe('delay', () => {
  it('more feedback leaves the later taps taller', () => {
    const low  = buildFxVis('delay', reader({ feedback: 0.2, wet: 1 }))!;
    const high = buildFxVis('delay', reader({ feedback: 0.85, wet: 1 }))!;
    // Compare the last tap's stem height — the odd entries are the tap tops.
    const lastTop = (p: string) => heights(p)[heights(p).length - 1];
    expect(lastTop(high.line)).toBeGreaterThan(lastTop(low.line));
  });
});

describe('reverb', () => {
  it('a longer decay keeps the tail up for longer', () => {
    const short = buildFxVis('reverb', reader({ size: 2, decay: 8 }))!;
    const long  = buildFxVis('reverb', reader({ size: 2, decay: 1 }))!;
    const mid = (p: string) => heights(p)[Math.floor(heights(p).length / 2)];
    expect(mid(long.line)).toBeGreaterThan(mid(short.line));
  });

  it('has a filled area — a tail reads as a body, not a wire', () => {
    expect(buildFxVis('reverb', reader({ size: 2, decay: 3 }))!.area).toBeTruthy();
  });
});

describe('tremolo / gate', () => {
  it('a square reaches its extremes; a sine mostly does not', () => {
    const sine   = buildFxVis('tremolo', reader({ depth: 1, shape: 0 }))!;
    const square = buildFxVis('tremolo', reader({ depth: 1, shape: 1 }))!;
    // Count points sitting near the very top: a square parks there, a sine passes.
    const nearTop = (p: string) => heights(p).filter((h) => h > VIS_H * 0.8).length;
    expect(nearTop(square.line)).toBeGreaterThan(nearTop(sine.line));
  });

  it('depth 0 draws a flat line — nothing is happening, and it looks it', () => {
    const flat = ys(buildFxVis('tremolo', reader({ depth: 0, shape: 0 }))!.line);
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThan(0.5);
  });
});

describe('multifilter', () => {
  it('lowpass falls to the right; highpass rises', () => {
    const lp = heights(buildFxVis('multifilter', reader({ type: 0, freq: 1000, q: 1 }))!.line);
    const hp = heights(buildFxVis('multifilter', reader({ type: 1, freq: 1000, q: 1 }))!.line);
    expect(lp[lp.length - 1]).toBeLessThan(lp[0]);
    expect(hp[hp.length - 1]).toBeGreaterThan(hp[0]);
  });

  it('a lower cutoff turns down sooner', () => {
    const low  = heights(buildFxVis('multifilter', reader({ type: 0, freq: 200, q: 1 }))!.line);
    const high = heights(buildFxVis('multifilter', reader({ type: 0, freq: 8000, q: 1 }))!.line);
    const mid = Math.floor(low.length / 2);
    expect(low[mid]).toBeLessThan(high[mid]);
  });
});

describe('compressor', () => {
  it('a higher ratio bends the transfer curve down harder', () => {
    const gentle = heights(buildFxVis('compressor', reader({ threshold: -24, ratio: 2 }))!.line);
    const hard   = heights(buildFxVis('compressor', reader({ threshold: -24, ratio: 20 }))!.line);
    expect(hard[hard.length - 1]).toBeLessThan(gentle[gentle.length - 1]);
  });

  it('below threshold the curve is untouched — that is what a threshold means', () => {
    const c = heights(buildFxVis('compressor', reader({ threshold: -12, ratio: 20 }))!.line);
    // The first few points sit under the threshold and must rise linearly.
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[2] - c[1]).toBeCloseTo(c[1] - c[0], 1);
  });
});

describe('distortion and bitcrusher', () => {
  it('more drive bends the curve further from the diagonal', () => {
    const bend = (p: string) => {
      const h = heights(p);
      const quarter = h[Math.floor(h.length / 4)];
      const diagonal = (VIS_H - 4) * 0.25 + 2;
      return Math.abs(quarter - diagonal);
    };
    const soft = buildFxVis('distortion', reader({ drive: 1 }))!;
    const hard = buildFxVis('distortion', reader({ drive: 40 }))!;
    expect(bend(hard.line)).toBeGreaterThan(bend(soft.line));
  });

  it('fewer bits make a visibly coarser staircase', () => {
    const steps = (p: string) => new Set(ys(p).map((v) => v.toFixed(2))).size;
    expect(steps(buildFxVis('bitcrusher', reader({ bits: 2 }))!.line))
      .toBeLessThan(steps(buildFxVis('bitcrusher', reader({ bits: 6 }))!.line));
  });
});
