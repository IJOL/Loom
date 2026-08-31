// @vitest-environment jsdom
// The control catalogue's DOM-building half — split from loom-api.test.ts,
// which runs without jsdom and cannot mount an element.
import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines } from './loom-api';
import { __resetModulators } from '../modulation/modulator-registry';
import { __resetModulatorKernels } from '../audio-dsp/modulator-kernels';

describe('Loom.controls (DOM)', () => {
  beforeEach(() => {
    __resetPluginEngines();
    __resetModulators();
    __resetModulatorKernels();
    installMainThreadLoomApi();
  });

  it('controls.curve builds a curve control a plugin can mount', () => {
    const api = (globalThis as unknown as { Loom: { controls: { curve: (o: {
      points: { x: number; y: number; c: number }[];
      onChange: (p: { x: number; y: number; c: number }[]) => void;
      label: string;
    }) => { el: HTMLElement; set: (p: { x: number; y: number; c: number }[]) => void } } } }).Loom;
    const h = api.controls.curve({
      points: [{ x: 0, y: 1, c: 0 }, { x: 1, y: 0, c: 0 }],
      onChange: () => {},
      label: 'spec',
    });
    expect(h.el.querySelectorAll('.curve-point')).toHaveLength(2);
    expect(typeof h.set).toBe('function');
  });
});
