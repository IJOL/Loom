// src/audio-dsp/filter-stack.test.ts
import { describe, it, expect } from 'vitest';
import { FILTER_MODES, tapFor, typeOptionsFor, type FilterTap } from './filter-kinds';
import {
  FilterStack, ROUTING_OFF, ROUTING_SER, ROUTING_PAR, ROUTING_DIFF, trackedCutoff,
} from './filter-stack';

const SR = 48000;
const CUTOFF = 880;
// A2 (110 Hz), A5 (880 Hz), A8 (7040 Hz): three octaves under the cutoff, on it,
// three over. The same three tones the renderer's filter tests use.
const LOW = 110, AT = 880, HIGH = 7040;

/** How much of a steady sine at `hz` survives (model, type), at the engine's
 *  default resonance. The first 20 ms are dropped: the filter states start at
 *  zero, so the run-in is a transient, not the steady-state response being
 *  measured. */
const passes = (model: number, type: number, hz: number): number => {
  const s = new FilterStack(model, type, 0, 0, ROUTING_OFF, SR);
  const tail: number[] = [];
  for (let i = 0; i < SR * 0.25; i++) {
    const y = s.update(Math.sin(2 * Math.PI * hz * i / SR), CUTOFF, 0.25, CUTOFF, 0.25, 0);
    if (i > SR * 0.02) tail.push(y);
  }
  // RMS about the MEAN, not about zero. The diode ladder's clip is asymmetric
  // by design (see ladder.ts), so it rectifies: a sine through it carries a DC
  // offset, and DC is the one frequency a lowpass passes untouched. Measuring
  // raw RMS would score that offset as "the tone survived the filter", which is
  // the opposite of what it means.
  const mean = tail.reduce((s, v) => s + v, 0) / tail.length;
  return Math.sqrt(tail.reduce((s, v) => s + (v - mean) * (v - mean), 0) / tail.length);
};

/** A deterministic broadband signal — a seeded LCG, so every run compares the
 *  same input and two pairs differ only by what the filter did to it. */
const noise = (n: number): number[] => {
  let s = 12345;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(s / 0x40000000 - 1); }
  return out;
};

const throughPair = (model: number, type: number, input: number[]): number[] => {
  const s = new FilterStack(model, type, 0, 0, ROUTING_OFF, SR);
  return input.map((x) => s.update(x, CUTOFF, 0.4, CUTOFF, 0.4, 0));
};

const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
/** How much two renders differ, relative to their own level. Same helper the
 *  renderer tests use, and 0.01 is the threshold that file already treats as
 *  "these are the same sound". */
const divergence = (a: number[], b: number[]): number => {
  let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length / Math.max(1e-9, rms(a));
};

/** Every (mode, tap) pair the table declares, as [modelIdx, typeIdx, label]. */
const PAIRS: Array<[number, number, string]> = FILTER_MODES.flatMap((m, mi) =>
  m.taps.map((t, ti) => [mi, ti, `${m.label} ${t}`] as [number, number, string]),
);

describe('the mode table', () => {
  it('is four circuits, and every one declares at least two taps', () => {
    expect(FILTER_MODES).toHaveLength(4);
    for (const m of FILTER_MODES) expect(m.taps.length, m.label).toBeGreaterThan(1);
  });

  it('starts at the current default, so a patch that says nothing is unchanged', () => {
    expect(FILTER_MODES[0].value).toBe('dig');
    expect(FILTER_MODES[0].taps[0]).toBe('lp');
  });

  it('keeps every existing preset value meaning what it meant', () => {
    // DIG/MOG/303 at 0/1/2, and each declaring its taps in the order the old
    // Type control used. Six values in the preset pack depend on this.
    expect(FILTER_MODES.map((m) => m.value)).toEqual(['dig', 'mog', 'acid', 'comb']);
    expect(FILTER_MODES[0].taps).toEqual(['lp', 'hp', 'bp', 'notch']);
    expect(FILTER_MODES[1].taps).toEqual(['lp', 'hp', 'bp']);
    expect(FILTER_MODES[2].taps).toEqual(['lp', 'hp', 'bp']);
    expect(FILTER_MODES[3].taps).toEqual(['comb+', 'comb-', 'combff']);
  });

  it('never lets a ladder declare a notch — the one response they cannot do', () => {
    for (const m of FILTER_MODES) {
      if (m.value === 'mog' || m.value === 'acid') expect(m.taps).not.toContain('notch');
    }
  });
});

