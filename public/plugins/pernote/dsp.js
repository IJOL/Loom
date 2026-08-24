// plugins/pernote/dsp.ts
var GOLDEN = (Math.sqrt(5) - 1) / 2;
Loom.registerModulatorKernel({
  id: "pernote",
  valueAt(m, _t, _origin, triggerIndex) {
    const n = triggerIndex ?? 0;
    const pattern = m.params?.pattern ?? GOLDEN;
    const skew = m.params?.skew ?? 0;
    const x = n * pattern + skew;
    const v = x - Math.floor(x);
    return m.params?.bipolar === 0 ? v : v * 2 - 1;
  }
});
