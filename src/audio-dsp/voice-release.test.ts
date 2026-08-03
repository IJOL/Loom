// Releasing ONE voice must not silence the others.
//
// Regression test for the live-keyboard chord bug (2026-07-26): holding a chord
// and lifting a single key killed the whole lane, because the only release the
// worklet understood was "steal N oldest" and WorkletVoice.release() asked for
// 1024 of them. Measured in the real app: a 3-note chord at RMS 0.1954 dropped
// to 0.0129 (−93 %) when ONE key was lifted, while an untouched control chord
// held at 0.2037.
//
// The kernel side of the fix: a voice carries an id, and the manager can release
// exactly that one.
import { describe, it, expect } from 'vitest';
import { VoiceManager } from './voice-manager';
// `test/plugin-dsp` installs the Loom global a plugin's dsp.ts registers
// through, so it MUST stay above the plugin import below.
import '../../test/plugin-dsp';
import '../../plugins/subtractive/dsp';   // side-effect: registers the 'subtractive' renderer
import type { ParamBag, NoteSpec } from './types';

const SR = 48000;
const P: ParamBag = {};

const note = (midi: number, voiceId?: number): NoteSpec => ({
  midi, beginSec: 0, durationSec: 3600,   // held, like a key you're still pressing
  velocity: 0.8, accent: false, slide: false, voiceId,
});

/** Render past the release tail so released voices self-free via `done`. */
const renderPastRelease = (vm: VoiceManager) => {
  for (let i = 0; i < SR * 0.6; i++) vm.renderSample(i / SR);
};

const rms = (vm: VoiceManager, samples: number, t0 = 0) => {
  let acc = 0;
  for (let i = 0; i < samples; i++) { const s = vm.renderSample(t0 + i / SR); acc += s * s; }
  return Math.sqrt(acc / samples);
};

describe('per-voice release', () => {
  it('user: lifting one key of a held chord leaves the other notes sounding', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setMaxVoices(8);
    vm.spawn(note(60, 1));
    vm.spawn(note(64, 2));
    vm.spawn(note(67, 3));
    expect(vm.activeCount).toBe(3);

    vm.releaseVoice(2);              // lift the middle key only
    renderPastRelease(vm);

    expect(vm.activeCount).toBe(2);  // the other two still hold
  });

  it('user: the chord stays audible after one key is lifted', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setMaxVoices(8);
    vm.spawn(note(60, 1));
    vm.spawn(note(64, 2));
    vm.spawn(note(67, 3));
    const full = rms(vm, SR * 0.2);

    vm.releaseVoice(1);
    renderPastRelease(vm);
    const remaining = rms(vm, SR * 0.2, 0.8);

    // Two of three voices left: comfortably more than half the full chord, and
    // nowhere near the silence the bug produced. Relative, never absolute.
    expect(remaining).toBeGreaterThan(full * 0.5);
  });

  it('releasing an unknown id is a harmless no-op — nothing else is silenced', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setMaxVoices(8);
    vm.spawn(note(60, 1));
    vm.spawn(note(64, 2));

    vm.releaseVoice(999);
    renderPastRelease(vm);

    expect(vm.activeCount).toBe(2);
  });

  it('releasing the same id twice is harmless (key repeat / stop after note-off)', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setMaxVoices(8);
    vm.spawn(note(60, 1));
    vm.spawn(note(64, 2));

    vm.releaseVoice(1);
    vm.releaseVoice(1);
    renderPastRelease(vm);

    expect(vm.activeCount).toBe(1);
  });

  it('steal(count) still silences everything — the transport Stop path is unchanged', () => {
    const vm = new VoiceManager(SR, 'subtractive', P);
    vm.setMaxVoices(8);
    vm.spawn(note(60, 1));
    vm.spawn(note(64, 2));
    vm.spawn(note(67, 3));

    vm.steal(1024);
    renderPastRelease(vm);

    expect(vm.activeCount).toBe(0);
  });
});
