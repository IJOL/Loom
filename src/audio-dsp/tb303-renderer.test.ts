// src/audio-dsp/tb303-renderer.test.ts
// Tests for the TB-303 per-sample renderer. Uses REAL engine param dot-ids from
// src/engines/tb303.ts: 'filter.cutoff', 'filter.resonance', 'env.amount',
// 'env.decay', 'env.accent', 'osc.wave'. Engine id = 'tb303'.
import { describe, it, expect } from 'vitest';
import { TB303Renderer } from './tb303-renderer';
import { createRenderer } from './renderer-registry';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;

// Default params using the REAL dot-ids from TB303Engine.PARAMS
const P: ParamBag = {
  'filter.cutoff':    0.3,
  'filter.resonance': 0.8,
  'env.amount':       0.6,
  'env.decay':        0.4,
  'env.accent':       0.6,
  'osc.wave':         0,   // 0 = saw
};

const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 45,
  beginSec: 0,
  durationSec: 0.2,
  velocity: 0.8,
  accent: false,
  slide: false,
  ...o,
});

const rms = (b: number[]) =>
  Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('TB303Renderer', () => {
  it('is audible during the note gate', () => {
    const v = new TB303Renderer(note(), P, SR);
    const g: number[] = [];
    for (let i = 0; i < SR * 0.15; i++) g.push(v.renderSample(i / SR));
    expect(rms(g)).toBeGreaterThan(0.01);
  });

  it('decays to silence and done===true after the release tail', () => {
    const v = new TB303Renderer(note(), P, SR);
    // Run past the full gate + release tail
    let last = 1;
    for (let i = 0; i < SR * 0.8; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);
    expect(v.done).toBe(true);
  });

  it('accent makes the note louder/brighter than non-accent', () => {
    const measure = (acc: boolean) => {
      const v = new TB303Renderer(note({ accent: acc }), P, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    expect(measure(true)).toBeGreaterThan(measure(false) * 1.1);
  });

  it('square wave has different timbre than saw wave', () => {
    const measure = (wave: number) => {
      const v = new TB303Renderer(note(), { ...P, 'osc.wave': wave }, SR);
      const b: number[] = [];
      for (let i = 0; i < SR * 0.05; i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    const sawRms = measure(0);
    const sqrRms = measure(1);
    // Both should be audible; square vs saw are different timbres
    expect(sawRms).toBeGreaterThan(0.01);
    expect(sqrRms).toBeGreaterThan(0.01);
    // Their RMS should differ (different waveform content through the filter)
    expect(Math.abs(sawRms - sqrRms) / sawRms).toBeGreaterThan(0.05);
  });

  it('slide flag: gate is held at peakAmp (no attack ramp from silence)', () => {
    // Sliding note: amp is held at peakAmp from note begin, not ramped from 0.
    // The filter needs a few samples to charge, so we compare RMS of first 5ms
    // vs non-slide to verify the slide path holds amplitude sooner.
    const measureEarlyRms = (slide: boolean) => {
      const v = new TB303Renderer(note({ slide }), P, SR);
      const early: number[] = [];
      // 5ms of audio — filter charges and amp is either held (slide) or ramping (non-slide)
      for (let i = 0; i < Math.floor(SR * 0.005); i++) {
        early.push(v.renderSample(i / SR));
      }
      return rms(early);
    };
    // Both produce audio; slide should have higher RMS early on (no 3ms ramp from 0)
    const slideRms = measureEarlyRms(true);
    const nonSlideRms = measureEarlyRms(false);
    expect(slideRms).toBeGreaterThan(0.001);
    expect(slideRms).toBeGreaterThanOrEqual(nonSlideRms);
  });

  it('noteOff shortens the gate (done earlier than full durationSec)', () => {
    const longNote = note({ durationSec: 2.0 });
    const v = new TB303Renderer(longNote, P, SR);
    // Trigger noteOff early at 0.05s
    v.noteOff(0.05);
    // Run to 0.5s — should be done well before the 2s full duration
    let isDone = false;
    for (let i = 0; i < SR * 0.5; i++) {
      v.renderSample(i / SR);
      if (v.done) { isDone = true; break; }
    }
    expect(isDone).toBe(true);
  });

  it('env.amount affects filter brightness (more amount = different timbre)', () => {
    // Higher env.amount opens the filter wider at note start.
    // Use a high-pitched note so the resonance peak difference is audible.
    const hiNote = note({ midi: 69 }); // A4 = 440 Hz
    const measure = (envAmt: number) => {
      // Low resonance so resonance peak doesn't dominate the comparison
      const pLowRes = { ...P, 'filter.resonance': 0.1, 'env.amount': envAmt };
      const v = new TB303Renderer(hiNote, pLowRes, SR);
      const b: number[] = [];
      for (let i = 0; i < Math.floor(SR * 0.01); i++) b.push(v.renderSample(i / SR));
      return rms(b);
    };
    // No env (closed filter) vs full env (fully open): open filter passes more signal
    expect(measure(0.9)).toBeGreaterThan(measure(0.0) * 1.05);
  });

  it('registers under engine id "tb303" via the renderer registry', () => {
    // The import of tb303-renderer triggers the self-registration side-effect.
    // We verify the registry has the engine by constructing through createRenderer.
    const r = createRenderer('tb303', note(), P, SR);
    expect(r).toBeDefined();
    expect(typeof r.renderSample).toBe('function');
  });
});
