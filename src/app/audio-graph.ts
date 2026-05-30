import { FxBus, ChannelStrip, MasterCompressor } from '../core/fx';
import { InsertChain } from '../plugins/fx/insert-chain';
import { SidechainBus } from '../core/sidechain-bus';
import { TB303 } from '../core/synth';
import { DrumMachine } from '../core/drums';
import { PolySynth } from '../polysynth/polysynth';
import { configureTB303EngineMainInstance } from '../engines/tb303';
import { configureDrumsEngineSharedFx } from '../engines/drums-engine';
import { getEngine } from '../engines/registry';
import type { SynthEngine } from '../engines/engine-types';
import { LANE_ID_BASS, LANE_ID_DRUMS, LANE_ID_POLY } from '../core/lane-ids';

export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  masterInsertChain: InsertChain;
  masterComp: MasterCompressor;
  fx: FxBus;
  sidechainBus: SidechainBus;
  bassStrip: ChannelStrip;
  polyStrip: ChannelStrip;
  drumBusStrip: ChannelStrip;
  synth: TB303;
  drums: DrumMachine;
  polysynth: PolySynth;
  mainSubtractive: SynthEngine | null;
  drumsEngineInstance: SynthEngine | null;
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
  configureDrumsEngineSharedFx(fx);

  const sidechainBus = new SidechainBus();
  const bassStrip    = new ChannelStrip(ctx, master, fx,
    { sidechain: { bus: sidechainBus, id: LANE_ID_BASS,  label: 'BASS'  } });
  const polyStrip    = new ChannelStrip(ctx, master, fx,
    { sidechain: { bus: sidechainBus, id: LANE_ID_POLY,  label: 'POLY'  } });
  const drumBusStrip = new ChannelStrip(ctx, master, fx,
    { sidechain: { bus: sidechainBus, id: LANE_ID_DRUMS, label: 'DRUMS' } });

  const synth = new TB303(ctx, bassStrip.input);
  configureTB303EngineMainInstance(bassStrip.input, synth);
  const drums = new DrumMachine(ctx, fx, drumBusStrip.input);
  const polysynth = new PolySynth(ctx, polyStrip.input);

  const mainSubtractive = getEngine('subtractive') ?? null;
  if (mainSubtractive) {
    (mainSubtractive as unknown as { setPolySynth?(p: PolySynth): void }).setPolySynth?.(polysynth);
  }
  const drumsEngineInstance = getEngine('drums-machine') ?? null;

  return {
    ctx, master, analyser, masterInsertChain, masterComp, fx, sidechainBus,
    bassStrip, polyStrip, drumBusStrip,
    synth, drums, polysynth,
    mainSubtractive, drumsEngineInstance,
  };
}
