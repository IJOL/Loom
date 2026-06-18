// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createPerfDiagnostics } from './perf-diagnostics';
import type { PerfVoiceTap } from './perf-sources';
import type { Sequencer } from '../core/sequencer';

function fakeCtx() {
  const make = () => ({ addEventListener() {} });
  return { createOscillator: make, createBufferSource: make, createConstantSource: make } as unknown as AudioContext;
}

describe('createPerfDiagnostics', () => {
  it('mounts on open and fully tears down on close', () => {
    const mount = document.createElement('div');
    const seq = {} as Sequencer;
    const voiceTap: PerfVoiceTap = { fn: null };
    const diag = createPerfDiagnostics({ ctx: fakeCtx(), seq, voiceTap, mount });

    expect(diag.isOpen()).toBe(false);

    diag.toggle();
    expect(diag.isOpen()).toBe(true);
    expect(mount.querySelector('.perf-diag')).not.toBeNull();
    expect(typeof seq.onTickStats).toBe('function');
    expect(voiceTap.fn).not.toBeNull();

    diag.toggle();
    expect(diag.isOpen()).toBe(false);
    expect(mount.querySelector('.perf-diag')).toBeNull();
    expect(seq.onTickStats).toBeUndefined();
    expect(voiceTap.fn).toBeNull();
  });
});
