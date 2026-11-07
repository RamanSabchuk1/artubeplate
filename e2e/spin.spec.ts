import { test, expect, type Page } from '@playwright/test';
import { boot, dialogLog, recordDialogs, rows, snap, waitIdle } from './helpers';

// A spin the server does not answer (the user, after Artube QA on DEV: "if we get a server not
// responding on the spin we need to handle it correctly"). Artube's rule: never send the spin
// again; block input, reconnect, read `session`, show what it says. The game shows a spinner after
// 5 s and gives up after 20 s; here the mock shortens both (slowMs 1 s, timeoutMs 3 s).

async function ready(page: Page): Promise<void> {
  await boot(page);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 15_000 });
  // a losing round, so the balance says exactly what the spin cost
  const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('base', r), loss);
}

test('no answer, the round played on the server: a spinner, then reconnecting, then the round from `session`; never sent twice', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const w = window as any;
    const net = w.__GAME__.network;
    const spin = net.spin.bind(net);
    w.__spins = 0;
    net.spin = (...a: unknown[]) => (w.__spins++, spin(...a));
    net.simulateNoAnswer({ played: true, slowMs: 1000, timeoutMs: 3000 });
  });
  await recordDialogs(page);
  await page.locator('#PlaceBetBtn').click();
  // `session` has the round the answer never brought: the player may watch it; the balance is the server's
  await expect(page.locator('.Dialog__title')).toHaveText('Your last round', { timeout: 20_000 });
  expect(await dialogLog(page)).toEqual(['busy:Waiting for the server…', 'busy:Reconnecting…', 'card:Your last round']);
  await page.locator('.Dialog__action', { hasText: 'Skip' }).click();
  const s = await waitIdle(page);
  expect(s.balance).toBe(999); // the stake of 1, the losing round, as the server has it
  expect(await page.evaluate(() => (window as any).__spins)).toBe(1);
  expect(await page.evaluate(() => (window as any).__GAME__.requestSpin())).toBe(true); // the game plays on
  await waitIdle(page);
});

test('no answer, nothing played: a spinner, then reconnecting; the stake is back, as `session` says', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__GAME__.network.simulateNoAnswer({ played: false, slowMs: 1000, timeoutMs: 3000 }));
  await recordDialogs(page);
  await page.locator('#PlaceBetBtn').click();
  await expect.poll(() => dialogLog(page), { timeout: 20_000 }).toEqual(['busy:Waiting for the server…', 'busy:Reconnecting…']);
  await expect(page.locator('#DialogWindow')).toBeHidden({ timeout: 15_000 });
  const s = await waitIdle(page);
  expect(s.balance).toBe(1000);
});

test('a late answer during autoplay: the spinner while it waits, gone when it lands, and the run plays on', async ({ page }) => {
  await ready(page);
  const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
  await page.evaluate((r) => Array.from({ length: 6 }, () => (window as any).__GAME__.network.forceRow('base', r)), loss);
  await page.evaluate(() => (window as any).__GAME__.network.simulateSlowAnswer(3000, { slowMs: 1000 }));
  await recordDialogs(page);
  await page.locator('#AutoplayBtn').click();
  await page.locator('#AutoplayNavList li', { hasText: /^10$/ }).click();
  await expect.poll(() => dialogLog(page), { timeout: 15_000 }).toEqual(['busy:Waiting for the server…']);
  await expect(page.locator('#DialogWindow')).toBeHidden({ timeout: 15_000 });
  // the round that was late settles, and the run goes on to the next ones
  await expect.poll(() => page.evaluate(() => (window as any).__GAME__.hud.ui.autoplay.count.get()), { timeout: 30_000 }).toBeLessThanOrEqual(7);
  expect(await page.evaluate(() => (window as any).__GAME__.hud.ui.autoplay.isActive)).toBe(true);
  await page.locator('#AutoplayBtn').click(); // stop
  await waitIdle(page);
  expect((await snap(page)).balance).toBeLessThan(1000);
});
