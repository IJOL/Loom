// Plain serializable state for a single-band compressor and an optional
// sidechain ducker block. The state shapes are referenced by ChannelStrip
// (per-lane comp + duck) and MasterCompressor (comp only).

export interface CompState {
  bypass: boolean;
  threshold: number;   // dB,  -100..0 — DynamicsCompressorNode range
  ratio: number;       // 1..20
  attack: number;      // s,    0..1
  release: number;     // s,    0..1
  knee: number;        // dB,   0..40
  makeup: number;      // linear gain, ~0..4 (≈ +12dB)
}

export interface SidechainState {
  source: string;      // lane id of the source (must be registered with SidechainBus)
  depth: number;       // 0..1 — how deep the duck dips
  attack: number;      // s
  release: number;     // s
  threshold: number;   // dB; envelope below this contributes nothing
}

export const DEFAULT_COMP_STATE: CompState = {
  bypass: true,
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 30,
  makeup: 1,
};

export const DEFAULT_SIDECHAIN_STATE: SidechainState = {
  source: '',
  depth: 0.6,
  attack: 0.005,
  release: 0.25,
  threshold: -40,
};

export function withCompDefaults(s: Partial<CompState> | undefined): CompState {
  if (!s) return { ...DEFAULT_COMP_STATE };
  return { ...DEFAULT_COMP_STATE, ...s };
}

export function withSidechainDefaultsOrNull(
  s: Partial<SidechainState> | null | undefined,
): SidechainState | null {
  if (s == null) return null;
  return { ...DEFAULT_SIDECHAIN_STATE, ...s };
}
