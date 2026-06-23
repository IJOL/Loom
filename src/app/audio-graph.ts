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
  masterComp.output.connect(analyser);
  // Dedicated metering tap off masterComp.output — NOT connected to destination
  // (mirrors the per-strip analysers; feeds the master strip VU meter).
  const masterMeterAnalyser = ctx.createAnalyser();
  masterMeterAnalyser.fftSize = 512;
  masterComp.output.connect(masterMeterAnalyser);
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
