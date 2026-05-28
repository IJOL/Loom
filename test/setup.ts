// Globalize node-web-audio-api so src/ code that calls `new AudioContext()`
// or `new OfflineAudioContext(...)` works under Vitest in Node.

import * as nwa from 'node-web-audio-api';

const g = globalThis as unknown as Record<string, unknown>;

for (const [name, value] of Object.entries(nwa)) {
  if (typeof value === 'function' && !(name in g)) {
    g[name] = value;
  }
}

// Sequencer uses `window.setTimeout` — alias window to globalThis.
if (!('window' in g)) g.window = g;
