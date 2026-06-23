import { FxBus, MasterCompressor } from '../core/fx';
import { MasterBusStrip } from '../core/master-bus-strip';
import { InsertChain } from '../plugins/fx/insert-chain';
import { SidechainBus } from '../core/sidechain-bus';

// Phase G: audio-graph.ts is master-only. All per-lane strips, instrument
// instances, and configurator calls have been removed. Lane allocation is
// the sole responsibility of lane-allocator.ts via ensureLaneResource().
export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  masterMeterAnalyser: AnalyserNode;
  /** Master bus EQ + pan + mute (the master mixer module's tone controls).
   *  Sits between the sum bus and the master insert chain. */
  masterStrip: MasterBusStrip;
  masterInsertChain: InsertChain;
  masterComp: MasterCompressor;
  fx: FxBus;
  sidechainBus: SidechainBus;
}

/** Build the master audio graph against ANY context (live or offline). The
 *  analyser is wired to ctx.destination so the master signal reaches the
 *  output (or the offline render target). */
/** Master soft-clip curve: identity below ±0.8 (transparent for a normal mix),
 *  then a smooth tanh knee that maps everything above — including overs beyond
 *  ±1 (which clamp to the curve endpoints) — to ≤ ~0.95. Guarantees the master
 *  output can never reach 0 dBFS, so it cannot digitally clip. */
export function makeMasterSoftClipCurve(): Float32Array {
  const N = 2048;
  const curve = new Float32Array(N);
  const T = 0.8;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    const ax = Math.abs(x);
    if (ax <= T) {
      curve[i] = x;
    } else {
      const over = (ax - T) / (1 - T);
      curve[i] = Math.sign(x) * (T + (1 - T) * Math.tanh(over));
    }
  }
  return curve;
}

export function buildAudioGraph(ctx: AudioContext): AudioGraph {
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(ctx.destination);
  // Master SAFETY LIMITER, on by default. A session with many lanes at unity
  // sums well past 0 dBFS and hard-clips at the destination (the harsh
  // "chirps"). A brickwall-ish limiter near 0 dB is transparent for a
  // well-levelled mix (peaks below threshold) but stops the gross clipping of a
  // dense arrangement. Fully adjustable / bypassable in the master comp UI
  // (fx-ui), so this is the "one we need", not a hidden param.
  const masterComp = new MasterCompressor(ctx, {
    bypass: false, threshold: -2, ratio: 20, attack: 0.002, release: 0.1, knee: 0, makeup: 1,
  });
  // Final SOFT-CLIP safety after the limiter. The DynamicsCompressor limiter
  // tames sustained level but a dense mix's instantaneous transient PEAKS still
  // punch through it and clip at the destination (the audible "clipeo"). This
  // WaveShaper is the absolute peak ceiling: identity below ~-2 dB (transparent
  // for a normal mix) and a smooth knee that maps anything louder — including
  // overs beyond 0 dBFS — to ≤ ~0.95, so the output can never digitally clip.
  // 4x oversample keeps the saturation from aliasing. One node on the master,
  // so the cost is negligible.
  const softClip = ctx.createWaveShaper();
  (softClip as { curve: Float32Array | null }).curve = makeMasterSoftClipCurve();
  softClip.oversample = '4x';
  masterComp.output.connect(softClip);
  softClip.connect(analyser);
  // Dedicated metering tap off the FINAL output (post-soft-clip) — NOT connected
  // to destination (mirrors the per-strip analysers; feeds the master VU meter
  // and the PERF peak/clip readout, which now reflects the true, clip-free out).
  const masterMeterAnalyser = ctx.createAnalyser();
  masterMeterAnalyser.fftSize = 512;
  softClip.connect(masterMeterAnalyser);
  // master (sum) → MasterBusStrip (EQ/pan/mute) → InsertChain → masterComp → analyser → destination.
  // FxBus returns sum into `master` (pre-strip), so the master EQ shapes the wet returns too.
  const masterStrip = new MasterBusStrip(ctx);
  master.connect(masterStrip.input);
  const masterInsertChain = new InsertChain(masterStrip.output, masterComp.input);
  const fx = new FxBus(ctx, master);

  const sidechainBus = new SidechainBus();

  return { ctx, master, analyser, masterMeterAnalyser, masterStrip, masterInsertChain, masterComp, fx, sidechainBus };
}

export function createAudioGraph(): AudioGraph {
  return buildAudioGraph(new AudioContext());
}
