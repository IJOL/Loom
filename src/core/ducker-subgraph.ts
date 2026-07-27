import type { SidechainState } from './comp-state';
import { loadDuckWorklet } from '../audio-worklet/duck-node';
import { DUCK_PROCESSOR_NAME } from '../audio-worklet/processor-name';
import type { DuckMsg } from '../audio-worklet/duck-processor';

// Build/teardown the subgraph that ducks one lane from another's signal:
//
//   sourceTap → duck-detector worklet → duckGain.gain   (duckGain.gain.value = 0)
//
// The processor emits the MULTIPLIER itself (1 − depth·env, always in [0, 1]), so
// the param's intrinsic value is 0 and its computed value is that signal. There is
// no ConstantSource and no filter chain any more.
//
// The previous version was all native nodes: a rectifier WaveShaper → two
// BiquadFilter lowpasses whose cutoff came from the time constants. At REL 0.25 s
// that first lowpass sits at 0.64 Hz, where a float32 biquad stops filtering and
// starts integrating: measured in Chrome, its output grew 1.06 → 17.3 in 4 s with
// the input at exactly zero, so the multiplier drifted 0.99 → 0 → −3.0 and the
// "ducked" lane came back phase-inverted and +9.5 dB LOUDER. Stopping the transport
// did not reset it. See audio-dsp/duck-detector.ts for the full autopsy.

export interface DuckerOpts {
  sourceTap: GainNode;
  duckGain: GainNode;
  state: SidechainState;
}

export class DuckerSubgraph {
  private node: AudioWorkletNode | null = null;
  private disposed = false;
  private state: SidechainState;
  private sourceTap: GainNode;
  private duckGain: GainNode;
  private duckGainRestoreValue: number;

  constructor(private ctx: BaseAudioContext, opts: DuckerOpts) {
    this.duckGain = opts.duckGain;
    this.duckGainRestoreValue = opts.duckGain.gain.value;
    this.sourceTap = opts.sourceTap;
    this.state = opts.state;
    // Registering the module is async. Until the detector is actually connected the
    // lane must sound NORMAL — so the intrinsic gain is left alone, and only zeroed
    // (handing the param over to the processor) at the moment of connection.
    void this.attach();
  }

  private async attach(): Promise<void> {
    try {
      await loadDuckWorklet(this.ctx);
    } catch {
      return;   // no worklet → the lane simply isn't ducked; never silent
    }
    if (this.disposed) return;
    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(this.ctx, DUCK_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { params: this.state },
      });
      this.sourceTap.connect(node);
      // The processor emits the whole multiplier, so the param's own value must be
      // 0 — computedValue = intrinsic + Σ(connected inputs). Set it only now that
      // the detector is really feeding it, never before.
      this.duckGain.gain.value = 0;
      node.connect(this.duckGain.gain);
    } catch {
      // A lane that cannot build its detector plays UN-DUCKED. Restoring the gain
      // here is what keeps a failure from turning into a silent lane.
      this.duckGain.gain.value = this.duckGainRestoreValue;
      return;
    }
    this.node = node;
  }

  private post(m: DuckMsg): void { this.node?.port.postMessage(m); }

  setState(state: SidechainState): void {
    this.state = state;
    this.post({ type: 'params', params: state });
  }

  dispose(): void {
    this.disposed = true;
    if (this.node) {
      // Kill first (its process() returns false) THEN disconnect, or the disposed
      // processor keeps running for the context's lifetime — same contract as the
      // other worklet nodes in this app.
      this.post({ type: 'kill' });
      try { this.sourceTap.disconnect(this.node); } catch { /* already gone */ }
      try { this.node.disconnect(); } catch { /* */ }
      this.node = null;
    }
    this.duckGain.gain.value = this.duckGainRestoreValue;
  }
}
