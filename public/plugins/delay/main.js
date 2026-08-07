// plugins/delay/main.ts
var SYNC_BEATS = [0, 1, 0.5, 0.75, 1 / 3, 0.25, 1 / 6];
Loom.registerFx("delay", (ctx) => {
  const input = ctx.createGain();
  const delayL = ctx.createDelay(2);
  const delayR = ctx.createDelay(2);
  delayL.delayTime.value = 0.375;
  delayR.delayTime.value = 0.375;
  const dampL = ctx.createBiquadFilter();
  const dampR = ctx.createBiquadFilter();
  for (const d of [dampL, dampR]) {
    d.type = "lowpass";
    d.frequency.value = 4500;
  }
  const fbL = ctx.createGain();
  const fbR = ctx.createGain();
  fbL.gain.value = 0.45;
  fbR.gain.value = 0.45;
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -1;
  panR.pan.value = 1;
  const wet = ctx.createGain();
  wet.gain.value = 0.8;
  const output = ctx.createGain();
  let syncIdx = 0;
  let currentBpm = 120;
  let shadowTime = 0.375;
  let width = 1;
  const setTime = (t) => {
    delayL.delayTime.setTargetAtTime(t, ctx.currentTime, 0.01);
    delayR.delayTime.setTargetAtTime(t, ctx.currentTime, 0.01);
  };
  const applySync = () => {
    const beats = SYNC_BEATS[syncIdx];
    if (beats > 0) {
      shadowTime = 60 / currentBpm * beats;
      setTime(shadowTime);
    }
  };
  input.connect(delayL);
  delayL.connect(dampL).connect(fbL).connect(delayR);
  delayR.connect(dampR).connect(fbR).connect(delayL);
  delayL.connect(panL).connect(wet);
  delayR.connect(panR).connect(wet);
  wet.connect(output);
  const params = /* @__PURE__ */ new Map([
    ["time", delayL.delayTime],
    ["feedback", fbL.gain],
    ["wet", wet.gain],
    ["damping", dampL.frequency]
  ]);
  return {
    input,
    output,
    getAudioParams: () => params,
    getBaseValue: (id) => {
      if (id === "time") return shadowTime;
      if (id === "feedback") return fbL.gain.value;
      if (id === "wet") return wet.gain.value;
      if (id === "damping") return dampL.frequency.value;
      if (id === "sync") return syncIdx;
      if (id === "width") return width;
      return 0;
    },
    setBaseValue: (id, v) => {
      if (id === "time") {
        shadowTime = v;
        setTime(v);
      }
      if (id === "feedback") {
        fbL.gain.value = v;
        fbR.gain.value = v;
      }
      if (id === "wet") wet.gain.value = v;
      if (id === "damping") {
        dampL.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
        dampR.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
      }
      if (id === "sync") {
        syncIdx = v | 0;
        applySync();
      }
      if (id === "width") {
        width = v;
        panL.pan.value = -v;
        panR.pan.value = v;
      }
    },
    setBpm: (b) => {
      currentBpm = b;
      applySync();
    },
    applyPreset: () => {
    },
    dispose: () => {
      for (const n of [input, delayL, delayR, dampL, dampR, fbL, fbR, panL, panR, wet, output]) {
        try {
          n.disconnect();
        } catch {
        }
      }
    }
  };
});
