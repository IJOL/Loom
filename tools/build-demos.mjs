// Generator for the showcase demos.
//
// Design (per user feedback):
//  • Each demo is COMPLETE on one Play — every lane has ONE long clip, launched
//    together by ONE scene, looping. The build lives INSIDE the clips (sections
//    sequenced one after another), not across scenes you click through.
//  • Full arrangements with the supporting channels each piece needs. Delicate
//    pieces keep their lead instrument pristine and accompaniment stays light.
//  • The FM engine is avoided on purpose (it reads harsh / out-of-tune).
//
// Run:  node tools/build-demos.mjs   (writes public/demos/*.json)
//
// Tick grid (must match src/core/notes.ts + src/core/pattern.ts):
//   TICKS_PER_QUARTER = 96, bar(4/4) = 384, 16th = 24, AUTOMATION_SUB_RES = 16.
//   Accent  = velocity >= 100. Slide (tb303) = a note whose end overlaps the
//   next note's start. Envelope length = lengthBars * 16 * 16 ; values 0..1 map
//   onto the target knob's [min,max] (paramId = `<laneId>.<localParamId>`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TPQ = 96;
const BAR = TPQ * 4;          // 384
const S16 = TPQ / 4;          // 24  (one sixteenth)
const SUB_RES = 16;           // AUTOMATION_SUB_RES
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demos');

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const note = (start, duration, midi, velocity) => ({ start, duration, midi, velocity });
const env = (paramId, values) => ({ paramId, values, enabled: true, stepped: false });
const COLORS = ['#a8c8e8', '#a8e0d8', '#d8e8a8', '#f4c8a8', '#c8a8e0', '#f4b8b8'];
const DRUM = { K: 36, SN: 38, CLP: 39, CHH: 42, OHH: 46, RIDE: 51, TOM: 45, COW: 56 };

/** Envelope value array for `lengthBars` from f(phase 0..1). */
function envFromFn(lengthBars, f) {
  const n = lengthBars * 16 * SUB_RES;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = +clamp01(f(i / n)).toFixed(5);
  return out;
}

/** Sequence sections ({bars, notes} with notes relative to the section start)
 *  into one clip's notes; returns {lengthBars, notes}. */
function sequenceNotes(sections) {
  let cursor = 0;
  const notes = [];
  for (const s of sections) {
    const off = cursor * BAR;
    for (const n of s.notes) notes.push({ ...n, start: n.start + off });
    cursor += s.bars;
  }
  return { lengthBars: cursor, notes };
}

/** Concatenate per-section envelopes ({bars, fn}) into one value array. */
function sequenceEnv(paramId, sections) {
  const values = [];
  for (const s of sections) values.push(...envFromFn(s.bars, s.fn));
  return env(paramId, values);
}

const lane = (id, engineId, name, notes, lengthBars, preset, params, envelopes) => ({
  id, engineId, name,
  clips: [{ id, name, color: COLORS[0], lengthBars, notes, ...(envelopes ? { envelopes } : {}) }],
  enginePresetName: preset,
  ...(params ? { engineState: { params } } : {}),
});

/** One scene launching slot 0 of every lane — one Play = the whole piece. */
const onePlay = (lanes) => [{
  id: 'scene-1', name: 'Play',
  clipPerLane: Object.fromEntries(lanes.map((l) => [l.id, 0])),
}];

const demo = (bpm, lanes) => ({ bpm, lanes, scenes: onePlay(lanes), globalQuantize: '1/1' });

function writeDemo(file, d) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, file), JSON.stringify(d, null, 2) + '\n');
  const notes = d.lanes.reduce((s, l) => s + l.clips[0].notes.length, 0);
  console.log(`wrote ${file}  [${d.lanes.map((l) => l.engineId).join(' + ')}]  ${d.lanes[0].clips[0].lengthBars} bars, ${notes} notes, ${d.bpm} bpm`);
}

const sustainChords = (chordsPerBar, { dur = BAR - 12, vel = 56 } = {}) => {
  const out = [];
  chordsPerBar.forEach((ch, i) => { for (const m of ch) out.push(note(i * BAR, dur, m, vel)); });
  return out;
};

