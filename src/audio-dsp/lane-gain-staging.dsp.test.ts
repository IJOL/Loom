// Lane-level gain staging: per-voice headroom + the lane soft clip.
//
// Measured 2026-09-05 (tools/repro-west-poly.test.ts, a real saved session):
// a westcoast patch at 8 voices summed to raw RMS 1.03 — sustained overload —
// and the MASTER limiter/soft-clip then ground the whole lane into noise. A
// static gain cannot tell one voice from eight, so the lane's output gets two
// stages: POLY_VOICE_HEADROOM moves the operating point down, and laneSoftClip
// is the only stage that treats a pileup differently from a note — identity
// below its knee, a bounded saturation above it, INSIDE the lane.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
import { registerRenderer } from './renderer-registry';
import type { NoteSpec, VoiceRenderer } from './types';
import { POLY_VOICE_HEADROOM, LANE_SOFTCLIP_KNEE, laneSoftClip } from './gain-staging';

const SR = 44100;

// A renderer whose output is a KNOWN constant (the note's velocity), so level
// arithmetic is exact: what comes out of the lane over what went in IS the
// staging under test, with no envelope in the way.
registerRenderer('test-const', (note: NoteSpec) => ({
  renderSample: () => note.velocity,
  noteOff() { /* no gate */ },
} as unknown as VoiceRenderer));

const note = (velocity: number): NoteSpec =>
  ({ midi: 60, beginSec: 0, durationSec: 1, velocity, accent: false, slide: false });

describe('lane gain staging', () => {
  // The one justified absolute comparison here: the assertion IS the constant —
  // it pins the wiring (headroom applied exactly once), not a magic number.
  it('a single quiet voice leaves the lane at voice × headroom, untouched by the clip', () => {
    const vm = new VoiceManager(SR, 'test-const', {}, 1);
    vm.setMaxVoices(8);
    vm.spawn(note(0.4));
    expect(vm.renderSample(0)).toBeCloseTo(0.4 * POLY_VOICE_HEADROOM, 6);
  });

  it('a pileup of hot voices saturates inside the lane instead of leaving over full scale', () => {
    const vm = new VoiceManager(SR, 'test-const', {}, 1);
    vm.setMaxVoices(8);
    for (let i = 0; i < 4; i++) vm.spawn(note(0.9));   // raw sum 3.6
    const out = vm.renderSample(0);
    expect(out).toBeLessThanOrEqual(1.0);
    expect(out).toBeGreaterThan(LANE_SOFTCLIP_KNEE);   // saturated, not muted
  });

  it('laneSoftClip: identity below the knee, continuous at it, bounded and monotonic above', () => {
    expect(laneSoftClip(0.5)).toBe(0.5);
    expect(laneSoftClip(-0.5)).toBe(-0.5);
    const k = LANE_SOFTCLIP_KNEE;
    expect(Math.abs(laneSoftClip(k + 1e-6) - laneSoftClip(k - 1e-6))).toBeLessThan(1e-4);
    expect(laneSoftClip(10)).toBeLessThan(1.0);
    // Monotonic in the WORKING range — at 10 the tanh is float-saturated and a
    // strict compare there tests double precision, not the curve.
    expect(laneSoftClip(1.5)).toBeGreaterThan(laneSoftClip(1.1));
    expect(laneSoftClip(-10)).toBeGreaterThan(-1.0);
  });
});
