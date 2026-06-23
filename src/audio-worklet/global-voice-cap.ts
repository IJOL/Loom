// src/audio-worklet/global-voice-cap.ts
// Main-thread coordinator holding a TOTAL simultaneous-voice budget across all
// worklet lanes. Each lane's LoomWorkletNode reports its active count (~30 Hz,
// see loom-processor.ts). When the global sum exceeds the budget, the busiest
// lane is told to steal its overflow — the lever that ends peak dropouts.

interface CapNode {
  steal(n: number): void;
  onVoiceCount(cb: (n: number) => void): void;
}

export class GlobalVoiceCap {
  private counts = new Map<string, number>();
  private nodes = new Map<string, CapNode>();
  constructor(private budget: number) {}

  get total(): number { let s = 0; for (const c of this.counts.values()) s += c; return s; }
  setBudget(n: number): void { this.budget = Math.max(1, n); }

  register(laneId: string, node: CapNode): void {
    this.nodes.set(laneId, node);
    this.counts.set(laneId, 0);
    node.onVoiceCount((n) => {
      // Ignore reports from a node that has since been replaced/unregistered for
      // this lane (its worklet keeps posting briefly after dispose) — otherwise
      // a stale callback would resurrect a removed lane's count.
      if (this.nodes.get(laneId) !== node) return;
      this.counts.set(laneId, n);
      this.enforce();
    });
  }

  unregister(laneId: string): void {
    this.nodes.delete(laneId);
    this.counts.delete(laneId);
  }

  private enforce(): void {
    const overflow = this.total - this.budget;
    if (overflow <= 0) return;
    let busiest: string | null = null; let max = -1;
    for (const [id, c] of this.counts) if (c > max) { max = c; busiest = id; }
    if (busiest) this.nodes.get(busiest)?.steal(overflow);
  }
}
