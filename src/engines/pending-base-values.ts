// Caches setBaseValue calls made before the engine's underlying instance
// exists, so callers can pre-configure params at engine-construction time
// without losing writes. The engine flushes on the next createVoice() (or
// equivalent instance-arrival hook), routing each entry through its normal
// setBaseValue path now that the instance is in place.

export class PendingBaseValues {
  private map = new Map<string, number>();

  set(id: string, value: number): void {
    this.map.set(id, value);
  }

  /** Read back a value queued before the instance existed (undefined if none).
   *  Lets getBaseValue surface a pre-instance preset/knob edit so the UI knobs
   *  reflect it instead of snapping to the spec default. */
  get(id: string): number | undefined {
    return this.map.get(id);
  }

  /** Snapshot, clear, then apply each entry via `write`. Snapshot-first
   *  means re-entrant setBaseValue calls (which the write callback typically
   *  triggers) find an empty map and write straight through to the instance. */
  flush(write: (id: string, value: number) => void): void {
    if (this.map.size === 0) return;
    const pending = [...this.map];
    this.map.clear();
    for (const [id, value] of pending) write(id, value);
  }
}
