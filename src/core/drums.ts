// Synthesized drum-kit DATA (no samples). Each kit is a bag of parameters that
// the synthesis primitives consume — adding a new "model" means tweaking
// numbers, not writing new DSP.
//
// Phase 4 cutover: the node-per-note DrumMachine DSP class was deleted; the
// 8-output AudioWorklet (DrumsWorkletEngine + audio-dsp/drums) synthesises drums
// now. This module is pure DATA + helpers.

export type DrumVoice =
  | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'clap' | 'cowbell' | 'tom' | 'ride'
  | 'rimshot' | 'crash';

export const DRUM_LANES: DrumVoice[] = [
  'kick', 'snare', 'rimshot', 'closedHat', 'openHat', 'clap', 'cowbell', 'tom', 'ride', 'crash',
];

interface KickParams    { startFreq: number; endFreq: number; pitchDecay: number; ampDecay: number; clickAmount: number; tone: OscillatorType; }
interface SnareParams   { tone1: number; tone2: number; toneDecay: number; toneAmount: number; noiseAmount: number; noiseDecay: number; noiseFilter: number; }
interface HatParams     { decay: number; openDecay: number; tune: number; }
interface ClapParams    { decay: number; filterFreq: number; filterQ: number; }
interface CowbellParams { freq1: number; freq2: number; decay: number; }
interface TomParams     { startFreq: number; endFreq: number; pitchDecay: number; ampDecay: number; }
interface RideParams    { tune: number; decay: number; }
interface RimshotParams { freq: number; decay: number; }
interface CrashParams   { tune: number; decay: number; }

export interface Kit {
  id: string;
  name: string;
  description: string;
  kick: KickParams;
  snare: SnareParams;
  hat: HatParams;
  clap: ClapParams;
  cowbell: CowbellParams;
  tom: TomParams;
  ride: RideParams;
  rimshot: RimshotParams;
  crash: CrashParams;
}

export const WAVE_TYPES: OscillatorType[] = ['sine', 'triangle', 'square'];
const WAVE_INDEX: Record<string, number> = { sine: 0, triangle: 1, square: 2 };
const HAT_FILTER_DEFAULT = 7000;

/** Live, editable per-voice synthesis params. Seeded from the active kit by
 *  loadKitDefaults; read at trigger time by each play* method. Keys are the
 *  canonical leaf names documented in the plan. */
export type VoiceSynthState = Record<string, number>;
export type DrumSynthState = Record<DrumVoice, VoiceSynthState>;

export function seedSynthState(kit: Kit): DrumSynthState {
  // chokeGroup: 0 = none; voices sharing a non-zero group cut each other (mutually
  // exclusive). Default group 1 = {closedHat, openHat} — the standard hi-hat choke.
  return {
    kick: {
      tune: 1, attack: kit.kick.clickAmount, decay: kit.kick.ampDecay,
      startFreq: kit.kick.startFreq, endFreq: kit.kick.endFreq,
      sweep: kit.kick.pitchDecay, wave: WAVE_INDEX[kit.kick.tone] ?? 0, chokeGroup: 0,
    },
    snare: {
      tune: 1, tone: kit.snare.toneAmount, snap: kit.snare.noiseAmount,
      bodyDecay: kit.snare.toneDecay, noiseDecay: kit.snare.noiseDecay,
      noiseTone: kit.snare.noiseFilter, tone1: kit.snare.tone1, tone2: kit.snare.tone2, chokeGroup: 0,
    },
    closedHat: { tune: kit.hat.tune, decay: kit.hat.decay,    filter: HAT_FILTER_DEFAULT, chokeGroup: 1 },
    openHat:   { tune: kit.hat.tune, decay: kit.hat.openDecay, filter: HAT_FILTER_DEFAULT, chokeGroup: 1 },
    clap: { tone: kit.clap.filterFreq, decay: kit.clap.decay, sharp: kit.clap.filterQ, chokeGroup: 0 },
    tom: {
      tune: 1, decay: kit.tom.ampDecay, sweep: kit.tom.pitchDecay,
      startFreq: kit.tom.startFreq, end: kit.tom.endFreq, chokeGroup: 0,
    },
    cowbell: {
      tune: 1, decay: kit.cowbell.decay, detune: 1, // new param, no kit field — neutral default
      freq1: kit.cowbell.freq1, freq2: kit.cowbell.freq2, chokeGroup: 0,
    },
    ride: { tune: kit.ride.tune, decay: kit.ride.decay, chokeGroup: 0 },
    rimshot: { tune: 1, decay: kit.rimshot.decay, freq: kit.rimshot.freq, chokeGroup: 0 },
    crash:   { tune: kit.crash.tune, decay: kit.crash.decay, chokeGroup: 0 },
  };
}

/** Voices choked when `voice` triggers: all voices (including `voice` itself, to
 *  cut its own previous ring) that share its non-zero chokeGroup. [] if no group.
 *  Pure — drives both the live mechanism and its test. */
export function chokeGroupMates(synth: DrumSynthState, voice: DrumVoice): DrumVoice[] {
  const g = synth[voice]?.chokeGroup ?? 0;
  if (!(g > 0)) return [];
  return DRUM_LANES.filter((w) => (synth[w]?.chokeGroup ?? 0) === g);
}

