// src/export/recorder-worklet.ts
// AudioWorklet recorder: taps a 2-channel input, captures only the samples
// whose time falls in [startTime, endTime) (sample-accurate via the global
// `currentTime`/`sampleRate`), then posts the concatenated stereo PCM and
// stops. Authored as a source string so it can load via a Blob URL.

export const RECORDER_PROCESSOR_NAME = 'loom-scene-recorder';

export const RECORDER_WORKLET_SOURCE = `
class LoomSceneRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._startTime = 0;
    this._endTime = Infinity;
    this._left = [];
    this._right = [];
    this._frames = 0;
    this._done = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'window') {
        this._startTime = e.data.startTime;
        this._endTime = e.data.endTime;
      }
    };
  }
  process(inputs) {
    if (this._done) return false;
    const input = inputs[0];
    const inL = input && input[0] ? input[0] : null;
    if (!inL) return true; // upstream not connected yet this quantum
    const inR = input[1] ? input[1] : inL;
    const n = inL.length;
    const sr = sampleRate;
    const blockStart = currentTime;
    const blockEnd = blockStart + n / sr;
    if (blockEnd > this._startTime && blockStart < this._endTime) {
      let from = 0, to = n;
      if (blockStart < this._startTime) from = Math.ceil((this._startTime - blockStart) * sr);
      if (blockEnd > this._endTime) to = Math.floor((this._endTime - blockStart) * sr);
      if (to > from) {
        this._left.push(inL.slice(from, to));
        this._right.push(inR.slice(from, to));
        this._frames += (to - from);
      }
    }
    if (blockEnd >= this._endTime) {
      const left = new Float32Array(this._frames);
      const right = new Float32Array(this._frames);
      let off = 0;
      for (let k = 0; k < this._left.length; k++) {
        left.set(this._left[k], off);
        right.set(this._right[k], off);
        off += this._left[k].length;
      }
      this._done = true;
      this.port.postMessage(
        { type: 'done', left, right, sampleRate: sr },
        [left.buffer, right.buffer],
      );
      return false;
    }
    return true;
  }
}
registerProcessor('${RECORDER_PROCESSOR_NAME}', LoomSceneRecorder);
`;

let modulePromise: Promise<void> | null = null;

/** Loads the recorder worklet module into `ctx` (once, cached via Blob URL). */
export function ensureRecorderWorklet(ctx: BaseAudioContext): Promise<void> {
  if (!modulePromise) {
    const blob = new Blob([RECORDER_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    modulePromise = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  }
  return modulePromise;
}
