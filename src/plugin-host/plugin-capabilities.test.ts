import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines } from './loom-api';
import { outputTrimFor, shortLabelFor, pluginGmHints, isWorkletHosted } from './plugin-capabilities';
import type { EngineManifest } from '@loom/plugin-sdk';

const m: EngineManifest = {
  id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll',
  outputTrim: 0.5, shortLabel: 'prb',
  gm: { keywords: ['probe', 'prb'], priority: 5 },
  params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
};

describe('plugin capabilities', () => {
  beforeEach(() => {
    __resetPluginEngines();
    installMainThreadLoomApi();
    (globalThis as unknown as { Loom: { registerEngine(x: EngineManifest): void } }).Loom.registerEngine(m);
  });

  it('answers the output trim from the manifest', () => {
    expect(outputTrimFor('probe')).toBe(0.5);
    expect(outputTrimFor('not-a-plugin')).toBeUndefined();
  });

  it('answers the lane-id prefix from the manifest', () => {
    expect(shortLabelFor('probe')).toBe('prb');
  });

  it('surfaces GM name hints with their priority', () => {
    expect(pluginGmHints()).toEqual([{ keywords: ['probe', 'prb'], engineId: 'probe', priority: 5 }]);
  });

  it('treats an engine that declares DSP as worklet-hosted', () => {
    expect(isWorkletHosted('probe')).toBe(true);
    expect(isWorkletHosted('sampler')).toBe(false);
  });
});
