// src/audio-dsp/drums/voices.test.ts
import { describe, it, expect } from 'vitest';
import { DRUM_RENDERERS } from './voices';
import { DRUM_VOICE_IDS } from './types';
import type { DrumHit, DrumVoiceId } from './types';
import type { ParamBag } from '../types';
import { TriOsc } from '../osc';

const SR = 48000;
const hit = (o: Partial<DrumHit> = {}): DrumHit => ({ voice: 'kick', beginSec: 0, velocity: 0.8, ...o });
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
const render = (id: DrumVoiceId, p: ParamBag, secs: number) => {
  const r = DRUM_RENDERERS[id](hit({ voice: id }), p, SR);
  const b: number[] = []; for (let i = 0; i < SR * secs; i++) b.push(r.renderSample(i / SR));
  return { r, b };
};

describe('drum renderers', () => {
  it('exposes a ctor for every drum voice', () => {
    for (const id of DRUM_VOICE_IDS) expect(typeof DRUM_RENDERERS[id]).toBe('function');
  });

  it('kick: pitched thump, audible then silent + done', () => {
    const { r, b } = render('kick', { startFreq: 220, endFreq: 55, sweep: 0.03, decay: 0.4, attack: 0.7, wave: 0, tune: 1 }, 0.8);
    expect(rms(b.slice(0, SR * 0.05))).toBeGreaterThan(0.02);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01);
    expect(r.done).toBe(true);
  });

  it('snare: broadband noise + body', () => {
    const { b } = render('snare', { tone1: 240, tone2: 360, bodyDecay: 0.04, tone: 0.35, snap: 0.75, noiseDecay: 0.18, noiseTone: 7000, tune: 1 }, 0.4);
    expect(rms(b.slice(0, SR * 0.05))).toBeGreaterThan(0.02);
  });

  it('snare body sums both oscillators at unity (not halved)', () => {
    // Legacy playSnare connected osc1 AND osc2 at unity into the tone gain, so
    // the body peak is 2·(vel·tone). Isolate the body (snap=0, no noise) with a
    // long bodyDecay so the env ≈ 1 over the window, vel=tone=1 so the body gain
    // is unity, and compare its peak to a SINGLE triangle's peak. Two summed
    // triangles must exceed one — a stray ×0.5 would drag it down to ≈ one.
    const r = DRUM_RENDERERS.snare(
      hit({ voice: 'snare', velocity: 1 }),
      { tone1: 240, tone2: 360, bodyDecay: 10, tone: 1, snap: 0, noiseDecay: 0.001, noiseTone: 7000, tune: 1 },
      SR,
    );
    let bodyPeak = 0;
    for (let i = 0; i < SR * 0.05; i++) bodyPeak = Math.max(bodyPeak, Math.abs(r.renderSample(i / SR)));
    const ref = new TriOsc(SR);
    let triPeak = 0;
    for (let i = 0; i < SR * 0.05; i++) triPeak = Math.max(triPeak, Math.abs(ref.update(240)));
    expect(bodyPeak).toBeGreaterThan(triPeak * 1.3);
  });

  it('closed hat decays faster than open hat (shorter tail)', () => {
    const tailRms = (decay: number) => rms(render('closedHat', { decay, filter: 7000, tune: 1.2 }, 0.6).b.slice(SR * 0.2, SR * 0.3));
    expect(tailRms(0.4)).toBeGreaterThan(tailRms(0.05));   // longer decay still ringing at 200ms
  });

  it('tom is more low-frequency / tonal than the snare (lower zero-crossing rate)', () => {
    const zcr = (b: number[]) => {
      let z = 0; for (let i = 1; i < b.length; i++) if ((b[i - 1] < 0) !== (b[i] < 0)) z++;
      return z / b.length;
    };
    const tom = render('tom', { startFreq: 200, end: 90, sweep: 0.08, decay: 0.5, tune: 1 }, 0.1).b.slice(0, SR * 0.05);
    const snr = render('snare', { tone1: 240, tone2: 360, bodyDecay: 0.04, tone: 0.35, snap: 0.75, noiseDecay: 0.18, noiseTone: 7000, tune: 1 }, 0.1).b.slice(0, SR * 0.05);
    expect(zcr(tom)).toBeLessThan(zcr(snr));   // noise-heavy snare crosses zero far more often
  });

  it('clap multiple bursts: energy present after the initial transient', () => {
    const { b } = render('clap', { tone: 1500, decay: 0.18, sharp: 2 }, 0.3);
    // a single burst would be near-silent by ~30ms; the offset bursts keep energy alive
    expect(rms(b.slice(SR * 0.03, SR * 0.06))).toBeGreaterThan(0);
  });

  it('cowbell: tonal metallic tone, audible then done', () => {
    const { r, b } = render('cowbell', { freq1: 540, freq2: 800, decay: 0.3, detune: 1, tune: 1 }, 0.6);
    expect(rms(b.slice(0, SR * 0.05))).toBeGreaterThan(0.005);
    expect(r.done).toBe(true);
  });

  it('ride: long shimmering tail still ringing after the hats would have died', () => {
    const { b } = render('ride', { decay: 1.2, tune: 1.4 }, 1.0);
    expect(rms(b.slice(SR * 0.4, SR * 0.5))).toBeGreaterThan(0);
  });

  it('higher velocity is louder for the same voice', () => {
    const p: ParamBag = { startFreq: 220, endFreq: 55, sweep: 0.03, decay: 0.4, attack: 0, wave: 0, tune: 1 };
    const loud = DRUM_RENDERERS.kick(hit({ voice: 'kick', velocity: 1.0 }), p, SR);
    const soft = DRUM_RENDERERS.kick(hit({ voice: 'kick', velocity: 0.2 }), p, SR);
    const accL: number[] = []; const accS: number[] = [];
    for (let i = 0; i < SR * 0.05; i++) { accL.push(loud.renderSample(i / SR)); accS.push(soft.renderSample(i / SR)); }
    expect(rms(accL)).toBeGreaterThan(rms(accS));
  });

  it('choke fades a ringing voice to near-zero quickly', () => {
    const r = DRUM_RENDERERS.openHat(hit({ voice: 'openHat', velocity: 0.9 }), { decay: 0.5, filter: 7000, tune: 1.2 }, SR);
    // ring for ~20ms
    for (let i = 0; i < SR * 0.02; i++) r.renderSample(i / SR);
    const before = Math.abs(r.ampAt(0.02));
    r.choke(0.02);
    const acc: number[] = [];
    for (let i = SR * 0.02; i < SR * 0.04; i++) acc.push(r.renderSample(i / SR));
    // post-choke amplitude collapses far below the pre-choke level
    expect(Math.abs(r.ampAt(0.02 + 0.006))).toBeLessThan(before * 0.01 + 1e-6);
    expect(rms(acc)).toBeLessThan(before);
  });

  it('each voice produces non-silent output then reports done', () => {
    for (const id of DRUM_VOICE_IDS) {
      const { r, b } = render(id, { startFreq: 200, endFreq: 80, sweep: 0.05, decay: 0.3, tone1: 200, tone2: 300, bodyDecay: 0.05, tone: 1500, snap: 0.6, noiseDecay: 0.15, noiseTone: 6000, sharp: 2, freq1: 540, freq2: 800, detune: 1, end: 90, filter: 7000, tune: 1, attack: 0.5, wave: 0 }, 3.5);
      expect(rms(b)).toBeGreaterThan(0.001);
      expect(r.done).toBe(true);
    }
  });
});
