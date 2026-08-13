// Read a saved Loom session and describe its lanes.
//
// Written for a lock-up nobody could reproduce from a fresh boot: one channel
// sounding for ever, deaf to the transport, silenced only by its own mute. The
// state that produced it is in the save — so the save is where to look, rather
// than at another guess about the sequence that made it.
//
// Usage: node tools/inspect-save.mjs <file.json> [engineId]
import { readFileSync } from 'node:fs';

const [, , file, wantEngine] = process.argv;
if (!file) { console.error('usage: node tools/inspect-save.mjs <file.json> [engineId]'); process.exit(1); }

const raw = JSON.parse(readFileSync(file, 'utf8'));

/** Two shapes reach here: the IndexedDB dump (an array of `{id, json}`) and a
 *  single session object. Both are handed back as a list of named sessions. */
function sessions(v) {
  if (Array.isArray(v)) {
    return v.map((r) => ({ name: r.id ?? '?', state: typeof r.json === 'string' ? JSON.parse(r.json) : r.json }));
  }
  return [{ name: 'session', state: v }];
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

for (const { name, state } of sessions(raw)) {
  const s = state.sessionState ?? state.session ?? state;
  const lanes = s.lanes ?? [];
  console.log(`\n=== ${name} — schemaVersion ${state.schemaVersion ?? '?'} · ${lanes.length} lanes ===`);

  for (const lane of lanes) {
    if (wantEngine && lane.engineId !== wantEngine) continue;
    const es = lane.engineState ?? {};
    const params = es.params ?? {};
    const mods = es.modulators ?? lane.modulators ?? [];
    const bad = Object.entries(params).filter(([, v]) => !isNum(v));

    console.log(`\n--- ${lane.name} [${lane.engineId}] id=${lane.id}`);
    console.log(`    preset=${lane.enginePresetName ?? '—'} mute=${lane.muted ?? false} level=${lane.level}`);
    if (bad.length) console.log(`    !! NON-NUMERIC PARAMS: ${JSON.stringify(bad)}`);

    if (mods.length) {
      console.log(`    modulators (${mods.length}):`);
      for (const m of mods) {
        console.log(`      ${m.type ?? m.kind ?? '?'} → ${m.target ?? m.destination ?? '—'} depth=${m.depth} ${JSON.stringify(m.params ?? {})}`);
      }
    }
    if (es.noteFx?.length) console.log(`    noteFx: ${JSON.stringify(es.noteFx)}`);
    if (es.layers ?? es.rack) console.log(`    rack: ${JSON.stringify(es.layers ?? es.rack)}`);

    // The notes themselves: a duration that is not a finite number makes
    // `holdEnd` NaN, and a renderer that ends on its gate then never ends.
    for (const clip of lane.clips ?? []) {
      const notes = clip?.notes ?? [];
      const weird = notes.filter((n) => !isNum(n.start) || !isNum(n.duration) || !isNum(n.midi) || n.duration <= 0);
      const longest = notes.reduce((a, n) => Math.max(a, isNum(n.duration) ? n.duration : 0), 0);
      if (weird.length || longest > 64) {
        console.log(`    clip "${clip.name ?? clip.id}": ${notes.length} notes, longest=${longest}, weird=${weird.length}`);
        for (const n of weird.slice(0, 5)) console.log(`      ${JSON.stringify(n)}`);
      }
    }
  }
}
