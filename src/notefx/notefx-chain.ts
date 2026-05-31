// src/notefx/notefx-chain.ts
import type {
  NoteFxEvent, NoteFxContext, NoteFxProcessor, NoteFxState, NoteFxKind,
} from './notefx-types';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS, type ArpProcessorParams } from './arp-processor';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS, type ChordProcessorParams } from './chord-processor';

function defaultParams(kind: NoteFxKind): Record<string, number | string> {
  return kind === 'arp'
    ? { ...ARP_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>
    : { ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>;
}

function makeProcessor(s: NoteFxState): NoteFxProcessor {
  if (s.kind === 'arp')   return new ArpProcessor(s.params as unknown as ArpProcessorParams);
  return new ChordProcessor(s.params as unknown as ChordProcessorParams);
}

export class NoteFxChain {
  noteFx: NoteFxState[];

  constructor(initial: NoteFxState[]) {
    this.noteFx = initial.map((s) => ({ ...s, params: { ...s.params } }));
  }

  addNoteFx(kind: NoteFxKind): NoteFxState {
    const prefix = kind;
    const used = new Set(this.noteFx.filter((s) => s.kind === kind).map((s) => s.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    const fresh: NoteFxState = { id: `${prefix}${n}`, kind, enabled: true, params: defaultParams(kind) };
    this.noteFx.push(fresh);
    return fresh;
  }

  removeNoteFx(id: string): void {
    const i = this.noteFx.findIndex((s) => s.id === id);
    if (i >= 0) this.noteFx.splice(i, 1);
  }

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    let events = input;
    for (const s of this.noteFx) {
      if (!s.enabled) continue;
      events = makeProcessor(s).process(events, ctx);
    }
    return events;
  }

  serialize(): NoteFxState[] {
    return this.noteFx.map((s) => ({ ...s, params: { ...s.params } }));
  }

  deserialize(state: NoteFxState[]): void {
    this.noteFx = state.map((s) => ({ ...s, params: { ...s.params } }));
  }
}
