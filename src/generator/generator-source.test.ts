import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '../core/notes';
import { createGeneratorSource, type GeneratorDeps } from './generator-source';
import { DEFAULT_GRID } from './grid';

const bar = (...midi: number[]): NoteEvent[] =>
  midi.map((m, i) => ({ start: i * 96, duration: 96, midi: m, velocity: 100 }));

function harness(over: Partial<GeneratorDeps> = {}) {
  // Three notes against a pattern of four or eight. A pool that DIVIDES the
  // pattern repeats inside it and the head lands on the same pitches — correct,
  // and useless for telling whether the head moved at all.
  const st = { material: bar(60, 62, 64), grid: { ...DEFAULT_GRID }, start: 0 };
  const source = createGeneratorSource({
    material: () => st.material,
    grid: () => st.grid,
    stepsPerBar: () => 4,
    ticksPerStep: () => 96,
    steps: () => 4,
    startStep: () => st.start,
    barTicks: () => 384,
    ...over,
  });
  const midis = () => (source() ?? []).map((n) => n.midi);
  return { st, source, midis };
}

describe('the generator as a lane note source', () => {
  it('produces notes for the lane instead of undefined', () => {
    expect(harness().source()).toHaveLength(4);
  });

  it('moves the head from one iteration to the next', () => {
    // A cache keyed on everything BUT the start would freeze the pattern on its
    // first bar, which is the failure that would look most like working.
    const { st, midis } = harness();
    st.grid = { repeats: 2, div: 4, pow2: 0 };
    const first = midis();
    st.start = 4;
    expect(midis()).not.toEqual(first);
  });

  it('answers the same iteration identically when nothing has moved', () => {
    const { source } = harness();
    expect(source()).toBe(source());
  });

  it('hears a grid changed mid-flight on the next iteration', () => {
    const { st, midis } = harness({ steps: () => 8 });
    const tight = midis();
    st.grid = { repeats: 2, div: 4, pow2: 0 };
    expect(midis()).not.toEqual(tight);
  });

  it('re-reads the pool when the material is refolded under the same count', () => {
    // The cache cannot describe the pool by its LENGTH. A crossfade arriving at
    // the other loop changes every pitch and keeps the count, and a lane that
    // kept playing the material from before is the quietest failure there is.
    const { st, midis } = harness();
    expect(midis()[0]).toBe(60);
    st.material = bar(72, 74, 76);
    expect(midis()[0]).toBe(72);
  });

  it('falls silent on material that resolved to nothing', () => {
    const { st, source } = harness();
    st.material = [];
    expect(source()).toEqual([]);
  });
});
