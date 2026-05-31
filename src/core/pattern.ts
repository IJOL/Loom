// Each automation lane is sampled at SUB_RES points per 16th-step, so a clip of
// N steps has N * SUB_RES values. At 16 it's ~7ms resolution at 130 BPM — fine
// for filter sweeps without being too heavy on canvas redraws.
//
// Shared by per-clip automation (clip.envelopes) and Performance-view
// automation. (The Classic PatternData / PatternBank that used to live here are
// gone — the Session is the only note model.)
export const AUTOMATION_SUB_RES = 16;
