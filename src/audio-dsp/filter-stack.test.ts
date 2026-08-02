// src/audio-dsp/filter-stack.test.ts
import { describe, it, expect } from 'vitest';
import { FILTER_KINDS, FILTER_KIND_OPTIONS } from './filter-kinds';
import { FilterStack, ROUTING_OFF, trackedCutoff } from './filter-stack';

const SR = 48000;
const CUTOFF = 880;
// A2 (110 Hz), A5 (880 Hz), A8 (7040 Hz): three octaves under the cutoff, on it,
// three over. The same three tones the renderer's filter tests use.
const LOW = 110, AT = 880, HIGH = 7040;

/** How much of a steady sine at `hz` survives `kind`, at the engine's default
 *  resonance. The first 20 ms are dropped: the filter states start at zero, so
 *  the run-in is a transient, not the steady-state response being measured. */
const passes = (kind: number, hz: number): number => {
  const s = new FilterStack(kind, 0, ROUTING_OFF, SR);
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
 *  same input and two kinds differ only by what the filter did to it. */
const noise = (n: number): number[] => {
  let s = 12345;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(s / 0x40000000 - 1); }
  return out;
};

const throughKind = (kind: number, input: number[]): number[] => {
  const s = new FilterStack(kind, 0, ROUTING_OFF, SR);
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

const kindsWithTap = (tap: string): number[] =>
  FILTER_KINDS.map((k, i) => [k, i] as const).filter(([k]) => k.tap === tap).map(([, i]) => i);

describe('the filter kind table', () => {
  it('is ten entries and the dropdown is built from it', () => {
    expect(FILTER_KINDS).toHaveLength(10);
    expect(FILTER_KIND_OPTIONS).toEqual(FILTER_KINDS.map((k) => ({ value: k.value, label: k.label })));
  });

  it('starts at the current default, so a patch that says nothing is unchanged', () => {
    expect(FILTER_KINDS[0]).toMatchObject({ model: 'dig', tap: 'lp' });
  });

  it('never offers a notch on a ladder — the one response they cannot do honestly', () => {
    // A ladder's resonance feedback fills a notch's null, and on the diode at
    // res 0.7 it inverts into a bump. The old grid let you pick that and quietly
    // handed back the lowpass; the list simply does not contain it.
    const lie = FILTER_KINDS.filter((k) => k.model !== 'dig' && k.tap === 'notch');
    expect(lie, 'a ladder notch is not an honest response').toEqual([]);
  });

  it('has unique values and unique labels', () => {
    expect(new Set(FILTER_KINDS.map((k) => k.value)).size).toBe(10);
    expect(new Set(FILTER_KINDS.map((k) => k.label)).size).toBe(10);
  });
});

describe('every entry in the list does what its label says', () => {
  it('the lowpasses pass what is under the cutoff and stop what is over it', () => {
    for (const k of kindsWithTap('lp')) {
      expect(passes(k, LOW), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, HIGH) * 10);
    }
  });

  it('the highpasses are the mirror image', () => {
    for (const k of kindsWithTap('hp')) {
      expect(passes(k, HIGH), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, LOW) * 10);
    }
  });

  it('the bandpasses pass the cutoff and reject both sides', () => {
    for (const k of kindsWithTap('bp')) {
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, LOW) * 5);
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeGreaterThan(passes(k, HIGH) * 5);
    }
  });

  it('the notch is a hole where the bandpass has its peak', () => {
    for (const k of kindsWithTap('notch')) {
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeLessThan(passes(k, LOW) * 0.2);
      expect(passes(k, AT), FILTER_KINDS[k].label).toBeLessThan(passes(k, HIGH) * 0.2);
    }
  });
});

describe('no entry is a silent alias of another', () => {
  // This is the "everything in the list actually works" requirement as an
  // assertion: it is the test that would have caught NOTCH-on-a-ladder handing
  // back the lowpass, because the two would have been bit-identical.
  it('all ten differ from each other through the same signal', () => {
    const input = noise(SR * 0.1);
    const rendered = FILTER_KINDS.map((_, i) => throughKind(i, input));
    for (let a = 0; a < rendered.length; a++) {
      for (let b = a + 1; b < rendered.length; b++) {
        const tag = `${FILTER_KINDS[a].label} vs ${FILTER_KINDS[b].label}`;
        expect(divergence(rendered[a], rendered[b]), tag).toBeGreaterThan(0.01);
      }
    }
  });
});

describe('routing OFF', () => {
  it('is filter A alone — B is not in the path at any blend', () => {
    const input = noise(SR * 0.05);
    const run = (blend: number): number[] => {
      const s = new FilterStack(0, 3, ROUTING_OFF, SR);
      return input.map((x) => s.update(x, CUTOFF, 0.3, 200, 0.3, blend));
    };
    let d = 0;
    const a = run(0), b = run(1);
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
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
