# Sampler inspector visual reorg — design (incremental)

**Date:** 2026-06-07
**Mockup (visual source of truth):** [../mockups/sampler-mockup.html](../mockups/sampler-mockup.html)

Brings the real Sampler inspector toward the approved mockup. Done as small, individually
**browser-verified** increments (the 2026-06-06 failure came from shipping the whole reorg
blind; see memory `feedback-mockup-parity-and-honest-done`). Each increment is additive and
must keep the existing controls working + the suite green.

## Increment plan

1. **Keyboard map** (THIS increment). A horizontal mini-keyboard above the sampler controls
   that visualises the lane's keymap — drumkit: a labelled colour marker per pad at its key;
   melodic: a colour band per zone with its root marked. Read-only (auto-detects drumkit vs
   melodic from the keymap; no data mutation). New module `engines/sampler-keyboard-map.ts`,
   mounted in `sampler.ts buildParamUI`, styled in `_session-inspector.scss`.
2. **Connector lines** — SVG lines linking each control strip / keymap row to its key on the map.
3. **Melódico ⇄ Drumkit slide switch** — a view toggle in the header; the thorny part is the
   data transform (range zones ⇄ single-note pads) when a user converts one to the other.
4. **Per-sample viewer with zoom** — selecting a strip shows that sample's waveform + loop
   points + the −/＋ zoom from the mockup.
5. **Sampler | Loop top selector + Loop slicing workspace** — the 2-way view, loop view = the
   slice tool (onsets/grid, sens/threshold, editable cuts) → notes → clip.

## Increment 1 — keyboard map (in scope now)

- `renderSamplerKeyboardMap(host, keymap, { drumkit })`: pure DOM, no async (labels from the
  pad key / note name, not the sample store). Range = pads/zones span clamped to a sensible
  window (a single full-range 0..127 melodic zone windows around its roots).
- Mounted ABOVE the drum-voice rack (drumkit) / above the keymap editor (melodic). Hidden when
  the keymap is empty.
- Acceptance: load TR-808 → the map shows a labelled marker per pad over the keys; ＋ Pad adds a
  marker; load a melodic instrument → the map shows zone bands. Browser screenshot vs mockup.
  tsc clean + suite green.
