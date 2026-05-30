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
  masterInsertChain: InsertChain;
  masterComp: MasterCompressor;
  fx: FxBus;
  sidechainBus: SidechainBus;
}

export function createAudioGraph(): AudioGraph {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(ctx.destination);
  const masterComp = new MasterCompressor(ctx);
  masterComp.output.connect(analyser);
  // master → InsertChain → masterComp → analyser → destination
  const masterInsertChain = new InsertChain(master, masterComp.input);
  const fx = new FxBus(ctx, master);

  const sidechainBus = new SidechainBus();

  return { ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus };
}
