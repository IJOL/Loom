// src/plugins/notefx/chord.ts
import { registerPlugin } from '../registry';
import { CHORD_PROCESSOR_DEFAULTS } from '../../notefx/chord-processor';
import type { NoteFxFactory } from '../types';

export const chordNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'chord', name: 'Chord', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>),
};
registerPlugin(chordNoteFxPlugin);
