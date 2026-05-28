// scripts/wav-bless.ts
// Copies every WAV from test/output/ to test/golden/, overwriting. The
// resulting golden set should be committed deliberately.

import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'test', 'output');
const GOLDEN = resolve(process.cwd(), 'test', 'golden');

if (!existsSync(OUTPUT)) {
  console.error('test/output/ does not exist — run tests first.');
  process.exit(1);
}

mkdirSync(GOLDEN, { recursive: true });

const files = readdirSync(OUTPUT).filter(f => f.endsWith('.wav'));
for (const f of files) {
  copyFileSync(join(OUTPUT, f), join(GOLDEN, f));
}
console.log(`Blessed ${files.length} WAV(s) to test/golden/`);
