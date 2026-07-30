// Moved to @loom/plugin-sdk (dsp/velocity.ts) — a plugin renderer needs the same
// velocity curve the built-in engines were tuned against, and one copy is the
// rule. Re-exported here so existing imports keep resolving.
export {
  DEFAULT_VELOCITY, ACCENT_PUNCH, ACCENT_VCA_LADDER,
  velNorm, velGain01, velToGain, resolveVelocity, velGain,
} from '@loom/plugin-sdk';