export const KITS: Kit[] = [
  {
    id: '808', name: 'TR-808', description: 'Warm, boomy — hip hop / electro',
    kick:    { startFreq: 150, endFreq: 50, pitchDecay: 0.05, ampDecay: 0.9, clickAmount: 0.2, tone: 'sine' },
    snare:   { tone1: 200, tone2: 330, toneDecay: 0.06, toneAmount: 0.55, noiseAmount: 0.55, noiseDecay: 0.16, noiseFilter: 4000 },
    hat:     { decay: 0.05, openDecay: 0.4, tune: 1.0 },
    clap:    { decay: 0.22, filterFreq: 1200, filterQ: 1.5 },
    cowbell: { freq1: 540, freq2: 800, decay: 0.3 },
    tom:     { startFreq: 170, endFreq: 85, pitchDecay: 0.1, ampDecay: 0.6 },
    ride:    { tune: 1.4, decay: 1.5 },
    rimshot: { freq: 1700, decay: 0.03 },
    crash:   { tune: 1.0, decay: 2.6 },
  },
  {
    id: '909', name: 'TR-909', description: 'Punchy, electronic — house / techno',
    kick:    { startFreq: 220, endFreq: 55, pitchDecay: 0.03, ampDecay: 0.4, clickAmount: 0.7, tone: 'sine' },
    snare:   { tone1: 240, tone2: 360, toneDecay: 0.04, toneAmount: 0.35, noiseAmount: 0.75, noiseDecay: 0.18, noiseFilter: 7000 },
    hat:     { decay: 0.06, openDecay: 0.35, tune: 1.2 },
    clap:    { decay: 0.16, filterFreq: 1500, filterQ: 2.0 },
    cowbell: { freq1: 587, freq2: 845, decay: 0.25 },
    tom:     { startFreq: 200, endFreq: 95, pitchDecay: 0.08, ampDecay: 0.5 },
    ride:    { tune: 1.5, decay: 1.2 },
    rimshot: { freq: 1800, decay: 0.025 },
    crash:   { tune: 1.1, decay: 2.2 },
  },
  {
    id: '606', name: 'TR-606', description: 'Small, snappy — pairs with 303',
    kick:    { startFreq: 130, endFreq: 60, pitchDecay: 0.04, ampDecay: 0.3, clickAmount: 0.4, tone: 'triangle' },
    snare:   { tone1: 260, tone2: 390, toneDecay: 0.03, toneAmount: 0.3, noiseAmount: 0.7, noiseDecay: 0.1, noiseFilter: 5500 },
    hat:     { decay: 0.04, openDecay: 0.25, tune: 1.35 },
    clap:    { decay: 0.12, filterFreq: 1400, filterQ: 1.8 },
    cowbell: { freq1: 600, freq2: 880, decay: 0.2 },
    tom:     { startFreq: 220, endFreq: 130, pitchDecay: 0.05, ampDecay: 0.3 },
    ride:    { tune: 1.4, decay: 0.8 },
    rimshot: { freq: 1950, decay: 0.018 },
    crash:   { tune: 1.35, decay: 1.4 },
  },
  {
    id: '78', name: 'CR-78', description: 'Vintage preset — mellow disco',
    kick:    { startFreq: 130, endFreq: 55, pitchDecay: 0.06, ampDecay: 0.5, clickAmount: 0.1, tone: 'sine' },
    snare:   { tone1: 180, tone2: 280, toneDecay: 0.06, toneAmount: 0.6, noiseAmount: 0.4, noiseDecay: 0.18, noiseFilter: 3500 },
    hat:     { decay: 0.06, openDecay: 0.45, tune: 0.85 },
    clap:    { decay: 0.22, filterFreq: 1000, filterQ: 1.2 },
    cowbell: { freq1: 520, freq2: 770, decay: 0.32 },
    tom:     { startFreq: 170, endFreq: 90, pitchDecay: 0.1, ampDecay: 0.55 },
    ride:    { tune: 1.3, decay: 1.2 },
    rimshot: { freq: 1500, decay: 0.035 },
    crash:   { tune: 0.9, decay: 1.8 },
  },
  {
    id: 'linn', name: 'LinnDrum', description: 'Hybrid, 80s pop punch',
    kick:    { startFreq: 180, endFreq: 60, pitchDecay: 0.04, ampDecay: 0.45, clickAmount: 0.5, tone: 'sine' },
    snare:   { tone1: 210, tone2: 320, toneDecay: 0.05, toneAmount: 0.45, noiseAmount: 0.6, noiseDecay: 0.14, noiseFilter: 5000 },
    hat:     { decay: 0.05, openDecay: 0.32, tune: 1.1 },
    clap:    { decay: 0.18, filterFreq: 1300, filterQ: 1.6 },
    cowbell: { freq1: 560, freq2: 820, decay: 0.28 },
    tom:     { startFreq: 190, endFreq: 90, pitchDecay: 0.08, ampDecay: 0.45 },
    ride:    { tune: 1.5, decay: 1.0 },
    rimshot: { freq: 1600, decay: 0.03 },
    crash:   { tune: 1.0, decay: 2.9 },
  },
];

export const BY_ID: Record<string, Kit> = Object.fromEntries(KITS.map((k) => [k.id, k]));

/** Returns the static kit list without needing a DrumMachine instance.
 *  Phase G: used by main.ts to populate the kit selector at boot before
 *  lane allocation (applyLoadedSessionState) has run. */
export function listDrumKits(): Array<{ id: string; name: string; description: string }> {
  return KITS.map((k) => ({ id: k.id, name: k.name, description: k.description }));
}
// Phase 4 cutover: the DrumMachine node-per-note DSP class (+ makeWhiteNoise) was
// deleted. Drums now synthesise in the 8-output AudioWorklet (DrumsWorkletEngine
// + audio-dsp/drums). This file keeps ONLY the kit DATA + pure helpers (KITS / BY_ID
// / DRUM_LANES / Kit / DrumVoice / WAVE_TYPES / seedSynthState / chokeGroupMates /
// listDrumKits) that the worklet drums engine + UI consume.
