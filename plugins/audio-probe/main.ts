// plugins/audio-probe/main.ts — main-thread half: metadata only.
//
// An audio channel with NO DSP of its own: it exists to prove the capabilities
// alone are enough. It ships no `dsp`, so the host never asks it for a
// renderer — the waveform editor, the file-drop target, and the lane editor
// reduced to its inserts all come from `capabilities.clipContent: 'audio'`
// alone, without a single line under src/ naming this engine.
//
// Plain JSON import, NOT `with { type: 'json' }`: esbuild 0.21 bundles JSON
// natively, and the import-attribute syntax is newer than the toolchain here.
import manifest from './plugin.json';

Loom.registerComponent(manifest.components[0] as never);
