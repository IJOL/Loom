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
    name: 'export-menu',
    selector: '.export-menu-wrap',
    setup: async (page) => { await page.locator('#export-scene').click();
      await page.locator('#export-menu').waitFor({ state: 'visible' }); },
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
];
