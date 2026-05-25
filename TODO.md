# TODO

Pending work, ordered roughly by size. Each block needs its own work cycle to ship without breaking the rest.

## Huge — multi-turn synths / modular

- **DX7 emulation tab** — 6-operator FM synth. 32 algorithms (operator routing topologies), per-op envelope (8-stage with rates/levels), per-op level/freq ratio/detune, feedback loop on op 6, LFO, key scaling, velocity sensitivity. UI is dense: 6 op panels + algorithm picker + global section. Sound is hard to match without iterating on the actual Yamaha YM2128 EG curves. **Plan:** start with 4-op subset, 8 most-used algorithms, simple ADSR per op (not the real 8-stage). Iterate on accuracy.

- **ARP 2600 emulation tab** — semi-modular subtractive. 3 VCOs (sine/tri/saw/sqr each with sync + PWM), ring mod, noise (white/pink), VCF (LP24 + HP12), VCA, two envelope generators (AR + ADSR), sample & hold, lag, two LFOs, electronic switch, voltage processors, spring reverb. Famous patch points panel. **Plan:** start with VCOs + VCF + VCA + 1 envelope + S&H, no patch cables yet (fixed routing), then add the patcher in a separate turn.

- **True cable patcher** (modular routing UI for current PolySynth + future ARP 2600 / DX7) — SVG canvas with draggable cables. Each module (osc/filter/env/lfo) exposes input + output jacks. Drag from output → input to connect. Right-click to delete. Connection data model: `{ sourceId, sourceJack, destId, destJack, amount }`. Re-wire Web Audio nodes on connect/disconnect. Cables rendered as bezier curves. **Plan:** start with a fixed module list (osc1, osc2, sub, noise, filter, amp, lfo1, lfo2) and a small set of jacks (out / freq-mod-in / amp-mod-in / cutoff-mod-in). Once that ships, generalize.

- **PolySynth with multiple filters + configurable I/O** — beyond the current single filter, allow N filters in serial or parallel, per-filter type/cutoff/Q/env, configurable signal routing (osc1→filter1, osc2→filter2, sub→filter1+2, etc.). Stepping stone toward the modular patcher.

- **Modularity throughout** — generalize the synth so every module (osc, filter, envelope, LFO) is replaceable / chainable. Required for both DX7/ARP2600 and the patcher. Big refactor of polysynth.ts into a node-based system.

## Next up (medium)

- **Tests funcionales + UI** (current request)
  - Vitest + jsdom for unit tests of pure modules: `random.ts` (deterministic with seed), `pattern.ts`, `fx.ts` math (`syncDivToHz`), `sequencer.ts` (mock TB303/DrumMachine/PolySynth).
  - Web Audio nodes need stubbing — write a minimal `AudioContext` mock in `tests/setup.ts` (createGain, createOscillator, etc. as no-op stubs) so `polysynth.trigger` and friends can be exercised without crashing.
  - Playwright for end-to-end UI: click play, switch tab, edit a step, randomize, switch pattern slot (queue), check the slot pulses and swaps at bar end.
  - Initial coverage targets: scheduler timing, randomize distributions, pattern bank queue/swap, knob component (drag math → value).

## Big features (each needs its own turn)

- **Panel modular de conexiones del synth** (drag-cable patch bay)
  - SVG canvas with draggable cables; each knob exposes an input jack, each LFO/envelope an output jack.
  - Data model: `Connection { sourceId, destId, amount }`.
  - Re-wire Web Audio graph on connect/disconnect.
  - Cable rendering with bezier curves; hover/select/delete.

- **Lanes de automatización pintables** ("cualquier control debe ser automatizable")
  - Param registry: every knob registers `{ id, label, getter, setter, min, max }`.
  - Per-pattern automation lanes: `lane = { paramId, values: number[N], curve }` where N matches step count.
  - Canvas-based curve editor: click & drag to paint values, smooth/stepped/random modes, copy/paste, scale Y.
  - Sequencer applies lane values per step (or per sub-step for higher resolution).
  - Add "+ Automate" button on any knob → spawns a lane.

