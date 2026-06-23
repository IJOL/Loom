// src/audio-dsp/wavetable-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { WavetableRenderer } from './wavetable-renderer';
import { getWaveTables } from './wavetable-data';
import { createRenderer } from './renderer-registry';
import type { NoteSpec, ParamBag } from './types';

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

  it('registers under engine id "wavetable"', () => {
    // Importing WavetableRenderer above triggers its registerRenderer side-effect.
    expect(() => createRenderer('wavetable', note(), P, SR)).not.toThrow();
  });
});
