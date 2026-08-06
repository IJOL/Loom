// src/plugins/notefx/random.ts
import { registerPlugin } from '../registry';
import { RANDOM_PROCESSOR_DEFAULTS } from '../../notefx/random-processor';
import type { NoteFxFactory } from '../types';

export const randomNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'random', name: 'Random', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...RANDOM_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string | boolean>),
};
registerPlugin(randomNoteFxPlugin);
