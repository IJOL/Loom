import { describe, it, expect } from 'vitest';
import { DrumMachine, type DrumVoice } from './drums';
import { FxBus } from './fx';
import { spectralCentroid, rms } from '../../test/dsp-asserts';

const SR = 44100;

async function render(mut: (dm: DrumMachine) => void, lane: DrumVoice): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.5), SR);
  const dest = ctx.createGain();
  dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  dm.setKit('909'); dm.loadKitDefaults('909');
  mut(dm);
  dm.trigger(lane, 0, false);
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('per-voice synth params shape the sound', () => {
  it('kick TUNE up raises the body centroid', async () => {
    const low  = await render((dm) => dm.setVoiceParam('kick', 'tune', 0.6), 'kick');
    const high = await render((dm) => dm.setVoiceParam('kick', 'tune', 1.8), 'kick');
    const head = (b: Float32Array) => b.subarray(0, Math.round(0.05 * SR));
    expect(spectralCentroid(head(high), SR)).toBeGreaterThan(spectralCentroid(head(low), SR));
  });

  it('snare SNAP up raises overall energy (more noise)', async () => {
    const dry  = await render((dm) => dm.setVoiceParam('snare', 'snap', 0.1), 'snare');
    const snap = await render((dm) => dm.setVoiceParam('snare', 'snap', 1.0), 'snare');
    expect(rms(snap)).toBeGreaterThan(rms(dry));
  });

  it('kick DECAY longer raises tail energy', async () => {
    const tailWin = (b: Float32Array) => b.subarray(Math.round(0.2 * SR));
    const shortD = await render((dm) => dm.setVoiceParam('kick', 'decay', 0.15), 'kick');
    const longD  = await render((dm) => dm.setVoiceParam('kick', 'decay', 1.2), 'kick');
    expect(rms(tailWin(longD))).toBeGreaterThan(rms(tailWin(shortD)));
  });
});
