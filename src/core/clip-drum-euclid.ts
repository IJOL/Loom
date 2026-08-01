// Session-global "the Euclidean fields are open" flag for the drum grid. The
// fields are a generator you reach for now and then, not a permanent third
// column, so they start CLOSED behind their vertical rail. Mirrors
// clip-drum-fullkit.ts: a module-level toggle, not persisted to saved state,
// so opening it once keeps it open while you move between clips.
let euclidOpen = false;
export function isDrumEuclidOpen(): boolean { return euclidOpen; }
export function setDrumEuclidOpen(v: boolean): void { euclidOpen = v; }
