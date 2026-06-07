// src/session/clip-editors/clip-editor-router.test.ts
import { describe, it, expect } from 'vitest';
import { chooseClipEditor, isAudioClip, classifyClip } from './clip-editor-router';
import type { SessionLane, SessionClip } from '../session';

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

  it('sampler with a variable single-note keymap (no drumkitId) → drum-grid', () => {
    const km = Array.from({ length: 12 }, (_, i) => ({ sampleId: `s${i}`, rootNote: 36 + i, loNote: 36 + i, hiNote: 36 + i }));
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: km } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('drum-grid');
  });

  it('melodic sampler with range zones (no drumkitId) → piano-roll', () => {
    const km = [{ sampleId: 's', rootNote: 60, loNote: 0, hiNote: 127 }];
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: km } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('piano-roll');
  });
});

describe('classifyClip', () => {
  const noteClip = { id: 'c', lengthBars: 1, notes: [{ start: 0, duration: 1, midi: 60, velocity: 90 }] } as unknown as SessionClip;
  const audioClip = { id: 'a', lengthBars: 1, notes: [], sample: { sampleId: 's', mode: 'loop', trimStart: 0, trimEnd: 1 } } as unknown as SessionClip;

  it('melodic (non-audio) lane + piano-roll engine editor → notes', () => {
    expect(classifyClip(lane({ engineId: 'subtractive' }), noteClip, 'piano-roll')).toBe('notes');
  });

  it('drums-machine lane (drum-grid editor) → drums', () => {
    expect(classifyClip(lane({ engineId: 'drums-machine' }), noteClip, 'drum-grid')).toBe('drums');
  });

  it('sampler lane with a loaded drumkit → drums', () => {
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: [], drumkitId: 'tr808' } } });
    expect(classifyClip(l, noteClip, 'piano-roll')).toBe('drums');
  });

  it('audio-clip (audio lane + sample + no notes) → audio', () => {
    expect(classifyClip(lane({ engineId: 'audio' }), audioClip, 'piano-roll')).toBe('audio');
  });

  it('explicit piano-roll override on a drumkit-sampler → notes', () => {
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: [], drumkitId: 'tr808' } } });
    expect(classifyClip(l, noteClip, 'piano-roll', 'piano-roll')).toBe('notes');
  });
});

describe('isAudioClip', () => {
  it('true only for an audio-lane clip with a sample and no notes', () => {
    const audio = { id: 'a', engineId: 'audio', clips: [] } as unknown as SessionLane;
    const sampler = { id: 's', engineId: 'sampler', clips: [] } as unknown as SessionLane;
    const withSample = { id: 'c', lengthBars: 1, notes: [], sample: { sampleId: 's', mode: 'loop', trimStart: 0, trimEnd: 1 } } as unknown as SessionClip;
    const noteClip = { id: 'd', lengthBars: 1, notes: [{ start: 0, duration: 1, midi: 60, velocity: 90 }] } as unknown as SessionClip;
    expect(isAudioClip(audio, withSample)).toBe(true);
    expect(isAudioClip(sampler, withSample)).toBe(false);
    expect(isAudioClip(audio, noteClip)).toBe(false);
  });
});
