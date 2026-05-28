// Per-lane audio resources. One entry per session lane; created at lane
// creation, disposed at lane delete. Replaces the legacy singleton globals
// (polysynth/bassStrip/polyStrip/drumBusStrip/extraPolys/extraStrips).

import type { ChannelStrip } from './fx';
import type { SynthEngine } from '../engines/engine-types';

export interface LaneResources {
  strip:  ChannelStrip;
  engine: SynthEngine;
}

export class LaneResourceMap {
  private inner = new Map<string, LaneResources>();

  get(laneId: string): LaneResources | undefined {
    return this.inner.get(laneId);
  }

  set(laneId: string, res: LaneResources): void {
    const existing = this.inner.get(laneId);
    if (existing) {
      (existing.strip as { dispose?(): void }).dispose?.();
      existing.engine.dispose?.();
    }
    this.inner.set(laneId, res);
  }

  dispose(laneId: string): void {
    const res = this.inner.get(laneId);
    if (!res) return;
    (res.strip as { dispose?(): void }).dispose?.();
    res.engine.dispose?.();
    this.inner.delete(laneId);
  }

  ids(): string[] {
    return [...this.inner.keys()];
  }

  *[Symbol.iterator](): Iterator<[string, LaneResources]> {
    yield* this.inner;
  }
}
