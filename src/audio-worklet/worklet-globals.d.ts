// Ambient declarations for the AudioWorkletGlobalScope.
// These globals exist only inside an AudioWorklet; declaring them here lets
// loom-processor.ts typecheck under the standard "DOM" lib.

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => {
    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ): boolean;
  },
): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
