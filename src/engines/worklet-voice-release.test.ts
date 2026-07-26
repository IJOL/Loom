/** @vitest-environment jsdom */
// The main-thread half of the live-keyboard chord fix (2026-07-26).
//
// The live voice pool (src/control/live-keyboard.ts) calls voice.release(t) when
// a key comes up. That used to reach LoomWorkletNode.silenceAll(), i.e.
// steal(1024) — every voice on the lane. Lifting one key of a held chord killed
// the chord. Each voice must now release only itself.
import { describe, it, expect, vi } from 'vitest';
import type { NoteSpec, ParamBag } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';

const spawns: NoteSpec[] = [];
const releasedIds: number[] = [];
let silenceAllCalls = 0;
let stealCalls: number[] = [];

vi.mock('../audio-worklet/loom-node', () => ({
  loadLoomWorklet: vi.fn().mockResolvedValue(undefined),
  LoomWorkletNode: class {
    constructor(_ctx: unknown, _engineId?: string) {}
    spawn(n: NoteSpec) { spawns.push(n); }
    releaseVoice(id: number) { releasedIds.push(id); }
    setParams(_p: ParamBag) {}
    setMaxVoices(_n: number) {}
    setMods(_m: ModLite[]) {}
    steal(c: number) { stealCalls.push(c); }
    silenceAll() { silenceAllCalls++; }
    onVoiceCount() {}
    onModValues() {}
    connect() {} disconnect() {} dispose() {}
  },
}));

import { WorkletLaneEngine, type WorkletEngineConfig } from './worklet-lane-engine';
import { SUB_PARAM_SPECS } from './subtractive-params';

const out = () => ({ connect() {} }) as unknown as AudioNode;
const cfg = (): WorkletEngineConfig => ({
  engineId: 'subtractive', name: 'Sub', params: SUB_PARAM_SPECS,
  presetsKey: 'subtractive', polyphony: 'poly',
});
const makeEngine = () => new WorkletLaneEngine({} as AudioContext, out(), cfg());

const reset = () => { spawns.length = 0; releasedIds.length = 0; silenceAllCalls = 0; stealCalls = []; };

describe('WorkletVoice release is per-voice', () => {
  it('every spawned voice carries its own id', () => {
    reset();
    const eng = makeEngine();
    const a = eng.createVoice({} as AudioContext, out());
    const b = eng.createVoice({} as AudioContext, out());
    a.trigger(60, 0, { gateDuration: 3600 });
    b.trigger(64, 0, { gateDuration: 3600 });

    expect(spawns).toHaveLength(2);
    expect(spawns[0].voiceId).toBeTypeOf('number');
    expect(spawns[1].voiceId).toBeTypeOf('number');
    expect(spawns[0].voiceId).not.toBe(spawns[1].voiceId);
  });

  it('user: releasing one voice releases THAT voice and never silences the lane', () => {
    reset();
    const eng = makeEngine();
    const a = eng.createVoice({} as AudioContext, out());
    const b = eng.createVoice({} as AudioContext, out());
    const c = eng.createVoice({} as AudioContext, out());
    a.trigger(60, 0, { gateDuration: 3600 });
    b.trigger(64, 0, { gateDuration: 3600 });
    c.trigger(67, 0, { gateDuration: 3600 });

    b.release(1.0);                       // lift the middle key

    expect(releasedIds).toEqual([spawns[1].voiceId]);
    expect(silenceAllCalls).toBe(0);      // the whole-lane kill must NOT happen
    expect(stealCalls).toEqual([]);
  });

  it('releasing a voice that never triggered is a no-op', () => {
    reset();
    const eng = makeEngine();
    const v = eng.createVoice({} as AudioContext, out());
    v.release(0.5);
    expect(releasedIds).toEqual([]);
    expect(silenceAllCalls).toBe(0);
  });

  it('silenceLane still kills the whole lane — the transport Stop path survives', () => {
    reset();
    const eng = makeEngine();
    const v = eng.createVoice({} as AudioContext, out());
    v.trigger(60, 0, { gateDuration: 3600 });

    (v as unknown as { silenceLane(): void }).silenceLane();

    expect(silenceAllCalls).toBe(1);
  });
});
