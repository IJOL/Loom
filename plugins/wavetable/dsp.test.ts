// plugins/wavetable/dsp.test.ts
// Behaviour of the Wavetable plugin's renderer. These assertions used to live in
// src/audio-dsp/wavetable-renderer.test.ts, against the in-tree engine; the
// shipped plugin is the only Wavetable there is, so the coverage moved with it.
import { describe, it, expect, vi } from 'vitest';

// `dsp.ts` calls Loom.registerRenderer at module scope — that is the ABI — so
// the global must exist before the import graph is evaluated. vi.hoisted is the
// only hook that runs that early. Same two-line stub the parity test next door
// installs, for the same reason.
vi.hoisted(() => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    apiVersion: 1, registerRenderer: () => {},
  };
});

import { attachSlots } from '../../test/slot-offsets';
import { WavetableRenderer } from './dsp';
import { getWaveTables } from './wavetable-data';
import type { NoteSpec, ParamBag } from '@loom/plugin-sdk';

const SR = 48000;

const P: ParamBag = {
  'osc.waveA': 0,
  'osc.waveB': 1,
  'osc.morph': 0,
  'osc.detune': 0,
  'filter.cutoff': 0.7,
  'filter.resonance': 0.2,
  'amp.attack': 0.01,
  'amp.decay': 0.3,
  'amp.sustain': 0.7,
  'amp.release': 0.3,
  'amp.builtinEnv': 1,
};

const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 57,
  beginSec: 0,
  durationSec: 0.4,
  velocity: 0.8,
  accent: false,
  slide: false,
  ...o,
});

const rms = (b: number[]): number =>
  Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('wavetable data', () => {
  it('provides at least 2 non-empty single-cycle tables', () => {
    const t = getWaveTables();
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0].length).toBeGreaterThan(256);
    expect(Math.max(...t[0])).toBeGreaterThan(0);
  });

  it('returns 8 tables matching the legacy WAVETABLES order', () => {
    const t = getWaveTables();
    // Sine, Triangle, Sawtooth, Square, PWM25%, Organ, Brass, Vocal
    expect(t.length).toBe(8);
    // All tables have the same length (N=2048) and non-trivial amplitude
    for (const tbl of t) {
      expect(tbl.length).toBe(2048);
      const pk = Math.max(...tbl);
      expect(pk).toBeGreaterThan(0.5); // peak-normalised should be near 1
    }
  });

  it('different tables have different content', () => {
    const t = getWaveTables();
    // Sine vs Sawtooth should differ substantially
    let diff = 0;
    for (let i = 0; i < t[0].length; i++) diff += Math.abs(t[0][i] - t[2][i]);
    expect(diff).toBeGreaterThan(10); // large cumulative difference
  });
});

