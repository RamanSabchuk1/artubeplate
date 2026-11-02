import { test, expect, type Page } from '@playwright/test';
import { boot, continueScreen, hudState, rows, snap, waitIdle } from './helpers';

// The showcase on the mock RGS. `window.__GAME__` is the ArtubeGame handle (inspect / requestSpin
// / requestBuy / network = the MockRgs, scriptable: forceRow, failNext, simulateReconnect…).


test('boots on the mock RGS: Artube loader gone, HUD built from the session', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#loader')).toHaveCount(0);
  await expect(page.locator('#BalanceValue')).toHaveText('€1,000.00');
  await expect(page.locator('#BetAmountValue')).toHaveText('€1.00');
  await expect(page.locator('#FeatureBuyToggle')).toBeVisible();
  expect(await page.title()).toBe('Whisker Pharaoh');
  await page.screenshot({ path: 'test-results/shots/desktop-idle.png' });
});

test('a paid round: stake by index, the win lands at settle; no in-game history on Artube', async ({ page }) => {
  await boot(page);
  const [row] = await rows(page, 'base', 'mult >= 200 && mult <= 900 && !book.includes("featureStart") && !book.includes("respin")');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('base', r), row);
  await page.locator('#PlaceBetBtn').click();
  const s = await waitIdle(page);
  expect(s.lastWin).toBeGreaterThan(0);
  expect(s.balance).toBeCloseTo(1000 - 1 + s.lastWin, 2);
  await expect(page.locator('#WinAmountValue')).not.toHaveText('€0.00');
  // Artube keeps the rounds on the platform: the ☰ menu has no HISTORY row.
  await expect(page.locator('#BetHistoryBtn')).toHaveCount(0);
});

test('bet ladder: ▲ raises the stake that the next spin pays', async ({ page }) => {
  await boot(page);
  await page.locator('#BetAmountIncrease').click();
  await expect(page.locator('#BetAmountValue')).toHaveText('€2.00');
  const before = (await snap(page)).balance;
  const [loss] = await rows(page, 'base', 'mult === 0');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('base', r), loss);
  await page.locator('#PlaceBetBtn').click();
  const s = await waitIdle(page);
  expect(s.balance).toBeCloseTo(before - 2, 2);
});

test('buy feature: 100× charged, the rules screen waits, the bonus plays by itself, the total screen waits, back to idle', async ({ page }) => {
  await boot(page);
  await page.locator('#FeatureBuyToggle').click();
  await expect(page.locator('#FeatureBuyWindow')).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/desktop-buy-sheet.png' });
  await page.locator('[data-feature-buy-id-cta="buyfs"]').click();
  await expect(page.locator('#FeatureBuyConfirmBody')).toBeVisible();
  await page.locator('#FeatureBuyConfirmButton').click();
  // The announcer, then the bonus's rules: the bar steps aside and the screen waits for the player.
  await expect.poll(() => hudState(page), { timeout: 30_000, intervals: [200] }).toBe('hidden');
  await page.waitForTimeout(2500);
  expect(await hudState(page)).toBe('hidden');
  await page.screenshot({ path: 'test-results/shots/desktop-bonus-rules.png' });
  await continueScreen(page);
  // The bonus plays by itself: a feature bar with no round button.
  await expect.poll(() => hudState(page), { timeout: 20_000 }).toMatch(/feature/);
  await expect(page.locator('#PlaceBetBtn')).toBeHidden();
  await page.screenshot({ path: 'test-results/shots/desktop-free-spins.png' });
  // The total waits too.
  await expect.poll(() => hudState(page), { timeout: 110_000, intervals: [300] }).toBe('hidden');
  await page.waitForTimeout(3000);
  expect(await hudState(page)).toBe('hidden');
  await page.screenshot({ path: 'test-results/shots/desktop-total-win.png' });
  await continueScreen(page);
  const s = await waitIdle(page, 30_000);
  expect(s.balance).toBeCloseTo(1000 - 100 + s.lastWin, 2);
  await expect(page.locator('.OpenSlotUiContainer')).toHaveAttribute('data-state', 'idle');
});

test('lucky bet: the ante makes every spin cost 1.25× until switched off', async ({ page }) => {
  await boot(page);
  await page.locator('#FeatureBuyToggle').click();
  await page.locator('[data-feature-buy-id-cta="luckybet"]').click();
  await page.locator('#FeatureBuyConfirmButton').click();
  await expect(page.locator('#BetAmountValue')).toHaveText('€1.25');
  await expect(page.locator('#FeatureBuyActiveModifierNotice')).toBeVisible();
  const [loss] = await rows(page, 'luckybet', 'mult === 0');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('luckybet', r), loss);
  await page.locator('#PlaceBetBtn').click();
  const s = await waitIdle(page);
  expect(s.balance).toBeCloseTo(1000 - 1.25, 2);
  await page.locator('#FeatureBuyToggle').click(); // reads DISABLE while the ante is on
  await expect(page.locator('#BetAmountValue')).toHaveText('€1.00');
});

