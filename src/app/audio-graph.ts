import { FxBus, ChannelStrip, FilterChain, MasterCompressor } from '../core/fx';
import { TB303 } from '../core/synth';
import { DrumMachine } from '../core/drums';
import { PolySynth } from '../polysynth/polysynth';
import { configureTB303EngineMainInstance } from '../engines/tb303';
import { configureDrumsEngineSharedFx } from '../engines/drums-engine';
import { getEngine } from '../engines/registry';
import type { SynthEngine } from '../engines/engine-types';

export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  filterChain: FilterChain;
  masterComp: MasterCompressor;
  fx: FxBus;
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
  // master → FilterChain → masterComp → analyser → destination
  const filterChain = new FilterChain(ctx, master, masterComp.input);
  const fx = new FxBus(ctx, master);
  configureDrumsEngineSharedFx(fx);

  const bassStrip    = new ChannelStrip(ctx, master, fx);
  const polyStrip    = new ChannelStrip(ctx, master, fx);
  const drumBusStrip = new ChannelStrip(ctx, master, fx);

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
    ctx, master, analyser, filterChain, masterComp, fx,
    bassStrip, polyStrip, drumBusStrip,
    synth, drums, polysynth,
    mainSubtractive, drumsEngineInstance,
  };
}
