// src/export/recorder-worklet.test.ts
import { describe, it, expect } from 'vitest';
import { RECORDER_PROCESSOR_NAME, RECORDER_WORKLET_SOURCE } from './recorder-worklet';

describe('recorder worklet source', () => {
  it('registers the named processor', () => {
    expect(RECORDER_PROCESSOR_NAME).toBe('loom-scene-recorder');
    expect(RECORDER_WORKLET_SOURCE).toContain(`registerProcessor('${RECORDER_PROCESSOR_NAME}'`);
    expect(RECORDER_WORKLET_SOURCE).toContain('extends AudioWorkletProcessor');
  });
});
