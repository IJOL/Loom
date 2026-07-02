import { describe, it, expect } from 'vitest';
import { KarplusRenderer } from './karplus-renderer';
import { createRenderer } from './renderer-registry';
import type { NoteSpec, ParamBag } from './types';

const SR = 48000;
const P: ParamBag = {
  'string.damping': 0.4,
  'string.brightness': 0.7,
  'excite.time': 0.01,
  'excite.tone': 0.5,
  'amp.attack': 0.005,
  'amp.release': 0.5,
  'amp.level': 0.8,
  'amp.builtinEnv': 1,
};
const note = (o: Partial<NoteSpec> = {}): NoteSpec => ({
  midi: 60,
  beginSec: 0,
  durationSec: 0.5,
  velocity: 0.8,
  accent: false,
  slide: false,
  ...o,
});
const rms = (b: number[]) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('KarplusRenderer', () => {
  it('produces a decaying plucked tone (audible then quieter)', () => {
    const v = new KarplusRenderer(note({ durationSec: 1 }), P, SR);
    const early: number[] = [];
    for (let i = 0; i < SR * 0.05; i++) early.push(v.renderSample(i / SR));
    const late: number[] = [];
    for (let i = SR * 0.7; i < SR * 0.75; i++) late.push(v.renderSample(i / SR));
    expect(rms(early)).toBeGreaterThan(rms(late));   // string decays
    expect(rms(early)).toBeGreaterThan(0.01);
  });

  it('a brighter string has more high-frequency energy than a dark one', () => {
    // The excitation is a random noise burst, so a single render's energy varies
    // ~15% — average several so the bright-vs-dark comparison reflects brightness,
    // not the noise seed (this assertion used to flake by a hair).
    const e = (b: number) => {
      let acc = 0;
      for (let k = 0; k < 8; k++) {
        const v = new KarplusRenderer(note(), { ...P, 'string.brightness': b }, SR);
        const buf: number[] = [];
        for (let i = 0; i < SR * 0.05; i++) buf.push(v.renderSample(i / SR));
        acc += rms(buf);
      }
      return acc / 8;
    };
    // Bright string must genuinely exceed dark string (averaged over the noise).
    expect(e(0.95)).toBeGreaterThan(e(0.1));
  });

  it('decays to silence and done===true after the release tail', () => {
    // durationSec=0.1, release=0.1s → need exp(-(t-0.1)/0.1)<0.001 → t≈0.79s
    // Render to 1.2s to be safely past the threshold.
    const v = new KarplusRenderer(
      note({ durationSec: 0.1 }),
      { ...P, 'amp.release': 0.1 },
      SR,
    );
    let last = 1;
    for (let i = 0; i < SR * 1.2; i++) last = v.renderSample(i / SR);
    expect(Math.abs(last)).toBeLessThan(0.005);
    expect(v.done).toBe(true);
  });

  it('noteOff shortens the gate and triggers early release', () => {
    // durationSec=2 but noteOff at 0.05s, release=0.5s → done at ~0.05+0.5*ln(1000)≈3.5s
    // Use a short release so done is reached within the render window.
    const shortRel = { ...P, 'amp.release': 0.05 };
    const v = new KarplusRenderer(note({ durationSec: 2 }), shortRel, SR);
    // Render a bit, then call noteOff
    for (let i = 0; i < SR * 0.05; i++) v.renderSample(i / SR);
    v.noteOff(0.05);
    // With rel=0.05s → done at ~0.05+0.05*ln(1000)≈0.395s; render to 0.6s
    let last = 1;
    for (let i = SR * 0.05; i < SR * 0.6; i++) last = v.renderSample(i / SR);
    expect(v.done).toBe(true);
  });

  it('registers under engine id "karplus"', () => {
    // Importing KarplusRenderer above triggers its registerRenderer side-effect.
    expect(() => createRenderer('karplus', note(), P, SR)).not.toThrow();
  });
});