describe('tapFor', () => {
  it('names a tap the mode really has, for every model and every type', () => {
    for (let mi = 0; mi < FILTER_MODES.length; mi++) {
      for (const ti of [-3, 0, 1, 2, 3, 9]) {
        expect(FILTER_MODES[mi].taps, `mode ${mi} type ${ti}`).toContain(tapFor(mi, ti));
      }
    }
  });

  it('clamps rather than wrapping, so an out-of-range type lands on the last tap', () => {
    expect(tapFor(1, 9)).toBe('bp');    // MOG has lp, hp, bp
    expect(tapFor(1, -1)).toBe('lp');
  });
});

describe('the Type control offers exactly the declared taps', () => {
  // No lying buttons, as an assertion: the option list the UI builds must be
  // the mode's tap list, no extra button and no missing one.
  it.each(FILTER_MODES.map((m, i) => [m.label, i] as const))('%s', (_label, mi) => {
    expect(typeOptionsFor(mi)).toHaveLength(FILTER_MODES[mi].taps.length);
    expect(typeOptionsFor(mi).map((o) => o.value)).toEqual(FILTER_MODES[mi].taps);
  });
});

describe('every declared pair does what it says', () => {
  const lp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'lp');
  const hp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'hp');
  const bp = PAIRS.filter(([m, t]) => tapFor(m, t) === 'bp');
  const notch = PAIRS.filter(([m, t]) => tapFor(m, t) === 'notch');

  it('the lowpasses pass what is under the cutoff and stop what is over it', () => {
    for (const [m, t, label] of lp) expect(passes(m, t, LOW), label).toBeGreaterThan(passes(m, t, HIGH) * 10);
  });

  it('the highpasses are the mirror image', () => {
    for (const [m, t, label] of hp) expect(passes(m, t, HIGH), label).toBeGreaterThan(passes(m, t, LOW) * 10);
  });

  it('the bandpasses pass the cutoff and reject both sides', () => {
    for (const [m, t, label] of bp) {
      expect(passes(m, t, AT), label).toBeGreaterThan(passes(m, t, LOW) * 5);
      expect(passes(m, t, AT), label).toBeGreaterThan(passes(m, t, HIGH) * 5);
    }
  });

  it('the notch is a hole where the bandpass has its peak', () => {
    for (const [m, t, label] of notch) {
      expect(passes(m, t, AT), label).toBeLessThan(passes(m, t, LOW) * 0.2);
      expect(passes(m, t, AT), label).toBeLessThan(passes(m, t, HIGH) * 0.2);
    }
  });
});

describe('no declared pair is a silent alias of another', () => {
  it('all of them differ from each other through the same signal', () => {
    const input = noise(SR * 0.1);
    const rendered = PAIRS.map(([m, t]) => throughPair(m, t, input));
    for (let a = 0; a < rendered.length; a++) {
      for (let b = a + 1; b < rendered.length; b++) {
        expect(divergence(rendered[a], rendered[b]), `${PAIRS[a][2]} vs ${PAIRS[b][2]}`)
          .toBeGreaterThan(0.01);
      }
    }
  });
});

describe('routing OFF', () => {
  it('is filter A alone — B is not in the path at any blend', () => {
    const input = noise(SR * 0.05);
    const run = (blend: number): number[] => {
      const s = new FilterStack(0, 0, 1, 3, ROUTING_OFF, SR);
      return input.map((x) => s.update(x, CUTOFF, 0.3, 200, 0.3, blend));
    };
    let d = 0;
    const a = run(0), b = run(1);
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });
});

