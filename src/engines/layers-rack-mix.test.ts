import { describe, it, expect } from 'vitest';
import {
  loadedSlots, mixShape, chainGains, chainPosition, squarePosition, mixGains,
} from './layers-rack-mix';
import { soundGains } from '../weave/sound-fade';
import type { LayerSpec } from '../audio-dsp/layers/layer-spec';

const slot = (engineId: string): LayerSpec => ({ engineId, lo: 0, hi: 127, gain: 1 });

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
const closeAll = (a: readonly number[], b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => close(v, b[i]));
};

describe('loadedSlots', () => {
  it('names the slots holding an engine, in slot order', () => {
    expect(loadedSlots([slot('fm'), slot(''), slot('karplus'), slot('')])).toEqual([0, 2]);
  });

  it('is empty for a rack nobody has filled', () => {
    expect(loadedSlots([slot(''), slot(''), slot(''), slot('')])).toEqual([]);
  });
});

describe('mixShape', () => {
  it('offers nothing when there is nothing to mix', () => {
    expect(mixShape([])).toBe('none');
    expect(mixShape([0])).toBe('none');
  });

  it('is a chain for two or three loaded slots', () => {
    expect(mixShape([0, 1])).toBe('chain');
    expect(mixShape([0, 2, 3])).toBe('chain');
  });

  it('is a square once all four are loaded', () => {
    expect(mixShape([0, 1, 2, 3])).toBe('square');
  });
});

describe('chainGains', () => {
  it('hands one end the whole sound, exactly', () => {
    closeAll(chainGains(0, 2), [1, 0]);
    closeAll(chainGains(1, 2), [0, 1]);
  });

  it('crosses two slots at constant power', () => {
    closeAll(chainGains(0.5, 2), [Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('walks three slots through the middle one', () => {
    closeAll(chainGains(0, 3), [1, 0, 0]);
    closeAll(chainGains(0.5, 3), [0, 1, 0]);
    closeAll(chainGains(1, 3), [0, 0, 1]);
    closeAll(chainGains(0.25, 3), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    closeAll(chainGains(0.75, 3), [0, Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('never leaves a hole in the middle: the power always sums to one', () => {
    for (const n of [2, 3]) {
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const power = chainGains(p, n).reduce((s, g) => s + g * g, 0);
        close(power, 1);
      }
    }
  });

  it('clamps a position outside the fader', () => {
    closeAll(chainGains(-2, 3), chainGains(0, 3));
    closeAll(chainGains(9, 3), chainGains(1, 3));
  });
});

describe('chainPosition', () => {
  it('reads back the position the gains came from', () => {
    for (const n of [2, 3]) {
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const q = Math.min(1, p);
        close(chainPosition(chainGains(q, n)), q);
      }
    }
  });

  it('sits at the far end when only the last slot sounds', () => {
    close(chainPosition([0, 0, 1]), 1);
  });

  it('reads two slots at equal level as halfway between them', () => {
    close(chainPosition([1, 1, 0]), 0.25);
  });

  it('parks at the near end rather than dividing by zero when the rack is silent', () => {
    close(chainPosition([0, 0, 0]), 0);
  });
});

describe('squarePosition', () => {
  it('reads back the corner the gains came from', () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
      const p = squarePosition(soundGains(x, y));
      close(p.x, x);
      close(p.y, y);
    }
  });

  it('parks in the near corner rather than dividing by zero when the rack is silent', () => {
    expect(squarePosition([0, 0, 0, 0])).toEqual({ x: 0, y: 0 });
  });
});

describe('mixGains', () => {
  it('gives one gain per loaded slot, in the same order', () => {
    expect(mixGains([0, 2], 0.5, 0)).toHaveLength(2);
    expect(mixGains([0, 1, 3], 0.5, 0)).toHaveLength(3);
  });

  it('takes the chain arithmetic up to three slots', () => {
    closeAll(mixGains([0, 1, 3], 0.25, 0.9), chainGains(0.25, 3));
  });

  it('takes the square arithmetic at four, where the second axis is what moves', () => {
    closeAll(mixGains([0, 1, 2, 3], 0.3, 0.7), soundGains(0.3, 0.7));
  });
});
