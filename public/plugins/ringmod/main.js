// plugins/ringmod/main.ts
Loom.registerFx("ringmod", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = 300;
  carrier.start();
  const ring = ctx.createGain();
  ring.gain.value = 0;
  carrier.connect(ring.gain);
  const dry = ctx.createGain();
  dry.gain.value = 0;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  input.connect(dry).connect(output);
  input.connect(ring).connect(wet).connect(output);
  let mix = 1;
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["freq", carrier.frequency],
      ["mix", wet.gain]
    ]),
    getBaseValue: (id) => id === "freq" ? carrier.frequency.value : id === "mix" ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === "freq") carrier.frequency.value = v;
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
        carrier.stop();
      } catch {
      }
      for (const n of [input, output, carrier, ring, dry, wet]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
