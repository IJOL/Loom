// src/core/drums.dsp.test.ts
// Layer-3: real DSP tests for every drum lane × kit.

import { describe, it, expect } from 'vitest';
import { DrumMachine, DRUM_LANES, type DrumVoice } from './drums';
import { FxBus } from './fx';
import { rms, peak, isSilent, spectralCentroid } from '../../test/dsp-asserts';
import { writeWav, wavPath } from '../../test/wav';

const SR = 44100;
const DURATION = 0.5;

async function renderLane(kitId: string, lane: DrumVoice, accent = false): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * DURATION), SR);
  const dest = ctx.createGain();
  dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  dm.setKit(kitId);
  dm.loadKitDefaults(kitId);
  dm.trigger(lane, 0, accent);
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

// Discover kits at module load. We can't call dm.listKits() before
// constructing one, but the constructor needs a context. Build a throwaway.
function listKits(): string[] {
  const ctx = new OfflineAudioContext(1, 1024, SR);
  const dest = ctx.createGain();
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  return dm.listKits().map(k => k.id);
}
const KITS = listKits();

describe('drums — every lane × every kit sounds and does not clip', () => {
  for (const kitId of KITS) {
    for (const lane of DRUM_LANES) {
      it(`${kitId}/${lane}`, async () => {
        const buf = await renderLane(kitId, lane);
        writeWav(buf, wavPath(`drums-${kitId}__${lane}`), SR);
        expect(isSilent(buf)).toBe(false);
        expect(peak(buf)).toBeLessThan(1.0);
      });
    }
  }
});

describe('drums — accent raises RMS per lane', () => {
  // Use one kit (909) as representative — accent is a per-lane code path.
  const kit = '909';
  for (const lane of DRUM_LANES) {
    it(`${lane} accent louder than non-accent`, async () => {
      const bufN = await renderLane(kit, lane, false);
      const bufA = await renderLane(kit, lane, true);
      writeWav(bufN, wavPath(`drums-${kit}__${lane}__accent-off`), SR);
      writeWav(bufA, wavPath(`drums-${kit}__${lane}__accent-on`),  SR);
      expect(rms(bufA)).toBeGreaterThan(rms(bufN));
    });
  }
});

describe('drums — character coherence', () => {
  it('909 kick has low-frequency centroid in its body', async () => {
    const buf = await renderLane('909', 'kick');
    // First 50 ms = kick body.
    const head = buf.subarray(0, Math.round(0.05 * SR));
    expect(spectralCentroid(head, SR)).toBeLessThan(400);
  });

  it('909 closed hat has high-frequency centroid', async () => {
    const buf = await renderLane('909', 'closedHat');
    expect(spectralCentroid(buf, SR)).toBeGreaterThan(2000);
  });

  it('snare centroid sits above kick (body window, 909)', async () => {
    // Snare body contains both 200–400 Hz tonal content and HP'd noise,
    // so its centroid is well above a kick body (50–220 Hz sine sweep).
    // Note: by raw centroid the snare is often ABOVE the hat too — the
    // hat applies both a bandpass (10 kHz, Q=0.6) AND a high-pass, while
    // the snare's noise is unshaped above its HP cutoff and extends to
    // Nyquist. "Snare is darker than hat" is a perceptual judgement that
    // doesn't survive a centroid-only metric, so we only assert the
    // snare > kick half here.
    const bodyLen = Math.round(0.05 * SR);
    const snare = (await renderLane('909', 'snare')).subarray(0, bodyLen);
    const kick  = (await renderLane('909', 'kick')).subarray(0, bodyLen);
    expect(spectralCentroid(snare, SR)).toBeGreaterThan(spectralCentroid(kick, SR));
  });
});