test('free rounds campaign: offer → the rounds play themselves → betIndex null, no charge → summary → normal play', async ({ page }) => {
  await boot(page, '&frc=3&frcBet=0.5');
  await expect(page.locator('#DialogWindow')).toBeVisible();
  await expect(page.locator('.Dialog__body')).toContainText('3 free rounds');
  await page.screenshot({ path: 'test-results/shots/desktop-frc-offer.png' });
  const start = (await snap(page)).balance;
  await page.locator('.Dialog__action', { hasText: 'Play now' }).click();
  await expect(page.locator('#BetAmountValue')).toHaveText('€0.50');
  // No presses from here: each free round starts by itself and the counter counts them down.
  await expect(page.locator('#FreeRoundsCounterValue')).toHaveText('1', { timeout: 120_000 });
  // The last one settles into the campaign summary (Settle waits for the player to read it).
  await expect(page.locator('.Dialog__title')).toHaveText('Free rounds complete', { timeout: 120_000 });
  await page.screenshot({ path: 'test-results/shots/desktop-frc-summary.png' });
  const totalWin = Number((await page.locator('.Dialog__body').innerText()).match(/€([\d.,]+)/)?.[1]?.replace(/,/g, '') ?? '0');
  await page.locator('.Dialog__action').click();
  const end = await waitIdle(page);
  expect(end.freeRoundsActive).toBe(false);
  expect(end.balance).toBeCloseTo(start + totalWin, 2); // nothing was charged: only the wins landed
  await expect(page.locator('#BetAmountValue')).toHaveText('€1.00'); // the player's own bet is back
});

test('free rounds per session: a reload after accepting carries on, a decline is not offered again', async ({ page }) => {
  // A real launch carries a sessionId, and a reload keeps it. `mock=1` plays it on the mock RGS.
  await boot(page, '&frc=3&frcBet=0.5&mock=1&sessionId=e2e-frc-accept');
  await expect(page.locator('.Dialog__body')).toContainText('3 free rounds');
  await page.locator('.Dialog__action', { hasText: 'Play now' }).click();
  await expect.poll(async () => (await snap(page)).freeRoundsActive).toBe(true);
  await page.reload();
  await expect(page.locator('.Dialog__title')).toHaveText('Free rounds');
  await expect(page.locator('.Dialog__action')).toHaveText(['Continue']); // no second offer
  await page.screenshot({ path: 'test-results/shots/desktop-frc-resume.png' });
  await page.locator('.Dialog__action').click();
  await expect.poll(async () => (await snap(page)).freeRoundsActive).toBe(true);

  await boot(page, '&frc=3&frcBet=0.5&mock=1&sessionId=e2e-frc-decline');
  await page.locator('.Dialog__action', { hasText: 'Later' }).click();
  await page.reload();
  await expect.poll(async () => (await snap(page)).phase).toBe('idle');
  await page.waitForTimeout(1500);
  await expect(page.locator('#DialogWindow')).toBeHidden();
  expect((await snap(page)).freeRoundsActive).toBe(false);
});

test('errors by errorId: 503 shows insufficient funds and refunds the optimistic debit', async ({ page }) => {
  await boot(page, '&mockError=503');
  await page.locator('#PlaceBetBtn').click();
  await expect(page.locator('#DialogWindow')).toBeVisible();
  const s = await waitIdle(page);
  expect(s.balance).toBe(1000);
});

test('session end: a 501 is terminal (blocking notice, nothing more is sent)', async ({ page }) => {
  await boot(page, '&mockError=501');
  await page.locator('#PlaceBetBtn').click();
  await expect(page.locator('.Dialog__title')).toHaveText('Session ended');
});

test('reconnect: blocking notice while down, session re-read when back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => void (window as any).__GAME__.network.simulateReconnect(1500));
  await expect(page.locator('.Dialog__title')).toHaveText('Connection lost');
  await expect(page.locator('#DialogWindow')).toBeHidden({ timeout: 10_000 });
  expect((await snap(page)).phase).toBe('idle');
});

