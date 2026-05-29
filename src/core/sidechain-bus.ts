// Lane-id → sidechain tap registry. Each ChannelStrip registers a GainNode
// fed off its post-mute output as its "tap"; ducker subgraphs read from
// `getTap(sourceLaneId)` to drive their envelope follower.
//
// Pure data structure — never owns audio nodes' lifetime; strips create
// and dispose their own taps and call register/unregister at the boundary.

export interface SidechainSource {
  id: string;
  label: string;
}

type Listener = () => void;

export class SidechainBus {
  private taps = new Map<string, { tap: GainNode; label: string }>();
  private listeners: Set<Listener> = new Set();

  register(id: string, tap: GainNode, label: string): void {
    this.taps.set(id, { tap, label });
    this.fire();
  }

  unregister(id: string): void {
    if (this.taps.delete(id)) this.fire();
  }

  getTap(id: string): GainNode | null {
    return this.taps.get(id)?.tap ?? null;
  }

  /** Sorted by id, optionally excluding one (the self-id for the UI dropdown). */
  listSources(excludeId?: string): SidechainSource[] {
    const out: SidechainSource[] = [];
    for (const [id, { label }] of this.taps) {
      if (id === excludeId) continue;
      out.push({ id, label });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private fire() {
    for (const fn of this.listeners) fn();
  }
}
