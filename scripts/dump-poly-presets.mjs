// One-shot script: snapshot FACTORY_POLY_PRESETS (TS source) to public/presets/poly.json
// so the runtime preset-loader can fetch it as a static asset. Re-run after editing
// src/polysynth/poly-presets.ts. GM tags are populated separately (see Task B2).
//
// Usage: npx tsx scripts/dump-poly-presets.mjs
import { FACTORY_POLY_PRESETS } from '../src/polysynth/poly-presets.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/presets', { recursive: true });
const out = {
  engineId: 'poly',
  presets: FACTORY_POLY_PRESETS.map((p) => ({
    name: p.name,
    gm: p.gm ?? [],
    params: p.params,
  })),
};
writeFileSync('public/presets/poly.json', JSON.stringify(out, null, 2));
console.log(`wrote ${out.presets.length} poly presets`);
