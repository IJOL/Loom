// Shared access to the committed loop fixtures (`test/fixtures/loops/drum/*.wav`)
// for use as real-audio test fixtures. These are a small curated subset of real
// drum loops with the BPM encoded in the filename (the bulk `loops/` corpus
// stays gitignored). We walk UP from cwd to find `test/fixtures/loops/drum` so
// the resolver works from the repo root and from a .claude/worktrees/* worktree.
// When absent (shouldn't happen, since they're committed), helpers return [].

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface LoopFixture {
  path: string;
  name: string;
  /** BPM parsed from the filename (the corpus encodes it), or null if unknown. */
  bpm: number | null;
}

/** Walk up from `startDir` until a dir containing `test/fixtures/loops/drum` is found. */
export function findLoopsDir(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, 'test', 'fixtures', 'loops');
    if (existsSync(join(candidate, 'drum'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse BPM from names like '..._135bpm_1.wav' or 'Amen_Break_136_BPM_...'. */
export function bpmFromFilename(name: string): number | null {
  const m1 = name.match(/(\d{2,3})\s*bpm/i);
  if (m1) return Number(m1[1]);
  const m2 = name.match(/_(\d{2,3})_BPM/i);
  if (m2) return Number(m2[1]);
  return null;
}

/** List WAV fixtures in `loops/<category>` (default 'drum'); [] when absent. */
export function listLoopFixtures(category: string = 'drum'): LoopFixture[] {
  const root = findLoopsDir();
  if (!root) return [];
  const dir = join(root, category);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.wav$/i.test(f))
    .map((name) => ({ path: join(dir, name), name, bpm: bpmFromFilename(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a fixture file as an ArrayBuffer (for parseLoopMetadata / decodeAudioData). */
export function readFixtureBytes(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
