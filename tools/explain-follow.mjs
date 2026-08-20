// What does a follower actually derive from a given leader clip?
//
// Answers the only question that matters when the result sounds wrong: is the
// harmony it inferred the problem, or the part it plays over it?
//
// Usage: node tools/explain-follow.mjs <demo.json> <leaderLaneId> <sceneIndex1based>

import { readFileSync } from 'node:fs';

const [, , demoPath, leaderId, sceneArg, keyArg, scaleArg] = process.argv;
const scene = Number(sceneArg ?? 3) - 1;
const s = JSON.parse(readFileSync(demoPath, 'utf8'));
// Optional override, so a demo whose declared key does not match its material
// can be re-read in the key it is actually in.
if (keyArg !== undefined) {
  const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  s.musicality = { ...s.musicality, key: PC[keyArg] ?? Number(keyArg), scale: scaleArg ?? s.musicality.scale };
}
const lane = s.lanes.find((l) => l.id === leaderId);
const clip = lane?.clips?.[scene];
if (!clip) { console.error('no clip there'); process.exit(1); }

const TICKS_PER_QUARTER = 96, TICKS_PER_STEP = 24;
const BAR = TICKS_PER_QUARTER * 4;
const key = s.musicality?.key ?? 0;
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };
const iv = SCALES[s.musicality?.scale ?? 'minor'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const ROMAN = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];

function metricWeight(tick, barTicks) {
  const inBar = ((tick % barTicks) + barTicks) % barTicks;
  if (inBar % TICKS_PER_STEP !== 0) return 0.28;
  const st = inBar / TICKS_PER_STEP;
  if (st === 0) return 1;
  if (st === Math.floor(barTicks / TICKS_PER_STEP / 2)) return 0.9;
  if (st % 4 === 0) return 0.72;
  if (st % 2 === 0) return 0.5;
  return 0.28;
}
const degOf = (midi) => {
  const pc = ((midi - key) % 12 + 12) % 12;
  let best = 0, bd = 99;
  iv.forEach((v, i) => { const d = Math.abs(v - pc); if (d < bd) { bd = d; best = i; } });
  return best;
};

console.log(`LEADER ${leaderId} · scene ${scene + 1} · ${clip.lengthBars} bars · ${clip.notes.length} notes`);
console.log(`key=${NAMES[key]} scale=${s.musicality?.scale}\n`);
for (const n of [...clip.notes].sort((a, b) => a.start - b.start)) {
  console.log(`  bar ${Math.floor(n.start / BAR) + 1} @${String(n.start % BAR).padStart(3)}  ${nameOf(n.midi).padEnd(4)}`
    + ` deg ${degOf(n.midi)}  dur ${String(n.duration).padStart(3)}  weight ${(metricWeight(n.start, BAR) * Math.max(1, Math.min(n.duration, BAR) / TICKS_PER_STEP)).toFixed(2)}`);
}

const bars = clip.lengthBars;
console.log(`\nPER-BAR SCORING over ${bars} bars (the window the follower analyses):`);
let prev = 0;
const chosen = [];
for (let bar = 0; bar < bars; bar++) {
  const lo = bar * BAR, hi = lo + BAR;
  const w = new Map(); let total = 0;
  for (const n of clip.notes) {
    if (n.start < lo || n.start >= hi) continue;
    const wt = metricWeight(n.start - lo, BAR) * Math.max(1, Math.min(n.duration, BAR) / TICKS_PER_STEP);
    const d = degOf(n.midi);
    w.set(d, (w.get(d) ?? 0) + wt); total += wt;
  }
  if (total === 0) { chosen.push(prev); console.log(`  bar ${bar + 1}: EMPTY -> holds ${ROMAN[prev]}`); continue; }
  const scores = [];
  for (let d = 0; d < iv.length; d++) {
    const inside = new Set([0, 2, 4].map((o) => (d + o) % iv.length));
    let sc = 0;
    for (const [pc, x] of w) sc += inside.has(pc) ? x : -0.5 * x;
    if (d === prev) sc += 0.15 * total;
    if (bar === bars - 1 && (d === 4 || d === 0)) sc += 0.2 * total;
    scores.push({ d, sc });
  }
  scores.sort((a, b) => b.sc - a.sc);
  chosen.push(scores[0].d); prev = scores[0].d;
  console.log(`  bar ${bar + 1}: ${scores.slice(0, 3).map((x) => `${ROMAN[x.d]}=${x.sc.toFixed(2)}`).join('  ')}`
    + `   -> ${ROMAN[scores[0].d]}`);
}
console.log(`\nPROGRESSION: ${chosen.map((d) => ROMAN[d]).join(' - ')}`);
const uniq = new Set(chosen);
if (uniq.size === 1) console.log('  ⚠ ONE CHORD for the whole loop — a drone, not a progression.');
