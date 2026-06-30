// Pure id + deep-clone helpers shared by the session model (session.ts) and its
// mutation ops (session-ops.ts). Leaf module — only depends on the data shapes.

import type { SessionState } from './session-types';

let nextIdCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
}

export function cloneSessionState(s: SessionState): SessionState {
  return JSON.parse(JSON.stringify(s)) as SessionState;
}
