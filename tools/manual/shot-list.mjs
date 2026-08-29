// Declarative screenshot list. Each shot:
//   name     -> output file docs/manual/images/<name>.png
//   selector -> element to frame (omit for full page)
//   setup    -> async (page) => {} to reach the right UI state before the shot
//
// Selectors below come from index.html. The app boots with a demo loaded, so
// the session grid already has filled cells (no demo-loading needed).

/** Open a top-level menu (File / Edit / View / Tools / Help) and wait for its
 *  dropdown, so a shot can frame a menu or reach an item that now lives there. */
const openMenu = async (page, label) => {
  await page.locator('.menubar-top', { hasText: label }).first().click();
  await page.locator('.menubar-dropdown').first().waitFor({ state: 'visible' });
};

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
/** Open a lane's instrument editor. The session-view reorder REMOVED the
 *  '.session-lane-tab' row — the grid's column header is now what opens and
 *  marks the active instrument, so click that instead. */
const clickLaneTab = async (page, name) => {
  await page.locator('.session-lane-header', { hasText: name }).first().click();
  await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
};

/** Add a new lane with the given engineId via the session-tabs add controls. */
/** Add a lane. The session-view reorder replaced the old
 *  '.session-tabs-engine' <select> + add-button pair with a '+' button that
 *  opens a menu of engines, each carrying data-engine-id. */
const addLane = async (page, engineId) => {
  await page.locator('.session-lane-add').first().click();
  await page.locator(`.session-add-item[data-engine-id="${engineId}"]`).first().click();
  // Wait for the new lane's header to appear and settle.
  await page.waitForTimeout(300);
};

/** Select a value in the shared #instrument-preset-select, waiting for the (async-
 *  populated) option to exist first. The Sampler surfaces its instruments —
 *  drumkits, melodic instruments and loops — as options here. */
const loadPolyPreset = async (page, value) => {
  const sel = page.locator('#instrument-preset-select');
  await sel.locator(`option[value="${value}"]`).waitFor({ state: 'attached', timeout: 10_000 });
  await sel.selectOption(value);
};

/** Add a Sampler lane and reveal its editor (shared steps for the sampler shots). */
const openSamplerLane = async (page) => {
  await loadDemo(page, 'Minimal Techno');
  await addLane(page, 'sampler');
  const tabs = page.locator('.session-lane-header');
  const count = await tabs.count();
  await tabs.nth(count - 1).click();
  await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
};

/** A ~2s 16-bit PCM mono WAV with four decaying bursts. Returned as a base64
 *  string fed to the audio-channel cell's file picker via the filechooser event. */
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

/** Add an audio channel and load a WAV into its first cell, so the audio-clip
 *  editor auto-opens in the inspector. The "+ Audio" button creates an EMPTY
 *  audio lane; a WAV is imported by clicking a cell, which opens a file picker
 *  (a transient <input type=file> the app .click()s) — caught via filechooser. */
const addAudioChannel = async (page) => {
  // The audio channel is an entry in the '+' add-lane menu (it carries no
  // data-engine-id — it is added by its own callback, not as an engine).
  await page.locator('.session-lane-add').first().click();
  await page.locator('.session-add-item', { hasText: 'Audio channel' }).first().click();
  await page.waitForTimeout(300); // let the audio lane + its grid row mount
  const cell = page.locator('.session-cell[data-lane-id^="audio-"]').first();
  const fileChooser = page.waitForEvent('filechooser');
  await cell.click();
  await (await fileChooser).setFiles({
    name: 'beat.wav', mimeType: 'audio/wav',
    buffer: Buffer.from(loopWavBase64(), 'base64'),
  });
  // The audio-clip editor's Warp toggle confirms it has mounted.
  await page.locator('.audio-clip-warp').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300); // let the waveform canvas paint
};

/** Switch to the WEAVE view and wait for the panel to be on screen. */
const openWeave = async (page) => {
  await page.locator('.mode-btn[data-mode="weave"]').click();
  await page.locator('#panel-view-weave').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.getElementById('panel-view-weave')?.hidden,
    null, { timeout: 5_000 },
  );
  await page.waitForTimeout(300);
};

