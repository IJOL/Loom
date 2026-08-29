#!/usr/bin/env node
// UNBIASED demo-vs-GitHub comparison for music/audio Show HN posts.
// search_by_date (chronological) => sample is NOT ranked by points.
// Per-term, per-year windows to stay under Algolia's 1000-hit pagination cap.
// Also reports a STRICT music filter to measure the loose regex's contamination.

const TERMS = ['synth', 'daw', 'sequencer', 'drum', 'music', 'audio', 'sound', 'midi',
  'song', 'melody', 'chord', 'piano', 'guitar', 'beat', 'track', '808', '303',
  'reverb', 'sampler', 'tone', 'pitch'];

const LOOSE_RE = /synth|daw|sequencer|drum|music|audio|sound|midi|song|melod|chord|piano|guitar|beat|track|808|303|reverb|sampler|tone|pitch/i;

// Strict: real music/audio words, with word boundaries, excluding the known false friends
// (tracker/tracking, milestone, heartbeat, soundness, etc.)
const STRICT_RE = /\b(synth|synthesizer|synthesiser|daw|sequencer|drum|drums|drum machine|music|musical|audio|midi|song|songs|melody|melodic|chord|chords|piano|guitar|reverb|sampler|sampling|808|303|tb-?303|vst|plugin|mixer|mastering|acid|bass|beatmak\w*|metronome|tuner|karaoke|spotify|soundcloud|podcast|speech|voice|singing|sing|vocal|waveform|oscillator|filter cutoff)\b/i;
const FALSE_FRIEND_RE = /\b(bug ?tracker|issue ?tracker|torrent|tracking|tracker|trackers|milestone|heartbeat|soundness|sound ?money|track record|fast ?track|backtrack|racetrack|investment|expense|habit)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(2500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }
  throw new Error('rate limited');
}

const byId = new Map();
for (const term of TERMS) {
  for (let year = 2008; year <= 2026; year++) {
    const lo = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const hi = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
    const d = await get(`https://hn.algolia.com/api/v1/search_by_date?tags=(story,show_hn)&query=${encodeURIComponent(term)}&hitsPerPage=1000&numericFilters=created_at_i>=${lo},created_at_i<${hi}`);
    for (const h of d.hits) byId.set(h.objectID, h);
    await sleep(100);
  }
  process.stderr.write(`${term}: pool=${byId.size}\n`);
}

const all = [...byId.values()];
const withUrl = all.filter((h) => h.url && h.title && /^show hn/i.test(h.title));
const titleOf = (h) => h.title.replace(/^show hn:?\s*/i, '');

const loose = withUrl.filter((h) => LOOSE_RE.test(titleOf(h)));
const strict = withUrl.filter((h) => STRICT_RE.test(titleOf(h)) && !FALSE_FRIEND_RE.test(titleOf(h)));

const isCode = (u) => {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return /(^|\.)github\.com$/.test(h) || /(^|\.)gitlab\.com$/.test(h) || /(^|\.)codeberg\.org$/.test(h);
  } catch { return false; }
};

const stats = (arr) => {
  const p = arr.map((h) => h.points ?? 0).sort((a, b) => a - b);
  const n = p.length; if (!n) return null;
  const med = n % 2 ? p[(n - 1) / 2] : (p[n / 2 - 1] + p[n / 2]) / 2;
  return { n, median: med, mean: +(p.reduce((a, b) => a + b, 0) / n).toFixed(1),
    p90: p[Math.floor(0.9 * n)], max: p[n - 1],
    ge100: p.filter((x) => x >= 100).length,
    ge100pct: +(100 * p.filter((x) => x >= 100).length / n).toFixed(1) };
};

function erf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  return 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
}
function mannWhitney(a, b) {
  const A = a.map((h) => h.points ?? 0), B = b.map((h) => h.points ?? 0);
  const m = [...A.map((v) => ({ v, g: 0 })), ...B.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(m.length); let i = 0;
  while (i < m.length) {
    let j = i; while (j + 1 < m.length && m[j + 1].v === m[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let R1 = 0; m.forEach((o, idx) => { if (o.g === 0) R1 += ranks[idx]; });
  const n1 = A.length, n2 = B.length;
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const z = (U1 - n1 * n2 / 2) / Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  return { z: +z.toFixed(2), p: +(2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))).toFixed(4) };
}

for (const [label, set] of [['LOOSE regex (claim\'s filter)', loose], ['STRICT music filter', strict]]) {
  const gh = set.filter((h) => isCode(h.url));
  const demo = set.filter((h) => !isCode(h.url));
  console.log(`\n===== ${label} — n=${set.length} =====`);
  console.log('  GitHub/GitLab/Codeberg:', JSON.stringify(stats(gh)));
  console.log('  Demo (other host)     :', JSON.stringify(stats(demo)));
  console.log('  Combined              :', JSON.stringify(stats(set)));
  console.log('  Mann-Whitney gh vs demo:', JSON.stringify(mannWhitney(gh, demo)));
}

// How contaminated is the loose regex?
const contam = loose.filter((h) => !strict.includes(h));
console.log(`\nLOOSE-only (matched loose regex but NOT genuine music): ${contam.length}/${loose.length} = ${(100 * contam.length / loose.length).toFixed(1)}%`);
console.log('Sample of loose-regex false positives:');
for (const h of contam.sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 15)) {
  console.log(`  ${String(h.points).padStart(4)}pts  ${titleOf(h).slice(0, 72)}`);
}
console.log('\nTotal Show HN pulled:', all.length, '| with URL:', withUrl.length);
