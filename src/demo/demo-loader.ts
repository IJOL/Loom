import type { SessionState } from '../session/session';

/** A demo file on disk is a {@link SessionState} plus optional transport
 *  metadata the loader honors on load. The live session model itself carries no
 *  tempo (only the save-file path sets `seq.bpm`), so demos that want a specific
 *  tempo declare it here and the loader pushes it through the BPM input. */
export interface DemoSession extends SessionState {
  /** Transport tempo (BPM) for the demo. Honored by the loader: clamped to the
   *  transport range and reflected in the BPM input via bpm-broadcast. Absent ⇒
   *  keep the current transport BPM. */
  bpm?: number;
}

/** Fetch a demo from a URL (typically `/demos/*.json` served by Vite from
 *  `public/`). Throws on non-OK response. Parse only — no side effects. */
export async function fetchDemoSession(url: string): Promise<DemoSession> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDemoSession ${url}: HTTP ${res.status}`);
  return (await res.json()) as DemoSession;
}
