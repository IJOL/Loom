// src/engines/registry-boot.test.ts
// Regression test: every engine module that main.ts depends on at runtime
// must be imported (directly or via side-effect import) so its module body
// runs and registers the engine. Phase B's removal of the
// `subtractiveEngine` named import accidentally dropped the only path that
// caused `src/engines/subtractive.ts` to load — leaving `getEngine('subtractive')`
// returning undefined and the LaneResourceMap allocation guard skipping
// the entire boot. This test pins the contract.

import { describe, it, expect } from 'vitest';

// Side-effect imports — must mirror main.ts.
import '../engines/subtractive';
import '../engines/wavetable';
import '../engines/fm';
import '../engines/karplus';
import '../engines/tb303';
import '../engines/drums-engine';

import { getEngine, createEngineInstance } from './registry';

describe('engine registry after side-effect imports', () => {
  it.each([
    ['tb303'],
    ['subtractive'],
    ['wavetable'],
    ['fm'],
    ['karplus'],
    ['drums-machine'],
  ])('getEngine(%s) returns a registered instance', (id) => {
    const eng = getEngine(id);
    expect(eng, `getEngine('${id}') returned undefined — module not loaded?`).toBeDefined();
    expect(eng!.id).toBe(id);
  });

  it.each([
    ['subtractive'],
    ['wavetable'],
    ['fm'],
    ['karplus'],
  ])('createEngineInstance(%s) produces a fresh instance', (id) => {
    const inst = createEngineInstance(id);
    expect(inst, `createEngineInstance('${id}') returned undefined`).toBeDefined();
    expect(inst!.id).toBe(id);
  });
});
