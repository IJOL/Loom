// plugins/tremolo/main.ts
var SYNC_BEATS = [0, 1, 0.5, 0.75, 1 / 3, 0.25, 1 / 6];
var SHAPES = ["sine", "square", "triangle", "sawtooth"];
Loom.registerFx("tremolo", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const vca = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 5;
  const smoother = ctx.createBiquadFilter();
  smoother.type = "lowpass";
  smoother.Q.value = 0.7;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.3;
  lfo.connect(smoother).connect(lfoDepth).connect(vca.gain);
  lfo.start();
  input.connect(vca).connect(output);
  let rate = 5, depth = 0.6, smoothMs = 2, shapeIdx = 0, syncIdx = 0;
  let currentBpm = 120;
  let shadowRate = 5;
  const applyDepth = () => {
    vca.gain.value = 1 - depth / 2;
    lfoDepth.gain.value = depth / 2;
  };
  const applySmooth = () => {
    smoother.frequency.value = Math.min(2e4, 1e3 / (2 * Math.PI * smoothMs));
  };
  const applyRate = () => {
    const beats = SYNC_BEATS[syncIdx];
    shadowRate = beats > 0 ? currentBpm / 60 / beats : rate;
    lfo.frequency.value = shadowRate;
  };
  applyDepth();
  applySmooth();
  applyRate();
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["rate", lfo.frequency]
    ]),
    getBaseValue: (id) => id === "rate" ? shadowRate : id === "depth" ? depth : id === "smooth" ? smoothMs : id === "shape" ? shapeIdx : id === "sync" ? syncIdx : 0,
    setBaseValue: (id, v) => {
      if (id === "rate") {
        rate = v;
        applyRate();
      }
      if (id === "depth") {
        depth = v;
        applyDepth();
      }
      if (id === "smooth") {
        smoothMs = v;
        applySmooth();
      }
      if (id === "shape") {
        shapeIdx = v | 0;
        lfo.type = SHAPES[shapeIdx] ?? "sine";
      }
      if (id === "sync") {
        syncIdx = v | 0;
        applyRate();
      }
    },
    setBpm: (b) => {
      currentBpm = b;
      applyRate();
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        lfo.stop();
      } catch {
      }
      for (const n of [input, output, vca, lfo, smoother, lfoDepth]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