describe('WavetableRenderer', () => {
  it('is audible during the gate and done after release', () => {
    const v = new WavetableRenderer(note(), P, SR);
    const g: number[] = [];
    for (let i = 0; i < SR * 0.3; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);

    // Advance through note-off + release tail
    let last = 1;
    for (let i = SR * 0.4; i < SR * 1.0; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01);
    expect(v.done).toBe(true);
  });

  it('morph between two tables changes the timbre (output differs)', () => {
    const sig = (m: number): number[] => {
      const v = new WavetableRenderer(note(), { ...P, 'osc.morph': m }, SR);
      const b: number[] = [];
      for (let i = 0; i < 512; i++) b.push(v.renderSample(i / SR));
      return b;
    };
    const a = sig(0);
    const b = sig(1);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0.1);
  });

  it('noteOff triggers release early', () => {
    // Voice with a very long gate; call noteOff early to trigger release
    const longNote = note({ durationSec: 10 });
    const v = new WavetableRenderer(longNote, P, SR);
    // Render for 0.3s (during gate)
    const g: number[] = [];
    for (let i = 0; i < SR * 0.3; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);

    // Trigger noteOff at 0.3s — this shortens holdEnd to 0.3
    v.noteOff(0.3);
    // Render through release tail
    let last = 1;
    for (let i = SR * 0.3; i < SR * 1.5; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.01);
    expect(v.done).toBe(true);
  });

  it('higher cutoff produces more energy than low cutoff (lowpass effect)', () => {
    const e = (cutoff: number): number => {
      const v = new WavetableRenderer(
        note({ midi: 57 }),
        { ...P, 'osc.waveA': 3, 'osc.waveB': 3, 'filter.cutoff': cutoff },
        SR,
      );
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    // High cutoff (open filter) passes more than very low cutoff (closed)
    expect(e(0.9)).toBeGreaterThan(e(0.1) * 1.5);
  });

  it('velocity scales output proportionally', () => {
    const e = (vel: number): number => {
      const v = new WavetableRenderer(note({ velocity: vel }), P, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(e(0.9)).toBeGreaterThan(e(0.3));
  });

  it('with builtinEnv=0, voice sets done===true at gate-off (no immortal voice)', () => {
    // No amplitude envelope: voice must set done===true shortly after holdEnd.
    // The voice manager stops calling renderSample once done===true, so the
    // silence guarantee comes from the manager — not from the renderer zeroing out.
    // This test verifies done is set, which is the termination contract.
    const noEnvP: ParamBag = { ...P, 'amp.builtinEnv': 0 };
    const shortNote = note({ durationSec: 0.1 });
    const v = new WavetableRenderer(shortNote, noEnvP, SR);
    // Render past holdEnd (0.1 s) — render to 0.5 s to be safely past gate-off
    for (let i = 0; i < Math.floor(SR * 0.5); i++) {
      v.renderSample(i / SR);
    }
    // Voice must be marked done — the voice manager will stop rendering it
    expect(v.done).toBe(true);
    // Verify done was set close to holdEnd (within 1 ms), not much later
    const v2 = new WavetableRenderer(shortNote, noEnvP, SR);
    let doneTime = -1;
    for (let i = 0; i < Math.floor(SR * 0.5); i++) {
      v2.renderSample(i / SR);
      if (v2.done && doneTime < 0) doneTime = i / SR;
    }
    // done must be set within 1 sample after holdEnd (0.1 s)
    expect(doneTime).toBeGreaterThan(0.09);
    expect(doneTime).toBeLessThan(0.11 + 1 / SR);
  });

  it('honours a live cutoff modulation offset (LFO path, keyed by param dot-id)', () => {
    const bright = (cutMod: number): number => {
      const v = new WavetableRenderer(
        note(), { ...P, 'osc.waveA': 3, 'osc.waveB': 3, 'filter.cutoff': 0.15, 'filter.resonance': 0 }, SR,
      );
      const { mo } = attachSlots(v, { ...P, 'osc.waveA': 3, 'osc.waveB': 3, 'filter.cutoff': 0.15, 'filter.resonance': 0 });
      const off = mo({ 'filter.cutoff': cutMod });
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR, off));
      return rms(b);
    };
    expect(bright(0.8)).toBeGreaterThan(bright(0) * 1.3);
  });

  it('a per-voice ADSR routed to filter.cutoff opens the filter (modulation reaches the engine)', () => {
    const adsr = {
      id: 'a', kind: 'adsr' as const, enabled: true, rateHz: 0, waveform: 'sine' as const,
      attackSec: 0.001, decaySec: 0.001, sustain: 1, releaseSec: 0.1, depthByParam: { 'filter.cutoff': 1 },
    };
    const bright = (withAdsr: boolean): number => {
      const v = new WavetableRenderer(
        note(), { ...P, 'osc.waveA': 3, 'osc.waveB': 3, 'filter.cutoff': 0.15, 'filter.resonance': 0 }, SR,
      );
      if (withAdsr) {
        v.setModEnvelopes([adsr], attachSlots(v, { ...P, 'osc.waveA': 3, 'osc.waveB': 3, 'filter.cutoff': 0.15, 'filter.resonance': 0 }).index);
      }
      const b: number[] = [];
      for (let i = 0; i < SR * 0.1; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(bright(true)).toBeGreaterThan(bright(false) * 1.3);
  });

  it('getAdsrOffsets exposes the per-voice ADSR contribution (the knob-ring source)', () => {
    const v = new WavetableRenderer(note({ durationSec: 10 }), P, SR);
    const { index } = attachSlots(v, P);
    // A ModEnvSpec, not a ModLite: the in-tree renderer took the whole modulator
    // state and read five of its fields, the plugin takes only the envelope
    // slice the SDK publishes. id/kind/enabled/rateHz/waveform were never read
    // here, so dropping them changes nothing this test measures.
    v.setModEnvelopes([{
      attackSec: 0.001, decaySec: 0.001, sustain: 0.5, releaseSec: 0.1, depthByParam: { 'filter.cutoff': 1 },
    }], index);
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    expect(v.getAdsrOffsets()[index.slot['filter.cutoff']]).toBeCloseTo(0.5, 1);
  });

  // The "registers under engine id wavetable" case that used to close this file
  // is gone: it asserted a side effect on the HOST registry, which a plugin's
  // dsp.ts no longer touches — it calls Loom.registerRenderer instead, and
  // wavetable-parity.dsp.test.ts asserts exactly that, at the right door.
});

describe('spectral warp', () => {
  // The tables are BORN as Fourier specs (real/imag per harmonic), so the warp
  // operates in that native domain and resynthesises. Filter wide open and no
  // envelope, so what the assertions measure is the table itself.
  const CLEAN: ParamBag = {
    ...P, 'osc.waveA': 2, 'osc.waveB': 2, 'osc.morph': 0, 'osc.detune': 0,
    'filter.cutoff': 1, 'filter.resonance': 0, 'amp.builtinEnv': 0,
  };
  const render = (bag: ParamBag): number[] => {
    const v = new WavetableRenderer(note({ durationSec: 0.5 }), bag, SR);
    const out: number[] = [];
    for (let i = 0; i < SR * 0.25; i++) out.push(v.renderSample(i / SR));
    return out;
  };
  const mag = (xs: number[], freqHz: number): number => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * freqHz) / SR;
    for (let i = 0; i < xs.length; i++) {
      re += xs[i] * Math.cos(w * i);
      im += xs[i] * Math.sin(w * i);
    }
    return Math.hypot(re, im);
  };
  // Mode indices pinned by the manifest options: 0=Stretch 1=Smear 2=Low-pass 3=Random.
  const STRETCH = 0;
  const LOWPASS = 2;
  const RANDOM = 3;

  it('spectral low-pass strips the top of a saw and leaves the fundamental', () => {
    const plain = render({ ...CLEAN, 'osc.spectral': LOWPASS, 'osc.spectralAmt': 0 });
    const dark = render({ ...CLEAN, 'osc.spectral': LOWPASS, 'osc.spectralAmt': 1 });
    expect(mag(dark, 220 * 12)).toBeLessThan(mag(plain, 220 * 12) / 5);
    expect(mag(dark, 220)).toBeGreaterThan(mag(plain, 220) / 3);
  });

  it('harmonic stretch leaves gaps where the stretched grid skips a harmonic', () => {
    // amt 0.5 → factor 1.5: source harmonics land on 2, 3, 5, 6… so the saw's
    // 4th (880 Hz) falls in a GAP while the 3rd (660) inherits the strong
    // source h2. Full amt would be a plain octave shift — a saw is
    // self-similar under that, which is exactly the case this dodges.
    const plain = render({ ...CLEAN, 'osc.spectral': STRETCH, 'osc.spectralAmt': 0 });
    const wide = render({ ...CLEAN, 'osc.spectral': STRETCH, 'osc.spectralAmt': 0.5 });
    expect(mag(wide, 880)).toBeLessThan(mag(plain, 880) / 3);
    expect(mag(wide, 660)).toBeGreaterThan(mag(plain, 660) * 0.5);
  });

  it('a patch that never mentions the warp is bit-identical to amount 0', () => {
    // P carries no spectral params — the silent defaults must leave the tables
    // untouched, or every saved Wavetable patch (and the pinned parity render)
    // changes sound on load.
    const a = render(CLEAN);
    const b = render({ ...CLEAN, 'osc.spectral': STRETCH, 'osc.spectralAmt': 0 });
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });

  it('random amplitudes is deterministic — the same patch renders the same twice', () => {
    // The offline export renders in a different order from the live path; a
    // Math.random in the warp would make an export sound different from what
    // was heard. Seeded by (harmonic, wave) on purpose.
    const bag = { ...CLEAN, 'osc.spectral': RANDOM, 'osc.spectralAmt': 0.8 };
    const a = render(bag);
    const b = render(bag);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    expect(d).toBe(0);
  });
});
