import { describe, it, expect } from 'vitest';
import { stretchBuffer } from './timestretch';

function sine(durationSec: number, freq: number, sr = 44100): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * sr), sr);
  const buf = ctx.createBuffer(1, Math.ceil(durationSec * sr), sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf;
}
// crude pitch estimate via zero-crossing rate over the middle of the buffer.
function zcrFreq(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const a = Math.floor(d.length * 0.25), b = Math.floor(d.length * 0.75);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) crossings++;
  return (crossings / 2) * (buf.sampleRate / (b - a));
}

describe('stretchBuffer', () => {
  it('lengthens duration by ~ratio (1.5x)', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const src = sine(1.0, 220);
    const out = stretchBuffer(ctx, src, 1.5);
    expect(out.length / src.length).toBeGreaterThan(1.4);
    expect(out.length / src.length).toBeLessThan(1.6);
  });

  it('preserves pitch (zero-crossing freq ratio approx 1)', () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const src = sine(1.0, 220);
    const out = stretchBuffer(ctx, src, 1.5);
    const ratio = zcrFreq(out) / zcrFreq(src);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});
