// plugins/compressor/main.ts
Loom.registerFx("compressor", (ctx) => {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const output = ctx.createGain();
  comp.threshold.value = -24;
  comp.ratio.value = 4;
  comp.attack.value = 3e-3;
  comp.release.value = 0.25;
  comp.knee.value = 30;
  makeup.gain.value = 1;
  input.connect(comp).connect(makeup).connect(output);
  const params = /* @__PURE__ */ new Map([
    ["threshold", comp.threshold],
    ["ratio", comp.ratio],
    ["attack", comp.attack],
    ["release", comp.release],
    ["knee", comp.knee],
    ["makeup", makeup.gain]
  ]);
  return {
    input,
    output,
    getAudioParams: () => params,
    getBaseValue: (id) => params.get(id)?.value ?? 0,
    setBaseValue: (id, v) => {
      const p = params.get(id);
      if (p) p.value = v;
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        input.disconnect();
        comp.disconnect();
        makeup.disconnect();
        output.disconnect();
      } catch {
      }
    }
  };
});
