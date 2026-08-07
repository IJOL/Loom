// Per-lane audio resources. One entry per session lane; created at lane
// creation, disposed at lane delete. Replaces the legacy singleton globals
// (polysynth/bassStrip/polyStrip/drumBusStrip/extraPolys/extraStrips).

import type { ChannelStrip } from './fx';
import type { SynthEngine } from '../engines/engine-types';
import type { InsertChain } from './insert-chain';

export interface LaneResources {
  strip:   ChannelStrip;
  /** Absent when no plugin registered this lane's engine. The lane still owns
   *  its strip and its insert chain — they are the HOST's, not the engine's —
   *  so its mixer settings and its FX rack stay editable and stay saved while
   *  the plugin is missing. Every reader must handle undefined: a lane with no
   *  engine makes no sound, which is stated in the editor, not silently. */
  engine?: SynthEngine;
  inserts: InsertChain;
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
      existing.engine?.dispose?.();
      existing.inserts.dispose();
    }
    this.inner.set(laneId, res);
  }

  /** Replace ONLY the engine for a lane, disposing the old engine but keeping
   *  the existing strip + inserts (channel-level resources survive an engine
   *  swap). No-op if the lane has no resource. */
  replaceEngine(laneId: string, engine: SynthEngine): void {
    const res = this.inner.get(laneId);
    if (!res) return;
    res.engine?.dispose?.();
    res.engine = engine;
  }

  dispose(laneId: string): void {
    const res = this.inner.get(laneId);
    if (!res) return;
    (res.strip as { dispose?(): void }).dispose?.();
    res.engine?.dispose?.();
    res.inserts.dispose();
    this.inner.delete(laneId);
  }

  ids(): string[] {
    return [...this.inner.keys()];
  }

  *[Symbol.iterator](): Iterator<[string, LaneResources]> {
    yield* this.inner;
  }
}