test('platform max win: the win is capped and a blocking modal names the capped amount', async ({ page }) => {
  await boot(page, '&maxWin=2');
  const [row] = await rows(page, 'base', 'mult >= 500 && !book.includes("featureStart") && !book.includes("respin")');
  await page.evaluate((r) => (window as any).__GAME__.network.forceRow('base', r), row);
  await page.locator('#PlaceBetBtn').click();
  await expect(page.locator('.Dialog__title')).toHaveText('Maximum win reached', { timeout: 60_000 });
  await expect(page.locator('.Dialog__body')).toContainText('€2.00');
  await page.locator('.Dialog__action').click();
  const s = await waitIdle(page);
  expect(s.lastWin).toBe(2);
});

test('demo session: currency null → play-money label', async ({ page }) => {
  await boot(page, '&currency=demo');
  await expect(page.locator('#BalanceValue')).toContainText('DEMO');
  await expect(page.locator('#BetAmountValue')).toContainText('DEMO');
  // At the top of the ladder the longest stake (with DEMO) still fits its box, clear of ▲▼.
  const spill = await page.evaluate(async () => {
    const stepper = (window as any).__GAME__.hud.ui.betStepper;
    stepper.setIndex(stepper.count - 1);
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const value = document.getElementById('BetAmountValue')!;
    // the readout pops when it changes: measure it at rest
    await Promise.all(value.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const range = document.createRange();
    range.selectNodeContents(value);
    return { text: value.textContent, spill: range.getBoundingClientRect().right - value.parentElement!.getBoundingClientRect().right };
  });
  expect(spill.text).toContain('DEMO');
  expect(spill.spill).toBeLessThanOrEqual(0.5);
  // The currency says it; no pill on the balance label as well.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#BalanceLabel')!, '::after').content)).toMatch(/^(none|normal)$/);
});

test('mobile portrait layout', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('/?seed=7&intro=1');
  await introReady(page); // the portrait intro: one card at a time
  await page.screenshot({ path: 'test-results/shots/mobile-intro.png' });
  await page.touchscreen.tap(195, 420);
  await expect.poll(async () => (await snap(page)).phase, { timeout: 15_000 }).toBe('idle');
  await expect(page.locator('#PlaceBetBtn')).toBeVisible();
  // The strip's readouts: each label stands centred over its value, BET (wrapped once more) too.
  const offsets = await page.evaluate(() =>
    ['Balance', 'BetAmountStatic', 'WinAmount'].map((id) => {
      const mid = (el: Element | null): number => {
        const r = document.createRange();
        r.selectNodeContents(el!);
        const b = r.getBoundingClientRect();
        return b.left + b.width / 2;
      };
      return Math.abs(mid(document.getElementById(`${id}Label`)) - mid(document.getElementById(`${id}Value`)));
    }),
  );
  for (const off of offsets) expect(off).toBeLessThan(1);
  await page.screenshot({ path: 'test-results/shots/mobile-idle.png' });
  await page.locator('#MainMenuToggle').click();
  await page.screenshot({ path: 'test-results/shots/mobile-menu.png' });
  await ctx.close();
});

/** The intro starts once the Artube loader is gone; its prompt (and clicks) are up 1.5s later. */
async function introReady(page: Page): Promise<void> {
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1900);
}

test('intro: the info screen comes first, the HUD stays inert, a click after the prompt reveals the game', async ({ page }) => {
  await page.goto('/?seed=7&latency=40&intro=1');
  const hud = page.locator('.OpenSlotUiContainer');
  await expect(hud).toHaveJSProperty('inert', true);
  await expect(page.locator('#loader')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.mouse.click(640, 400); // before the prompt is up: ignored
  await page.waitForTimeout(600);
  expect((await snap(page)).phase).not.toBe('idle');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/shots/desktop-intro.png' });
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await snap(page)).phase, { timeout: 15_000 }).toBe('idle');
  await expect(hud).toHaveJSProperty('inert', false);
  await expect(page.locator('#PlaceBetBtn')).toBeVisible();
});

test("intro: \"Don't show this again\" is remembered", async ({ page }) => {
  await page.goto('/?seed=7&latency=40&intro=1');
  await introReady(page);
  // The checkbox sits under the prompt: design (960, 1035) in the 1920×1080 frame → screen at 1280×800.
  const s = Math.min(1280 / 1920, 800 / 1080);
  await page.mouse.click(640, (800 - 1080 * s) / 2 + 1035 * s);
  await page.mouse.click(640, 400);
  await expect.poll(async () => (await snap(page)).phase, { timeout: 15_000 }).toBe('idle');
  await page.goto('/?seed=7&latency=40');
  await expect.poll(async () => (await snap(page)).phase, { timeout: 15_000 }).toBe('idle'); // no intro, no click
});

