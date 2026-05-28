import { describe, it, expect } from 'vitest';
// Import side-effects to register the engines.
import '../engines/subtractive';
import '../engines/wavetable';
import '../engines/fm';
import '../engines/karplus';
import '../engines/tb303';
import '../engines/drums-engine';
import { listEngines } from '../engines/registry';
import { nextLaneSlug } from './session-host';

describe('nextLaneSlug — slug id generation', () => {
  it('returns subtractive-2 for first added subtractive (subtractive-1 already exists)', () => {
    expect(nextLaneSlug(new Set(['tb-303-1', 'drums-1', 'subtractive-1']), 'subtractive')).toBe('subtractive-2');
  });

  it('skips taken ids and returns the next free one', () => {
    expect(nextLaneSlug(new Set(['subtractive-1', 'subtractive-2', 'subtractive-3']), 'subtractive')).toBe('subtractive-4');
  });

  it('TB-303 lane gets tb-303-2 when tb-303-1 is present', () => {
    expect(nextLaneSlug(new Set(['tb-303-1']), 'tb303')).toBe('tb-303-2');
  });

  it('FM lane gets fm-4-op-1 when none exist (no default FM lane)', () => {
    expect(nextLaneSlug(new Set([]), 'fm')).toBe('fm-4-op-1');
  });

  it('Wavetable lane gets wavetable-1 when none exist', () => {
    expect(nextLaneSlug(new Set([]), 'wavetable')).toBe('wavetable-1');
  });

  it('Karplus lane gets karplus-1 when none exist', () => {
    expect(nextLaneSlug(new Set([]), 'karplus')).toBe('karplus-1');
  });

  it('drums-machine lane gets drums-2 when drums-1 is present', () => {
    expect(nextLaneSlug(new Set(['drums-1']), 'drums-machine')).toBe('drums-2');
  });

  it('unknown engineId falls back to engineId as prefix', () => {
    expect(nextLaneSlug(new Set([]), 'my-engine')).toBe('my-engine-1');
  });
});

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
