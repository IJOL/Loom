// tools/preset-audition-page.ts
// The listening page the audition renderer writes next to its WAVs.
// Static file:// page — no fetch (blocked on file://), so the entry list is
// embedded at generation time. Ratings persist in localStorage and export as
// JSON for the tuning/noise triage round.

export interface AuditionEntry {
  engine: string;
  name: string;
  /** Which pressing of the preset this render is: std | accent | chord | low. */
  variant: string;
  file: string;
  peak: number;
  rms: number;
  /** Samples with |x| > 1 before the WAV writer clamps them. */
  clipped: number;
  /** First-difference energy over signal energy — ~0 for a low sine, ~2 for noise. */
  hf: number;
  /** RMS of the last 0.4 s over whole-render RMS — a tail that never decays. */
  tailRatio: number;
}

export function auditionPageHtml(entries: AuditionEntry[]): string {
  const data = JSON.stringify(entries);
  return `<!doctype html>
<meta charset="utf-8">
<title>Preset Auditions</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14161a; color: #d8dce2; font: 14px/1.45 system-ui, sans-serif; }
  header { position: sticky; top: 0; background: #1b1e24; padding: 10px 16px; display: flex;
           gap: 12px; align-items: center; border-bottom: 1px solid #2a2e36; z-index: 2; flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0 8px 0 0; }
  header .count { color: #8b93a1; }
  button { background: #2a2e36; color: #d8dce2; border: 1px solid #3a4050; border-radius: 6px;
           padding: 4px 10px; cursor: pointer; font: inherit; }
  button:hover { background: #343a46; }
  button.on { background: #3d5afe33; border-color: #7c8cff; color: #c9d1ff; }
  button.v-good.on { background: #1d4a2a; border-color: #4caf7d; color: #a7e3c0; }
  button.v-meh.on  { background: #4a3d1d; border-color: #cfa84c; color: #ecd9a0; }
  button.v-bad.on  { background: #4a1d1d; border-color: #d05c5c; color: #f0b0b0; }
  .row { display: grid; grid-template-columns: 220px 1fr 340px; gap: 10px; padding: 10px 16px;
         border-bottom: 1px solid #23262d; align-items: start; }
  .row.rated { opacity: 0.65; }
  .who .engine { color: #8b93a1; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .who .name { font-weight: 600; }
  .variants { display: flex; flex-direction: column; gap: 4px; }
  .variant { display: flex; gap: 8px; align-items: center; }
  .variant .vlabel { width: 52px; color: #8b93a1; font-size: 12px; text-align: right; }
  .metrics { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #22252c; color: #9aa2b0; }
  .chip.warn { background: #4a2a1d; color: #f0c0a0; }
  audio { width: 230px; height: 28px; }
  .rate { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .rate .sep { color: #3a4050; margin: 0 4px; }
  input[type=text] { background: #1b1e24; border: 1px solid #2a2e36; color: #d8dce2;
                     border-radius: 6px; padding: 4px 8px; font: inherit; width: 180px; }
</style>
<header>
  <h1>Preset Auditions</h1>
  <span class="count" id="count"></span>
  <button id="only-unrated">Only unrated</button>
  <span style="flex:1"></span>
  <button id="export">Download ratings JSON</button>
  <button id="copy">Copy JSON</button>
  <button id="clear">Clear all</button>
</header>
<main id="list"></main>
<script>
const ENTRIES = ${data};
const KEY = 'loom-preset-auditions-v1';
const TAGS = ['noisy', 'detuned', 'harsh', 'weak'];
let ratings = {};
try { ratings = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
let onlyUnrated = false;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ratings)); } catch {} };
const idOf = e => e.engine + '::' + e.name;

function chip(label, warn) {
  return '<span class="chip' + (warn ? ' warn' : '') + '">' + label + '</span>';
}

function groupByPreset() {
  const groups = new Map();
  for (const e of ENTRIES) {
    const id = idOf(e);
    if (!groups.has(id)) groups.set(id, { engine: e.engine, name: e.name, variants: [] });
    groups.get(id).variants.push(e);
  }
  return [...groups.values()];
}

function render() {
  const list = document.getElementById('list');
  list.replaceChildren();
  let rated = 0;
  const groups = groupByPreset();
  for (const e of groups) {
    const r = ratings[idOf(e)] || {};
    const isRated = !!r.verdict;
    if (isRated) rated++;
    if (onlyUnrated && isRated) continue;
    const row = document.createElement('div');
    row.className = 'row' + (isRated ? ' rated' : '');
    const variants = e.variants.map(v =>
      '<div class="variant"><span class="vlabel">' + v.variant + '</span>' +
      '<audio controls preload="none" src="' + v.file + '"></audio>' +
      '<span class="metrics">' +
      chip('peak ' + v.peak.toFixed(2), v.peak > 0.99) +
      chip('clip ' + v.clipped, v.clipped > 0) +
      chip('hf ' + v.hf.toFixed(2), v.hf > 0.5) +
      chip('tail ' + v.tailRatio.toFixed(2), v.tailRatio > 0.6) +
      '</span></div>').join('');
    row.innerHTML =
      '<div class="who"><div class="engine">' + e.engine + '</div>' +
      '<div class="name">' + e.name + '</div></div>' +
      '<div class="variants">' + variants + '</div>' +
      '<div class="rate"></div>';
    const rate = row.querySelector('.rate');
    for (const v of ['good', 'meh', 'bad']) {
      const b = document.createElement('button');
      b.textContent = v;
      b.className = 'v-' + v + (r.verdict === v ? ' on' : '');
      b.onclick = () => { r.verdict = r.verdict === v ? undefined : v; ratings[idOf(e)] = r; save(); render(); };
      rate.appendChild(b);
    }
    rate.insertAdjacentHTML('beforeend', '<span class="sep">|</span>');
    for (const t of TAGS) {
      const b = document.createElement('button');
      b.textContent = t;
      b.className = (r.tags || []).includes(t) ? 'on' : '';
      b.onclick = () => {
        const tags = new Set(r.tags || []);
        tags.has(t) ? tags.delete(t) : tags.add(t);
        r.tags = [...tags]; ratings[idOf(e)] = r; save(); render();
      };
      rate.appendChild(b);
    }
    const note = document.createElement('input');
    note.type = 'text'; note.placeholder = 'note…'; note.value = r.note || '';
    note.onchange = () => { r.note = note.value; ratings[idOf(e)] = r; save(); };
    rate.appendChild(note);
    list.appendChild(row);
  }
  document.getElementById('count').textContent = rated + ' / ' + groups.length + ' rated';
}

function exportJson() {
  const out = groupByPreset().map(e => ({
    engine: e.engine, name: e.name,
    ...(ratings[idOf(e)] || {}),
    metrics: Object.fromEntries(e.variants.map(v =>
      [v.variant, { peak: v.peak, rms: v.rms, clipped: v.clipped, hf: v.hf, tailRatio: v.tailRatio }])),
  }));
  return JSON.stringify({ ratedAt: new Date().toISOString(), presets: out }, null, 2);
}

document.getElementById('export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
  a.download = 'preset-ratings.json';
  a.click();
};
document.getElementById('copy').onclick = async (ev) => {
  await navigator.clipboard.writeText(exportJson());
  ev.target.textContent = 'Copied!';
  setTimeout(() => { ev.target.textContent = 'Copy JSON'; }, 1200);
};
document.getElementById('clear').onclick = () => {
  if (confirm('Clear every rating?')) { ratings = {}; save(); render(); }
};
document.getElementById('only-unrated').onclick = (ev) => {
  onlyUnrated = !onlyUnrated;
  ev.target.classList.toggle('on', onlyUnrated);
  render();
};
render();
</script>
`;
}
