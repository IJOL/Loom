// plugins/phaser/main.ts
var STAGES = 4;
var CENTRE = 800;
var SPAN = 1600;
Loom.registerFx("phaser", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const stages = [];
  for (let i = 0; i < STAGES; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = "allpass";
    ap.frequency.value = CENTRE;
    ap.Q.value = 0.7;
    stages.push(ap);
  }
  for (let i = 0; i < STAGES - 1; i++) stages[i].connect(stages[i + 1]);
  const first = stages[0], last = stages[STAGES - 1];
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.5;
  const sweep = ctx.createGain();
  sweep.gain.value = SPAN * 0.5 * 0.7;
  for (const ap of stages) lfo.connect(sweep).connect(ap.frequency);
  lfo.start();
  const fb = ctx.createGain();
  fb.gain.value = 0.3 * 0.5;
  last.connect(fb).connect(first);
  const dry = ctx.createGain();
  dry.gain.value = 0.5;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  input.connect(dry).connect(output);
  input.connect(first);
  last.connect(wet).connect(output);
  let rate = 0.5, depth = 0.7, feedback = 0.3, mix = 0.5;
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["rate", lfo.frequency],
      ["mix", wet.gain]
    ]),
    getBaseValue: (id) => id === "rate" ? rate : id === "depth" ? depth : id === "feedback" ? feedback : id === "mix" ? mix : 0,
    setBaseValue: (id, v) => {
      if (id === "rate") {
        rate = v;
        lfo.frequency.value = v;
      }
      if (id === "depth") {
        depth = v;
        sweep.gain.value = SPAN * 0.5 * v;
      }
      if (id === "feedback") {
        feedback = v;
        fb.gain.value = v * 0.5;
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
        lfo.stop();
      } catch {
      }
      for (const n of [input, output, lfo, sweep, fb, dry, wet, ...stages]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
