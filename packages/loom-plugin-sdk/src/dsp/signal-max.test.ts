// The whole primitive is one identity, so the tests are the identity: for every
// pair of constants, out === the larger one. Constants rather than renders,
// because that is what makes it possible to state the claim exactly instead of
// as a ratio — this is arithmetic, not a filter, and a filter's "relative
// assertions only" rule would weaken it here rather than strengthen it.
import { describe, it, expect } from 'vitest';
import { createSignalMax } from './signal-max';

const SR = 44100;

/** Render max(x, y) for two constant signals and return the settled sample. */
async function maxOf(x: number, y: number, headroom = 4): Promise<number> {
  const ctx = new OfflineAudioContext(1, 2048, SR);
  const m = createSignalMax(ctx as unknown as AudioContext, headroom);
  const cx = ctx.createConstantSource(); cx.offset.value = x;
  const cy = ctx.createConstantSource(); cy.offset.value = y;
  cx.connect(m.a);
  cy.connect(m.b);
  m.output.connect(ctx.destination);
  cx.start(); cy.start();
  const d = (await ctx.startRendering()).getChannelData(0);
  return d[d.length - 1];
}

describe('signal max', () => {
  it('is the larger of the two, whichever side it arrives on', async () => {
    for (const [x, y] of [[0.2, 0.8], [0.8, 0.2], [-0.5, 0.1], [0.1, -0.5], [0, 0]]) {
      expect(await maxOf(x, y), `max(${x}, ${y})`).toBeCloseTo(Math.max(x, y), 4);
    }
  });

  it('equal inputs come back unchanged, not doubled or halved', async () => {
    // The failure mode of getting the 0.5 wrong: (a + b)/2 without the |a - b|
    // term is the MEAN, which agrees with the max exactly when the inputs are
    // equal — so a test that only ever fed equal values would pass on a mean.
    // This case is here to be paired with the one above, never alone.
    expect(await maxOf(0.6, 0.6)).toBeCloseTo(0.6, 4);
  });

  it('is still right when the difference runs past unity — the headroom earns its place', async () => {
    // The shaper's curve is defined over -1..1 and CLAMPS outside it. Without
    // the scaling either side of it, |a - b| would saturate at 1 and the result
    // would be wrong precisely when the two inputs are far apart.
    //
    // `headroom` bounds the DIFFERENCE, not either input — worth stating,
    // because the first version of this test asked for max(3, -3) at the default
    // headroom of 4, a difference of SIX, and read the answer (2 instead of 3)
    // as a bug in the code rather than in the request.
    expect(await maxOf(1.5, -1.5)).toBeCloseTo(1.5, 3);   // difference 3, inside 4
    expect(await maxOf(2, -2)).toBeCloseTo(2, 3);         // difference 4, exactly at it
    // And with the headroom deliberately too small, it IS wrong — so the cases
    // above are measuring the headroom rather than passing regardless of it.
    expect(await maxOf(1.5, -1.5, 1)).not.toBeCloseTo(1.5, 3);
  });

  it('a bigger headroom buys a bigger difference, which is what the knob is for', async () => {
    expect(await maxOf(3, -3, 8)).toBeCloseTo(3, 3);
  });
});
