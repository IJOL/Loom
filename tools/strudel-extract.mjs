// tools/strudel-extract.mjs
// ONE-SHOT. Queries a Strudel tune with Strudel's own engine and writes its note
// data to tools/data/<name>-haps.json, which is COMMITTED. The demo build reads
// that JSON and never imports Strudel, exactly like
// plugins/tb303/reference-render.json.
//
// Run:  node tools/strudel-extract.mjs --strudel ../strudel [--patch <name>]
//       (no --patch extracts every entry in PATCHES)
//
// The tune SOURCE is read from the checkout — website/src/repl/tunes.mjs and
// website/src/examples.mjs — and evaluated through Strudel's own transpiler,
// rather than transcribed here. Transcription is where a port silently drifts
// from its original, and there are twenty of these.
//
// A patch that is NOT in the library — one somebody wrote in the REPL and asked
// for as a demo — is committed verbatim under tools/patches/ and read from
// there. Same rule: the file is the source, never a transcription of it.
//
// Packages are imported by ABSOLUTE FILE URL from that checkout, so nothing is
// installed into this repo; their own deps resolve from its node_modules.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const STRUDEL = resolve(arg('--strudel', '../strudel'));
const ONLY = arg('--patch', null);

const load = (pkg) => import(pathToFileURL(join(STRUDEL, 'packages', pkg, 'index.mjs')).href);

const core = await load('core');
const miniPkg = await load('mini');
const tonal = await load('tonal');
core.setStringParser(miniPkg.mini);
Object.assign(globalThis, core, tonal, miniPkg);
// The transpiler rewrites every string literal into a call to `m`.
globalThis.m = miniPkg.m;
for (const pkg of ['xen', 'draw']) {
  try { Object.assign(globalThis, await load(pkg)); } catch { /* browser-only */ }
}
const { transpiler } = await import(pathToFileURL(join(STRUDEL, 'packages/transpiler/transpiler.mjs')).href);

// TWO copies of @strudel/core end up loaded — the packages each resolve their
// own through node_modules — and `core.Pattern` is NOT the class the patterns
// are actually made of: `Object.getPrototypeOf(core.n('0')) === core.Pattern.prototype`
// is FALSE. Every prototype shim below therefore has to land on the live one as
// well, or it silently does nothing and the failure reads as "this tune needs a
// browser".
const PROTOS = [...new Set([Object.getPrototypeOf(core.n('0')), core.Pattern.prototype])];
const onPattern = (name, fn) => { for (const proto of PROTOS) proto[name] = fn; };

// A visualiser draws to a canvas and returns the pattern unchanged, so in Node
// it is a no-op that must not break the chain. Half the library ends on one, and
// without these `window is not defined` looks like the TUNE being browser-only.
for (const v of ['pianoroll', '_pianoroll', 'punchcard', '_punchcard', 'spiral', 'wordfall', 'scope', '_scope', 'draw', 'onPaint']) {
  onPattern(v, function () { return this; });
}

// `$:` transpiles to `.p('$')`, and `p` is defined by the REPL (core/repl.mjs),
// not by any package — so in Node a patch written in `$:` lines throws
// `.p is not a function` before a single note is queried. Collected here the
// same way the REPL collects it, and STACKED below.
//
// Each line is also TAGGED with the id the REPL gives it (`$0`, `$1`, … in
// source order). The REPL puts that id in the query state, where it never
// reaches the hap; putting it in the VALUE is what lets a spec say "this lane is
// that line" instead of guessing a voice apart by gain or by register.
const pPatterns = {};
let anonymousIndex = 0;
onPattern('p', function (id) {
  if (typeof id === 'string' && (id.startsWith('_') || id.endsWith('_'))) return core.silence;  // x_ / _x mutes
  if (String(id).includes('$')) { id = `${id}${anonymousIndex}`; anonymousIndex++; }
  pPatterns[id] = this;
  return this;
});
onPattern('q', function () { return core.silence; });