// ── FX insert helpers ────────────────────────────────────────────────────────

/** Open the Master FX panel (the FX button on the master strip). */
const openMasterFx = async (page) => {
  await page.locator('.master-fx-toggle').click();
  await page.locator('#master-fx-panel').waitFor({ state: 'visible' });
};

/** Add one insert to the MASTER rack and wait for its unit to render.
 *
 *  The master chain starts EMPTY — only the two sends are seeded (A = Delay,
 *  B = Reverb) — so the single '.insert-unit' that appears under '#fx-filters'
 *  is the one we asked for, and every effect can be framed by the same
 *  selector. The rack markup is `buildLaneInsertUI`'s, the same one a lane and
 *  a send return use, so these shots show the unit as it looks in ANY rack. */
const addMasterInsert = async (page, pluginId) => {
  await openMasterFx(page);
  await page.locator('#fx-filters .insert-add').click();
  const picker = page.locator('#fx-filters .insert-add-picker');
  await picker.waitFor({ state: 'visible' });
  await picker.selectOption(pluginId);
  await page.locator('#fx-filters .insert-unit').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(300); // knob canvases + the unit's response curve
};

/** The fifteen inserts, in the order chapter 07 introduces them. The ids are
 *  plugin ids (plugins/<id>/plugin.json) — the picker's option values. */
const FX_PLUGIN_IDS = [
  'multifilter', 'distortion', 'reverb', 'delay', 'compressor', 'limiter',
  'tremolo', 'gate', 'chorus', 'flanger', 'phaser', 'bitcrusher', 'autowah',
  'ringmod', 'width',
];

/** One shot per effect: `fx-<id>.png`, the insert unit on its own. */
const fxShot = (pluginId) => ({
  name: `fx-${pluginId}`,
  selector: '#fx-filters .insert-unit',
  setup: (page) => addMasterInsert(page, pluginId),
});

