// src/plugins/fx/delay.ts
// Ping-pong stereo delay. Two delay lines of equal time cross-feed into each
// other — L's output feeds R and R's feeds L — so successive echoes alternate
// channels instead of piling up in the middle. The input enters the LEFT line,
// so the first repeat is left, the second right, and so on.
//
// `width` pans the two lines apart. At 0 both sit centred and the result is the
// plain mono delay (the echo TIMES are unchanged by width — cross-feeding two
// lines of time T still spaces repeats at T, 2T, 3T…); at 1 they are hard left
// and right. Cross-feedback topology adapted from mpump (AGPL-3.0-or-later).
import type { FxInstance, PluginFactory } from '../types';

export const delayPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'delay',
    name: 'Delay',
    kind: 'fx',
    version: '1.0.0',
    params: [
      { id: 'time',     label: 'Time',     kind: 'continuous', min: 0.01, max: 2,     default: 0.375, unit: 's' },
      { id: 'feedback', label: 'Fbk',      kind: 'continuous', min: 0,    max: 0.95,  default: 0.45 },
      { id: 'wet',      label: 'Wet',      kind: 'continuous', min: 0,    max: 1.5,   default: 0.8 },
      { id: 'damping',  label: 'Damp',     kind: 'continuous', min: 200,  max: 12000, default: 4500, curve: 'exponential', unit: 'Hz' },
      { id: 'width',    label: 'Width',    kind: 'continuous', min: 0,    max: 1,     default: 1 },
      { id: 'sync', label: 'Sync', kind: 'discrete', min: 0, max: 6, default: 0,
        options: [
          { value: 'free',  label: 'Free' },
          { value: '1/4',   label: '1/4' },
          { value: '1/8',   label: '1/8' },
          { value: '1/8.',  label: '1/8.' },
          { value: '1/8t',  label: '1/8t' },
          { value: '1/16',  label: '1/16' },
          { value: '1/16t', label: '1/16t' },
        ] },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input    = ctx.createGain();
    const delayL   = ctx.createDelay(2);
    const delayR   = ctx.createDelay(2);
    delayL.delayTime.value = 0.375;
    delayR.delayTime.value = 0.375;
    const dampL    = ctx.createBiquadFilter();
    const dampR    = ctx.createBiquadFilter();
    for (const d of [dampL, dampR]) { d.type = 'lowpass'; d.frequency.value = 4500; }
    const fbL      = ctx.createGain();
    const fbR      = ctx.createGain();
    fbL.gain.value = 0.45;
    fbR.gain.value = 0.45;
    const panL     = ctx.createStereoPanner();
    const panR     = ctx.createStereoPanner();
    panL.pan.value = -1;
    panR.pan.value = 1;
    const wet      = ctx.createGain();
    wet.gain.value = 0.8;
    const output   = ctx.createGain();

    // index → beats (0 = free / manual time)
    const SYNC_BEATS = [0, 1, 0.5, 0.75, 1 / 3, 0.25, 1 / 6];
    let syncIdx = 0;
    let currentBpm = 120;
    // Shadow of the current delay time (tracks both manual and synced values
    // because setTargetAtTime is async and delayTime.value lags behind).
    let shadowTime = 0.375;
    let width = 1;

    const setTime = (t: number) => {
      delayL.delayTime.setTargetAtTime(t, ctx.currentTime, 0.01);
      delayR.delayTime.setTargetAtTime(t, ctx.currentTime, 0.01);
    };

    const applySync = () => {
      const beats = SYNC_BEATS[syncIdx];
      if (beats > 0) {
        shadowTime = (60 / currentBpm) * beats;
        setTime(shadowTime);
      }
    };

    // The input enters the LEFT line only — that is what makes the first repeat
    // land left and the ping-pong alternate.
    input.connect(delayL);
    // Cross-feedback: L → R and R → L, each darkened on the way round.
    delayL.connect(dampL).connect(fbL).connect(delayR);
    delayR.connect(dampR).connect(fbR).connect(delayL);
    // Each line out to its own side of the image.
    delayL.connect(panL).connect(wet);
    delayR.connect(panR).connect(wet);
    wet.connect(output);

    // Modulation destinations. NOTE these are the LEFT line's params only: a
    // modulator connects to one AudioParam, and there is no way to fan it to
    // both lines from here. A knob edit (setBaseValue) drives both and stays
    // symmetric; an LFO on `time` or `damping` moves only the left line, which
    // reads as stereo drift rather than a fault. `feedback` is the one to watch
    // — modulated hard it makes the two sides decay unevenly.
    const params = new Map<string, AudioParam>([
      ['time', delayL.delayTime],
      ['feedback', fbL.gain],
      ['wet', wet.gain],
      ['damping', dampL.frequency],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'time')     return shadowTime;
        if (id === 'feedback') return fbL.gain.value;
        if (id === 'wet')      return wet.gain.value;
        if (id === 'damping')  return dampL.frequency.value;
        if (id === 'sync')     return syncIdx;
        if (id === 'width')    return width;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'time')     { shadowTime = v; setTime(v); }
        if (id === 'feedback') { fbL.gain.value = v; fbR.gain.value = v; }
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'damping')  {
          dampL.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
          dampR.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
        }
        if (id === 'sync')     { syncIdx = v | 0; applySync(); }
        if (id === 'width')    { width = v; panL.pan.value = -v; panR.pan.value = v; }
      },
      setBpm: (b) => { currentBpm = b; applySync(); },
      applyPreset: () => {},
      dispose: () => {
        for (const n of [input, delayL, delayR, dampL, dampR, fbL, fbR, panL, panR, wet, output]) {
          try { n.disconnect(); } catch { /* ok */ }
        }
      },
    };
  },
};