## Pattern libraries (new request)

- **Drum break library** — hardcoded classic patterns selectable from a dropdown:
  Amen Break, Apache, Funky Drummer, Think Break, 4-on-the-floor house, trap hi-hats, jungle/D&B, motorik, boom-bap. "Load preset" replaces current drum lanes; user can edit on top.
- **TB-303 acid bass library** — hardcoded classic acid lines & long sequences:
  Phuture-style "Acid Tracks", Hardfloor-style sequences, Plastikman, generic 16/32-step acid loops. Multiple lengths (1-4 bars). "Load preset" replaces current bass row.
- **PolySynth melody library** — hardcoded melodic phrases / chord progressions for the polysynth track.
  Some scale-aware so they fit the current scale/root selector.

## Sampler engine (requested — for real vocal "ahhs" etc.)

A real audio-sample playback engine alongside PolySynth, so each extra poly slot can EITHER run the subtractive synth OR play back a sample at different pitches.

- **Sampler class** (`src/sampler.ts`): holds an `AudioBuffer`, `baseMidi`, looping flag, per-trigger envelope. Per `trigger(midi, time, gate, accent)`, creates `AudioBufferSourceNode` with `playbackRate = 2^((midi - baseMidi)/12)`, into a gain envelope, into the channel strip input.
- **Built-in sample library**: ship a few synthesized-at-boot samples for things subtractive can't fake well: choir "aah", choir "ooh", grand piano C4, plucked string. Generate via `OfflineAudioContext` at app load and cache the buffers. No bundled binaries.
- **Drag-drop / file picker per track**: any `.wav` / `.mp3` / `.flac` loads into a track's Sampler.
- **Per-track engine switch**: track header gets a `Synth ⇄ Sampler` toggle. Synth params panel hides when in sampler mode; sampler shows base note + loop start/end + amp env knobs instead.
- **MIDI program → engine routing**: programs known to be polyphonic vocal/piano (0-7, 52-54) auto-load sampler with their matching built-in sample. The rest stay on PolySynth.
- **Channel strip reuse**: both engines write to the same per-slot `ChannelStrip` so mixer + sends + EQ work unchanged.

## Automation extensions (high priority — natural follow-ups)

- **Record knob movements into automation** — global REC toggle in the transport. When on + playing, any knob `onChange` writes the new value into the matching automation lane at the current sub-step. If no lane exists for that paramId, create one initialized to the current value. Skip writes that come from the automation tick itself (use a re-entrancy flag) to avoid feedback. Optional: smooth recorded points with a low-pass filter so wiggles don't end up razor-sharp.

- **Copy/paste between pattern slots** — "copy bass+drums from A to B", "copy melody from C to D", "copy everything from A to D". UI: a small menu next to the slot buttons with copy/paste source/destination + which tracks (bass / drums / melody / automation / all). Should respect the queue (paste while playing applies to the slot you're copying into, doesn't disrupt current playback).

## Sequencer beyond steps (big refactor — needed for true MIDI fidelity)

User explicitly asked: "ampliar el sequenciador para hacerlo más musical y no solamente step". To play back the Sweet Dreams MIDI faithfully, the current 16th-note grid is too rigid. Needed:

- **Time-based note events** instead of per-step on/off. Each note has `{ startBeat, durationBeats, midi, velocity, ... }`. The pattern stores a list of notes per track.
- **Piano-roll UI** per track. Drag to create notes, resize for duration, drag vertically to change pitch.
- **Sub-step resolution** — at minimum 64th notes / triplets / dotted variations.
- **Per-note velocity** instead of per-step accent boolean.
- **Multiple voices per step on the bass too** — currently bass is single-note per step; MIDI bass has octave doubles. Need `BassStep.notes: number[]` (or full piano-roll).
- **Polysynth pattern multinote** — DONE (PolyStep.notes is already an array with chord cycle UI).
- Backwards-compat shim: convert existing step patterns to note events on load.

