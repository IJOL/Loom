// Declarative screenshot list. Each shot:
//   name     -> output file docs/manual/images/<name>.png
//   selector -> element to frame (omit for full page)
//   setup    -> async (page) => {} to reach the right UI state before the shot
//
// Selectors below come from index.html. The app boots with a demo loaded, so
// the session grid already has filled cells (no demo-loading needed).

const openFirstClip = async (page) => {
  await page.locator('.session-cell-filled').first().click();
  await page.locator('#session-inspector').waitFor({ state: 'visible' });
};

// ── Engine screenshot helpers ────────────────────────────────────────────────

/** Load a demo by selecting the given label in #demo-picker, then wait for the
 *  session grid to repopulate with filled cells. */
const loadDemo = async (page, label) => {
  await page.locator('#demo-picker').selectOption({ label });
  await page.waitForFunction(
    () => document.querySelectorAll('.session-cell-filled').length > 0,
    null, { timeout: 10_000 },
  );
};

/** Click the first lane tab whose text matches `name` and wait for a .page to
 *  become visible. */
const clickLaneTab = async (page, name) => {
  await page.locator('.session-lane-tab', { hasText: name }).first().click();
  await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
};

/** Add a new lane with the given engineId via the session-tabs add controls. */
const addLane = async (page, engineId) => {
  await page.locator('.session-tabs-engine').selectOption(engineId);
  await page.locator('.session-tabs-add-btn').click();
  // Wait for the new tab to appear and settle.
  await page.waitForTimeout(300);
};

/** A ~2s 16-bit PCM mono WAV with four decaying bursts, so onset detection
 *  finds slices when the audio channel / "Slice → pads" runs. Returned as a
 *  base64 string fed to the hidden "+ Audio" file input via setInputFiles. */
const loopWavBase64 = () => {
  const sr = 44100, secs = 2.0, n = Math.floor(sr * secs);
  const dataLen = n * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    const phase = (i / sr) % 0.5;        // bursts at 0, 0.5, 1.0, 1.5s
    const env = Math.exp(-phase * 18);
    const s = Math.sin(2 * Math.PI * 180 * (i / sr)) * env * 16000;
    b.writeInt16LE(Math.round(s), 44 + i * 2);
  }
  return b.toString('base64');
};

/** Drop a generated WAV into the "+ Audio" control; the new audio clip
 *  auto-opens in the inspector showing the audio-clip editor. */
const addAudioChannel = async (page) => {
  await page.locator('input.session-add-audio-input').setInputFiles({
    name: 'beat.wav', mimeType: 'audio/wav',
    buffer: Buffer.from(loopWavBase64(), 'base64'),
  });
  await page.locator('.audio-clip-slice').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300); // let the waveform canvas paint
};

