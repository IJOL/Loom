import { describe, it, expect } from 'vitest';
import '../engines/fm';                 // registers the FM descriptor engine
import { getEngine } from './registry';
import { FMRenderer } from '../audio-dsp/fm-renderer';
import type { ParamBag } from '../audio-dsp/types';

describe('FM param groups', () => {
  // Group id and display title are two different things since Task 9 declared
  // FM's groups table: the id (op1..op4, lowercase, matching each operator's
  // own dot-prefix) is a stable key nothing renders, and the title ('OP 1'..
  // 'OP 4') is what the user actually sees painted as the section header. Pin
  // both — the id alone doesn't catch a title typo/regression, and the title
  // is the one a reviewer or a screenshot would actually notice.
  it('tags each operator param with its opN group id, titled OP N', () => {
    const fm = getEngine('fm')!;
    const groupOf = (id: string) => fm.params.find((p) => p.id === id)?.group;
    const titleOf = (groupId: string) => fm.groups?.find((g) => g.id === groupId)?.title;
    for (let n = 1; n <= 4; n++) {
      expect(groupOf(`op${n}.ratio`)).toBe(`op${n}`);
      expect(groupOf(`op${n}.release`)).toBe(`op${n}`);
      expect(titleOf(`op${n}`)).toBe(`OP ${n}`);
    }
  });

  it('leaves global params ungrouped', () => {
    const fm = getEngine('fm')!;
    for (const id of ['algorithm', 'feedback', 'amp.mix']) {
      expect(fm.params.find((p) => p.id === id)?.group).toBeUndefined();
    }
  });

  it('fresh default patch is audible, in tune and does not clip', () => {
    const fm = getEngine('fm')!;
    const bag = Object.fromEntries(fm.params.map((p) => [p.id, p.default])) as ParamBag;
    const v = new FMRenderer(
      { midi: 60, beginSec: 0, durationSec: 1, velocity: 0.8, accent: false, slide: false },
      bag, 48000,
    );
    const buf = new Float32Array(48000 * 0.5);
    let pk = 0;
    for (let i = 0; i < buf.length; i++) { buf[i] = v.renderSample(i / 48000); pk = Math.max(pk, Math.abs(buf[i])); }
    const energy = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
    expect(energy).toBeGreaterThan(0.002);
    expect(pk).toBeLessThan(1.0);
  });
});
