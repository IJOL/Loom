// TEMPORARY (Task 1 spike): a 220 Hz sine to prove the worklet pipe end-to-end.
// Replaced by the real VoiceManager-backed processor in Task 8.
//
// Authored as a JS source string (not a separate .ts module entry) because Vite 5
// does not transpile .ts files referenced via `new URL('./file.ts', import.meta.url)`;
// it embeds the raw TS source with MIME type video/mp2t, which browsers reject in
// addModule. The Blob URL approach (matching recorder-worklet.ts) is the correct
// pattern for this codebase.

export const LOOM_PROCESSOR_NAME = 'loom-processor';

/** JavaScript source for the temporary test-tone AudioWorkletProcessor. */
export const LOOM_PROCESSOR_SOURCE = `
class LoomProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._phase = 0; }
  process(_inputs, outputs) {
    const out = outputs[0];
    const inc = 220 / sampleRate;
    for (let i = 0; i < out[0].length; i++) {
      const s = Math.sin(this._phase * 2 * Math.PI) * 0.2;
      this._phase = (this._phase + inc) % 1;
      for (let c = 0; c < out.length; c++) out[c][i] = s;
    }
    return true;
  }
}
registerProcessor('${LOOM_PROCESSOR_NAME}', LoomProcessor);
`;
