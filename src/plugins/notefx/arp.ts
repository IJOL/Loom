// src/plugins/notefx/arp.ts
import { registerPlugin } from '../registry';
import { ARP_PROCESSOR_DEFAULTS } from '../../notefx/arp-processor';
import type { NoteFxFactory } from '../types';

export const arpNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'arp', name: 'Arpeggiator', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...ARP_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>),
};
registerPlugin(arpNoteFxPlugin);
