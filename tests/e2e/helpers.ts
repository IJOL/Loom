import type { Page } from '@playwright/test';

// Shared e2e helpers for the Session view. After the lane-tabs row was folded
// into the grid column headers, adding a lane goes through the header "+" menu
// (no more session-tabs engine-select + add-button), and a lane is opened by
// clicking its column header (a div, not a button).

/** Add a lane via the grid header "+" engine menu. */
export async function addLane(page: Page, engineId: string): Promise<void> {
  await page.locator('.session-lane-add').click();
  await page.locator(`.session-add-item[data-engine-id="${engineId}"]`).click();
}

/** Add an audio channel via the "+" menu's Audio channel entry. */
export async function addAudioChannel(page: Page): Promise<void> {
  await page.locator('.session-lane-add').click();
  await page.locator('.session-lane-add-menu .session-add-item', { hasText: 'Audio channel' }).click();
}

/** Open a lane's instrument editor by clicking its grid column header. */
export async function openLane(page: Page, laneId: string): Promise<void> {
  await page.locator(`.session-lane-header[data-lane-id="${laneId}"]`).click();
}
