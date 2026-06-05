// src/control/profiles/apc-key25.render.test.ts
import { describe, it, expect } from 'vitest';
import { apcKey25 } from './apc-key25';
import type { SurfaceView, CellState } from '../controller-profile';

function emptyCells(): CellState[][] {
  return Array.from({ length: 5 }, () => Array.from({ length: 8 }, () => ({ kind: 'empty' as const })));
}
function baseView(over: Partial<SurfaceView> = {}): SurfaceView {
  return {
    variant: 'mk1', cells: emptyCells(), scenes: ['empty','empty','empty','empty','empty'],
    anyPlaying: false, activeLaneCol: null, knobBank: 'device', ...over,
  };
}

describe('apc-key25 render (mk1)', () => {
  it('empty pad → velocity 0 (off) note-on at the pad note', () => {
    const cmds = apcKey25.render(baseView());
    const topLeft = cmds.find((c) => c.key === 'pad:32'); // row0/col0 → hwRow4 → note 32
    expect(topLeft).toBeDefined();
    expect(topLeft!.data).toEqual([0x90, 32, 0]);
  });
  it('playing pad → green (velocity 1)', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'playing' };
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:32');
    expect(cmd!.data).toEqual([0x90, 32, 1]);
  });
  it('stopped pad → amber (velocity 5)', () => {
    const cells = emptyCells();
    cells[4][7] = { kind: 'stopped' };  // bottom-right → note 7
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:7');
    expect(cmd!.data).toEqual([0x90, 7, 5]);
  });
  it('queued-launch pad → green blink (velocity 2)', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'queued-launch' };
    const cmd = apcKey25.render(baseView({ cells })).find((c) => c.key === 'pad:32');
    expect(cmd!.data).toEqual([0x90, 32, 2]);
  });
  it('scene with clips → lit; STOP ALL lit when anyPlaying', () => {
    const cmds = apcKey25.render(baseView({ scenes: ['has-clips','empty','empty','empty','empty'], anyPlaying: true }));
    expect(cmds.find((c) => c.key === 'scene:0')!.data).toEqual([0x90, 82, 1]);
    expect(cmds.find((c) => c.key === 'scene:1')!.data).toEqual([0x90, 83, 0]);
    expect(cmds.find((c) => c.key === 'stopall')!.data).toEqual([0x90, 81, 3]);
  });
});

describe('apc-key25 render (mk2 RGB)', () => {
  it('playing pad uses the clip colour palette index (non-zero), stopped is dimmer', () => {
    const cells = emptyCells();
    cells[0][0] = { kind: 'playing', color: '#23a559' };   // green-ish
    const playing = apcKey25.render(baseView({ variant: 'mk2', cells })).find((c) => c.key === 'pad:32');
    expect(playing!.data[0]).toBe(0x90);
    expect(playing!.data[1]).toBe(32);
    expect(playing!.data[2]).toBeGreaterThan(0);
  });
});

describe('apc-key25 onDisconnect', () => {
  it('sends all-LEDs-off for every pad', () => {
    const sent: number[][] = [];
    apcKey25.onDisconnect!((b) => sent.push(b), { variant: 'mk1' });
    // 40 pads off
    const offPads = sent.filter((b) => b[0] === 0x90 && b[1] <= 39 && b[2] === 0);
    expect(offPads.length).toBe(40);
  });
});
