// The sidechain duck detector, as an AudioWorklet processor: one audio input (the
// source lane's tap), one mono output carrying the GAIN MULTIPLIER for the ducked
// lane. Its output is connected straight to a GainNode's `gain` AudioParam, whose
// intrinsic value is 0, so the computed gain IS this signal.
//
// Bundled by Vite via the ?worker&url import in duck-node.ts — never imported on
// the main thread (registerProcessor + AudioWorkletProcessor don't exist there).
// The math lives in audio-dsp/duck-detector.ts and is unit-tested without audio.
/// <reference path="./worklet-globals.d.ts" />
import { DuckDetector, type DuckParams } from '../audio-dsp/duck-detector';
import { DUCK_PROCESSOR_NAME } from './processor-name';

export type DuckMsg =
  | { type: 'params'; params: DuckParams }
  | { type: 'kill' };

class DuckProcessor extends AudioWorkletProcessor {
  private det = new DuckDetector(sampleRate);
  private dead = false;

  constructor(options?: unknown) {
    super(options);
    const p = (options as { processorOptions?: { params?: DuckParams } } | undefined)
      ?.processorOptions?.params;
    if (p) this.det.setParams(p);
    this.port.onmessage = (e: MessageEvent<DuckMsg>) => {
      if (e.data.type === 'params') this.det.setParams(e.data.params);
      else if (e.data.type === 'kill') this.dead = true;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.dead) return false;
    const out = outputs[0][0];
    const chans = inputs[0];
    const nCh = chans ? chans.length : 0;
    for (let i = 0; i < out.length; i++) {
      // A silent upstream arrives as ZERO channels, not as zeroed channels — feed
      // the detector 0 then, so it releases back to unity instead of freezing.
      let x = 0;
      for (let c = 0; c < nCh; c++) x += chans[c][i];
      out[i] = this.det.process(nCh > 1 ? x / nCh : x);
    }
    return true;
  }
}

registerProcessor(DUCK_PROCESSOR_NAME, DuckProcessor);
