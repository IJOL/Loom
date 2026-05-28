import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { TB303 } from './synth';

// Wraps an AudioContext so every AudioParam created (via createConstantSource,
// createOscillator, etc.) records the times it's scheduled at. Lets us assert
// that the amp envelope schedule stays monotonic even for very short notes —
// the 20ms hard-coded margin in trigger() used to slip the release anchor
// before the attack-ramp endpoint when duration < ~20ms.
function recordingContext(ctx: AudioContext): { ctx: AudioContext; scheduled: number[][] } {
  const scheduled: number[][] = [];
  const origCreateCS = ctx.createConstantSource.bind(ctx);
  ctx.createConstantSource = (): ConstantSourceNode => {
    const cs = origCreateCS();
    const times: number[] = [];
    scheduled.push(times);
    const param = cs.offset;
    const orig = {
      sv: param.setValueAtTime.bind(param),
      lr: param.linearRampToValueAtTime.bind(param),
      er: param.exponentialRampToValueAtTime.bind(param),
    };
    param.setValueAtTime = (v: number, t: number) => { times.push(t); return orig.sv(v, t); };
    param.linearRampToValueAtTime = (v: number, t: number) => { times.push(t); return orig.lr(v, t); };
    param.exponentialRampToValueAtTime = (v: number, t: number) => { times.push(t); return orig.er(v, t); };
    return cs;
  };
  return { ctx, scheduled };
}

describe('TB303.trigger amp envelope scheduling', () => {
  it('keeps the amp envelope schedule monotonic for very short notes (< 20ms)', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
    const { scheduled } = recordingContext(ctx);
    const synth = new TB303(ctx, ctx.destination);

    synth.trigger({ freq: 220, accent: false, slide: false, duration: 0.005 }, 0);

    // Each ConstantSource records its own schedule. Find the one with the
    // attack ramp (setValueAtTime(0) → linearRamp → setValueAtTime(peak) →
    // exponentialRamp). That's the amp envelope.
    const ampSchedule = scheduled.find((s) => s.length >= 4);
    expect(ampSchedule).toBeDefined();
    for (let i = 1; i < ampSchedule!.length; i++) {
      expect(ampSchedule![i]).toBeGreaterThanOrEqual(ampSchedule![i - 1]);
    }
  });

  it('also stays monotonic for slide-in short notes', () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100) as unknown as AudioContext;
    const { scheduled } = recordingContext(ctx);
    const synth = new TB303(ctx, ctx.destination);

    synth.trigger({ freq: 220, accent: false, slide: true, duration: 0.005 }, 0);

    const ampSchedule = scheduled.find((s) => s.length >= 3);
    expect(ampSchedule).toBeDefined();
    for (let i = 1; i < ampSchedule!.length; i++) {
      expect(ampSchedule![i]).toBeGreaterThanOrEqual(ampSchedule![i - 1]);
    }
  });
});
