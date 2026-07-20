// src/modulation/control-cache.ts
// Create-once storage for imperative widgets rendered inside lit-html templates.
//
// lit-html re-runs a template function on every render. Knobs and select-controls
// cannot be built there: each owns its DOM, registers an automation-registry entry
// and captures the pointer during a drag, so rebuilding one mid-gesture would drop
// the drag. Instead they are built once, keyed by a stable id, and the template
// interpolates the cached node. The key doesn't have to be a single param id —
// modulation-ui.ts caches whole rows this way, e.g. `${mod.id}:config` for a
// modulator's config row (itself built from several knobs/selects, each with its
// own `${laneId}.mod.${modId}.<field>` registry id).
//
// Usage is a pass: beginPass() before render, get() from inside the template for
// each control still on screen, endPass() after. Anything not requested during the
// pass has left the UI and is dropped.
//
// The three calls must be used as a matched pass (beginPass -> get()* -> endPass),
// always paired. beginPass() clears the touched set but endPass() does not reset
// it, so calling endPass() twice without an intervening beginPass() is a silent
// no-op the second time, and two consecutive beginPass() calls can cause entries
// requested during the first pass to be dropped by the endPass() that follows the
// second. A render that throws partway through degrades gracefully, since entries
// are only deleted inside endPass() itself.

export class ControlCache {
  private entries = new Map<string, unknown>();
  private touched = new Set<string>();

  get size(): number {
    return this.entries.size;
  }

  /** Starts a render pass. Everything must be re-requested to survive it. */
  beginPass(): void {
    this.touched.clear();
  }

  /** Returns the control for `id`, building it on first use. */
  get<T>(id: string, factory: () => T): T {
    this.touched.add(id);
    if (this.entries.has(id)) return this.entries.get(id) as T;
    const created = factory();
    this.entries.set(id, created);
    return created;
  }

  /** Ends a render pass, dropping untouched entries. Returns the dropped ids. */
  endPass(): string[] {
    const dropped: string[] = [];
    for (const id of this.entries.keys()) {
      if (!this.touched.has(id)) dropped.push(id);
    }
    for (const id of dropped) this.entries.delete(id);
    return dropped;
  }
}
