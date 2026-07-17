// src/performance/xy-pad.ts
// The XY pad's pure core — a Kaoss-style two-axis controller where each axis is
// LEARNED onto any automatable param. This holds only the assignment state and
// the position→writes mapping; it touches no DOM and no AudioParam. The wiring
// layer arms learn from the UI, feeds knob touches into learn(), and turns each
// XyWrite's normalized value into a real one via the target knob's min/max.
export type XyAxis = 'x' | 'y';

/** Which registry-key param each axis drives (null = unassigned). Serializable. */
export interface XyPadState {
  x: string | null;
  y: string | null;
}

/** One axis's contribution at a given pad position: the bound param and the
 *  normalized (0..1) value it should take. */
export interface XyWrite {
  axis: XyAxis;
  paramId: string;
  norm: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The shape of a knob the pad drives — the subset of KnobHandle it needs. */
export interface XyTarget {
  meta: { min: number; max: number };
  setValue(v: number): void;
}

/** Denormalize each write into its target knob's real range and drive it. A
 *  write whose target is absent from the registry is skipped (a param can vanish
 *  when a lane's engine changes). One setValue call moves both the UI and sound. */
export function applyXyWrites(writes: XyWrite[], registry: Map<string, XyTarget>): void {
  for (const w of writes) {
    const h = registry.get(w.paramId);
    if (!h) continue;
    const { min, max } = h.meta;
    h.setValue(min + w.norm * (max - min));
  }
}

export class XyPadModel {
  private state: XyPadState = { x: null, y: null };
  private pending: XyAxis | null = null;

  /** The param id bound to an axis, or null. */
  target(axis: XyAxis): string | null {
    return this.state[axis];
  }

  /** Arm learn for an axis; the next learn(paramId) binds it. Only one axis can
   *  be armed, so arming supersedes any prior arm. */
  armLearn(axis: XyAxis): void {
    this.pending = axis;
  }

  isArmed(axis: XyAxis): boolean {
    return this.pending === axis;
  }

  /** Disarm without binding. */
  cancelLearn(): void {
    this.pending = null;
  }

  /** Feed a touched knob's param id. If an axis is armed, bind it (replacing any
   *  prior target), disarm, and return the bound axis; otherwise a no-op → null. */
  learn(paramId: string): XyAxis | null {
    if (this.pending === null) return null;
    const axis = this.pending;
    this.state[axis] = paramId;
    this.pending = null;
    return axis;
  }

  /** Unbind an axis. */
  clearTarget(axis: XyAxis): void {
    this.state[axis] = null;
  }

  /** The writes for a pad position (nx, ny in 0..1, y already up = max at top).
   *  Only bound axes produce a write. */
  writesFor(nx: number, ny: number): XyWrite[] {
    const out: XyWrite[] = [];
    if (this.state.x !== null) out.push({ axis: 'x', paramId: this.state.x, norm: clamp01(nx) });
    if (this.state.y !== null) out.push({ axis: 'y', paramId: this.state.y, norm: clamp01(ny) });
    return out;
  }

  getState(): XyPadState {
    return { x: this.state.x, y: this.state.y };
  }

  setState(s: XyPadState): void {
    this.state = { x: s.x ?? null, y: s.y ?? null };
    this.pending = null;
  }
}
