import { emptyPattern, AUTOMATION_SUB_RES, type PatternData, type AutomationLane } from '../core/pattern';
import { TICKS_PER_STEP } from '../core/notes';
import type { DrumVoice } from '../core/drums';
import type { Sequencer } from '../core/sequencer';
import type { PatternBank } from '../core/pattern';
import type { SynthEngine } from '../engines/engine-types';
import { emptySessionState, type SessionState, type SessionClip } from '../session/session';

export interface DemoDeps {
  seq: Sequencer;
  bank: PatternBank;
  bpmInput: HTMLInputElement;
  barsSel: HTMLSelectElement;
  chainEnabled: () => boolean;
  chainBtn: HTMLButtonElement;
  setSlotConfigurators: (cbs: Array<(() => void) | null>) => void;
  /** Returns the live SynthEngine instance for a lane, or null if none. */
  getLaneEngineInstance: (laneId: string) => SynthEngine | null;
  updateSlotButtons: () => void;
  renderLanes: () => void;
  updateBassModeButtons: () => void;
}

export function buildMinimalTechnoDemo(): PatternData[] {
  const LEN = 32; // 2 bars × 16 steps

  const newPat = () => emptyPattern(LEN);
  const setBass = (p: PatternData, i: number, note: number, accent = false, slide = false) => {
    p.bass[i] = { on: true, note, accent, slide };
  };
  const setDrum = (p: PatternData, lane: DrumVoice, steps: number[], accents: number[] = []) => {
    for (const i of steps) p.drums[lane][i] = { on: true, accent: accents.includes(i) };
  };
  const setPoly = (p: PatternData, i: number, notes: number[], accent = false, tie = false) => {
    p.melody[i] = { on: true, notes: [...notes], accent, tie };
  };
  // Build a cutoff automation envelope on the main poly lane (becomes a
  // clip envelope after the Classic → Session migration). The canonical
  // paramId is `<laneId>.<spec.id>`; the main subtractive lane's slug is
  // `subtractive-1`, so the cutoff paramId is `subtractive-1.filter.cutoff`.
  const autoCutoff = (curve: (t: number) => number): AutomationLane => {
    const len = LEN * AUTOMATION_SUB_RES;
    return {
      paramId: 'subtractive-1.filter.cutoff', enabled: true, stepped: false, lengthBars: 2,
      values: new Array(len).fill(0).map((_, i) => Math.max(0, Math.min(1, curve(i / (len - 1))))),
    };
  };

  // ── A — Intro (subtractive): kick + hat pulse, sub bass root, low poly pad
  const A = newPat();
  A.engineId = 'subtractive';
  A.polyMode = 'step';
  setDrum(A, 'kick',      [0, 4, 8, 12, 16, 20, 24, 28]);
  setDrum(A, 'closedHat', [2, 6, 10, 14, 18, 22, 26, 30]);
  for (const i of [0, 8, 16, 24]) setBass(A, i, 36);
  setPoly(A, 0,  [48, 55], false, true); // low C2/G2 pad with tie
  setPoly(A, 16, [48, 55], false, true);
  A.automation.push(autoCutoff((t) => 0.30 + 0.08 * Math.sin(t * Math.PI)));

  // ── B — Build (wavetable): clap + open hat, rolling bass, wavetable stabs
  const B = newPat();
  B.engineId = 'wavetable';
  B.polyMode = 'step';
  setDrum(B, 'kick',      [0, 4, 8, 12, 16, 20, 24, 28]);
  setDrum(B, 'closedHat', [2, 6, 10, 14, 18, 22, 26, 30]);
  setDrum(B, 'openHat',   [6, 14, 22, 30]);
  setDrum(B, 'clap',      [4, 12, 20, 28]);
  const bassB = [36, 36, 43, 36, 36, 36, 41, 36, 36, 36, 43, 36, 36, 36, 41, 36];
  for (let bar = 0; bar < 2; bar++) {
    const o = bar * 16;
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) setBass(B, o + i, bassB[i], i === 0 && bar === 1);
    }
  }
  // Wavetable stabs morphing pattern: Cm and EbM
  setPoly(B, 2,  [60, 63, 67]);
  setPoly(B, 6,  [60, 63, 67]);
  setPoly(B, 10, [63, 67, 70]);
  setPoly(B, 14, [60, 63, 67]);
  setPoly(B, 18, [60, 63, 67]);
  setPoly(B, 22, [60, 63, 67], true);
  setPoly(B, 26, [63, 67, 70]);
  setPoly(B, 30, [65, 68, 72]); // FmM build tension
  B.automation.push(autoCutoff((t) => 0.35 + 0.30 * t));

  // ── C — Peak (FM): 303 piano roll acid line, FM bell stabs, extra poly pad
  const C = newPat();
  C.engineId = 'fm';
  C.polyMode = 'step'; // FM bell stabs are written into melody[]
  setDrum(C, 'kick',      [0, 4, 8, 12, 16, 20, 24, 28]);
  setDrum(C, 'closedHat', [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
  setDrum(C, 'openHat',   [6, 14, 22, 30]);
  setDrum(C, 'clap',      [4, 12, 20, 28]);
  setDrum(C, 'snare',     [7, 23]);
  // 303 PIANO ROLL — acid line built directly as NoteEvents (showcases piano mode)
  C.bassMode = 'piano';
  const acidLine: Array<{ s: number; n: number; a?: boolean; sl?: boolean }> = [
    { s: 0,  n: 36, a: true  }, { s: 2,  n: 36 }, { s: 3,  n: 36, sl: true },
    { s: 4,  n: 39, a: true  }, { s: 6,  n: 41 }, { s: 7,  n: 41, sl: true },
    { s: 8,  n: 43 }, { s: 10, n: 43 }, { s: 11, n: 41, sl: true },
    { s: 12, n: 39, a: true }, { s: 14, n: 36 },
    { s: 16, n: 36, a: true }, { s: 17, n: 36 }, { s: 19, n: 48, sl: true },
    { s: 20, n: 43, a: true }, { s: 22, n: 41 }, { s: 24, n: 43 },
    { s: 26, n: 41 }, { s: 28, n: 39, a: true }, { s: 30, n: 36 },
  ];
  C.bassNotes = acidLine.map((e) => ({
    start: e.s * TICKS_PER_STEP,
    duration: Math.floor(TICKS_PER_STEP * (e.sl ? 1.5 : 0.92)),
    midi: e.n,
    velocity: e.a ? 115 : 80,
  }));
  // FM bell stabs on offbeats
  setPoly(C, 2,  [72]);             // C5 bell
  setPoly(C, 6,  [75]);             // Eb5
  setPoly(C, 11, [79], true);       // G5 accent
  setPoly(C, 14, [75]);
  setPoly(C, 18, [72]);
  setPoly(C, 22, [82], true);       // Bb5 high
  setPoly(C, 27, [75]);
  setPoly(C, 30, [79]);
  // Extra poly track — sustained subtractive pad layer (Cm7 → Bb)
  C.extraPolyTracks.push({
    id: 'poly1', name: 'PAD', enabled: true,
    notes: [
      { start: 0,  duration: TICKS_PER_STEP * 16, midi: 48, velocity: 70 },
      { start: 0,  duration: TICKS_PER_STEP * 16, midi: 55, velocity: 70 },
      { start: TICKS_PER_STEP * 16, duration: TICKS_PER_STEP * 16, midi: 46, velocity: 70 },
      { start: TICKS_PER_STEP * 16, duration: TICKS_PER_STEP * 16, midi: 53, velocity: 70 },
    ],
  });
  C.automation.push(autoCutoff((t) => 0.55 + 0.25 * Math.sin(t * Math.PI * 4)));

  // ── D — Breakdown (subtractive): held bass, piano-roll poly chords, drama
  const D = newPat();
  D.engineId = 'subtractive';
  setDrum(D, 'kick',      [0, 16]);
  setDrum(D, 'closedHat', [6, 14, 22, 30]);
  setDrum(D, 'openHat',   [0, 16]);
  setDrum(D, 'snare',     [12, 28]);
  setBass(D, 0,  36, true,  true);
  setBass(D, 8,  39, false, true);
  setBass(D, 16, 41, true,  true);
  setBass(D, 24, 43, false, false);
  // Main poly in PIANO ROLL — sustained chords showcase
  D.polyMode = 'piano';
  const chord1: number[] = [60, 63, 67, 70]; // Cm7
  const chord2: number[] = [58, 62, 65, 69]; // BbM7
  for (const n of chord1) D.polyNotes.push({ start: 0,  duration: TICKS_PER_STEP * 16, midi: n, velocity: 100 });
  for (const n of chord2) D.polyNotes.push({ start: TICKS_PER_STEP * 16, duration: TICKS_PER_STEP * 16, midi: n, velocity: 100 });
  // Extra poly track — high lead motif
  D.extraPolyTracks.push({
    id: 'poly1', name: 'LEAD', enabled: true,
    notes: [
      { start: TICKS_PER_STEP * 4,  duration: TICKS_PER_STEP * 4, midi: 84, velocity: 100 },
      { start: TICKS_PER_STEP * 12, duration: TICKS_PER_STEP * 4, midi: 82, velocity: 90  },
      { start: TICKS_PER_STEP * 20, duration: TICKS_PER_STEP * 4, midi: 81, velocity: 100 },
      { start: TICKS_PER_STEP * 28, duration: TICKS_PER_STEP * 4, midi: 79, velocity: 80  },
    ],
  });
  D.automation.push(autoCutoff((t) => 0.75 - 0.55 * t));

  return [A, B, C, D];
}

export function applyMinimalTechnoDemo(deps: DemoDeps): void {
  const { seq, bank, bpmInput, barsSel } = deps;
  const getLaneEngineInstance = deps.getLaneEngineInstance;

  // Per-slot configurators: applied each time the slot is activated. Each
  // configurator looks up the lane's engine and applies a named factory
  // preset (instead of poking private fields inline).
  const applyPreset = (laneId: string, presetName: string) => {
    const inst = getLaneEngineInstance(laneId);
    if (!inst) return;
    const preset = inst.presets.find((p) => p.name === presetName);
    if (!preset) return;
    for (const [id, value] of Object.entries(preset.params)) {
      inst.setBaseValue(id, value);
    }
  };
  deps.setSlotConfigurators([
    null,                                                       // A: subtractive defaults
    () => applyPreset('subtractive-1', 'Bright Stab'),          // B: bright stab
    () => applyPreset('subtractive-1', 'Sub Bell'),             // C: sub-bell ping
    null,                                                       // D: subtractive defaults
  ]);

  const patterns = buildMinimalTechnoDemo();
  seq.bpm = 130;
  bpmInput.value = '130';
  barsSel.value = '32';
  for (let i = 0; i < 4; i++) bank.slots[i] = patterns[i];
  bank.current = 0;
  seq.setPattern(bank.slots[0]);
  seq.setLength(32);
  deps.updateSlotButtons();
  deps.renderLanes();
  deps.updateBassModeButtons();
  if (!deps.chainEnabled()) deps.chainBtn.click();
}

export function buildMinimalTechnoDemoSession(): SessionState {
  const state = emptySessionState();

  // 1-bar drums clip on `drums-1`: kicks on 1/5/9/13 (4-on-the-floor) and
  // closed hats on the offbeats 3/7/11/15. GM_DRUM_MAP: 36=kick, 42=ch hat.
  const drumsClip: SessionClip = {
    id: 'demo-drums-1',
    lengthBars: 1,
    notes: [
      { start: 0,                   duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 4,  duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 8,  duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 12, duration: TICKS_PER_STEP / 2, midi: 36, velocity: 110 },
      { start: TICKS_PER_STEP * 2,  duration: TICKS_PER_STEP / 2, midi: 42, velocity:  80 },
      { start: TICKS_PER_STEP * 6,  duration: TICKS_PER_STEP / 2, midi: 42, velocity:  80 },
      { start: TICKS_PER_STEP * 10, duration: TICKS_PER_STEP / 2, midi: 42, velocity:  80 },
      { start: TICKS_PER_STEP * 14, duration: TICKS_PER_STEP / 2, midi: 42, velocity:  80 },
    ],
  };

  // 2-bar acid bass on `tb-303-1`. Mix of accents + slides to show off the
  // TB-303's character.
  const bassClip: SessionClip = {
    id: 'demo-bass-1',
    lengthBars: 2,
    notes: [
      { start: 0,                   duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 36, velocity: 115 },
      { start: TICKS_PER_STEP * 3,  duration: Math.floor(TICKS_PER_STEP * 1.5),  midi: 36, velocity:  80 },
      { start: TICKS_PER_STEP * 4,  duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 39, velocity: 115 },
      { start: TICKS_PER_STEP * 7,  duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 39, velocity:  80 },
      { start: TICKS_PER_STEP * 16, duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 36, velocity: 115 },
      { start: TICKS_PER_STEP * 19, duration: Math.floor(TICKS_PER_STEP * 1.5),  midi: 41, velocity:  80 },
      { start: TICKS_PER_STEP * 22, duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 43, velocity:  80 },
      { start: TICKS_PER_STEP * 26, duration: Math.floor(TICKS_PER_STEP * 0.92), midi: 36, velocity:  80 },
    ],
  };

  // 4-bar pad chord progression on `subtractive-1`. Cm7 → BbM7.
  const padClip: SessionClip = {
    id: 'demo-pad-1',
    lengthBars: 4,
    notes: [
      { start: 0,                   duration: TICKS_PER_STEP * 32, midi: 48, velocity: 80 },
      { start: 0,                   duration: TICKS_PER_STEP * 32, midi: 55, velocity: 80 },
      { start: TICKS_PER_STEP * 32, duration: TICKS_PER_STEP * 32, midi: 46, velocity: 80 },
      { start: TICKS_PER_STEP * 32, duration: TICKS_PER_STEP * 32, midi: 53, velocity: 80 },
    ],
  };

  const bass  = state.lanes.find((l) => l.id === 'tb-303-1')!;
  const drums = state.lanes.find((l) => l.id === 'drums-1')!;
  const poly  = state.lanes.find((l) => l.id === 'subtractive-1')!;
  bass.clips[0]  = bassClip;
  drums.clips[0] = drumsClip;
  poly.clips[0]  = padClip;

  state.scenes.push({
    id: 'demo-scene-1',
    name: 'Demo',
    clipPerLane: {
      'tb-303-1':      0,
      'drums-1':       0,
      'subtractive-1': 0,
    },
  });

  return state;
}

export function wireDemoMinimalTechno(deps: DemoDeps): void {
  const btn = document.getElementById('demo-minimal-techno') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => applyMinimalTechnoDemo(deps));
}
