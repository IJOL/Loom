// The seven params of a lane's ChannelStrip, as ONE declaration.
//
// These are the controls the lane's mixer column shows — level, pan, send A,
// send B and the three EQ bands. They are audio params like any other, but until
// now only ONE engine treated them that way: `drums-machine` declared these very
// seven ids inline, routed them in get/setBaseValue and handed their AudioParams
// to the modulation binder. That is why a drum lane's DRUM VOL could be
// automated and a Subtractive lane's LEVEL could not — the capability was a
// property of one engine's source file, not of the mixer.
//
// So this file is the extraction, not a new scheme. The ids are drums' ids
// unchanged (`bus.level`, `bus.eq.low`, …). Anything with a ChannelStrip now
// declares the same list from here:
//
//   • the engine descriptors, by spreading STRIP_PARAM_SPECS into their params —
//     which is the whole reason the destination catalogue lists them, since
//     listAutomationTargets walks `engine.params` and takes the continuous ones;
//   • the engines' get/setBaseValue, via getStripParam/setStripParam, so a clip
//     envelope or a timeline curve replays onto the real nodes;
//   • getSharedAudioParams, via stripAudioParams, so an LFO can reach them;
//   • the mixer column's knob ids, so right-clicking one finds a destination.
//
// The alternative — a second `mix.<param>` vocabulary alongside `bus.*` — was
// what the approved 2026-07-19 spec prescribed, written before drums had these.
// Two id families for one set of audio nodes is the "N solutions to the same
// problem" shape the duplication audit exists to stop, and it would have needed
// its own parse branch, its own apply target and its own binder source. Reusing
// `bus.*` needs none of that: they are ordinary engine params all the way down.
//
// NAMING, deliberately kept: `delaySend`/`reverbSend` rather than `sendA`/`sendB`
// (what ChannelState calls them). Renaming would break every saved drum lane's
// envelopes and connections, which DO contain these ids today.

import type { EngineParamSpec } from '../engines/engine-params';
import type { ChannelStrip } from './fx';

/** Every strip param id starts here. The one string that decides whether an
 *  engine-local param id addresses the lane's strip or the engine's own voice. */
export const STRIP_PARAM_PREFIX = 'bus.';

/** Does this engine-local param id address the lane's ChannelStrip?
 *  Prefix test on a DOT boundary — `busy.level` is not a strip param. */
export function isStripParamId(id: string): boolean {
  return id.startsWith(STRIP_PARAM_PREFIX);
}

/** The seven, in mixer-column order. Copied verbatim from what
 *  drums-worklet-engine declared inline, so drum lanes keep the ranges, labels
 *  and units their knobs and saved sessions were built with. */
