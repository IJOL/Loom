import { FxBus, MasterCompressor } from '../core/fx';
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
  // master → InsertChain → masterComp → analyser → destination
  const masterInsertChain = new InsertChain(master, masterComp.input);
  const fx = new FxBus(ctx, master);

  const sidechainBus = new SidechainBus();

  return { ctx, master, analyser, masterMeterAnalyser, masterInsertChain, masterComp, fx, sidechainBus };
}

export function createAudioGraph(): AudioGraph {
  return buildAudioGraph(new AudioContext());
}
