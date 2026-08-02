// Does the SubParams struct win because it is TYPED, or because it has a FIXED
// SHAPE? If it is the shape, the optimisation generalises to every engine — the
// host knows each engine's declared param ids up front and can pre-shape the bag.
//
// Three objects, same 30 numbers, same read pattern, same total reads.

const IDS = [
  'osc1.wave', 'osc1.level', 'osc1.detune', 'osc1.pw', 'osc1.sync',
  'osc2.wave', 'osc2.level', 'osc2.detune', 'osc2.pw', 'osc2.sync',
  'sub.level', 'noise.level',
  'filter.kind', 'filter.cutoff', 'filter.resonance',
  'filter.envAmount', 'filter.keyTrack', 'filter.drive',
  'amp.attack', 'amp.decay', 'amp.sustain', 'amp.release',
  'master.tune', 'master.level',
  'unison.voices', 'unison.detune', 'unison.drift',
  'poly.voices', 'output.trim',
];

// (a) how the live bag is built TODAY: empty literal, keys added one by one.
function grownBag() {
  const o = {};
  for (const id of IDS) o[id] = Math.random();
  return o;
}

// (b) the proposal: same dot-id keys, but the whole shape created at once.
const preShaped = new Function(
  `return { ${IDS.map((id) => `${JSON.stringify(id)}: 0`).join(', ')} };`,
);
function preShapedBag() {
  const o = preShaped();
  for (const id of IDS) o[id] = Math.random();
  return o;
}

// (c) what Subtractive does today: a camelCase struct from an object literal.
function structBag() {
  return {
    osc1Wave: Math.random(), osc1Level: Math.random(), osc1Detune: Math.random(),
    osc1Pw: Math.random(), osc1Sync: Math.random(),
    osc2Wave: Math.random(), osc2Level: Math.random(), osc2Detune: Math.random(),
    osc2Pw: Math.random(), osc2Sync: Math.random(),
    subLevel: Math.random(), noiseLevel: Math.random(),
    filterKind: Math.random(), filterCutoff: Math.random(),
    filterResonance: Math.random(), filterEnvAmount: Math.random(),
    filterKeyTrack: Math.random(), filterDrive: Math.random(),
    ampAttack: Math.random(), ampDecay: Math.random(), ampSustain: Math.random(),
    ampRelease: Math.random(), masterTune: Math.random(), masterLevel: Math.random(),
    unisonVoices: Math.random(), unisonDetune: Math.random(), unisonDrift: Math.random(),
    polyVoices: Math.random(), outputTrim: Math.random(),
  };
}

// 10 s at 48 kHz with 8 voices, reading 8 params per voice per sample.
const SAMPLES = 48000 * 10;
const VOICES = 8;

// The smoother MUTATES the shared bag as the sample loop runs, so the reads
// cannot be hoisted out of the loop. A benchmark without that mutation measures
// the JIT deleting the work, not the work.
function runDot(bag) {
  let acc = 0;
  for (let i = 0; i < SAMPLES; i++) {
    bag['filter.cutoff'] = i & 1023;              // one param in flight
    for (let v = 0; v < VOICES; v++) {
      acc += bag['filter.cutoff'] + bag['filter.resonance'] + bag['filter.envAmount']
           + bag['filter.drive'] + bag['osc1.level'] + bag['osc2.level']
           + bag['sub.level'] + bag['master.level'];
    }
  }
  return acc;
}

function runStruct(p) {
  let acc = 0;
  for (let i = 0; i < SAMPLES; i++) {
    p.filterCutoff = i & 1023;                    // the same one param in flight
    for (let v = 0; v < VOICES; v++) {
      acc += p.filterCutoff + p.filterResonance + p.filterEnvAmount
           + p.filterDrive + p.osc1Level + p.osc2Level
           + p.subLevel + p.masterLevel;
    }
  }
  return acc;
}

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; }

function bench(label, make, run) {
  const times = [];
  for (let r = 0; r < 5; r++) {
    const bag = make();
    const t0 = process.hrtime.bigint();
    run(bag);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  console.log(`${label.padEnd(34)} median ${median(times).toFixed(1)} ms   (${times.map((t) => t.toFixed(0)).join(', ')})`);
  return median(times);
}

console.log(`${SAMPLES} samples x ${VOICES} voices x 8 params = ${(SAMPLES * VOICES * 8 / 1e6).toFixed(0)}M reads\n`);
const a = bench('(a) bag grown key by key', grownBag, runDot);
const b = bench('(b) bag pre-shaped, dot ids', preShapedBag, runDot);
const c = bench('(c) camelCase struct (today)', structBag, runStruct);
console.log(`\n(a) vs (c): ${(a / c).toFixed(2)}x    (b) vs (c): ${(b / c).toFixed(2)}x`);