export const SHOTS = [
  { name: 'app-overview', selector: '.synth' },
  { name: 'transport', selector: '.row.transport' },
  { name: 'session-grid', selector: '#session-grid' },
  { name: 'session-view', selector: '#session-view' },
  {
    name: 'inspector',
    selector: '#session-inspector',
    setup: openFirstClip,
  },
  {
    // The unified REC group on the session bar (REC button + take/live/offline
    // mode selector). Replaced the removed standalone "↓ WAV" export menu.
    name: 'rec-group',
    selector: '.rec-group',
  },
  {
    name: 'midi-import',
    selector: '.midi-panel',
    setup: async (page) => { await page.locator('.midi-panel > summary').click(); },
  },
  {
    name: 'master-fx',
    selector: '.page[data-page="fx"]',
    setup: async (page) => { await page.locator('.tab[data-tab="fx"]').click();
      await page.locator('.page[data-page="fx"]').waitFor({ state: 'visible' }); },
  },
  {
    name: 'save-manager',
    selector: '.save-manager-dialog',
    setup: async (page) => { await page.locator('#load').click();
      await page.locator('#save-manager-modal').waitFor({ state: 'visible' }); },
  },

  // ── Per-engine editor panels ──────────────────────────────────────────────
  // Each shot loads the demo that contains the relevant engine, clicks the
  // lane tab to reveal its editor, then frames the page panel.

  {
    name: 'engine-tb303',
    selector: '.page[data-page="303"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await clickLaneTab(page, '303 1');
    },
  },
  {
    name: 'engine-drums',
    selector: '.page[data-page="drums"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await clickLaneTab(page, 'Drums 1');
    },
  },
  {
    name: 'engine-subtractive',
    selector: '.page[data-page="poly"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await clickLaneTab(page, 'Sub 1');
    },
  },
  {
    name: 'engine-karplus',
    selector: '.page[data-page="poly"]',
    setup: async (page) => {
      await loadDemo(page, 'Cordillera');
      await clickLaneTab(page, 'Guitar');
    },
  },
  {
    name: 'engine-wavetable',
    selector: '.page[data-page="poly"]',
    setup: async (page) => {
      await loadDemo(page, 'Neon Drive');
      await clickLaneTab(page, 'Neon Lead');
    },
  },
  {
    name: 'engine-fm',
    selector: '.page[data-page="poly"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await addLane(page, 'fm');
      // The newly-added lane tab is the last one before the "+" adder.
      const tabs = page.locator('.session-lane-tab');
      const count = await tabs.count();
      await tabs.nth(count - 1).click();
      await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
    },
  },
  {
    name: 'engine-sampler',
    selector: '.page[data-page="poly"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await addLane(page, 'sampler');
      const tabs = page.locator('.session-lane-tab');
      const count = await tabs.count();
      await tabs.nth(count - 1).click();
      await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
    },
  },

  // ── Audio channel ─────────────────────────────────────────────────────────
  {
    // The "+ Audio" control in the session tab bar.
    name: 'audio-channel-add',
    selector: '.session-tabs',
  },
  {
    // The audio-clip editor (BPM / bars / Warp / Slice → pads + waveform header),
    // reached by dropping a generated WAV into the "+ Audio" control.
    name: 'audio-clip-editor',
    selector: '#insp-roll-host',
    setup: addAudioChannel,
  },

  {
    name: 'stems-modal',
    selector: '#stems-modal .save-manager-dialog',
    setup: async (page) => {
      await page.locator('#stems-open').click();
      await page.locator('#stems-modal').waitFor({ state: 'visible' });
    },
  },

  // ── Performance view ─────────────────────────────────────────────────────
  {
    name: 'performance-view',
    selector: '#performance-view-root',
    setup: async (page) => {
      // Populate the arrangement via "Copy to Performance", then switch to Performance.
      await page.locator('#copy-to-performance').click();
      // Wait for the Performance view to become visible and contain content.
      await page.locator('#performance-view-root').waitFor({ state: 'visible' });
      await page.waitForFunction(
        () => !document.getElementById('performance-view-root')?.hidden,
        null, { timeout: 5_000 },
      );
      await page.waitForTimeout(300);
    },
  },

  // ── Clip editor screenshots ───────────────────────────────────────────────

  {
    name: 'inspector-piano-roll',
    selector: '#insp-roll-host',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      // Click the first filled cell on a melodic lane (tb-303-1 = "303 1").
      // data-lane-id='tb-303-1' cells are the first column in the session grid.
      const cell = page.locator('.session-cell-filled[data-lane-id="tb-303-1"]').first();
      await cell.click();
      await page.locator('#session-inspector').waitFor({ state: 'visible' });
      // Give the piano-roll canvas time to render.
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'inspector-drum-grid',
    selector: '#insp-roll-host',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      // Click the first filled cell on the drums lane.
      const cell = page.locator('.session-cell-filled[data-lane-id="drums-1"]').first();
      await cell.click();
      await page.locator('#session-inspector').waitFor({ state: 'visible' });
      // Give the drum-grid canvas time to render.
      await page.waitForTimeout(300);
    },
  },
];
