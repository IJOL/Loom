// Moved to @loom/plugin-sdk — plugins need these primitives, and one copy is the
// rule. Re-exported here so existing imports keep resolving.
export { midiToFreq, clamp01 } from '@loom/plugin-sdk';
