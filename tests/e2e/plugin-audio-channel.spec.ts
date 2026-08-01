import { test, expect } from '@playwright/test';

// Slice A's acceptance proof: a plugin that declares itself an audio channel
// (capabilities.clipContent: 'audio', listedInSelector: false) gets the audio
// behaviour from the host with zero DSP and zero mention under src/.
//
// A test that only checks "Audio Probe" is ABSENT from the selector cannot tell
// "the host honoured listedInSelector: false" apart from "the plugin never
// loaded" (index.json missing it, the build failing, main.js throwing). It
// would pass identically in either case. Karplus — a plugin that IS listed —
// is the control: its presence proves plugin loading works on this page at
// all, so the probe's absence can only be explained by the capability.
test('a plugin that declares itself an audio channel is honoured, not just absent', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  // 1. The probe is MEANT to be there.
  const ids = await page.evaluate(async () =>
    (await (await fetch('plugins/index.json')).json()).plugins);
  expect(ids).toContain('audio-probe');

  const options = (await page.locator('#engine-select option').allTextContents()).join('|');

  // 2. Plugin loading demonstrably WORKS on this page: Karplus (rendered as its
  //    manifest name, "Karp" — see plugins/karplus/plugin.json), a plugin with
  //    no listedInSelector, is present. Without this the next assertion proves
  //    nothing.
  expect(options).toContain('Karp');

  // 3. And yet the probe is absent. Given 1 and 2, the only explanation left is
  //    that the host honoured listedInSelector: false.
  expect(options).not.toContain('Audio Probe');

  // 4. Nothing failed quietly on the way.
  expect(errors).toEqual([]);
});
