// plugins/bitcrusher/curve.ts
function crushCurve(bits) {
  const n = 2048;
  const curve = new Float32Array(n);
  const levels = Math.max(2, Math.pow(2, bits));
  const step = 2 / (levels - 1);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    curve[i] = Math.max(-1, Math.min(1, Math.round((x + 1) / step) * step - 1));
  }
  return curve;
}

// plugins/bitcrusher/main.ts
function makeTpdfNoise(ctx) {
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = Math.random() - 0.5 + (Math.random() - 0.5);
  }
  return buf;
}
Loom.registerFx("bitcrusher", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 8e3;
  tone.Q.value = 0.7;
  const dry = ctx.createGain();
  dry.gain.value = 0;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  const noise = ctx.createBufferSource();
  noise.buffer = makeTpdfNoise(ctx);
  noise.loop = true;
  const ditherGain = ctx.createGain();
  ditherGain.gain.value = 0;
  noise.connect(ditherGain);
  try {
    noise.start();
  } catch {
  }
  let shaper = ctx.createWaveShaper();
  const buildShaper = (b) => {
    const next = ctx.createWaveShaper();
    next.curve = crushCurve(b);
    next.oversample = "none";
    input.connect(next);
    ditherGain.connect(next);
    next.connect(tone);
    try {
      input.disconnect(shaper);
      ditherGain.disconnect(shaper);
      shaper.disconnect();
    } catch {
    }
    shaper = next;
  };
  input.connect(dry).connect(output);
  tone.connect(wet).connect(output);
  buildShaper(8);
  let bits = 8, toneHz = 8e3, mix = 1, dither = 0;
  const stepFor = (b) => 2 / (Math.max(2, Math.pow(2, b)) - 1);
  const applyDither = () => {
    ditherGain.gain.value = dither * stepFor(bits);
  };
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["tone", tone.frequency],
      ["mix", wet.gain]
    ]),
    getBaseValue: (id) => id === "bits" ? bits : id === "tone" ? toneHz : id === "mix" ? mix : id === "dither" ? dither : 0,
    setBaseValue: (id, v) => {
      if (id === "bits") {
        bits = v;
        buildShaper(v);
        applyDither();
      }
      if (id === "tone") {
        toneHz = v;
        tone.frequency.value = v;
      }
      if (id === "mix") {
        mix = v;
        wet.gain.value = v;
        dry.gain.value = 1 - v;
      }
      if (id === "dither") {
        dither = v;
        applyDither();
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        noise.stop();
      } catch {
      }
      for (const n of [input, output, shaper, tone, dry, wet, noise, ditherGain]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
