// src/plugins/fx/insert-chain.ts
import type { FxInstance } from '../types';

export interface ChainSlot {
  /** Mirrors the persisted InsertSlot.id, so anything addressing a live slot
   *  (the modulation binder) uses the same identity the session saved. */
  id: string;
  fx: FxInstance;
  bypass: boolean;
}

export class InsertChain {
  private slots: ChainSlot[] = [];

  constructor(private input: AudioNode, private output: AudioNode) {
    this.rewire();
  }

  list(): readonly ChainSlot[] { return this.slots; }
  size(): number { return this.slots.length; }

  get inputNode(): AudioNode { return this.input; }

  insert(fx: FxInstance, id: string, at?: number): void {
    const idx = at ?? this.slots.length;
    this.slots.splice(idx, 0, { id, fx, bypass: false });
    this.rewire();
  }

  remove(idx: number): void {
    const [slot] = this.slots.splice(idx, 1);
    if (!slot) return;
    slot.fx.dispose();
    this.rewire();
  }

  setBypass(idx: number, bypass: boolean): void {
    const s = this.slots[idx];
    if (!s) return;
    s.bypass = bypass;
    this.rewire();
  }

  reorder(from: number, to: number): void {
    if (from === to) return;
    const [s] = this.slots.splice(from, 1);
    if (!s) return;
    this.slots.splice(to, 0, s);
    this.rewire();
  }

  setBpm(bpm: number): void {
    for (const s of this.slots) s.fx.setBpm?.(bpm);
  }

  dispose(): void {
    for (const s of this.slots) s.fx.dispose();
    this.slots = [];
    try { this.input.disconnect(); } catch { /* ok */ }
  }

  private rewire(): void {
    try { this.input.disconnect(); } catch { /* ok */ }
    for (const s of this.slots) {
      try { s.fx.output.disconnect(); } catch { /* ok */ }
    }
    const active = this.slots.filter((s) => !s.bypass).map((s) => s.fx);
    if (active.length === 0) {
      this.input.connect(this.output);
      return;
    }
    this.input.connect(active[0].input);
    for (let i = 0; i < active.length - 1; i++) {
      active[i].output.connect(active[i + 1].input);
    }
    active[active.length - 1].output.connect(this.output);
  }
}
