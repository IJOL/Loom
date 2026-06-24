// Session-global "show full kit" flag for the drum grid. Compact (false) shows
// only the sounds a clip uses; full (true) shows every kit pad. Mirrors
// clip-follow.ts: a simple module-level toggle, not persisted to saved state.
let fullKit = false;
export function isDrumFullKit(): boolean { return fullKit; }
export function setDrumFullKit(v: boolean): void { fullKit = v; }
