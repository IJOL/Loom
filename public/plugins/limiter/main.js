// plugins/limiter/main.ts
Loom.registerFx("limiter", (ctx) => {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const output = ctx.createGain();
  comp.threshold.value = -1;
  comp.ratio.value = 20;
  comp.knee.value = 0;
  comp.attack.value = 1e-3;
  comp.release.value = 0.05;
  input.connect(comp).connect(output);
  const params = /* @__PURE__ */ new Map([
    ["ceiling", comp.threshold],
    ["release", comp.release]
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
        output.disconnect();
      } catch {
      }
    }
  };
});
