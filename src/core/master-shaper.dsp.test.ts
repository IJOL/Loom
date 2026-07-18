// The master finishing stage, rendered through a real OfflineAudioContext.
// Every assertion is relative: air DARKENS relative to flat, width ADDS side
// energy relative to none, multiband REDUCES dynamic range relative to bypass.
import { describe, it, expect } from 'vitest';
import '../../test/setup';
import { MasterShaper, MASTER_SHAPER_DEFAULTS } from './master-shaper';
import { spectralCentroid, rms, peak } from '../../test/dsp-asserts';

const SR = 44100;

/** Render a source through a shaper configured by `setup`, in stereo. */
async function render(
  setup: (s: MasterShaper) => void,
  makeSource: (ctx: OfflineAudioContext) => AudioNode,
): Promise<{ L: Float32Array; R: Float32Array }> {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const shaper = new MasterShaper(ctx as unknown as BaseAudioContext);
  setup(shaper);
  makeSource(ctx).connect(shaper.input as unknown as AudioNode);
  (shaper.output as unknown as AudioNode).connect(ctx.destination as unknown as AudioNode);
  const buf = await ctx.startRendering();
  return { L: new Float32Array(buf.getChannelData(0)), R: new Float32Array(buf.getChannelData(1)) };
}

/** A bright sawtooth — plenty of high content for the air shelf to act on. */
const saw = (ctx: OfflineAudioContext) => {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 220;
  o.start();
  return o as unknown as AudioNode;
};

/** Side energy relative to mid — 0 is mono, higher is wider. */
function sideOverMid(L: Float32Array, R: Float32Array): number {
  let d = 0, s = 0;
  for (let i = 0; i < L.length; i++) {
    const dd = L[i] - R[i], ss = L[i] + R[i];
    d += dd * dd; s += ss * ss;
  }
  return Math.sqrt(d) / (Math.sqrt(s) || 1e-12);
}

describe('MasterShaper — air', () => {
  it('a negative air shelf darkens the output', async () => {
    const flat = await render((s) => { s.setAirDb(0); s.setWidth(0); }, saw);
    const dark = await render((s) => { s.setAirDb(-12); s.setWidth(0); }, saw);
    expect(spectralCentroid(dark.L, SR)).toBeLessThan(spectralCentroid(flat.L, SR));
  });

  it('a positive air shelf brightens it — the knob works both ways', async () => {
    const flat = await render((s) => { s.setAirDb(0); s.setWidth(0); }, saw);
    const bright = await render((s) => { s.setAirDb(12); s.setWidth(0); }, saw);
    expect(spectralCentroid(bright.L, SR)).toBeGreaterThan(spectralCentroid(flat.L, SR));
  });
});

describe('MasterShaper — Haas width', () => {
  it('width 0 leaves the signal mono', async () => {
    const { L, R } = await render((s) => { s.setAirDb(0); s.setWidth(0); }, saw);
    expect(sideOverMid(L, R)).toBeLessThan(0.01);
  });

  it('turning width up genuinely widens the image', async () => {
    const narrow = await render((s) => { s.setAirDb(0); s.setWidth(0); }, saw);
    const wide   = await render((s) => { s.setAirDb(0); s.setWidth(1); }, saw);
    expect(sideOverMid(wide.L, wide.R)).toBeGreaterThan(sideOverMid(narrow.L, narrow.R));
  });

  it('the widener only touches highs — a pure bass tone stays mono', async () => {
    // Delaying the low end smears it and breaks mono compatibility, so the
    // width tap is high-passed. A 60 Hz sine must come out untouched.
    const bass = (ctx: OfflineAudioContext) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = 60; o.start();
      return o as unknown as AudioNode;
    };
    const { L, R } = await render((s) => { s.setAirDb(0); s.setWidth(1); }, bass);
    expect(sideOverMid(L, R)).toBeLessThan(0.05);
  });
});

describe('MasterShaper — multiband glue', () => {
  it('engaged, it pulls loud passages toward quiet ones — that is what glue means', async () => {
    // NOT crest factor: with 3–20 ms attacks the compressor deliberately lets
    // transients through while holding down sustained level, which RAISES
    // peak/RMS. Glue is about the level difference between a loud passage and a
    // quiet one, so measure exactly that.
    const loudThenQuiet = (ctx: OfflineAudioContext) => {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = 110;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, 0);
      g.gain.setValueAtTime(0.1, 0.5);   // a hard step down halfway
      o.connect(g); o.start();
      return g as unknown as AudioNode;
    };
    // Both runs go through the band split, so this isolates the compression.
    const idle = await render((s) => {
      s.setAirDb(0); s.setWidth(0); s.setMultibandAmount(0); s.setMultibandOn(true);
    }, loudThenQuiet);
    const glued = await render((s) => {
      s.setAirDb(0); s.setWidth(0); s.setMultibandAmount(1); s.setMultibandOn(true);
    }, loudThenQuiet);
    // Sample well inside each half to skip the compressor's attack/release ramp.
    const loudRms  = (b: Float32Array) => rms(b.subarray(Math.floor(SR * 0.30), Math.floor(SR * 0.45)));
    const quietRms = (b: Float32Array) => rms(b.subarray(Math.floor(SR * 0.80), Math.floor(SR * 0.95)));
    const range = (b: Float32Array) => loudRms(b) / (quietRms(b) || 1e-12);
    expect(range(glued.L)).toBeLessThan(range(idle.L));
  });

  it('the crossover reconstructs: idle glue is close to bypassed', async () => {
    // Subtraction-built bands sum back to the input, so engaging an idle
    // multiband must not audibly change the signal. Comb-filtering crossovers
    // would fail this.
    const off  = await render((s) => { s.setAirDb(0); s.setWidth(0); s.setMultibandOn(false); }, saw);
    const idle = await render((s) => {
      s.setAirDb(0); s.setWidth(0); s.setMultibandAmount(0); s.setMultibandOn(true);
    }, saw);
    expect(rms(idle.L)).toBeGreaterThan(rms(off.L) * 0.8);
    expect(rms(idle.L)).toBeLessThan(rms(off.L) * 1.2);
  });

  it('bypassed, it is not in the signal path', async () => {
    const off = await render((s) => { s.setAirDb(0); s.setWidth(0); s.setMultibandOn(false); }, saw);
    expect(rms(off.L)).toBeGreaterThan(0);
  });
});

describe('MasterShaper — state', () => {
  it('round-trips through getState/setState', async () => {
    const ctx = new OfflineAudioContext(2, 128, SR);
    const s = new MasterShaper(ctx as unknown as BaseAudioContext);
    s.setState({ airDb: -6, width: 0.4, mbOn: true, mbAmount: 0.8 });
    expect(s.getState()).toEqual({ airDb: -6, width: 0.4, mbOn: true, mbAmount: 0.8 });
  });

  it('a partial state keeps the defaults for what it omits', async () => {
    const ctx = new OfflineAudioContext(2, 128, SR);
    const s = new MasterShaper(ctx as unknown as BaseAudioContext);
    s.setState({ width: 0.5 });
    expect(s.getState().airDb).toBe(MASTER_SHAPER_DEFAULTS.airDb);
    expect(s.getState().width).toBe(0.5);
  });
});
