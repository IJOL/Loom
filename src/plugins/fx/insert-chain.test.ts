// src/plugins/fx/insert-chain.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InsertChain } from './insert-chain';
import type { FxInstance } from '../types';

class FakeNode {
  connections: FakeNode[] = [];
  connect(d: FakeNode) { this.connections.push(d); }
  disconnect() { this.connections = []; }
}

function makeFx(): FxInstance {
  const input  = new FakeNode();
  const output = new FakeNode();
  input.connect(output);  // pass-through DSP
  return {
    input: input as unknown as AudioNode,
    output: output as unknown as AudioNode,
    getAudioParams: () => new Map(),
    getBaseValue: () => 0, setBaseValue: () => {}, applyPreset: () => {},
    dispose: () => {},
  };
}

describe('InsertChain', () => {
  let input: FakeNode, output: FakeNode, chain: InsertChain;

  beforeEach(() => {
    input = new FakeNode();
    output = new FakeNode();
    chain = new InsertChain(input as any, output as any);
  });

  it('connects input → output directly when empty', () => {
    expect(input.connections).toContain(output);
  });

  it('one insert: input → fx.input, fx.output → output', () => {
    const fx = makeFx();
    chain.insert(fx);
    expect(input.connections).toContain(fx.input);
    expect((fx.output as any as FakeNode).connections).toContain(output);
  });

  it('two inserts chain serially', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    expect(input.connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('bypass routes around a slot', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.setBypass(0, true);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(output);
  });

  it('remove disposes and rewires', () => {
    const a = makeFx(); const b = makeFx();
    let disposed = false;
    a.dispose = () => { disposed = true; };
    chain.insert(a); chain.insert(b);
    chain.remove(0);
    expect(disposed).toBe(true);
    expect(input.connections).toContain(b.input);
  });

  it('reorder swaps and rewires', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.reorder(0, 1);
    expect(input.connections).toContain(b.input);
    expect((b.output as any as FakeNode).connections).toContain(a.input);
    expect((a.output as any as FakeNode).connections).toContain(output);
  });

  it('dispose tears down all slots and clears connections', () => {
    const a = makeFx(); const b = makeFx();
    chain.insert(a); chain.insert(b);
    chain.dispose();
    expect(chain.list().length).toBe(0);
  });

  it('exposes inputNode for upstream wiring', () => {
    const inp = new FakeNode();
    const out = new FakeNode();
    const chain2 = new InsertChain(inp as any, out as any);
    expect(chain2.inputNode).toBe(inp);
  });
});