// ───────────────────────────────────────────────────────────────────────────
// 1. ACID RAIN — acid techno, 132 bpm, A-minor. 303 lead + 909 drums + sub bass.
//    One 8-bar clip per lane: intro → main riff → resonance climb → breakdown.
// ───────────────────────────────────────────────────────────────────────────
function acidRain() {
  const ROOT = 45;  // A2
  const line = (spec) => {
    const out = [];
    for (let i = 0; i < 32; i++) {
      const e = spec[i];
      if (e == null) continue;
      const [off, fl = ''] = e;
      out.push(note(i * S16, fl.includes('s') ? 36 : 22, ROOT + off, fl.includes('a') ? 110 : 80));
    }
    return out;
  };
  const s1 = line([
    [0, 'a'], [0], [0], [0], [0], [0], [12], [0, 's'], [0], [0, 'a'], [0], [0], [0], [0], [0], [12],
    [0, 'a'], [0], [0], [0], [3], [0], [0, 's'], [0], [0], [0, 'a'], [0], [12], [0], [0], [10], [0, 's'],
  ]);
  const s2 = line([
    [0, 'a'], null, [0, 's'], [12], [0], [3, 's'], [3], [0, 'a'], [7], [0, 's'], [0], [12, 'a'], [10], [0], [7, 's'], [7],
    [0, 'a'], null, [0, 's'], [12], [0], [3, 's'], [5], [3, 'a'], [2], [0, 's'], [0], [10, 'a'], [12], [10], [7, 's'], [0],
  ]);
  const s3 = line([
    [12, 'a'], [0], [12, 's'], [15], [12], [10, 's'], [12], [7, 'a'], [12], [10, 's'], [12], [15, 'a'], [14], [12], [10, 's'], [12],
    [12, 'a'], [0], [12, 's'], [19], [12], [15, 's'], [12], [10, 'a'], [7], [12, 's'], [12], [15, 'a'], [12], [10], [12, 's'], [24],
  ]);
  const s4 = line([
    [0, 'a'], null, null, null, [0, 's'], null, null, null, [12], null, null, [0, 's'], null, null, [10], null,
    [0, 'a'], null, null, [0, 's'], null, null, null, null, [7, 's'], null, null, null, [0], null, [3, 's'], null,
  ]);
  const lead = sequenceNotes([{ bars: 2, notes: s1 }, { bars: 2, notes: s2 }, { bars: 2, notes: s3 }, { bars: 2, notes: s4 }]);
  const cut = sequenceEnv('tb303-1.filter.cutoff', [
    { bars: 2, fn: (p) => 0.22 + 0.30 * p },
    { bars: 2, fn: (p) => 0.40 + 0.18 * Math.sin(p * Math.PI * 4) + 0.10 * p },
    { bars: 2, fn: (p) => 0.45 + 0.45 * p + 0.08 * Math.sin(p * Math.PI * 8) },
    { bars: 2, fn: (p) => 0.62 - 0.48 * p },
  ]);

  const dseg = (bars, { hats, open, clap, roll }) => {
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const t0 = bar * BAR;
      for (let q = 0; q < 4; q++) out.push(note(t0 + q * TPQ, 18, DRUM.K, 112));
      if (clap) { out.push(note(t0 + TPQ, 22, DRUM.CLP, 104)); out.push(note(t0 + 3 * TPQ, 22, DRUM.CLP, 104)); }
      if (hats) { const n = hats === 16 ? 16 : 8, st = hats === 16 ? S16 : TPQ / 2; for (let s = 0; s < n; s++) out.push(note(t0 + s * st, 14, DRUM.CHH, s % (n / 4) === 0 ? 96 : 74)); }
      if (open) for (const o of [1, 3, 5, 7]) out.push(note(t0 + o * (TPQ / 2), 26, DRUM.OHH, 90));
      if (roll && bar === bars - 1) for (let i = 0; i < 8; i++) out.push(note(t0 + 2 * TPQ + i * S16, 16, DRUM.CLP, 86 + i * 2));
    }
    return out;
  };
  const drums = sequenceNotes([
    { bars: 2, notes: dseg(2, {}) },
    { bars: 2, notes: dseg(2, { hats: 8, open: true }) },
    { bars: 2, notes: dseg(2, { hats: 16, open: true, clap: true }) },
    { bars: 2, notes: dseg(2, { clap: true, roll: true }) },
  ]);

  const SUB = 33;  // A1
  const subSeg = (bars, mode) => {
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const t0 = bar * BAR;
      if (mode === 'off') for (const e of [1, 3, 5, 7]) out.push(note(t0 + e * (TPQ / 2), TPQ / 2 - 6, SUB, 96));
      else if (mode === 'roll') for (let s = 0; s < 16; s++) out.push(note(t0 + s * S16, S16 - 3, SUB + (s % 4 === 2 ? 12 : 0), s % 4 === 0 ? 104 : 80));
      else if (mode === 'sparse') out.push(note(t0, BAR - 8, SUB, 84));
    }
    return out;
  };
  const sub = sequenceNotes([
    { bars: 2, notes: subSeg(2, 'sparse') },
    { bars: 2, notes: subSeg(2, 'off') },
    { bars: 2, notes: subSeg(2, 'roll') },
    { bars: 2, notes: subSeg(2, 'sparse') },
  ]);

  return demo(132, [
    lane('tb303-1', 'tb303', '303 Acid', lead.notes, lead.lengthBars, 'factory:BASS Squelch',
      { 'filter.resonance': 0.82, 'bus.reverbSend': 0.12, 'bus.delaySend': 0.18 }, [cut]),
    lane('sub-1', 'subtractive', 'Sub', sub.notes, sub.lengthBars, 'factory:BASS Sub 808',
      { 'bus.reverbSend': 0.04 }),
    lane('drums-1', 'drums-machine', 'Drums', drums.notes, drums.lengthBars, 'factory:KIT Power',
      { 'bus.reverbSend': 0.14 }),
  ]);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. CORDILLERA — plucked folk, 100 bpm, E-minor, 6/8 feel. The fingerpicked
