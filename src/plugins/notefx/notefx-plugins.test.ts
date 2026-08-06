// src/plugins/notefx/notefx-plugins.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerPlugin, listPlugins, _resetRegistry } from '../registry';
import { arpNoteFxPlugin } from './arp';
import { chordNoteFxPlugin } from './chord';
import { randomNoteFxPlugin } from './random';

describe('note-FX plugins register', () => {
  beforeEach(() => { _resetRegistry(); });
  it('arp + chord + random appear under the notefx kind', () => {
    registerPlugin(arpNoteFxPlugin);
    registerPlugin(chordNoteFxPlugin);
    registerPlugin(randomNoteFxPlugin);
    const ids = listPlugins('notefx').map((p) => p.manifest.id).sort();
    expect(ids).toEqual(['arp', 'chord', 'random']);
  });
});
