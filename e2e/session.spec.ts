import { test, expect } from '@playwright/test';
import { boot, dialogLog, recordDialogs, snap, waitIdle } from './helpers';

// Artube QA on DEV (2026-11-07): after a reload, "Cannot reach the game server … errorId 500, No
// Connection with that ID: Status code '404'"; on an ended session sometimes that and sometimes its
// 501, on a separate dark screen. The game designer: "just a reload button, and after a reload no
// 500 on any session". Every screen that stops the game is the HUD's own dialog with RELOAD, and a
// connection being made again shows a spinner first (Artube's reconnect spec).

const bootScreen = '.artubeplate-boot';

test('a session the hub refuses: "Session ended" in the HUD dialog with RELOAD, at once; a reload says it again', async ({ page }) => {
  await page.goto('/?seed=7&latency=40&intro=0&mockBoot=session-over');
  const dialog = page.locator(`${bootScreen} #DialogWindow`);
  await expect(dialog.locator('.Dialog__title')).toHaveText('Session ended');
  await expect(dialog.locator('.Dialog__body-inner p').first()).toHaveText(/Reload the game or open it again from the casino/);
  await expect(dialog).not.toHaveClass(/is-busy/);
  // the HUD's dialog: the white card, the title in capitals, RELOAD as the full-width green bar
  const look = await dialog.evaluate((d) => {
    const card = getComputedStyle(d.querySelector('.Dialog__wrapper')!);
    const title = getComputedStyle(d.querySelector('.Dialog__title')!);
    const button = getComputedStyle(d.querySelector('.Dialog__action')!);
    return { card: card.backgroundColor, title: title.textTransform, button: button.backgroundColor, height: button.height };
  });
  expect(look).toEqual({ card: 'rgb(248, 249, 250)', title: 'uppercase', button: 'rgb(71, 176, 75)', height: '50px' });
  await expect(page.locator(bootScreen)).not.toContainText(/500|501|errorId|Cannot reach/);
  await expect(page.locator('#loader')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shots/boot-session-ended.png' });
  await dialog.locator('.Dialog__action', { hasText: 'Reload' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator(`${bootScreen} .Dialog__title`)).toHaveText('Session ended');
});

test('a server that answers on the third attempt: the loader alone while it tries (no spinner over it), then the game', async ({ page }) => {
  // Anything the boot screen ever puts on the page is noted from the first script on.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('.artubeplate-boot')) (window as any).__bootScreenSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/?seed=7&latency=300&intro=0&mockBoot=flaky');
  await expect(page.locator('#PlaceBetBtn')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await snap(page)).phase, { timeout: 20_000 }).toBe('idle');
  expect(await page.evaluate(() => (window as any).__bootScreenSeen ?? false)).toBe(false);
  await expect(page.locator('#artubeplate-boot-skin')).toHaveCount(0);
  await expect(page.locator('#DialogWindow')).toBeHidden();
});

test('a server never reached: the loader while it tries, then "No connection" with RELOAD', async ({ page }) => {
  await page.goto('/?seed=7&latency=40&intro=0&mockBoot=offline');
  const dialog = page.locator(`${bootScreen} #DialogWindow`);
  await expect(dialog.locator('.Dialog__title')).toHaveText('No connection', { timeout: 15_000 });
  await expect(dialog).not.toHaveClass(/is-busy/);
  await expect(dialog.locator('.Dialog__action')).toHaveText('Reload');
  await expect(page.locator(bootScreen)).not.toContainText(/500|errorId/);
});

test('in play, a long outage: the spinner, then "Connection lost" with RELOAD; it clears by itself when back', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 15_000 });
  await recordDialogs(page);
  await page.evaluate(() => (window as any).__GAME__.network.simulateOutage(9000, { at: 'now', giveUpAfter: 3000 }));
  // the reconnect gave up: the popup replaces the spinner, and it has its RELOAD
  await expect(page.locator('.Dialog__title')).toHaveText('Connection lost', { timeout: 15_000 });
  expect(await dialogLog(page)).toEqual(['busy:Reconnecting…', 'card:Connection lost']);
  await expect(page.locator('#DialogWindow')).not.toHaveClass(/is-busy/);
  await expect(page.locator('#DialogWindow .Dialog__action')).toHaveText('Reload');
  await page.screenshot({ path: 'test-results/shots/play-connection-lost.png' });
  // back: it goes by itself and the game plays on
  await expect(page.locator('#DialogWindow')).toBeHidden({ timeout: 20_000 });
  await waitIdle(page);
  expect(await page.evaluate(() => (window as any).__GAME__.requestSpin())).toBe(true);
  await waitIdle(page);
});

test('in play, the session ends: "Session ended" with RELOAD over the game', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => (window as any).__GAME__.network.closeSession());
  await expect(page.locator('.Dialog__title')).toHaveText('Session ended');
  await expect(page.locator('#DialogWindow .Dialog__action')).toHaveText('Reload');
  await page.screenshot({ path: 'test-results/shots/play-session-ended.png' });
});
