// Pure CompBlock tests — no AudioContext. A stub context is what makes the
// gain-reduction contract testable at all: `DynamicsCompressorNode.reduction` is
// read-only on every real backend, so only a stub lets a test say "the node is
// reporting -8 dB right now". The audible behaviour (does it actually compress,
// is bypass a pass-through) is covered by comp-block.dsp.test.ts.

import { describe, it, expect } from 'vitest';
import { CompBlock } from './comp-block';

interface StubParam {
  value: number;
  setTargetAtTime(v: number, t: number, c: number): void;
}

function stubParam(value: number): StubParam {
  return { value, setTargetAtTime(v: number) { this.value = v; } };
}

class StubNode {
  outputs = new Set<StubNode>();
  connect(dst: StubNode): StubNode { this.outputs.add(dst); return dst; }
  disconnect(): void { this.outputs.clear(); }
}

class StubGain extends StubNode { gain = stubParam(1); }

class StubComp extends StubNode {
  threshold = stubParam(-24);
  ratio     = stubParam(4);
  attack    = stubParam(0.003);
  release   = stubParam(0.25);
  knee      = stubParam(30);
  /** Writable here; on a real node the browser owns it. */
  reduction = 0;
}

function stubCtx() {
  const comps: StubComp[] = [];
  const ctx = {
    currentTime: 0,
    createGain: () => new StubGain(),
    createDynamicsCompressor: () => {
      const c = new StubComp();
      comps.push(c);
      return c;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, comps };
}

/** The compressor node CompBlock built, with `reduction` writable. */
function compOf(handle: { comps: StubComp[] }): StubComp {
  return handle.comps[0];
}

describe('CompBlock.getReduction', () => {
  it('reports what the compressor is doing while it is in the signal path', () => {
    const h = stubCtx();
    const block = new CompBlock(h.ctx, { bypass: false });
    compOf(h).reduction = -8;
    expect(block.getReduction()).toBe(-8);
  });

  it('reports no reduction while bypassed, whatever the stale node still says', () => {
    // rewire() takes the compressor OUT of the graph on bypass (no input, no path
    // to the destination), so the node stops being rendered and `reduction`
    // freezes at its last reading. Handing that back would paint gain reduction
    // the lane is not receiving — the exact opposite of what a GR meter is for.
    const h = stubCtx();
    const block = new CompBlock(h.ctx, { bypass: false });
    compOf(h).reduction = -8;
    const whileCompressing = block.getReduction();

    block.setState({ bypass: true });

    expect(compOf(h).reduction).toBe(-8);              // the stale reading is still there…
    expect(block.getReduction()).toBe(0);              // …and it is not what we report
    expect(Math.abs(block.getReduction()))
      .toBeLessThan(Math.abs(whileCompressing));
  });

  it('reads the node again as soon as bypass is released', () => {
    const h = stubCtx();
    const block = new CompBlock(h.ctx, { bypass: true });
    compOf(h).reduction = -6;
    const bypassed = Math.abs(block.getReduction());

    block.setState({ bypass: false });

    expect(Math.abs(block.getReduction())).toBeGreaterThan(bypassed);
  });

  it('reads as "not compressing" on a backend without a reduction reading', () => {
    const h = stubCtx();
    const block = new CompBlock(h.ctx, { bypass: false });
    const comp = compOf(h) as unknown as { reduction: unknown };

    comp.reduction = undefined;
    expect(block.getReduction()).toBe(0);
    comp.reduction = NaN;
    expect(block.getReduction()).toBe(0);
  });
});
