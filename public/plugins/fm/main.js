// plugins/fm/plugin.json
var plugin_default = {
  id: "fm",
  name: "FM",
  version: "1.0.0",
  loomApi: 1,
  author: "Loom",
  main: "main.js",
  dsp: "dsp.js",
  presets: "presets.json",
  components: [
    {
      kind: "engine",
      id: "fm",
      name: "FM",
      polyphony: "poly",
      params: [
        {
          id: "algorithm",
          label: "Algorithm",
          kind: "discrete",
          min: 0,
          max: 3,
          default: 2,
          selectStyle: "dropdown",
          options: [
            { value: "0", label: "1. Serial 4\u21923\u21922\u21921" },
            { value: "1", label: "2. Parallel mods \u2192 1" },
            { value: "2", label: "3. Two pairs (4\u21923, 2\u21921)" },
            { value: "3", label: "4. Additive (all carriers)" }
          ]
        },
        { id: "feedback", label: "FB (op4)", kind: "continuous", min: 0, max: 1, default: 0 },
        { id: "op1.ratio", label: "Op1 Ratio", kind: "continuous", min: 0.1, max: 16, default: 1, curve: "exponential", group: "op1" },
        { id: "op1.detune", label: "Op1 Det", kind: "continuous", min: -50, max: 50, default: 0, unit: "\xA2", group: "op1" },
        { id: "op1.level", label: "Op1 Lvl", kind: "continuous", min: 0, max: 1, default: 0.9, group: "op1" },
        { id: "op1.attack", label: "Op1 Atk", kind: "continuous", min: 1e-3, max: 2, default: 0.01, unit: "s", group: "op1" },
        { id: "op1.decay", label: "Op1 Dec", kind: "continuous", min: 1e-3, max: 4, default: 0.3, unit: "s", group: "op1" },
        { id: "op1.sustain", label: "Op1 Sus", kind: "continuous", min: 0, max: 1, default: 0.7, group: "op1" },
        { id: "op1.release", label: "Op1 Rel", kind: "continuous", min: 5e-3, max: 4, default: 0.3, unit: "s", group: "op1" },
        { id: "op2.ratio", label: "Op2 Ratio", kind: "continuous", min: 0.1, max: 16, default: 2, curve: "exponential", group: "op2" },
        { id: "op2.detune", label: "Op2 Det", kind: "continuous", min: -50, max: 50, default: 0, unit: "\xA2", group: "op2" },
        { id: "op2.level", label: "Op2 Lvl", kind: "continuous", min: 0, max: 1, default: 0.35, group: "op2" },
        { id: "op2.attack", label: "Op2 Atk", kind: "continuous", min: 1e-3, max: 2, default: 0.01, unit: "s", group: "op2" },
        { id: "op2.decay", label: "Op2 Dec", kind: "continuous", min: 1e-3, max: 4, default: 0.3, unit: "s", group: "op2" },
        { id: "op2.sustain", label: "Op2 Sus", kind: "continuous", min: 0, max: 1, default: 0.7, group: "op2" },
        { id: "op2.release", label: "Op2 Rel", kind: "continuous", min: 5e-3, max: 4, default: 0.3, unit: "s", group: "op2" },
        { id: "op3.ratio", label: "Op3 Ratio", kind: "continuous", min: 0.1, max: 16, default: 1, curve: "exponential", group: "op3" },
        { id: "op3.detune", label: "Op3 Det", kind: "continuous", min: -50, max: 50, default: 0, unit: "\xA2", group: "op3" },
        { id: "op3.level", label: "Op3 Lvl", kind: "continuous", min: 0, max: 1, default: 0.5, group: "op3" },
        { id: "op3.attack", label: "Op3 Atk", kind: "continuous", min: 1e-3, max: 2, default: 0.01, unit: "s", group: "op3" },
        { id: "op3.decay", label: "Op3 Dec", kind: "continuous", min: 1e-3, max: 4, default: 0.3, unit: "s", group: "op3" },
        { id: "op3.sustain", label: "Op3 Sus", kind: "continuous", min: 0, max: 1, default: 0.7, group: "op3" },
        { id: "op3.release", label: "Op3 Rel", kind: "continuous", min: 5e-3, max: 4, default: 0.3, unit: "s", group: "op3" },
        { id: "op4.ratio", label: "Op4 Ratio", kind: "continuous", min: 0.1, max: 16, default: 3, curve: "exponential", group: "op4" },
        { id: "op4.detune", label: "Op4 Det", kind: "continuous", min: -50, max: 50, default: 0, unit: "\xA2", group: "op4" },
        { id: "op4.level", label: "Op4 Lvl", kind: "continuous", min: 0, max: 1, default: 0.25, group: "op4" },
        { id: "op4.attack", label: "Op4 Atk", kind: "continuous", min: 1e-3, max: 2, default: 0.01, unit: "s", group: "op4" },
        { id: "op4.decay", label: "Op4 Dec", kind: "continuous", min: 1e-3, max: 4, default: 0.3, unit: "s", group: "op4" },
        { id: "op4.sustain", label: "Op4 Sus", kind: "continuous", min: 0, max: 1, default: 0.7, group: "op4" },
        { id: "op4.release", label: "Op4 Rel", kind: "continuous", min: 5e-3, max: 4, default: 0.3, unit: "s", group: "op4" },
        { id: "amp.mix", label: "Mix", kind: "continuous", min: 0, max: 1, default: 0.7 },
        { id: "poly.voices", label: "Voices", kind: "continuous", min: 1, max: 16, default: 6, group: "poly" }
      ],
      groups: [
        { id: "op1", title: "OP 1", row: 0, color: "var(--knob-cyan)" },
        { id: "op2", title: "OP 2", row: 0, color: "var(--knob-yellow)" },
        { id: "op3", title: "OP 3", row: 1, color: "var(--knob-blue)" },
        { id: "op4", title: "OP 4", row: 1, color: "var(--knob-purple)" },
        { id: "poly", title: "POLY", row: 2 }
      ],
      modulators: [
        {
          id: "lfo1",
          kind: "lfo",
          enabled: true,
          connections: [],
          rateHz: 4,
          waveform: "sine",
          bipolar: true,
          syncToBpm: false,
          syncBars: 0.25,
          syncSubdiv: "straight",
          trigger: "free",
          scope: "shared"
        },
        {
          id: "adsr1",
          kind: "adsr",
          enabled: true,
          connections: [],
          attackSec: 0.01,
          decaySec: 0.3,
          sustain: 0.7,
          releaseSec: 0.3,
          scope: "per-voice"
        }
      ],
      capabilities: {
        clipContent: "notes",
        shortLabel: "fm-4-op",
        outputTrim: 0.179
      }
    }
  ]
};

// plugins/fm/main.ts
Loom.registerComponent(plugin_default.components[0]);