export const STRIP_PARAM_SPECS: readonly EngineParamSpec[] = [
  { id: 'bus.level',      label: 'Vol', kind: 'continuous', min: 0,   max: 1.5, default: 1 },
  { id: 'bus.pan',        label: 'Pan', kind: 'continuous', min: -1,  max: 1,   default: 0 },
  { id: 'bus.delaySend',  label: 'A',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.reverbSend', label: 'B',   kind: 'continuous', min: 0,   max: 1,   default: 0 },
  { id: 'bus.eq.low',     label: 'Lo',  kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.mid',     label: 'Mid', kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
  { id: 'bus.eq.high',    label: 'Hi',  kind: 'continuous', min: -18, max: 18,  default: 0, unit: 'dB' },
];

/** Read a strip param off the live nodes. `undefined` for an id this file does
 *  not own — the caller then knows to try the engine's own params. */
export function getStripParam(strip: ChannelStrip, id: string): number | undefined {
  const s = strip.serialize();
  switch (id) {
    case 'bus.level':      return s.level;
    case 'bus.pan':        return s.pan;
    case 'bus.delaySend':  return s.sendA;
    case 'bus.reverbSend': return s.sendB;
    case 'bus.eq.low':     return s.eqLow;
    case 'bus.eq.mid':     return s.eqMid;
    case 'bus.eq.high':    return s.eqHigh;
    default:               return undefined;
  }
}

/** Write a strip param onto the live nodes. Returns false for an id this file
 *  does not own, so a caller can fall through instead of swallowing the write —
 *  a silent no-op here reads to the user as "automation does nothing". */
export function setStripParam(strip: ChannelStrip, id: string, v: number): boolean {
  switch (id) {
    case 'bus.level':      strip.setLevel(v);  return true;
    case 'bus.pan':        strip.setPan(v);    return true;
    case 'bus.delaySend':  strip.setSendA(v);  return true;
    case 'bus.reverbSend': strip.setSendB(v);  return true;
    case 'bus.eq.low':     strip.setEqLow(v);  return true;
    case 'bus.eq.mid':     strip.setEqMid(v);  return true;
    case 'bus.eq.high':    strip.setEqHigh(v); return true;
    default:               return false;
  }
}

/** The AudioParams a MODULATOR may bind to, keyed by the same ids — what an
 *  engine hands over from getSharedAudioParams.
 *
 *  For pan and the EQ bands these are the params themselves: both are bipolar by
 *  nature (−1..+1, ±18 dB), so a modulator summed onto them behaves.
 *
 *  For the three GAINS they are the strip's multiplicative trims, NOT
 *  `level.gain`/`sendA.gain`/`sendB.gain`. The binder sums a bipolar modulator
 *  into its target, and a gain driven below zero inverts the signal instead of
 *  quietening it — which cancels against the other channels and makes
 *  instruments vanish. A trim parked at 1 with a 0..1 modulation range swings
 *  1 ± depth, so it never goes negative and the modulation is relative to
 *  wherever the fader sits. Automation is unaffected: it goes through
 *  setStripParam, straight onto the real gain. */
export function stripAudioParams(strip: ChannelStrip): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['bus.level',      strip.levelMod.gain],
    ['bus.pan',        strip.getPanParam()],
    ['bus.delaySend',  strip.sendAMod.gain],
    ['bus.reverbSend', strip.sendBMod.gain],
    ['bus.eq.low',     strip.getEqGainParam('low')],
    ['bus.eq.mid',     strip.getEqGainParam('mid')],
    ['bus.eq.high',    strip.getEqGainParam('high')],
  ]);
}

/** The AudioParams AUTOMATION addresses — the real gains and filter gains, not
 *  the modulation trims. Live automation goes through setStripParam (a plain
 *  value write on the audio thread's next block, which is what a knob does too);
 *  this exists for the OFFLINE render, where every value must be SCHEDULED
 *  before rendering starts or only the last one would survive. */
export function stripAutomationParams(strip: ChannelStrip): Map<string, AudioParam> {
  return new Map<string, AudioParam>([
    ['bus.level',      strip.level.gain],
    ['bus.pan',        strip.getPanParam()],
    ['bus.delaySend',  strip.sendA.gain],
    ['bus.reverbSend', strip.sendB.gain],
    ['bus.eq.low',     strip.getEqGainParam('low')],
    ['bus.eq.mid',     strip.getEqGainParam('mid')],
    ['bus.eq.high',    strip.getEqGainParam('high')],
  ]);
}

/** The range a modulator's depth is scaled by for `id` — which is NOT always the
 *  automation range the knob shows.
 *
 *  The binder computes its bridge gain as `depth · (max − min)` and sums the
 *  result into the target. For the three gains that target is a trim parked at 1
 *  (see stripAudioParams), so 0..1 means full depth swings it 0..2: the whole
 *  usable range, no phase inversion possible. Handing the binder the fader's own
 *  0..1.5 instead would swing the trim to −0.5.
 *
 *  Pan and EQ modulate over their declared range, which is already what a user
 *  means by "full depth". */
export function stripModulationRange(id: string): { min: number; max: number } | undefined {
  if (id === 'bus.level' || id === 'bus.delaySend' || id === 'bus.reverbSend') {
    return { min: 0, max: 1 };
  }
  const spec = STRIP_PARAM_SPECS.find((s) => s.id === id);
  return spec ? { min: spec.min, max: spec.max } : undefined;
}
