import { describe, it, expect, afterEach } from 'vitest';
import { registerPluginEngine } from './plugin-fixtures';
import { getEngineDescriptor } from '../src/engines/registry';
import { shortLabelFor } from '../src/plugins/capabilities';
import { __resetPluginEngines } from '../src/plugin-host/loom-api';

afterEach(() => __resetPluginEngines());

describe('the plugin test fixture', () => {
  it('registers a real plugin from its manifest on disk', () => {
    // Karplus is the only migrated engine today, so it is the honest subject.
    registerPluginEngine('karplus');
    const d = getEngineDescriptor('karplus');
    expect(d).toBeDefined();
    expect(d!.params.length).toBeGreaterThan(0);
    expect(shortLabelFor('karplus')).toBe('karplus');
  });

  it('fails loudly for a plugin that is not there', () => {
    // A silent no-op would let a test "register" a deleted plugin and then
    // assert against an empty registry, which is how a green suite hides a
    // broken migration.
    expect(() => registerPluginEngine('not-a-plugin')).toThrow(/not-a-plugin/);
  });
});
