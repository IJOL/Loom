import type { SessionState } from '../session/session';

/** Fetch a demo SessionState from a URL (typically `/demos/*.json` served
 *  by Vite from `public/`). Throws on non-OK response. */
export async function fetchDemoSession(url: string): Promise<SessionState> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDemoSession ${url}: HTTP ${res.status}`);
  return (await res.json()) as SessionState;
}
