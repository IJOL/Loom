// src/plugins/fx/delay.ts
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
    const delay    = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const damping  = ctx.createBiquadFilter();
    damping.type = 'lowpass';
    damping.frequency.value = 4500;
    const fb       = ctx.createGain();
    fb.gain.value = 0.45;
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

    const applySync = () => {
      const beats = SYNC_BEATS[syncIdx];
      if (beats > 0) {
        shadowTime = (60 / currentBpm) * beats;
        delay.delayTime.setTargetAtTime(shadowTime, ctx.currentTime, 0.01);
      }
    };

    // input → delay
    input.connect(delay);
    // delay → damping → fb → delay (feedback loop with lowpass darkening)
    delay.connect(damping).connect(fb).connect(delay);
    // delay → wet → output
    delay.connect(wet).connect(output);

    const params = new Map<string, AudioParam>([
      ['time', delay.delayTime],
      ['feedback', fb.gain],
      ['wet', wet.gain],
      ['damping', damping.frequency],
    ]);

    return {
      input, output,
      getAudioParams: () => params,
      getBaseValue: (id) => {
        if (id === 'time')     return shadowTime;
        if (id === 'feedback') return fb.gain.value;
        if (id === 'wet')      return wet.gain.value;
        if (id === 'damping')  return damping.frequency.value;
        if (id === 'sync')     return syncIdx;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'time')     { shadowTime = v; delay.delayTime.setTargetAtTime(v, ctx.currentTime, 0.01); }
        if (id === 'feedback') fb.gain.value = v;
        if (id === 'wet')      wet.gain.value = v;
        if (id === 'damping')  damping.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
        if (id === 'sync')     { syncIdx = v | 0; applySync(); }
      },
      setBpm: (b) => { currentBpm = b; applySync(); },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); delay.disconnect(); damping.disconnect(); fb.disconnect(); wet.disconnect(); output.disconnect(); } catch { /* ok */ } },
    };
  },
};
