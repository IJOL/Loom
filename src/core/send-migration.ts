import type { SendBusState } from './send-bus';
import { newInsertId } from '../session/insert-slot';

export function defaultSends(): SendBusState[] {
  return [
    { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'delay',  params: {}, bypass: false }] },
    { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'reverb', params: {}, bypass: false }] },
  ];
}

const REV_RE = /^(mix\..+)\.rev$/;
const DLY_RE = /^(mix\..+)\.dly$/;

/** Map legacy per-lane send knob ids to A/B. `<id>.rev` → `<id>.sendB`,
 *  `<id>.dly` → `<id>.sendA`. Non-send keys pass through unchanged. */
export function remapLaneSendParams(params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    const rev = REV_RE.exec(k);
    const dly = DLY_RE.exec(k);
    if (rev) out[`${rev[1]}.sendB`] = v;
    else if (dly) out[`${dly[1]}.sendA`] = v;
    else out[k] = v;
  }
  return out;
}
