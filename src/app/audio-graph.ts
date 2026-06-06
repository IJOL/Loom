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
  const masterComp = new MasterCompressor(ctx);
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
