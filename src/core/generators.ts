// src/core/generators.ts
// Generadores de notas por estilo, anclados a una tonalidad. Sustituyen el azar
// plano de session/clip-randomize. Puros: rng inyectable → deterministas en test.
import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { scaleDegreeToMidi, type ScaleId, type StyleId } from './musicality';

export type GenKind = 'bass' | 'melody' | 'beat';
export interface GenContext {
  key: number; scale: ScaleId;
  bars: number; stepsPerBar: number;
  octaveBase: number;          // midi de la octava base del editor (p. ej. 36 = C2)
  rng: () => number;           // [0,1)
}

const GM = { kick: 36, snare: 38, hat: 42, openhat: 46, clap: 39 } as const;
const ACCENT = 115, NORM = 80;

interface BassCfg { density: number; octaves: number[]; slideChance: number; accentChance: number; degreePool: number[]; }
const BASS: Record<StyleId, BassCfg> = {
  acid:      { density: 0.7,  octaves: [0, 1],     slideChance: 0.35, accentChance: 0.3,  degreePool: [0, 0, 0, 2, 4, 6] },
  house:     { density: 0.45, octaves: [0],        slideChance: 0.1,  accentChance: 0.2,  degreePool: [0, 4, 0, 2] },
  synthwave: { density: 0.55, octaves: [0, 1],     slideChance: 0.05, accentChance: 0.25, degreePool: [0, 2, 4, 0] },
  lofi:      { density: 0.22, octaves: [0],        slideChance: 0.0,  accentChance: 0.1,  degreePool: [0, 4, 6] },
};
interface MelCfg { density: number; longChance: number; spanDegrees: number; }
const MEL: Record<StyleId, MelCfg> = {
  acid:      { density: 0.35, longChance: 0.1, spanDegrees: 7 },
  house:     { density: 0.3,  longChance: 0.3, spanDegrees: 7 },
  synthwave: { density: 0.45, longChance: 0.2, spanDegrees: 9 },
  lofi:      { density: 0.18, longChance: 0.5, spanDegrees: 5 },
};
interface BeatCfg { kickEveryBeat: boolean; snareBackbeat: boolean; hatChance: number; hatStep: number; openHatChance: number; }
const BEAT: Record<StyleId, BeatCfg> = {
  acid:      { kickEveryBeat: true,  snareBackbeat: false, hatChance: 0.8, hatStep: 1, openHatChance: 0.1 },
  house:     { kickEveryBeat: true,  snareBackbeat: true,  hatChance: 0.9, hatStep: 2, openHatChance: 0.2 },
  synthwave: { kickEveryBeat: false, snareBackbeat: true,  hatChance: 0.6, hatStep: 2, openHatChance: 0.05 },
  lofi:      { kickEveryBeat: false, snareBackbeat: true,  hatChance: 0.4, hatStep: 2, openHatChance: 0.0 },
};

const pick = <T,>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

function genBass(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = BASS[style];
  const steps = c.bars * c.stepsPerBar;
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (c.rng() >= cfg.density) continue;
    const degree = pick(cfg.degreePool, c.rng) + pick(cfg.octaves, c.rng) * 7;
    const midi = scaleDegreeToMidi(degree, c.octaveBase, c.key, c.scale);
    const slide = c.rng() < cfg.slideChance;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: Math.floor(TICKS_PER_STEP * (slide ? 1.5 : 0.92)), // slide = duración solapada (ver notes.ts)
      midi,
      velocity: c.rng() < cfg.accentChance ? ACCENT : NORM,
    });
  }
  if (out.length === 0) out.push({ start: 0, duration: TICKS_PER_STEP, midi: scaleDegreeToMidi(0, c.octaveBase, c.key, c.scale), velocity: NORM });
  return out;
}

function genMelody(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = MEL[style];
  const steps = c.bars * c.stepsPerBar;
  const out: NoteEvent[] = [];
  let degree = 0;
  const melBase = c.octaveBase + 12; // una octava por encima del bajo
  for (let i = 0; i < steps; i++) {
    if (c.rng() >= cfg.density) continue;
    // contorno: paseo aleatorio acotado, sesgado a volver al centro
    degree += Math.round((c.rng() - 0.5) * 4);
    degree = Math.max(0, Math.min(cfg.spanDegrees, degree));
    const long = c.rng() < cfg.longChance;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP * (long ? 2 : 1),
      midi: scaleDegreeToMidi(degree, melBase, c.key, c.scale),
      velocity: c.rng() < 0.25 ? ACCENT : NORM,
    });
  }
  // resolución a la tónica en el último step si hay hueco
  const lastStart = (steps - 1) * TICKS_PER_STEP;
  if (!out.some((n) => n.start === lastStart)) {
    out.push({ start: lastStart, duration: TICKS_PER_STEP, midi: scaleDegreeToMidi(0, melBase, c.key, c.scale), velocity: NORM });
  }
  return out;
}

function genBeat(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = BEAT[style];
  const steps = c.bars * c.stepsPerBar;
  const stepsPerBeat = c.stepsPerBar / 4;
  const out: NoteEvent[] = [];
  const at = (i: number, midi: number, vel: number) => out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: vel });
  for (let i = 0; i < steps; i++) {
    const onBeat = i % stepsPerBeat === 0;
    const beatIdx = Math.floor(i / stepsPerBeat) % 4;
    if (onBeat && (cfg.kickEveryBeat || beatIdx === 0)) at(i, GM.kick, ACCENT);
    if (cfg.snareBackbeat && onBeat && (beatIdx === 1 || beatIdx === 3)) at(i, GM.snare, NORM);
    if (i % cfg.hatStep === 0 && c.rng() < cfg.hatChance) {
      at(i, c.rng() < cfg.openHatChance ? GM.openhat : GM.hat, 70);
    }
  }
  // garantía: kick en el primer downbeat
  if (!out.some((n) => n.midi === GM.kick && n.start === 0)) at(0, GM.kick, ACCENT);
  return out;
}

export function generate(kind: GenKind, style: StyleId, ctx: GenContext): NoteEvent[] {
  if (kind === 'bass') return genBass(style, ctx);
  if (kind === 'melody') return genMelody(style, ctx);
  return genBeat(style, ctx);
}
