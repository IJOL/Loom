import { describe, it, expect } from 'vitest';
// Import side-effects to register the engines.
import '../engines/subtractive';
import '../engines/wavetable';
import '../engines/fm';
import '../engines/karplus';
import '../engines/tb303';
import '../engines/drums-engine';
import { listEngines } from '../engines/registry';

describe('engine registry feeds the + Add selector', () => {
  it('lists at least subtractive + tb303 + drums-machine after side-effect imports', () => {
    const ids = listEngines('polyhost').map((e) => e.id);
    expect(ids).toContain('subtractive');
    expect(ids).toContain('tb303');
    expect(ids).toContain('drums-machine');
  });

  it('has a name per engine', () => {
    for (const e of listEngines('polyhost')) {
      expect(e.name).toBeTruthy();
    }
  });
});
