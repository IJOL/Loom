import type { SendBusState } from './send-bus';
import { newInsertId } from '../session/insert-slot';

export function defaultSends(): SendBusState[] {
  return [
    { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'delay',  params: {}, bypass: false }] },
    { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'reverb', params: {}, bypass: false }] },
  ];
}
