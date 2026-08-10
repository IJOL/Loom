import { describe, it, expect } from 'vitest';
import { macroParamWrites, type MacroParamContext } from './macro-params';
import { WEAVE_MACROS } from './weave-catalog';

const neutral = () => Object.fromEntries(WEAVE_MACROS.map((m) => [m.id, m.neutral]));
const ctx: MacroParamContext = {
  sendA: 'fx.send.A.level',
  sendB: 'fx.send.B.level',
  lfoDepthIds: ['lane-1.mod.lfo1.depth', 'lane-2.mod.lfo1.depth'],
};

describe('param macros', () => {
  it('writes nothing when every macro sits at its neutral', () => {
    // The negative control: neutral means the scene is untouched, and that has
    // to be true of the params as well as of the notes.
    expect(macroParamWrites(neutral(), ctx).size).toBe(0);
  });

  it('drives both sends from space', () => {
    const w = macroParamWrites({ ...neutral(), space: 0.8 }, ctx);
    expect(w.get('fx.send.A.level')).toBeGreaterThan(0);
    expect(w.get('fx.send.B.level')).toBeGreaterThan(0);
  });

  it('sends the second bus less than the first, so the two do not read as one', () => {
    const w = macroParamWrites({ ...neutral(), space: 0.8 }, ctx);
    expect(w.get('fx.send.B.level')!).toBeLessThan(w.get('fx.send.A.level')!);
  });

  it('drives every declared lfo depth from motion', () => {
    const w = macroParamWrites({ ...neutral(), motion: 0.6 }, ctx);
    expect(w.get('lane-1.mod.lfo1.depth')).toBeGreaterThan(0);
    expect(w.get('lane-2.mod.lfo1.depth')).toBeGreaterThan(0);
  });

  it('leaves the sends alone when only motion moved', () => {
    const w = macroParamWrites({ ...neutral(), motion: 0.6 }, ctx);
    expect(w.has('fx.send.A.level')).toBe(false);
  });

  it('leaves the lfos alone when only space moved', () => {
    const w = macroParamWrites({ ...neutral(), space: 0.6 }, ctx);
    expect(w.has('lane-1.mod.lfo1.depth')).toBe(false);
  });

  it('writes no send when the session declares none', () => {
    const w = macroParamWrites({ ...neutral(), space: 1 }, { lfoDepthIds: [] });
    expect(w.size).toBe(0);
  });

  it('writes no lfo depth when the session exposes none', () => {
    const w = macroParamWrites({ ...neutral(), motion: 1 }, { lfoDepthIds: [] });
    expect(w.size).toBe(0);
  });

  it('keeps every value inside 0..1', () => {
    for (const v of [0, 0.5, 1]) {
      const w = macroParamWrites({ ...neutral(), space: v, motion: v }, ctx);
      for (const val of w.values()) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rises monotonically with the macro', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const w = macroParamWrites({ ...neutral(), space: i / 10 }, ctx);
      const v = w.get('fx.send.A.level') ?? 0;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('survives a macro bag missing a key, rather than writing NaN', () => {
    // A save from an older version has no `motion` at all.
    const w = macroParamWrites({ space: 0.5 }, ctx);
    for (const val of w.values()) expect(Number.isFinite(val)).toBe(true);
  });
});

describe('Space is tapered, not linear', () => {
  it('gives less than half the send at half the knob', () => {
    // A send is a level, and moved linearly it puts almost all of its audible
    // range in the first quarter of the travel — one useful position and a lot
    // of dead knob. Reported as the macro being unusable rather than strong.
    const half = macroParamWrites({ space: 0.5 }, { sendA: 'a', lfoDepthIds: [] });
    expect(half.get('a')!).toBeLessThan(0.5 * 0.5 + 1e-9);
    expect(half.get('a')!).toBeGreaterThan(0);
  });

  it('still reaches the top', () => {
    // Taper, not a ceiling: the loud end has to stay reachable or the control
    // has simply been made quieter.
    const full = macroParamWrites({ space: 1 }, { sendA: 'a', lfoDepthIds: [] });
    expect(full.get('a')).toBe(1);
  });

  it('keeps the second bus below the first at every position', () => {
    for (const v of [0.25, 0.5, 0.75, 1]) {
      const w = macroParamWrites({ space: v }, { sendA: 'a', sendB: 'b', lfoDepthIds: [] });
      expect(w.get('b')!).toBeLessThan(w.get('a')!);
    }
  });
});
