// plugins/width/main.ts
var SYNC_BEATS = [0, 4, 2, 3, 4 / 3, 1, 2 / 3];
Loom.registerFx("width", (ctx) => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const split = ctx.createChannelSplitter(2);
  input.connect(split);
  const mid = ctx.createGain();
  const side = ctx.createGain();
  const midL = ctx.createGain();
  midL.gain.value = 0.5;
  const midR = ctx.createGain();
  midR.gain.value = 0.5;
  const sideL = ctx.createGain();
  sideL.gain.value = 0.5;
  const sideR = ctx.createGain();
  sideR.gain.value = -0.5;
  split.connect(midL, 0);
  midL.connect(mid);
  split.connect(midR, 1);
  midR.connect(mid);
  split.connect(sideL, 0);
  sideL.connect(side);
  split.connect(sideR, 1);
  sideR.connect(side);
  const widthGain = ctx.createGain();
  widthGain.gain.value = 1;
  side.connect(widthGain);
  const sideInv = ctx.createGain();
  sideInv.gain.value = -1;
  widthGain.connect(sideInv);
  const merge = ctx.createChannelMerger(2);
  mid.connect(merge, 0, 0);
  widthGain.connect(merge, 0, 0);
  mid.connect(merge, 0, 1);
  sideInv.connect(merge, 0, 1);
  let width = 1, rate = 0.5, depth = 0, syncIdx = 0;
  let currentBpm = 120;
  let shadowRate = 0.5;
  const panner = ctx.createStereoPanner();
  panner.pan.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.5;
  const panDepth = ctx.createGain();
  panDepth.gain.value = 0;
  lfo.connect(panDepth).connect(panner.pan);
  lfo.start();
  const panTrim = ctx.createGain();
  const applyPanTrim = () => {
    panTrim.gain.value = 1 / (1 + depth * 0.5);
  };
  merge.connect(panner).connect(panTrim).connect(output);
  const applyRate = () => {
    const beats = SYNC_BEATS[syncIdx];
    shadowRate = beats > 0 ? currentBpm / 60 / beats : rate;
    lfo.frequency.value = shadowRate;
  };
  applyRate();
  applyPanTrim();
  return {
    input,
    output,
    getAudioParams: () => /* @__PURE__ */ new Map([
      ["width", widthGain.gain],
      ["rate", lfo.frequency],
      ["depth", panDepth.gain]
    ]),
    getAudioParamRange: (id) => (
      // Declared, because an undeclared range falls back to 0..1 and a modulator
      // could then only reach half of a knob that travels 0..2.
      id === "width" ? { min: 0, max: 2 } : id === "rate" ? { min: 0.05, max: 8 } : id === "depth" ? { min: 0, max: 1 } : void 0
    ),
    getBaseValue: (id) => id === "width" ? width : id === "rate" ? shadowRate : id === "depth" ? depth : id === "sync" ? syncIdx : 0,
    setBaseValue: (id, v) => {
      if (id === "width") {
        width = v;
        widthGain.gain.value = v;
      }
      if (id === "rate") {
        rate = v;
        applyRate();
      }
      if (id === "depth") {
        depth = v;
        panDepth.gain.value = v;
        applyPanTrim();
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
      for (const n of [
        input,
        output,
        split,
        mid,
        side,
        midL,
        midR,
        sideL,
        sideR,
        widthGain,
        sideInv,
        merge,
        panner,
        panTrim,
        lfo,
        panDepth
      ]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
