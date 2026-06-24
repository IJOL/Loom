// src/session/clip-editors/clip-editor-router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { chooseClipEditor, isAudioClip, classifyClip, combineEditorHandle, samplerDrumModel } from './clip-editor-router';
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

  it('a loop slice bank (single-note keymap + instrumentId) → piano-roll, not drum-grid', () => {
    const km = Array.from({ length: 8 }, (_, i) => ({ sampleId: `s${i}`, rootNote: 60 + i, loNote: 60 + i, hiNote: 60 + i }));
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: km, instrumentId: 'amen-175' } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('piano-roll');
  });

  it('a user-imported loop (single-note bank, NO id, but a waveform slice clip) → piano-roll', () => {
    // Identical lane shape to a user-built drumkit (single-note keymap, no
    // drumkitId/instrumentId) — so WITHOUT the clip it routes to the drum grid…
    const km = Array.from({ length: 8 }, (_, i) => ({ sampleId: `s${i}`, rootNote: 36 + i, loNote: 36 + i, hiNote: 36 + i }));
    const l = lane({ engineId: 'sampler', engineState: { sampler: { keymap: km } } });
    expect(chooseClipEditor(l, 'piano-roll')).toBe('drum-grid');
    // …but the loop clip carries a waveform slice bank, which pins it to the
    // piano-roll (an imported loop has no instrumentId to lean on).
    const loopClip = {
      id: 'c', lengthBars: 1, notes: [],
      waveformRef: { sampleId: 'loop', slices: [{ start: 0, end: 1, note: 36 }] },
    } as unknown as SessionClip;
    expect(chooseClipEditor(l, 'piano-roll', undefined, loopClip)).toBe('piano-roll');
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

const km = (notes: number[]) => notes.map((n) => ({ sampleId: `s${n}`, rootNote: n, loNote: n, hiNote: n }));
const laneWith = (notes: number[]) => ({ id: 'l1', engineId: 'sampler', clips: [], engineState: { sampler: { keymap: km(notes) } } } as any);
const clipWith = (used: number[]) => ({ id: 'c1', lengthBars: 1, notes: used.map((m) => ({ start: 0, duration: 6, midi: m, velocity: 80 })) } as any);
const lbl = (m: number) => `n${m}`;

describe('samplerDrumModel compact/full', () => {
  it('full mode lists every pad with GM percussion labels', () => {
    const m = samplerDrumModel(laneWith([36, 54, 69]), clipWith([]), lbl, true)!;
    expect(m.rows.count).toBe(3);
    expect(m.labels).toEqual(['Kick', 'Tamb', 'Cabasa']);
  });
  it('compact mode lists only the pads the clip uses', () => {
    const m = samplerDrumModel(laneWith([36, 54, 69, 42]), clipWith([54, 69]), lbl, false)!;
    expect(m.rows.count).toBe(2);
    expect(m.labels).toEqual(['Tamb', 'Cabasa']);
  });
  it('compact mode on an empty clip seeds the basic voices present in the kit', () => {
    const m = samplerDrumModel(laneWith([36, 38, 42, 46, 39, 69]), clipWith([]), lbl, false)!;
    expect(m.labels).toEqual(['Kick', 'Snare', 'CH', 'OH', 'Clap']);
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

// Regression: renderClipEditor wraps the body editor + optional waveform header
// into one handle. It MUST forward the body's getOctaveBase/setOctaveBase (the
// piano-roll's), or the note-randomizer can't read/restore the editor octave —
// the bug where 🎲 reset the octave to C4 and generated there.
describe('combineEditorHandle', () => {
  it('forwards the body capabilities (getOctaveBase/setOctaveBase) and paints both', () => {
    let header = 0, body = 0;
    const setSpy = vi.fn();
    const h = combineEditorHandle(
      { redraw: () => { header++; } },
      { redraw: () => { body++; }, getOctaveBase: () => 72, setOctaveBase: setSpy },
    );
    expect(h.getOctaveBase?.()).toBe(72);
    h.setOctaveBase?.(84);
    expect(setSpy).toHaveBeenCalledWith(84);
    h.redraw();
    expect(header).toBe(1);
    expect(body).toBe(1);
  });

  it('works without a waveform header (header null)', () => {
    let body = 0;
    const h = combineEditorHandle(null, { redraw: () => { body++; }, getOctaveBase: () => 60 });
    expect(h.getOctaveBase?.()).toBe(60);
    h.redraw();
    expect(body).toBe(1);
  });
});
