// src/control/profile-registry.ts
import type { ControllerProfile, MIDIPortInfo } from './controller-profile';

// Build-time scan: every file in profiles/ that exports a ControllerProfile.
// Adding a new profile file is the ONLY step needed — no import here.
const modules = import.meta.glob<Record<string, unknown>>(
  ['./profiles/*.ts', '!./profiles/*.test.ts'],
  { eager: true },
);

function isProfile(v: unknown): v is ControllerProfile {
  return !!v && typeof v === 'object'
    && typeof (v as ControllerProfile).id === 'string'
    && typeof (v as ControllerProfile).detect === 'function'
    && typeof (v as ControllerProfile).parse === 'function';
}

const profiles: ControllerProfile[] = [];
for (const mod of Object.values(modules)) {
  for (const exported of Object.values(mod)) {
    if (isProfile(exported)) profiles.push(exported);
  }
}

export function listProfiles(): ControllerProfile[] {
  return profiles.slice();
}

/** Highest-confidence profile for a port, or null if none (generic always returns 1). */
export function pickProfile(port: MIDIPortInfo): ControllerProfile | null {
  let best: ControllerProfile | null = null;
  let bestScore = 0;
  for (const p of profiles) {
    const s = p.detect(port);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}
