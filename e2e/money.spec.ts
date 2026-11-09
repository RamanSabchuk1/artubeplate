import { test, expect } from '@playwright/test';
import { rows, waitIdle } from './helpers';

// Artube's game designer, Mad Dogs on DEV in KWD (3 decimals): the balance read 99,998.645, then
// 99,998.246 while the reels spun, then 99,998.245 when the losing round ended ("it showed a six,
// the spin ended: a five"). The wallet held 99,998.6455; the debit at the press was rounded to the
// nearest unit. Every text the BALANCE readout shows through a round is recorded here: it drops by
// the stake at the press and does not move again on a loss, and it never reads above the wallet.

test('a wallet with more decimals than the currency shows: the balance drops by the stake at once, and a losing round leaves it there', async ({ page }) => {
  await page.goto('/?seed=7&latency=40&intro=0&currency=KWD&balance=99999.6295');
  await expect(page.locator('#PlaceBetBtn')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__GAME__.inspect())).phase).toBe('idle');
  await expect(page.locator('#BalanceValue')).toHaveText('KD99,999.629');
  await expect(page.locator('#BetAmountValue')).toHaveText('KD1.000');
  const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('base', r), loss);
  await page.evaluate(() => {
    const w = window as any;
    const el = document.getElementById('BalanceValue')!;
    w.__readouts = [el.textContent];
    new MutationObserver(() => {
      const t = el.textContent;
      if (w.__readouts[w.__readouts.length - 1] !== t) w.__readouts.push(t);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#PlaceBetBtn').click();
  const s = await waitIdle(page);
  expect(s.lastWin).toBe(0);
  expect(await page.evaluate(() => (window as any).__readouts)).toEqual(['KD99,999.629', 'KD99,998.629']);
});