//    nylon guitar is the star and is kept PRISTINE: the Verse (bars 1-8) is the
//    guitar alone (the part you liked, unchanged). Light upright bass + soft
//    hand percussion join in the Reprise (bars 9-16), then a 4-bar Ending
//    resolves to a ringing Em. No string pad (it muddied the guitar).
//    Chords (i-VI-III-VII): Em C G D. One 4/4 bar = one 6/8 bar (6 × 64 ticks).
// ───────────────────────────────────────────────────────────────────────────
function cordillera() {
  const SUB = BAR / 6;  // 64 ticks per 6/8-eighth
  const CH = [
    { root: 40, alt: 47, tones: [52, 55, 59] },  // Em
    { root: 36, alt: 43, tones: [48, 52, 55] },  // C
    { root: 43, alt: 50, tones: [55, 59, 62] },  // G
    { root: 38, alt: 45, tones: [50, 54, 57] },  // D
  ];
  const CONTOUR = [[0, 1, 2, 1, 2, 0], [2, 1, 0, 1, 2, 1], [0, 2, 1, 2, 0, 2], [1, 2, 0, 2, 1, 0]];

  // Full Travis picking — the original, untouched: thumb bass on 0 & 4, alt bass
  // on 2, a finger-melody note on every sub.
  const pick = (bars, chordIdx, variation = 0) => {
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const c = CH[chordIdx[bar % chordIdx.length]];
      const t0 = bar * BAR;
      const con = CONTOUR[(bar + variation) % 4];
      for (let s = 0; s < 6; s++) {
        const t = t0 + s * SUB;
        if (s === 0 || s === 4) out.push(note(t, SUB - 4, c.root, 88));
        else if (s === 2) out.push(note(t, SUB - 4, c.alt, 80));
        const mel = c.tones[con[s]] + (variation && s === 3 ? 5 : 0);
        const vel = 64 + Math.round(26 * Math.sin((s / 6) * Math.PI));
        out.push(note(t + 2, SUB - 6, mel, s === 0 ? vel - 12 : vel));
      }
    }
    return out;
  };
  // Ending: 3 bars of picking (Em C G) then a ringing Em chord over the last bar.
  const endingGuitar = () => {
    const out = pick(3, [0, 1, 2], 0);
    const t = 3 * BAR;
    for (const m of [40, 52, 55, 59, 64]) out.push(note(t, BAR - 8, m, 78));
    return out;
  };

  // bass root one octave under the guitar, never below E1 (keeps it clear)
  const bassRoot = (r) => (r - 12 >= 28 ? r - 12 : r);
  const bassPhrase = (bars, chordIdx, busy) => {
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const c = CH[chordIdx[bar % chordIdx.length]];
      const t0 = bar * BAR;
      out.push(note(t0, SUB * 2 - 6, bassRoot(c.root), busy ? 78 : 70));
      if (busy) out.push(note(t0 + SUB * 3, SUB * 2 - 6, bassRoot(c.alt), 66));
    }
    return out;
  };

  // light hand percussion — shaker (closed hat) + soft conga (tom); `taper` fades it out
  const perc = (bars, taper) => {
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const t0 = bar * BAR;
      const fade = taper ? Math.max(0.15, 1 - bar / bars) : 1;
      for (let s = 0; s < 6; s++) out.push(note(t0 + s * SUB, 12, DRUM.CHH, Math.round((s % 3 === 0 ? 54 : 40) * fade)));
      out.push(note(t0, 26, DRUM.TOM, Math.round(64 * fade)));
      out.push(note(t0 + SUB * 3, 26, DRUM.TOM, Math.round(52 * fade)));
    }
    return out;
  };

  const VERSE = [0, 1, 2, 3, 0, 1, 2, 3];
  const END = [0, 1, 2, 0];

  const gtr = sequenceNotes([
    { bars: 8, notes: pick(8, VERSE, 0) },   // the beautiful original — guitar alone
    { bars: 8, notes: pick(8, VERSE, 1) },   // reprise
    { bars: 4, notes: endingGuitar() },
  ]);
  const bass = sequenceNotes([
    { bars: 8, notes: [] },                          // verse: guitar alone
    { bars: 8, notes: bassPhrase(8, VERSE, true) },  // reprise: bass joins
    { bars: 4, notes: [...bassPhrase(3, [0, 1, 2], false), note(3 * BAR, BAR - 8, bassRoot(CH[0].root), 70)] },
  ]);
  const percL = sequenceNotes([
    { bars: 8, notes: [] },                          // verse: no percussion
    { bars: 8, notes: perc(8, false) },              // reprise: light perc
    { bars: 4, notes: perc(4, true) },               // ending: tapers out
  ]);
  const bright = sequenceEnv('gtr-1.string.brightness', [
    { bars: 8, fn: (p) => 0.50 + 0.28 * Math.sin(p * Math.PI) },
    { bars: 8, fn: (p) => 0.52 + 0.26 * Math.sin(p * Math.PI) },
    { bars: 4, fn: (p) => 0.52 - 0.18 * p },
  ]);

  return demo(100, [
    lane('gtr-1', 'karplus', 'Guitar', gtr.notes, gtr.lengthBars, 'factory:GTR Nylon Soft Fingerpick',
      { 'bus.reverbSend': 0.24, 'bus.delaySend': 0.08 }, [bright]),
    lane('bass-1', 'subtractive', 'Upright', bass.notes, bass.lengthBars, 'factory:BASS Plucky',
      { 'bus.reverbSend': 0.06 }),
    lane('perc-1', 'drums-machine', 'Perc', percL.notes, percL.lengthBars, 'factory:KIT Jazz',
      { 'bus.reverbSend': 0.18 }),
  ]);
}