// `.piano()` is not in any package: the REPL defines it in prebake.mjs, so a
// Node evaluation has to carry it. Replicated verbatim (prebake.mjs:53) because
// it is not merely `s('piano')` — it also defaults `clip` to 1, which decides
// how long every note of five tunes actually sounds.
const maxPan = core.noteToMidi('C8');
const panwidth = (pan, width) => pan * width + (1 - width) / 2;
core.Pattern.prototype.piano = function () {
  return this.fmap((v) => ({ ...v, clip: v.clip ?? 1 }))
    .s('piano')
    .release(0.1)
    .fmap((value) => {
      const midi = core.valueToMidi(value);
      const pan = panwidth(Math.min(Math.round(midi) / maxPan, 1), 0.5);
      return { ...value, pan: (value.pan || 1) * pan };
    });
};

// What the REPL provides and a Node query does not need to really do. `setcps`
// is the exception: its value IS the tempo, so it is captured rather than
// dropped.
let capturedCps = null;
let allTransforms = [];
Object.assign(globalThis, {
  samples: () => Promise.resolve(),
  setcps: (v) => { capturedCps = v; }, setCps: (v) => { capturedCps = v; },
  setcpm: (v) => { capturedCps = v / 60; }, setCpm: (v) => { capturedCps = v / 60; },
  setVoicingRange: () => {}, registerSynthSounds: () => {}, initHydra: () => {},
  hush: () => {},
  // A slider is a REPL widget bound to a number. The transpiler rewrites
  // `slider(v, …)` into `sliderWithID('slider_123', v, …)`, so BOTH names are
  // needed: the value it stands for is the default the patch was saved with.
  slider: (v) => v, sliderWithID: (_id, v) => v,
  // `all(f)` applies f to everything stacked, and every use of it in these
  // patches is a visualiser — but it is collected and applied rather than
  // dropped, so that a patch which uses it for something audible still works.
  all: (transform) => { allTransforms.push(transform); return core.silence; },
});

const tunes = await import(pathToFileURL(join(STRUDEL, 'website/src/repl/tunes.mjs')).href);
const examples = (await import(pathToFileURL(join(STRUDEL, 'website/src/examples.mjs')).href)).examples;

