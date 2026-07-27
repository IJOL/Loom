async (page) => {
  // Click the "Sub 1" lane name in the session grid to make it the active lane
  // (that is what mounts its per-lane FX panel, incl. the SIDECHAIN section).
  const names = page.locator('.session-lane-name', { hasText: 'Sub 1' });
  await names.first().click();
  await page.waitForTimeout(600);

  return await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      fxSlots: q('.lane-fx-knobs').map((e) => ({
        page: e.closest('[data-page]')?.getAttribute('data-page'),
        kids: e.children.length,
        visible: !!e.offsetParent,
      })),
      scSelects: q('.lane-fx-sc-src').map((s) => ({
        page: s.closest('[data-page]')?.getAttribute('data-page'),
        opts: [...s.options].map((o) => o.value + '|' + (o.textContent || '').trim()),
        value: s.value,
        visible: !!s.offsetParent,
      })),
      pagesVisible: q('[data-page]').map((e) => e.getAttribute('data-page') + '=' + !!e.offsetParent),
    };
  });
}
