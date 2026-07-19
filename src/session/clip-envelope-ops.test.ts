import { describe, it, expect } from 'vitest';
import { addClipEnvelope } from './clip-envelope-ops';
import { AUTOMATION_SUB_RES } from '../core/pattern';
import type { SessionClip } from './session-types';

function clipOf(lengthBars: number): SessionClip {
  return { id: 'c1', name: 'Verse 1', lengthBars, notes: [] } as unknown as SessionClip;
}

describe('addClipEnvelope', () => {
  it('creates an envelope sized to the clip and centred at 0.5', () => {
    const clip = clipOf(2);
    expect(addClipEnvelope(clip, 'poly1.filter.cutoff')).toBe(true);
    const env = clip.envelopes![0];
    expect(env.paramId).toBe('poly1.filter.cutoff');
    expect(env.values.length).toBe(2 * 16 * AUTOMATION_SUB_RES);
    expect(new Set(env.values)).toEqual(new Set([0.5]));
    expect(env.enabled).toBe(true);
  });

  it('does not duplicate an envelope that already exists', () => {
    const clip = clipOf(1);
    addClipEnvelope(clip, 'poly1.filter.cutoff');
    expect(addClipEnvelope(clip, 'poly1.filter.cutoff')).toBe(false);
    expect(clip.envelopes!.length).toBe(1);
  });

  it('keeps existing envelopes for other params', () => {
    const clip = clipOf(1);
    addClipEnvelope(clip, 'poly1.filter.cutoff');
    addClipEnvelope(clip, 'poly1.amp.attack');
    expect(clip.envelopes!.map((e) => e.paramId))
      .toEqual(['poly1.filter.cutoff', 'poly1.amp.attack']);
  });
});
