// plugins/audio-probe/plugin.json
var plugin_default = {
  id: "audio-probe",
  name: "Audio Probe",
  version: "1.0.0",
  loomApi: 1,
  author: "Loom",
  main: "main.js",
  components: [
    {
      kind: "engine",
      id: "audio-probe",
      name: "Audio Probe",
      polyphony: "poly",
      params: [],
      capabilities: {
        clipContent: "audio",
        shortLabel: "probe",
        outputTrim: 1,
        accepts: ["audio-file"],
        acceptsNoteFx: false,
        harmonic: false
      }
    }
  ]
};

// plugins/audio-probe/main.ts
Loom.registerComponent(plugin_default.components[0]);
