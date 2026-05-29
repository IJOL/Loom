import type { SidechainState } from './comp-state';

// Build/teardown an envelope-follower subgraph whose output modulates
// `duckGain.gain` so the effective gain is approximately:
//
//     duckGain.gain ≈ 1 − depth · env(source)
//
// Graph:
//
//   sourceTap
//     → WaveShaper (curve: y = |x|; full-wave rectify)
//     → BiquadFilter (lowpass; freq from release time constant)
//     → Gain (-depth)             ─┐
//                                   ├──→ duckGain.gain (AudioParam)
//   ConstantSourceNode(1.0)        ─┘
//
// v1 approximation: a single one-pole LP whose frequency is derived from
// `release` (the more audible side). `attack` clamps a small extra smoothing
// stage. A proper detector with separate up/down constants is a follow-up.

export interface DuckerOpts {
  sourceTap: GainNode;
  duckGain: GainNode;
  state: SidechainState;
}

const ABS_CURVE_LEN = 2048;
function makeAbsCurve(): Float32Array {
  const c = new Float32Array(ABS_CURVE_LEN);
  for (let i = 0; i < ABS_CURVE_LEN; i++) {
    const x = (i / (ABS_CURVE_LEN - 1)) * 2 - 1;
    c[i] = Math.abs(x);
  }
  return c;
}

function timeToCutoffHz(timeSec: number): number {
  const safe = Math.max(timeSec, 0.001);
  return Math.min(20000, Math.max(0.5, 1 / (2 * Math.PI * safe)));
}

export class DuckerSubgraph {
  private rectify: WaveShaperNode;
  private envelopeLp: BiquadFilterNode;
  private smoothLp: BiquadFilterNode;
  private scale: GainNode;
  private constOne: ConstantSourceNode;
  private duckGain: GainNode;

  constructor(private ctx: BaseAudioContext, opts: DuckerOpts) {
    const { sourceTap, duckGain, state } = opts;

    this.duckGain = duckGain;

    this.rectify = ctx.createWaveShaper();
    this.rectify.curve = makeAbsCurve();

    this.envelopeLp = ctx.createBiquadFilter();
    this.envelopeLp.type = 'lowpass';
    this.envelopeLp.frequency.value = timeToCutoffHz(state.release);
    this.envelopeLp.Q.value = 0.707;

    this.smoothLp = ctx.createBiquadFilter();
    this.smoothLp.type = 'lowpass';
    this.smoothLp.frequency.value = timeToCutoffHz(Math.max(state.attack, 0.0005));
    this.smoothLp.Q.value = 0.707;

    this.scale = ctx.createGain();
    this.scale.gain.value = -state.depth;

    this.constOne = ctx.createConstantSource();
    this.constOne.offset.value = 1;
    this.constOne.start();

    sourceTap.connect(this.rectify);
    this.rectify.connect(this.envelopeLp);
    this.envelopeLp.connect(this.smoothLp);
    this.smoothLp.connect(this.scale);
    this.scale.connect(duckGain.gain);
    this.constOne.connect(duckGain.gain);

    duckGain.gain.value = 0;
  }

  setState(state: SidechainState): void {
    const t = this.ctx.currentTime;
    this.envelopeLp.frequency.setTargetAtTime(timeToCutoffHz(state.release), t, 0.01);
    this.smoothLp.frequency.setTargetAtTime(timeToCutoffHz(Math.max(state.attack, 0.0005)), t, 0.01);
    this.scale.gain.setTargetAtTime(-state.depth, t, 0.01);
  }

  dispose(): void {
    try { this.constOne.stop(); } catch { /* already stopped */ }
    try { this.rectify.disconnect(); } catch { /* */ }
    try { this.envelopeLp.disconnect(); } catch { /* */ }
    try { this.smoothLp.disconnect(); } catch { /* */ }
    try { this.scale.disconnect(); } catch { /* */ }
    try { this.constOne.disconnect(); } catch { /* */ }
    this.duckGain.gain.value = 1;
  }
}
