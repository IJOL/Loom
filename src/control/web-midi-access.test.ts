// src/control/web-midi-access.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMidiAccess } from './web-midi-access';

// Minimal fake Web MIDI.
function fakeInput(name: string) {
  return { id: 'in-' + name, name, manufacturer: 'Akai', onmidimessage: null as any };
}
function fakeOutput(name: string) {
  const sent: number[][] = [];
  return { id: 'out-' + name, name, manufacturer: 'Akai', send: (b: number[]) => sent.push(b), _sent: sent };
}
function fakeAccess(input: any, output: any) {
  return {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null as any,
  };
}

describe('web-midi-access', () => {
  it('reports unsupported when requestMIDIAccess is absent', async () => {
    const access = createMidiAccess({ nav: {} as any });
    const r = await access.enable();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected enable() to fail');
    expect(r.reason).toBe('unsupported');
  });

  it('binds the APC profile and routes parsed messages to onEvent', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const events: any[] = [];
    const access = createMidiAccess({ nav: nav as any });
    const r = await access.enable({ onEvent: (e) => events.push(e) });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected enable() to succeed');
    expect(r.profileId).toBe('apc-key25');
    // Simulate a pad press from the device.
    input.onmidimessage({ data: Uint8Array.from([0x90, 0, 100]) });
    expect(events).toContainEqual({ type: 'padPress', col: 0, row: 4 });
  });

  it('send() forwards bytes to the bound output', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const access = createMidiAccess({ nav: nav as any });
    await access.enable();
    access.send([0x90, 32, 1]);
    expect(output._sent).toContainEqual([0x90, 32, 1]);
  });

  it('disable() runs profile onDisconnect (all-LEDs-off) and stops routing', async () => {
    const input = fakeInput('APC Key 25');
    const output = fakeOutput('APC Key 25');
    const nav = { requestMIDIAccess: vi.fn(async () => fakeAccess(input, output)) };
    const access = createMidiAccess({ nav: nav as any });
    await access.enable();
    access.disable();
    // onDisconnect sends 40 pad-offs.
    expect(output._sent.filter((b) => b[0] === 0x90 && b[1] <= 39 && b[2] === 0).length).toBe(40);
  });
});
