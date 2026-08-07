// plugins/distortion/curve.ts
function makeCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = i * 2 / n - 1;
    curve[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// plugins/distortion/main.ts
Loom.registerFx("distortion", (ctx) => {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 0;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  const output = ctx.createGain();
  input.connect(dry).connect(output);
  let shaper = ctx.createWaveShaper();
  const buildShaper = (amount) => {
    const next = ctx.createWaveShaper();
    next.curve = makeCurve(amount);
    next.oversample = "4x";
    input.connect(next);
    next.connect(wet);
    try {
      input.disconnect(shaper);
      shaper.disconnect();
    } catch {
    }
    shaper = next;
  };
  wet.connect(output);
  buildShaper(0.3);
  let drive = 0.3;
  let mix = 1;
  const params = /* @__PURE__ */ new Map([["mix", wet.gain]]);
  return {
    input,
    output,
    getAudioParams: () => params,
    getBaseValue: (id) => id === "drive" ? drive : id === "mix" ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === "drive" && v !== drive) {
        drive = v;
        buildShaper(v);
      }
      if (id === "mix") {
        mix = v;
        wet.gain.value = v;
        dry.gain.value = 1 - v;
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        input.disconnect();
        shaper.disconnect();
        dry.disconnect();
        wet.disconnect();
        output.disconnect();
      } catch {
      }
    }
  };
});