describe('routing', () => {
  const CLOSED = 300, OPEN = 4000;
  const DIG = 0, LP = 0;
  const tone = (hz: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * hz * i / SR));

  /** RMS of a steady tone through a stack, past the run-in. About the mean, for
   *  the same reason `passes` is: an asymmetric circuit rectifies. */
  const through = (
    routing: number, cutA: number, cutB: number, blend: number, hz: number,
  ): number => {
    const s = new FilterStack(DIG, LP, DIG, LP, routing, SR);
    const input = tone(hz, SR * 0.25);
    const kept: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const y = s.update(input[i], cutA, 0.25, cutB, 0.25, blend);
      if (i > SR * 0.02) kept.push(y);
    }
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    return Math.sqrt(kept.reduce((a, v) => a + (v - mean) * (v - mean), 0) / kept.length);
  };

  it('blend 0 is filter A alone, in every mode', () => {
    const solo = through(ROUTING_OFF, CLOSED, OPEN, 0, 440);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      expect(through(routing, CLOSED, OPEN, 0, 440), `routing ${routing}`).toBeCloseTo(solo, 10);
    }
  });

  it('SERIES removes more than A alone — two lowpasses in a row', () => {
    expect(through(ROUTING_SER, OPEN, CLOSED, 1, 7040))
      .toBeLessThan(through(ROUTING_OFF, OPEN, CLOSED, 1, 7040) * 0.5);
  });

  it('PARALLEL passes what either branch passes', () => {
    // A closed, B open, the tone above A's cutoff and under B's: A alone loses
    // it and the parallel sum brings it back.
    expect(through(ROUTING_PAR, CLOSED, OPEN, 0.5, 2000))
      .toBeGreaterThan(through(ROUTING_OFF, CLOSED, OPEN, 0.5, 2000) * 2);
  });

  it('DIFFERENCE of two lowpasses is a band-pass between their cutoffs', () => {
    // This is why having the same filter twice is worth it: A minus B is a
    // response neither one can produce alone.
    const band = (hz: number) => through(ROUTING_DIFF, OPEN, CLOSED, 1, hz);
    expect(band(1200)).toBeGreaterThan(band(80) * 5);
    expect(band(1200)).toBeGreaterThan(band(12000) * 5);
  });

  it('every mode stays bounded with both filters resonant', () => {
    const input = noise(SR * 0.05);
    for (const routing of [ROUTING_SER, ROUTING_PAR, ROUTING_DIFF]) {
      for (const [mi, ti] of PAIRS.map(([m, t]) => [m, t] as const)) {
        const s = new FilterStack(mi, ti, (mi + 2) % 4, 0, routing, SR);
        let peak = 0;
        for (const x of input) {
          const y = s.update(x * 1.8, 900, 0.95, 300, 0.95, 1);
          expect(Number.isFinite(y), `routing ${routing} pair ${mi}/${ti} went non-finite`).toBe(true);
          const a = Math.abs(y); if (a > peak) peak = a;
        }
        expect(peak, `routing ${routing} pair ${mi}/${ti} blew up`).toBeLessThan(20);
      }
    }
  });
});

describe('trackedCutoff', () => {
  // How far filter B follows everything that MOVES filter A (its envelope and
  // key tracking), expressed as a ratio against A's own base so the interval
  // between them is preserved in OCTAVES rather than in Hz.
  it('leaves B where its knob puts it at track 0', () => {
    expect(trackedCutoff(400, 4, 0)).toBe(400);
  });

  it('preserves the interval at track 1 — B moves by the same ratio as A', () => {
    expect(trackedCutoff(400, 4, 1)).toBe(1600);
  });

  it('follows part of the way in between', () => {
    expect(trackedCutoff(400, 3, 0.5)).toBe(800);   // 400 * (1 + 0.5*2)
  });

  it('stays inside the audible range however far A swings', () => {
    expect(trackedCutoff(400, 200, 1)).toBe(18000);
    expect(trackedCutoff(400, 0, 1)).toBe(20);
  });
});
