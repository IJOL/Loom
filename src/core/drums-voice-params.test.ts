import { describe, it, expect } from 'vitest';
import { OfflineAudioContext } from 'node-web-audio-api';
import { DrumMachine } from './drums';
import { FxBus } from './fx';

function makeDM(kit = '909'): DrumMachine {
  const ctx = new OfflineAudioContext(1, 1024, 44100) as unknown as AudioContext;
  const dest = ctx.createGain();
  const fx = new FxBus(ctx, dest);
  const dm = new DrumMachine(ctx, fx, dest);
  dm.loadKitDefaults(kit);
  return dm;
}

describe('DrumMachine per-voice synth store', () => {
  it('loadKitDefaults seeds the synth store from the kit', () => {
    const dm = makeDM('909');
    // 909 kick: startFreq 220, ampDecay 0.4, clickAmount 0.7
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(220);
    expect(dm.getVoiceParam('kick', 'decay')).toBe(0.4);
    expect(dm.getVoiceParam('kick', 'attack')).toBe(0.7);
    expect(dm.getVoiceParam('kick', 'tune')).toBe(1);
    expect(dm.getVoiceParam('kick', 'wave')).toBe(0); // sine
  });

  it('different kits seed different defaults', () => {
    const dm808 = makeDM('808'); // 808 kick startFreq 150
    expect(dm808.getVoiceParam('kick', 'startFreq')).toBe(150);
    const dm606 = makeDM('606'); // 606 kick tone triangle -> index 1
    expect(dm606.getVoiceParam('kick', 'wave')).toBe(1);
  });

  it('setVoiceParam / getVoiceParam round-trip', () => {
    const dm = makeDM('909');
    dm.setVoiceParam('snare', 'snap', 0.9);
    expect(dm.getVoiceParam('snare', 'snap')).toBe(0.9);
  });

  it('setKit changes the active id WITHOUT reseeding the store', () => {
    const dm = makeDM('909');
    dm.setVoiceParam('kick', 'startFreq', 999);
    dm.setKit('808'); // id only — must NOT clobber the tweak
    expect(dm.kitId).toBe('808');
    expect(dm.getVoiceParam('kick', 'startFreq')).toBe(999);
  });

  it('loadKitDefaults resets per-voice mixer to neutral', () => {
    const dm = makeDM('909');
    dm.channels.kick.setReverbSend(0.8);
    dm.loadKitDefaults('808');
    expect(dm.channels.kick.serialize().reverbSend).toBe(0);
    expect(dm.channels.kick.serialize().level).toBe(1);
  });

  it('getVoiceParam returns undefined for an unknown leaf', () => {
    const dm = makeDM('909');
    expect(dm.getVoiceParam('kick', 'nonexistent')).toBeUndefined();
  });
});

describe('closed/open hat are independent', () => {
  it('editing closedHat.tune does not change openHat.tune', () => {
    const dm = makeDM('909');
    const before = dm.getVoiceParam('openHat', 'tune');
    dm.setVoiceParam('closedHat', 'tune', 0.5);
    expect(dm.getVoiceParam('closedHat', 'tune')).toBe(0.5);
    expect(dm.getVoiceParam('openHat', 'tune')).toBe(before);
  });

  it('closed and open carry independent decay', () => {
    const dm = makeDM('909');
    // 909 hat: closed decay 0.06, open decay 0.35
    expect(dm.getVoiceParam('closedHat', 'decay')).toBe(0.06);
    expect(dm.getVoiceParam('openHat', 'decay')).toBe(0.35);
  });
});

describe('DrumMachine per-voice mute/solo', () => {
  it('setVoiceMute mutes only that voice strip', () => {
    const dm = makeDM('909');
    dm.setVoiceMute('snare', true);
    expect(dm.channels.snare.isMuted()).toBe(true);
    expect(dm.channels.kick.isMuted()).toBe(false);
    expect(dm.getVoiceMute('snare')).toBe(true);
  });

  it('solo mutes every other voice; soloed voice stays audible', () => {
    const dm = makeDM('909');
    dm.setVoiceSolo('kick', true);
    expect(dm.channels.kick.isMuted()).toBe(false);
    expect(dm.channels.snare.isMuted()).toBe(true);
    expect(dm.getVoiceSolo('kick')).toBe(true);
  });

  it('clearing solo restores the explicit mute state', () => {
    const dm = makeDM('909');
    dm.setVoiceMute('snare', true);
    dm.setVoiceSolo('kick', true);
    expect(dm.channels.snare.isMuted()).toBe(true);  // muted (not soloed)
    expect(dm.channels.kick.isMuted()).toBe(false);
    dm.toggleVoiceSolo('kick');                       // solo off
    expect(dm.channels.kick.isMuted()).toBe(false);   // kick not muted
    expect(dm.channels.snare.isMuted()).toBe(true);   // explicit mute survives
  });

  it('getVoiceMutes/setVoiceMutes round-trip (persistence)', () => {
    const dm = makeDM('909');
    dm.setVoiceMute('tom', true);
    const map = dm.getVoiceMutes();
    expect(map.tom).toBe(true);
    expect(map.kick).toBe(false);

    const dm2 = makeDM('909');
    dm2.setVoiceMutes(map);
    expect(dm2.channels.tom.isMuted()).toBe(true);
    expect(dm2.channels.kick.isMuted()).toBe(false);
  });
});
