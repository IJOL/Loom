import { describe, it, expect } from 'vitest';
import '../engines/fm';                 // registers the FM descriptor engine
import { getEngine } from './registry';

describe('FM param groups', () => {
  it('tags each operator param with its OPn group', () => {
    const fm = getEngine('fm')!;
    const groupOf = (id: string) => fm.params.find((p) => p.id === id)?.group;
    for (let n = 1; n <= 4; n++) {
      expect(groupOf(`op${n}.ratio`)).toBe(`OP${n}`);
      expect(groupOf(`op${n}.release`)).toBe(`OP${n}`);
    }
  });

  it('leaves global params ungrouped', () => {
    const fm = getEngine('fm')!;
    for (const id of ['algorithm', 'feedback', 'amp.mix']) {
      expect(fm.params.find((p) => p.id === id)?.group).toBeUndefined();
    }
  });
});
