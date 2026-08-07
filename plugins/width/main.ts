// plugins/width/main.ts — stereo width and auto-pan. What it IS lives in
// plugin.json.
//
// TWO EFFECTS THAT DO DIFFERENT THINGS TO DIFFERENT SOURCES, which is worth
// knowing before reaching for either:
//
//   `width` is mid/side. It splits the signal into what the channels SHARE
//   (mid) and how they DIFFER (side), scales the side, and recombines. On a
//   MONO source the side is zero and scaling zero changes nothing — so width
//   does nothing at all to a mono track. It widens what is already stereo.
//
//   `depth` is an auto-pan: an LFO on a StereoPanner. That DOES move a mono
//   source, because it is not scaling a difference, it is creating one.
//
// So a mono track wants depth; a stereo one can use either.
import type { FxInstance } from '@loom/plugin-sdk';

/** Sync division → beats per LFO cycle. Index 0 is Free (manual Hz). Slower
 *  divisions than the tremolo's: a pan that moves once per sixteenth is a
 *  stutter, not a pan. */
const SYNC_BEATS = [0, 4, 2, 3, 4 / 3, 1, 2 / 3];

Loom.registerFx('width', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const output = ctx.createGain();

  // ⚠️ The input must be UP-MIXED to two channels before the splitter, or a
  // mono source comes out hard left. Without this, the splitter's channel 1 is
  // silence, so side = 0.5·sig equals mid and R = mid − side cancels to
  // nothing. Found by the mono test, which is exactly the case a stereo effect
  // is least likely to be tried against by hand.
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  // ── Mid/side ──────────────────────────────────────────────────────────────
  const split = ctx.createChannelSplitter(2);
  input.connect(split);

  const mid  = ctx.createGain();          // (L + R) / 2
  const side = ctx.createGain();          // (L - R) / 2
  const midL = ctx.createGain(); midL.gain.value = 0.5;
  const midR = ctx.createGain(); midR.gain.value = 0.5;
  const sideL = ctx.createGain(); sideL.gain.value = 0.5;
  const sideR = ctx.createGain(); sideR.gain.value = -0.5;
  split.connect(midL, 0);  midL.connect(mid);
  split.connect(midR, 1);  midR.connect(mid);
  split.connect(sideL, 0); sideL.connect(side);
  split.connect(sideR, 1); sideR.connect(side);

  const widthGain = ctx.createGain(); widthGain.gain.value = 1;
  side.connect(widthGain);
  // R = mid − side, so the side arm needs an inverted copy for the right.
  const sideInv = ctx.createGain(); sideInv.gain.value = -1;
  widthGain.connect(sideInv);

  const merge = ctx.createChannelMerger(2);
  mid.connect(merge, 0, 0);       widthGain.connect(merge, 0, 0);
  mid.connect(merge, 0, 1);       sideInv.connect(merge, 0, 1);

  // ── Auto-pan ──────────────────────────────────────────────────────────────
  const panner = ctx.createStereoPanner();
  panner.pan.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.5;
  const panDepth = ctx.createGain();
  panDepth.gain.value = 0;               // depth 0: no movement by default
  lfo.connect(panDepth).connect(panner.pan);
  lfo.start();

  merge.connect(panner).connect(output);

  let width = 1, rate = 0.5, depth = 0, syncIdx = 0;
  let currentBpm = 120;
  /** Shadow of the EFFECTIVE rate — a synced value does not live on the knob. */
  let shadowRate = 0.5;

  const applyRate = () => {
    const beats = SYNC_BEATS[syncIdx];
    shadowRate = beats > 0 ? (currentBpm / 60) / beats : rate;
    lfo.frequency.value = shadowRate;
  };
  applyRate();

  return {
    input, output,
    getAudioParams: () => new Map<string, AudioParam>([
      ['width', widthGain.gain],
      ['rate', lfo.frequency],
      ['depth', panDepth.gain],
    ]),
    getBaseValue: (id) =>
      id === 'width' ? width : id === 'rate' ? shadowRate
      : id === 'depth' ? depth : id === 'sync' ? syncIdx : 0,
    setBaseValue: (id, v) => {
      if (id === 'width') { width = v; widthGain.gain.value = v; }
      if (id === 'rate')  { rate = v; applyRate(); }
      if (id === 'depth') { depth = v; panDepth.gain.value = v; }
      if (id === 'sync')  { syncIdx = v | 0; applyRate(); }
    },
    setBpm: (b) => { currentBpm = b; applyRate(); },
    applyPreset: () => {},
    dispose: () => {
      try { lfo.stop(); } catch { /* already stopped */ }
      for (const n of [input, output, split, mid, side, midL, midR, sideL, sideR,
                       widthGain, sideInv, merge, panner, lfo, panDepth]) {
        try { n.disconnect(); } catch { /* ok */ }
      }
    },
  };
});