// Twelve tunes still spell a scale the old way — `.scale('G1 minor')` — which
// current Strudel rejects. It does NOT throw: it logs and falls through, and
// `n("0 2 4")` collapses from `G1 Bb1 D2` to a single repeated `G3`. A whole
// melodic line silently becomes one note, in the library's own published tunes.
//
// The colon form is the same scale — tonal's own error message states the
// equivalence — so this rewrites it rather than shipping the broken reading.
// The tail must be a REAL scale name from tonal's dictionary, so `"c3 eb3"` and
// the like are left alone; across all 32 tunes it rewrites 20 strings and
// touches nothing else.
// From the checkout, like every other package here — this repo does not depend
// on tonal and must not grow a dependency for a one-shot tool.
const { Scale } = await import(pathToFileURL(join(STRUDEL, 'packages/tonal/node_modules/@tonaljs/tonal/dist/index.mjs')).href);
const SCALE_NAMES = new Set(Scale.names().map((s) => s.toLowerCase()));
const SPACED_SCALE = /(['"`])([A-Ga-g][#b]?[0-9]?) ([a-z][a-z]*(?: [a-z]+)?)\1/g;
function repairScales(code, name) {
  return code.replace(SPACED_SCALE, (whole, q, root, mode) => {
    if (!SCALE_NAMES.has(mode.toLowerCase())) return whole;
    console.log(`  · ${name}: scale ${whole} -> ${q}${root}:${mode}${q}`);
    return `${q}${root}:${mode}${q}`;
  });
}

/** name -> { source, cycles?, offset? }. `cycles` is the window the demo freezes. It is
 *  DETECTED — the smallest span whose events repeat — because guessing it cuts
 *  a tune in half: `swimming` closes at 51 and `zeldasRescue` at 48, not at any
 *  round number. `cycles` is only declared for the tunes whose randomness means
 *  nothing ever repeats exactly, where detection cannot succeed by definition. */
const PATCHES = {
  coastline:    { source: () => examples[0], cycles: 64 },
  'broken-cut': { source: () => examples[1], cycles: 64 },
  swimming:     { source: () => tunes.swimming },
  sml1:         { source: () => tunes.sml1 },
  'zeldas-rescue': { source: () => tunes.zeldasRescue },
  waa2:         { source: () => tunes.waa2 },
  'acidic-tooth': { source: () => examples[2] },
  flatrave:     { source: () => tunes.flatrave },
  caverave:     { source: () => tunes.caverave },
  orbit:        { source: () => tunes.orbit },
  'delay-tune': { source: () => tunes.delay },
  // wave 3 — the sample-led ones
  // 48 cycles, not the 32 default: a bar is 1.5 cycles at 80, so only a multiple
  // of three fills whole bars. Nothing here ever repeats (perlin), so the window
  // is a choice and this one is 32 bars.
  meltingsubmarine: { source: () => tunes.meltingsubmarine, cycles: 48 },
  'blippy-rhodes':  { source: () => tunes.blippyRhodes },
  dinofunk:         { source: () => tunes.dinofunk },
  amensister:       { source: () => tunes.amensister },
  arpoon:           { source: () => tunes.arpoon },
  chop:             { source: () => tunes.chop },
  // `.slow(5)` puts a bar at 1.25 cycles, so the window must be a multiple of
  // five; 80 is 64 bars, and only that far in do the blips arrive: their
  // mask runs over sixteen INNER cycles, which slow(5) stretches to eighty.
  belldub:          { source: () => tunes.belldub, cycles: 80 },
  'wavy-kalimba':   { source: () => tunes.wavyKalimba },
  'sample-demo':    { source: () => tunes.sampleDemo },
  // wave 4 — the ones that needed the visualiser and `.piano()` shims above
  'bass-fuge':      { source: () => tunes.bassFuge },
  'giant-steps':    { source: () => tunes.giantSteps },
  holyflute:        { source: () => tunes.holyflute },
  'jux-und-tollerei': { source: () => tunes.juxUndTollerei },
  'random-bells':   { source: () => tunes.randomBells },
  'sample-drums':   { source: () => tunes.sampleDrums },
  'underground-plumber': { source: () => tunes.undergroundPlumber },
  'barry-harris':   { source: () => tunes.barryHarris },
  'echo-piano':     { source: () => tunes.echoPiano },
  'festival-of-fingers':  { source: () => tunes.festivalOfFingers },
  'festival-of-fingers-3': { source: () => tunes.festivalOfFingers3 },
  'good-times':     { source: () => tunes.goodTimes },
  // Not from the library: a patch written in the REPL, committed verbatim.
  //
  // `offset` exists for this one. `rand` is EXACTLY 0 at t=0 and `degradeBy`
  // keeps a hap on a strict `>`, so `degradeBy(0)` — which means "degrade
  // nothing" — still drops whichever hap starts precisely on cycle 0. Live that
  // is one missing note in the first bar of the session and nobody hears it;
  // frozen into a LOOPING window it is a downbeat that goes missing on four
  // voices at once, every lap, forever. Starting the window a whole period
  // later is the same music with the artefact behind it.
  'supersaw-mask': { source: () => readFileSync(join(HERE, 'patches', 'supersaw-mask.strudel'), 'utf8'), offset: 24 },
};

const MAX_PERIOD = 128;

/** One onset, as the fingerprint used to tell two windows apart. Which SLICE of
 *  a sample plays is part of what you hear, so `begin`/`end`/`speed` count: a
 *  chopped break repeats its rhythm every cycle while playing a different piece
 *  of the sample each time, and without these `chop` reported a period of 1
 *  cycle for a 32-cycle piece. */
const stamp = (h, from) =>
  `${(h.whole.begin.valueOf() - from).toFixed(5)}|${h.value.note ?? h.value.n ?? ''}|${h.value.s ?? ''}`
  + `|${h.value.begin ?? ''}|${h.value.end ?? ''}|${h.value.speed ?? ''}`;

/** The smallest span that repeats, or null when nothing does (a tune driven by
 *  `rand`/`perlin` over absolute time never repeats — that is not a failure).
 *
 *  Every span up to MAX_PERIOD is tried, rather than a list of round numbers:
 *  `giantSteps` closes at 20 and `swimming` at 51, and a hand-picked list misses
 *  both. That is 128 candidates, so the pattern is queried ONCE over the whole
 *  range and the candidates compare slices of that one result — querying per
 *  candidate costs minutes across thirty tunes. */
function detectPeriod(pattern, offset = 0) {
  const haps = pattern.queryArc(offset, offset + 2 * MAX_PERIOD).filter((h) => h.hasOnset());
  const at = new Map();   // floor(cycle), relative to `offset` -> the onsets starting in it
  for (const h of haps) {
    const c = Math.floor(h.whole.begin.valueOf() - offset);
    if (!at.has(c)) at.set(c, []);
    at.get(c).push(h);
  }
  const window = (from, span) => {
    const out = [];
    for (let c = from; c < from + span; c++) for (const h of at.get(c) ?? []) out.push(stamp(h, from + offset));
    return out.sort().join(';');
  };
  // Comparing a window only against the NEXT one accepts a coincidence:
  // `<bd!3 bd(3,4,3)>` is identical for its first three cycles and changes on
  // the fourth, so a one-cycle "period" matched and the tune was frozen at a
  // quarter of its length. Every repeat that fits in the queried range has to
  // agree.
  for (let p = 1; p <= MAX_PERIOD; p++) {
    const first = window(0, p);
    const repeats = Math.floor((2 * MAX_PERIOD) / p) - 1;
    let all = true;
    for (let k = 1; k <= Math.min(4, repeats) && all; k++) all = window(k * p, p) === first;
    if (all) return p;
  }
  return null;
}

mkdirSync(join(HERE, 'data'), { recursive: true });
for (const [name, spec] of Object.entries(PATCHES)) {
  if (ONLY && ONLY !== name) continue;
  capturedCps = null;
  const code = repairScales(spec.source(), name);
  for (const key of Object.keys(pPatterns)) delete pPatterns[key];
  anonymousIndex = 0;
  allTransforms = [];
  let { pattern } = await core.evaluate(code, transpiler);
  // What the REPL does with the lines it collected (core/repl.mjs:220): stack
  // them, then hand the stack to every `all()` transform. `.stack` is called as
  // a METHOD so the stack is built by whichever copy of core made the patterns.
  const lines = Object.keys(pPatterns);
  if (lines.length) {
    pattern = lines
      .map((key) => pPatterns[key].withHap((h) => h.withValue((v) => ({ ...v, id: key }))))
      .reduce((a, b) => a.stack(b));
  }
  for (const transform of allTransforms) pattern = transform(pattern);
  const offset = spec.offset ?? 0;
  const detected = detectPeriod(pattern, offset);
  const cycles = spec.cycles ?? detected ?? 32;
  if (spec.cycles && detected && detected !== spec.cycles) {
    console.warn(`  ! ${name}: declared ${spec.cycles} cycles but it repeats at ${detected}`);
  }

  // hasOnset() is what separates a real trigger from a query fragment: `late`
  // with a pattern argument splits held notes into several parts, and only the
  // part whose start equals the note's own start actually fires.
  const haps = pattern.queryArc(offset, offset + cycles).filter((h) => h.hasOnset());
  const events = haps.map((h) => {
    const value = { ...h.value };
    // Resolve note names to MIDI while Strudel is loaded, so the mappers stay
    // dependency-free.
    if (typeof value.note === 'string') value.note = core.noteToMidi(value.note);
    return { begin: h.whole.begin.valueOf() - offset, end: h.whole.end.valueOf() - offset, value };
  });
  events.sort((a, b) => a.begin - b.begin);

  const title = (/^\/\/\s*(.+)$/m.exec(code) ?? [, name])[1].trim();
  const cps = capturedCps ?? 0.5;   // strudel's own default
  writeFileSync(
    join(HERE, 'data', `${name}-haps.json`),
    JSON.stringify({ source: `strudel — ${title}`, cycles, cps, events }, null, 2) + '\n',
  );
  const sources = [...new Set(events.map((e) => e.value.s ?? '(synth)'))];
  console.log(`${name.padEnd(14)} ${String(events.length).padStart(5)} events / ${String(cycles).padStart(3)} cycles ${detected ? '(detected)' : '(declared — never repeats)'}  cps ${cps}  [${sources.join(' ')}]`);
}