export const SHOTS = [
  { name: 'app-overview', selector: '.synth' },
  { name: 'transport', selector: '.row.transport' },
  { name: 'session-grid', selector: '#session-grid' },
  // NOT '#session-view': the session-view reorder gave it `display: contents`,
  // so it generates no box of its own and Playwright can never see it (the
  // shot hung for 30 s and failed the whole build). Its ROOT is the real box.
  { name: 'session-view', selector: '#session-view-root' },
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
    // MIDI import is no longer a transport-row <details> panel — it moved to a
    // modal opened from File ▸ Import MIDI…. The old '.midi-panel' selector
    // matched nothing and hung the build for 30 s.
    name: 'midi-import',
    selector: '#midi-import-dialog',
    setup: async (page) => {
      await openMenu(page, 'File');
      await page.locator('.menubar-item', { hasText: 'Import MIDI' }).first().click();
      await page.locator('#midi-import-dialog').waitFor({ state: 'visible' });
    },
  },
  {
    // The desktop menu bar with the File menu OPEN — the app's primary
    // navigation, previously undocumented. Framed as a viewport region, not by
    // selector: the dropdown is absolutely positioned and so sits outside the
    // '.menubar' box, which would capture an empty bar.
    name: 'menu-bar',
    clip: { x: 0, y: 0, width: 460, height: 445 },
    setup: async (page) => { await openMenu(page, 'File'); },
  },
  {
    // The floating XY pad (session-bar "▣ XY").
    name: 'xy-pad',
    selector: '.xy-panel',
    setup: async (page) => {
      await page.locator('#xy-open').click();
      await page.locator('.xy-panel.open').waitFor({ state: 'visible' });
      // Assign both axes so the shot shows the pad in use rather than its empty
      // "— none —" state. Cutoff on X and resonance on Y is the classic pairing.
      const pick = async (axis, re) => {
        const sel = page.locator(`.xy-sel[data-axis="${axis}"]`);
        const value = await sel.locator('option').evaluateAll(
          (opts, pattern) => opts.map((o) => o.value).find((v) => new RegExp(pattern).test(v)) ?? '',
          re,
        );
        if (value) await sel.selectOption(value);
      };
      await pick('x', 'filter\\.cutoff$');
      await pick('y', 'filter\\.reso');
      await page.waitForTimeout(150);
    },
  },
  {
    name: 'master-fx',
    selector: '#master-fx-panel',
    setup: async (page) => { await page.locator('.master-fx-toggle').click();
      await page.locator('#master-fx-panel').waitFor({ state: 'visible' }); },
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
    // The 303 is framed on the INSTRUMENT page like every other melodic engine.
    // It used to have a page of its own, `data-page="303"`, and that selector
    // outlived it — matching nothing, which throws and takes the whole shot
    // build down with it. That is why every image here was months old.
    name: 'engine-tb303',
    selector: '.page[data-page="instrument"]',
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
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await clickLaneTab(page, 'Sub 1');
    },
  },
  {
    name: 'engine-karplus',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Cordillera');
      await clickLaneTab(page, 'Guitar');
    },
  },
  {
    name: 'engine-wavetable',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Neon Drive');
      await clickLaneTab(page, 'Neon Lead');
    },
  },
  {
    name: 'engine-fm',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await addLane(page, 'fm');
      // The newly-added lane tab is the last one before the "+" adder.
      const tabs = page.locator('.session-lane-header');
      const count = await tabs.count();
      await tabs.nth(count - 1).click();
      await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
    },
  },
  {
    name: 'engine-westcoast',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await addLane(page, 'westcoast');
      const tabs = page.locator('.session-lane-header');
      const count = await tabs.count();
      await tabs.nth(count - 1).click();
      await page.locator('.page:not([hidden])').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
    },
  },
  {
    // The LAYERS rack. Reached by CONVERTING a lane rather than adding an empty
    // Layers lane: converting fills slots 1 and 2 with the lane's own
    // instrument, and the MIX control is only drawn once two slots are loaded.
    name: 'engine-layers',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await page.locator('.session-lane-header', { hasText: 'Sub 1' }).first()
        .click({ button: 'right' });
      await page.locator('.context-menu-item', { hasText: 'Convert to layered' })
        .first().click();
      await page.locator('.page[data-page="instrument"]')
        .waitFor({ state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(600); // the rack rebuilds the lane's engine
    },
  },
  {
    name: 'musicality-bar',
    selector: '#project-options-dialog',
    setup: async (page) => {
      // The musicality summary/popover were replaced by the toolbar status
      // chip (first chip = musicality) which opens the Project Options dialog.
      await page.locator('#toolbar-status-chips .status-chip').first().click();
      await page.locator('#project-options-dialog').waitFor({ state: 'visible' });
      await page.waitForTimeout(150);
    },
  },
  {
    name: 'engine-sampler',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await openSamplerLane(page);
      // Load a ready-made drumkit so the channel strips, keyboard map and
      // Selected-sample editor render (a fresh Sampler lane is empty).
      await loadPolyPreset(page, 'sampler:drumkit:tr808');
      await page.locator('.dv-col').first().waitFor({ state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(500); // keyboard / connector / sample-viewer canvases
    },
  },
  {
    // The Sampler's Loop instrument: the whole-loop colour-coded overview above
    // the per-slice channel strips.
    name: 'engine-sampler-loop',
    selector: '.page[data-page="instrument"]',
    setup: async (page) => {
      await openSamplerLane(page);
      await loadPolyPreset(page, 'sampler:loop:amen-175');
      await page.locator('.sampler-loop-overview canvas').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(600); // overview + per-strip canvases paint
    },
  },

  // ── Audio channel ─────────────────────────────────────────────────────────
  {
    // Adding a lane. The old '.session-tabs' bar is gone (session-view reorder);
    // lanes are now added from the grid's '+' header, which opens a menu listing
    // every engine plus "Audio channel". Frame that menu open.
    // Frame the MENU, not the '+' button's wrapper. The wrapper is the button's
    // own box — a few pixels wide — and the menu is positioned absolutely, so it
    // falls outside: the shot came out an 890-byte sliver of nothing. Same trap
    // the menu-bar shot hit, and it never failed loudly because a tiny box is a
    // valid screenshot.
    name: 'audio-channel-add',
    selector: '.session-lane-add-menu',
    setup: async (page) => {
      await page.locator('.session-lane-add').first().click();
      await page.locator('.session-lane-add-menu').first().waitFor({ state: 'visible' });
    },
  },
  {
    // The audio-clip editor (Warp toggle + waveform header), reached by adding an
    // audio channel and loading a generated WAV into its first cell.
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

  // ── WEAVE ────────────────────────────────────────────────────────────────
  // Before the Performance shot, which leaves the app in the other view: this
  // one wants the session as it was.
  //
  // The root id is the panel registry's own (`panel-view-<id>`), not a name
  // this file invents — WEAVE is a plugin, so there is no hand-written element
  // to aim at and a hardcoded id would break the day the panel is renamed.
  {
    name: 'weave-view',
    selector: '#panel-view-weave',
    setup: openWeave,
  },
  {
    // The generator's controls. Framed with ':not(:empty)' because EVERY lane
    // row carries a '.weave-lane-gen' — it is empty and zero-height until that
    // lane generates, so a bare selector would frame a 0px box and still
    // "succeed". The generating lane is the only non-empty one.
    name: 'weave-gen',
    selector: '.weave-lane-gen:not(:empty)',
    setup: async (page) => {
      await openWeave(page);
      await page.locator('.weave-lane-wrap').first()
        .locator('button.weave-gen-on').click();
      await page.locator('.weave-lane-gen:not(:empty)')
        .waitFor({ state: 'visible', timeout: 10_000 });
      await page.waitForTimeout(500); // nineteen knob canvases
    },
  },
  {
    // The PLAYS list. Two entries, so the shot shows the numbering and the
    // ↑ ↓ ✕ an entry carries — an empty list is just the words "everything it
    // may". Each pick repaints the list, so the picker is re-located per pick.
    //
    // The whole lane ROW, not '.weave-pool-line' alone: that line is a
    // full-width block holding one short strip of controls, so framing it
    // gives a 57:1 sliver that the PDF scales to nothing. The row shows the
    // same list where it actually sits.
    name: 'weave-pool',
    selector: '.weave-lane-wrap',
    setup: async (page) => {
      await openWeave(page);
      for (const index of [1, 2]) {
        await page.locator('.weave-lane-wrap').first()
          .locator('select.weave-pool-add').selectOption({ index });
        await page.waitForTimeout(250);
      }
      await page.locator('.weave-pool-item').first().waitFor({ state: 'visible' });
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

  {
    // The Arp's painted pattern. PATTERN is the card's FIRST select, and
    // choosing 'steps' is what makes the STEPS row exist at all.
    name: 'notefx-arp-steps',
    selector: '.notefx-card.notefx-arp',
    setup: async (page) => {
      await loadDemo(page, 'Minimal Techno');
      await clickLaneTab(page, 'Sub 1');
      await page.locator('.notefx-panel button', { hasText: '+ Arp' }).first().click();
      const card = page.locator('.notefx-card.notefx-arp').last();
      await card.locator('select').first().selectOption('steps');
      await card.locator('.notefx-steps').waitFor({ state: 'visible' });
      // Two steps longer than the default four, so the − + buttons have
      // something to have done.
      for (let i = 0; i < 2; i++) {
        await card.locator('.notefx-steps button[title="One step longer"]').click();
      }
      await page.waitForTimeout(300);
    },
  },

  // ── The fifteen inserts, one shot each ────────────────────────────────────
  // Chapter 07 described every effect's knobs in prose and showed none of them.
  ...FX_PLUGIN_IDS.map(fxShot),
];
