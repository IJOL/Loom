import { describe, it, expect } from 'vitest';
import { DrumMachine } from './drums';
import { FxBus } from './fx';
import { rms } from '../../test/dsp-asserts';

const SR = 44100;

// Trigger a long open hat at t=0, then a closed hat at chSec. With the default
// hi-hat choke group the CH must silence the still-ringing OH; with choke OFF the
// OH rings on. We compare the tail energy AFTER the CH has died away.
async function renderHats(choke: boolean): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.round(SR * 0.4), SR);
  const dest = ctx.createGain();
  dest.connect(ctx.destination);
  const fx = new FxBus(ctx as unknown as AudioContext, dest);
  const dm = new DrumMachine(ctx as unknown as AudioContext, fx, dest);
  dm.setKit('909'); dm.loadKitDefaults('909');
  if (!choke) {
    dm.setVoiceParam('closedHat', 'chokeGroup', 0);
    dm.setVoiceParam('openHat', 'chokeGroup', 0);
  }
  dm.trigger('openHat', 0, false);
  dm.trigger('closedHat', 0.05, false);   // 50 ms in, while the OH still rings
  const ab = await ctx.startRendering();
  return new Float32Array(ab.getChannelData(0));
}

describe('hi-hat choke (CH cuts OH)', () => {
  it('the OH tail after the CH is far quieter with the choke than without', async () => {
    const tail = (b: Float32Array) => b.subarray(Math.round(0.15 * SR), Math.round(0.35 * SR));
    const choked = await renderHats(true);
    const open = await renderHats(false);
    // Without the choke the OH rings through the tail window; with it, the CH
    // silenced it ~50 ms in, so the tail is a fraction of the un-choked energy.
    expect(rms(tail(choked))).toBeLessThan(rms(tail(open)) * 0.5);
  });
});