Migration path: add an alternative "MIDI mode" toggle on each track. In MIDI mode the track uses note events + piano roll. Step mode keeps the current 16-cell grid. They produce the same kind of trigger calls into the synth, so the engine doesn't change.

## MIDI fidelity gaps (to fully reproduce real songs like Sweet Dreams)

After parsing the actual Sweet Dreams MIDI, what's missing to reproduce it faithfully:

- **Polyphonic bass track** — the MIDI bass plays octave doubles (C2+C3, A♭1+A♭2). TB-303 is monophonic by design. Either add `BassStep.notes: number[]` (TB-303 still plays just `notes[0]`, octave layer played by a parallel poly bass voice) or add a separate "Poly Bass" track.
- **Per-note velocity** — currently only an accent boolean. MIDI has continuous 0-127 velocities. Need to extend Step types with optional velocity and route to amp/filter.
- **Multi-instrument polysynth** — Sweet Dreams has 11 MIDI tracks (strings, lead, bass, voice oohs, piano, drums). Only ONE polysynth track exists. To layer up properly need N parallel poly tracks, each with its own polysynth instance + channel strip.
- **True long sustains** — `tie` extends gate to 1.6× the step. MIDI sustains can be 1.9s = several bars. Need real "gate length in beats/bars" instead of a binary flag.
- **Triplet timing** — current grid is straight 16ths. MIDI has note placements like beat 38.75 / 39.25 that align here but anything with triplets won't quantize cleanly.
- **MIDI import** — current load uses scripts/parse-midi.mjs offline. A real UI loader (drag-drop a .mid into the app) would let you instantly bring tracks into slots.

## Specific feature requests (medium)

- **Drum rolls per step** — extra "roll" state on each drum cell (off → on → accent → roll-2 → roll-4) that schedules N sub-triggers within one step (32nds / 64ths). UI: extend the cycle, or shift-click to toggle roll independently.
- **Sweet Dreams 4-pattern, 4-bar demo** — replace the boot demo with 4 slots (A/B/C/D) each at 64 steps (4 bars), encoding the Eurythmics riff: minor key bass riff, classic LinnDrum-style beat, hooky melody line. Each slot a section (verse / pre-chorus / chorus / bridge).
- **Musical sync everywhere there's a Hz** — added on PolySynth LFOs and arpeggiator. Pending: master filter chain LFO already syncs; master delay damping (Hz) doesn't need sync; ADSR seconds could optionally take musical divisions (1/4 attack, etc.) — niche.
- **Extend arp scope to drum tracks** — currently melody / bass / both. Adding drums means turning a single hit into a roll-style fast pattern. Could be a fun chaos source.

## Smaller polish

- **Mono mode + glide** for the polysynth (currently always poly).
- **Pitch envelope** ADSR on polysynth (currently filter + amp only).
- **Distortion master** insert (was deferred earlier).
- **MIDI export** of patterns (.mid file) — skipped earlier.
- **Pattern chain mode** (auto-cycle A→B→C→D as a song).
- **Save / load multiple banks** (named slots, not just one localStorage key).
- **Filter chain reorder** (drag to reorder filters in the Master FX chain).
- **Notch filter wave for LFOs** + sample-and-hold.

## Known limitations

- Slot switch saves edits to the slot you're leaving immediately, but the audible swap happens at the next loop boundary (musical). If you change pattern length on slot A, then queue B, then come back to A — the length you stored is the new one.
- Filter chain rewiring briefly disconnects audio when adding/removing filters. Could be smoother with crossfade.
- `polyParams` in localStorage isn't deep-merged with defaults — adding new fields will mean old saves lose data for those fields (they default).
