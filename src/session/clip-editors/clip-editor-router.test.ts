// src/session/clip-editors/clip-editor-router.test.ts
import { describe, it, expect } from 'vitest';
import { chooseClipEditor } from './clip-editor-router';
import type { SessionLane } from '../session';

const lane = (over: Partial<SessionLane>): SessionLane => ({
  id: 'l1', engineId: 'sampler', clips: [], ...over,
});

describe('chooseClipEditor', () => {
  it('plain sampler lane → piano-roll', () => {
    expect(chooseClipEditor(lane({ engineId: 'sampler' }), 'piano-roll')).toBe('piano-roll');
  });

  it('sampler lane with a loaded drumkit → drum-grid', () => {
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: [], drumkitId: 'tr808' } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('drum-grid');
  });

  it('drumkitId on a NON-sampler lane is ignored (uses engine editor)', () => {
    const l = lane({ engineId: 'subtractive', engineState: { sampler: { keymap: [], drumkitId: 'tr808' } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('piano-roll');
  });

  it('drums-machine engine editor → drum-grid', () => {
    expect(chooseClipEditor(lane({ engineId: 'drums-machine' }), 'drum-grid')).toBe('drum-grid');
  });

  it('explicit per-clip override beats the drumkit flag', () => {
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: [], drumkitId: 'tr808' } } });
    expect(chooseClipEditor(l, 'piano-roll', 'piano-roll')).toBe('piano-roll');
  });

  it('falls back to piano-roll when engine editor is undefined', () => {
    expect(chooseClipEditor(lane({ engineId: 'mystery' }), undefined)).toBe('piano-roll');
  });
});
