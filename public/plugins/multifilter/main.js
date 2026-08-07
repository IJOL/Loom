// plugins/multifilter/main.ts
var FREQ_DETUNE_SPAN_CENTS = 1200 * Math.log2(2e4 / 20);
Loom.registerFx("multifilter", (ctx) => {
  const input = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const output = ctx.createGain();
  filter.type = "lowpass";
  filter.frequency.value = 1e3;
  filter.Q.value = 1;
  input.connect(filter).connect(output);
  let typeIdx = 0;
  const types = ["lowpass", "highpass", "bandpass", "notch"];
  const params = /* @__PURE__ */ new Map([
    ["freq", filter.detune],
    ["q", filter.Q]
  ]);
  return {
    input,
    output,
    getAudioParams: () => params,
    getAudioParamRange: (id) => {
      if (id === "freq") return { min: 0, max: FREQ_DETUNE_SPAN_CENTS };
      if (id === "q") return { min: 0, max: 24 };
      return void 0;
    },
    getBaseValue: (id) => {
      if (id === "freq") return filter.frequency.value;
      if (id === "q") return filter.Q.value;
      if (id === "type") return typeIdx;
      return 0;
    },
    setBaseValue: (id, v) => {
      if (id === "freq") filter.frequency.value = v;
      if (id === "q") filter.Q.value = v;
      if (id === "type") {
        typeIdx = v | 0;
        filter.type = types[typeIdx] ?? "lowpass";
      }
    },
    applyPreset: () => {
    },
    dispose: () => {
      try {
        input.disconnect();
        filter.disconnect();
        output.disconnect();
      } catch {
      }
    }
  };
});
