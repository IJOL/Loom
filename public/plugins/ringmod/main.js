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
      // DETUNE, not frequency, and the reason is the whole difference between a
      // modulation destination that works and one that looks like it does. A
      // modulator's depth is scaled by the declared range, and an undeclared one
      // falls back to 0..1 — so publishing `carrier.frequency` over a 20-4000 Hz
      // knob gave a full-depth LFO a swing of ±1 Hz out of 3980. Cents are
      // additive and perceptually even, which is what the SDK's own note on this
      // says and what the auto-wah and the multifilter already do.
      ["freq", carrier.detune],
      ["mix", wet.gain]
    ]),
    getAudioParamRange: (id) => (
      // ±4 octaves in cents: at full depth the carrier sweeps the audible span
      // the knob covers, instead of a rounding error.
      id === "freq" ? { min: 0, max: 4800 } : id === "mix" ? { min: 0, max: 1 } : void 0
    ),
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