// ───────────────────────────────────────────────────────────────────────────
// 3. NEON DRIVE — synthwave, 115 bpm, A-minor. Wavetable arp + warm pad +
//    sub-saw bass + drums. One 16-bar clip each, built inside:
//    Intro → Build → Drive → Climax (drums + pad enter at the Build). Am F C G.
// ───────────────────────────────────────────────────────────────────────────
function neonDrive() {
  const ARP = [
    [57, 60, 64, 69, 72, 76], [53, 57, 60, 65, 69, 72],
    [48, 52, 55, 60, 64, 67], [55, 59, 62, 67, 71, 74],
  ];
  const HOOK = [[76, 72], [77, 74], [76, 72], [74, 79]];
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];  // Am F C G triads
  const ROOTS = [33, 29, 36, 31];   // A1 F1 C2 G1

  const arp = ({ octaves, hook }) => {
    const out = [];
    for (let bar = 0; bar < 4; bar++) {
      const pool = ARP[bar], t0 = bar * BAR;
      for (let st = 0; st < 16; st++) {
        const t = t0 + st * S16, idx = st % pool.length, accent = st % 4 === 0;
        out.push(note(t, S16 - 4, pool[idx], accent ? 108 : 82));
        if (octaves && st % 2 === 0) out.push(note(t, S16 - 4, pool[idx] - 12, accent ? 100 : 74));
      }
      if (hook) { out.push(note(t0 + S16 * 4, TPQ - 8, HOOK[bar][0], 96)); out.push(note(t0 + S16 * 10, TPQ - 8, HOOK[bar][1], 92)); }
    }
    return out;
  };
  const SC = [
    { octaves: false, hook: false, morph: (p) => 0.15 + 0.20 * p, cut: (p) => 0.35 + 0.20 * p },
    { octaves: false, hook: false, morph: (p) => 0.30 + 0.25 * p, cut: (p) => 0.45 + 0.25 * p },
    { octaves: true, hook: true, morph: (p) => 0.45 + 0.25 * Math.sin(p * Math.PI * 2), cut: (p) => 0.55 + 0.30 * p },
    { octaves: true, hook: true, morph: (p) => 0.55 + 0.40 * p, cut: (p) => 0.70 + 0.28 * Math.sin(p * Math.PI * 2) },
  ];
  const lead = sequenceNotes(SC.map((s) => ({ bars: 4, notes: arp(s) })));
  const morphEnv = sequenceEnv('wavetable-1.osc.morph', SC.map((s) => ({ bars: 4, fn: s.morph })));
  const cutEnv = sequenceEnv('wavetable-1.filter.cutoff', SC.map((s) => ({ bars: 4, fn: s.cut })));

  const bassIntro = () => ROOTS.map((r, bar) => note(bar * BAR, BAR - 8, r, 80));
  const bassPulse8 = () => { const o = []; ROOTS.forEach((r, bar) => { for (let e = 0; e < 8; e++) o.push(note(bar * BAR + e * (TPQ / 2), TPQ / 2 - 6, r, e === 0 ? 106 : 86)); }); return o; };
  const bassDrive16 = (climax) => {
    const o = [];
    ROOTS.forEach((r, bar) => { for (let s = 0; s < 16; s++) { const t = bar * BAR + s * S16; const oct = s % 4 === 2; const fifth = climax && s % 8 === 6; o.push(note(t, S16 - 3, r + (oct ? 12 : 0) + (fifth ? 7 : 0), s % 4 === 0 ? 108 : 82)); } });
    return o;
  };
  const bass = sequenceNotes([
    { bars: 4, notes: bassIntro() }, { bars: 4, notes: bassPulse8() },
    { bars: 4, notes: bassDrive16(false) }, { bars: 4, notes: bassDrive16(true) },
  ]);

  const beat = ({ clap, hats, openOff, ride1, fill }) => {
    const out = [];
    for (let bar = 0; bar < 4; bar++) {
      const t0 = bar * BAR;
      for (let q = 0; q < 4; q++) out.push(note(t0 + q * TPQ, 20, DRUM.K, 112));
      if (clap) { out.push(note(t0 + TPQ, 24, DRUM.CLP, 106)); out.push(note(t0 + 3 * TPQ, 24, DRUM.CLP, 106)); }
      const n = hats === 16 ? 16 : 8, st = hats === 16 ? S16 : TPQ / 2;
      for (let s = 0; s < n; s++) out.push(note(t0 + s * st, 16, DRUM.CHH, s % (n / 4) === 0 ? 100 : 78));
      if (openOff) for (const o of [1, 3, 5, 7]) out.push(note(t0 + o * (TPQ / 2), 28, DRUM.OHH, 92));
      if (ride1) out.push(note(t0, 40, DRUM.RIDE, 88));
      if (fill && bar === 3) for (let i = 0; i < 4; i++) out.push(note(t0 + 3 * TPQ + i * S16, 20, DRUM.TOM, 100 + i * 3));
    }
    return out;
  };
  const drums = sequenceNotes([
    { bars: 4, notes: [] },
    { bars: 4, notes: beat({ hats: 8 }) },
    { bars: 4, notes: beat({ clap: true, hats: 8, openOff: true }) },
    { bars: 4, notes: beat({ clap: true, hats: 16, openOff: true, ride1: true, fill: true }) },
  ]);

  const padSeg = (vel) => sustainChords(PROG, { vel });
  const pad = sequenceNotes([
    { bars: 4, notes: [] },
    { bars: 4, notes: padSeg(40) },
    { bars: 4, notes: padSeg(50) },
    { bars: 4, notes: padSeg(58) },
  ]);

  return demo(115, [
    lane('wavetable-1', 'wavetable', 'Neon Lead', lead.notes, lead.lengthBars, 'factory:LEAD Saw Classic',
      { 'filter.resonance': 0.30, 'bus.reverbSend': 0.18, 'bus.delaySend': 0.22 }, [morphEnv, cutEnv]),
    lane('pad-1', 'subtractive', 'Pad', pad.notes, pad.lengthBars, 'factory:PAD Warm',
      { 'bus.reverbSend': 0.30, 'bus.delaySend': 0.10 }),
    lane('bass-1', 'subtractive', 'Bass', bass.notes, bass.lengthBars, 'factory:BASS Punchy',
      { 'bus.reverbSend': 0.05 }),
    lane('drums-1', 'drums-machine', 'Drums', drums.notes, drums.lengthBars, 'factory:KIT Electronic',
      { 'bus.reverbSend': 0.16 }),
  ]);
}

writeDemo('acid-rain.json', acidRain());
writeDemo('cordillera.json', cordillera());
writeDemo('neon-drive.json', neonDrive());
console.log('done.');
