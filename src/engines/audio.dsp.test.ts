// src/engines/audio.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine } from './audio';
import { createEngineInstance, getEngine } from './registry';
import { sampleCache } from '../samples/sample-cache';
import { tickLane } from '../core/lane-scheduler';
import { stretchCache } from '../samples/stretch-cache';
import { audioChannelClip } from '../session/session';
import { DEFAULT_METER } from '../core/meter';

function tone(ctx: OfflineAudioContext, durationSec: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return buf as unknown as AudioBuffer;
}

describe('audio engine', () => {
  it('is registered under id "audio" via factory', () => {
    expect(getEngine('audio')?.id).toBe('audio');
    expect(createEngineInstance('audio')?.id).toBe('audio');
  });

  it('plays a clip sample buffer (non-silent)', async () => {
    const sr = 44100;
    const render = new OfflineAudioContext(1, Math.ceil(1.0 * sr), sr);
    sampleCache.put('smp-au', tone(render, 1.0, 220));
    const engine = new AudioEngine();
    const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
    voice.trigger(60, 0, {
      gateDuration: 1.0,
      sample: { sampleId: 'smp-au', mode: 'loop', trimStart: 0, trimEnd: 1.0 },
    });
    const out = await render.startRendering();
    const d = out.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });
});

/** Drive tickLane across the whole render, firing each audio trigger into the
 *  engine voice — the SAME path the live transport uses (engine + scheduler). */
async function renderViaScheduler(opts: {
  durationSec: number; bpm: number; sampleId: string;
  loopDurSec: number; originalBpm: number;
}): Promise<AudioBuffer> {
  const sr = 44100;
  const render = new OfflineAudioContext(1, Math.ceil(opts.durationSec * sr), sr);
  const engine = new AudioEngine();
  const voice = engine.createVoice(render as unknown as AudioContext, render.destination as unknown as AudioNode);
  const clip = audioChannelClip({
    name: 'l', sampleId: opts.sampleId, durationSec: opts.loopDurSec,
    originalBpm: opts.originalBpm, projectMeter: DEFAULT_METER,
  });
  // Walk the look-ahead window across the render in scheduler-sized steps.
  const tick = 0.025, look = 0.12;
  let loopStartedAt = 0, lastScheduledAt = -Infinity;
  for (let now = 0; now < opts.durationSec; now += tick) {
    loopStartedAt = tickLane(clip, {
      bpm: opts.bpm, lookaheadSec: look, now, loopStartedAt, lastScheduledAt,
      meter: DEFAULT_METER,
      onTrigger: (note, when) => {
        voice.trigger(note.midi, when, { gateDuration: (note.duration / 96) * (60 / opts.bpm), sample: note.sample });
        lastScheduledAt = when;
      },
      onAutomation: () => {},
    });
  }
  return render.startRendering() as unknown as AudioBuffer;
}

function pitchHz(buf: AudioBuffer, a0: number, a1: number): number {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const a = Math.floor(a0 * sr), b = Math.floor(a1 * sr);
  let cross = 0; for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
  return (cross / 2) * (sr / (b - a));
}

describe('audio engine — real scheduler path', () => {
  it('plays through engine+scheduler (non-silent) at native tempo', async () => {
    const render = new OfflineAudioContext(1, 1, 44100);
    sampleCache.put('smp-native', tone(render, 1.0, 220));
    stretchCache.clear();
    const out = await renderViaScheduler({
      durationSec: 1.0, bpm: 120, sampleId: 'smp-native', loopDurSec: 1.0, originalBpm: 120,
    });
    let peak = 0; const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(peak).toBeGreaterThan(0.1);
  });

  it('preserves pitch when stretched to a faster tempo (ratio ≈ 1, not varispeed)', async () => {
    // loop native = 120 BPM, 1 bar = 2s. Play it at 60 BPM → clip gate = 4s,
    // ratio 4/2 = 2 → WSOLA stretch keeps 220 Hz; varispeed would drop to 110 Hz.
    const sr = 44100;
    const big = new OfflineAudioContext(1, Math.ceil(4 * sr), sr);
    sampleCache.put('smp-pitch', tone(big, 2.0, 220));
    stretchCache.clear();
    await stretchCache.ensure('smp-pitch', 2.0, () => tone(big, 4.0, 220)); // pre-render the stretch
    const out = await renderViaScheduler({
      durationSec: 3.5, bpm: 60, sampleId: 'smp-pitch', loopDurSec: 2.0, originalBpm: 120,
    });
    const f = pitchHz(out, 0.5, 3.0);
    expect(f).toBeGreaterThan(200);
    expect(f).toBeLessThan(240);
  });
});
