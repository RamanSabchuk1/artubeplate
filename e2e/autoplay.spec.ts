import { test, expect, type Page } from '@playwright/test';
import { boot, continueScreen, hudState, rows, snap, waitIdle } from './helpers';

// Runs of rounds and whole bonuses: longer than the suite's default per test.
test.describe.configure({ timeout: 300_000 });

// Autoplay as a player drives it, through the real panel of the showcase's HUD on the mock RGS:
// every setting (the number of rounds, the loss and single-win limits with their chips, NO LIMIT,
// MAX WIN and CUSTOM, stop on special feature win), every way to interrupt a run (the autoplay
// button, the round button, Space, a tap outside the panel, a lost connection) and every way a
// run ends (its count, a limit, a bonus, a balance that cannot pay). The outcomes are forced row by row.

/** Count the spins the transport is asked for, from now on. */
async function countSpins(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const net = w.__GAME__.network;
    const spin = net.spin.bind(net);
    w.__spins = 0;
    net.spin = (...args: unknown[]) => {
      w.__spins++;
      return spin(...args);
    };
  });
}
const spins = (page: Page): Promise<number> => page.evaluate(() => (window as any).__spins as number);

/** The run as the HUD holds it. */
const run = (page: Page) =>
  page.evaluate(() => {
    const ui = (window as any).__GAME__.hud.ui;
    return { active: ui.autoplay.isActive as boolean, count: ui.autoplay.count.get() as number, lossLimit: ui.autoplay.lossLimit as number, singleWinLimit: ui.autoplay.singleWinLimit as number, stopOnFeature: ui.stopOnFeature.isOn as boolean };
  });

/** Force the next base rounds: `n` losses, or the rows given. The math holds each outcome once
 *  (with its weight), so a run of losses repeats one losing row. */
async function forceLosses(page: Page, n: number): Promise<void> {
  const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
  await force(page, Array(n).fill(loss));
}
async function force(page: Page, list: number[]): Promise<void> {
  await page.evaluate((l) => l.forEach((r) => (window as any).__GAME__.network.forceRow('base', r)), list);
}

async function openPanel(page: Page): Promise<void> {
  await page.locator('#AutoplayBtn').click();
  await expect(page.locator('#AutoplayNav')).toBeVisible();
}
async function openAdvanced(page: Page): Promise<void> {
  await page.locator('#AutoplayAdvancedToggle').click();
  await expect(page.locator('#AdvancedAutoplaySections')).toBeVisible();
}
/** Tap a number of rounds: with Artube's settings that starts the run. */
async function tapRounds(page: Page, n: number): Promise<void> {
  await page.locator('#AutoplayNavList li', { hasText: new RegExp(`^${n}$`) }).click();
}
async function runEnds(page: Page, timeout = 120_000): Promise<void> {
  await expect.poll(async () => (await run(page)).active, { timeout, intervals: [250] }).toBe(false);
  await waitIdle(page);
}

test.describe('autoplay: the settings', () => {
  test('the panel offers the session\'s numbers of rounds and what they cost; a tap starts the run, the autoplay button counts it down, it ends at its count', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await expect(page.locator('#AutoplayNavList li')).toHaveText(['10', '25', '50', '100']);
    await expect(page.locator('#AutoplayCost')).toContainText('€');
    await forceLosses(page, 10);
    await countSpins(page);
    await tapRounds(page, 10);
    await expect(page.locator('#AutoplayNav')).toBeHidden();
    await expect(page.locator('#AutoplayBtn')).toHaveClass(/is-counting/);
    const counts = new Set<string>();
    await expect
      .poll(
        async () => {
          counts.add((await page.locator('#AutoplayBtnCounter').textContent()) ?? '');
          return (await run(page)).active;
        },
        { timeout: 120_000, intervals: [100] },
      )
      .toBe(false);
    await waitIdle(page);
    expect(await spins(page)).toBe(10);
    expect([...counts].filter((c) => /^\d+$/.test(c)).length).toBeGreaterThan(3); // it counted down
    await expect(page.locator('#AutoplayBtn')).not.toHaveClass(/is-counting/);
    expect((await run(page)).count).toBe(0);
    await expect(page.locator('#DialogWindow')).toBeHidden();
  });

  test('ADVANCED: a loss-limit chip, a CUSTOM single-win limit that takes digits only, and stop on feature reach the run', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await openAdvanced(page);
    await expect(page.locator('#LossLimitNavList li[data-openui-generated]')).toHaveText(['5×', '20×', '50×', '100×']);
    await expect(page.locator('#WinLimitNavList li[data-openui-generated]')).toHaveText(['10×', '50×', '100×']);
    await page.locator('#LossLimitNavList li[data-openui-generated]', { hasText: '20×' }).click();
    await expect(page.locator('#LossLimitNavList li.is-selected')).toHaveText(['20×']);
    await page.locator('#WinLimitCustomInput').click();
    await page.keyboard.type('a1b2!');
    await expect(page.locator('#WinLimitCustomInput')).toHaveValue('12');
    await page.locator('label[for="StopOnFeatureToggle"]').click();
    await expect(page.locator('#StopOnFeatureToggle')).toBeChecked();
    await forceLosses(page, 5);
    await tapRounds(page, 100);
    expect(await run(page)).toMatchObject({ active: true, lossLimit: 20, singleWinLimit: 12, stopOnFeature: true });
    await page.locator('#AutoplayBtn').click();
    await runEnds(page);
  });

  test('NO LIMIT takes a chosen limit back, and MAX WIN stops the run at the game\'s max win', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await openAdvanced(page);
    await page.locator('#LossLimitNavList li[data-openui-generated]', { hasText: '5×' }).click();
    await page.locator('#LossLimitNoLimit').click();
    await expect(page.locator('#LossLimitNoLimit')).toHaveClass(/is-selected/);
    await page.locator('#WinLimitJackpot').click();
    await expect(page.locator('#WinLimitJackpot')).toHaveClass(/is-selected/);
    await forceLosses(page, 5);
    await tapRounds(page, 10);
    const maxWin = await page.evaluate(() => (window as any).__GAME__.hud.ui.facts.get().maxWinCapX);
    expect(maxWin).toBeGreaterThan(0);
    expect(await run(page)).toMatchObject({ active: true, lossLimit: Infinity, singleWinLimit: maxWin });
    await page.locator('#AutoplayBtn').click();
    await runEnds(page);
  });
});

test.describe('autoplay: how a run ends', () => {
  test('a loss limit ends the run once the rounds have lost that many bets', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await openAdvanced(page);
    await page.locator('#LossLimitNavList li[data-openui-generated]', { hasText: '5×' }).click();
    await forceLosses(page, 20);
    await countSpins(page);
    await tapRounds(page, 100);
    await runEnds(page);
    expect(await spins(page)).toBe(5);
  });

  test('a CUSTOM loss limit is the one enforced', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await openAdvanced(page);
    await page.locator('#LossLimitCustomInput').click();
    await page.keyboard.type('3');
    await forceLosses(page, 20);
    await countSpins(page);
    await tapRounds(page, 100);
    await runEnds(page);
    expect(await spins(page)).toBe(3);
  });

  test('a single-win limit ends the run on the first win that large', async ({ page }) => {
    await boot(page);
    const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
    const [big] = await rows(page, 'base', 'mult >= 1000 && mult <= 3000 && !book.includes("featureStart") && !book.includes("respin")');
    await force(page, [loss!, loss!, big!, ...Array(10).fill(loss)]);
    await openPanel(page);
    await openAdvanced(page);
    await page.locator('#WinLimitNavList li[data-openui-generated]', { hasText: '10×' }).click();
    await countSpins(page);
    await tapRounds(page, 100);
    await runEnds(page);
    expect(await spins(page)).toBe(3);
  });

  test('stop on special feature win: the run ends at the trigger, and the bonus waits for the player', async ({ page }) => {
    await boot(page);
    const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
    const [bonus] = await rows(page, 'base', 'book.includes("featureStart")');
    await force(page, [loss!, bonus!, ...Array(10).fill(loss)]);
    await openPanel(page);
    await openAdvanced(page);
    await page.locator('label[for="StopOnFeatureToggle"]').click();
    await countSpins(page);
    await tapRounds(page, 10);
    // The bonus's rules screen: the bar steps aside, the run is over, and the screen waits.
    await expect.poll(() => hudState(page), { timeout: 60_000, intervals: [200] }).toBe('hidden');
    expect((await run(page)).active).toBe(false);
    await page.waitForTimeout(2500);
    expect(await hudState(page)).toBe('hidden');
    await continueScreen(page);
    // The free spins play; the total waits for the player too.
    await expect.poll(() => hudState(page), { timeout: 150_000, intervals: [300] }).toBe('hidden');
    await page.waitForTimeout(2000);
    expect(await hudState(page)).toBe('hidden');
    await continueScreen(page);
    await waitIdle(page, 30_000);
    await page.waitForTimeout(1500);
    expect(await spins(page)).toBe(2); // nothing after the bonus
  });

  test('without stop on feature the bonus plays by itself and the run goes on', async ({ page }) => {
    await boot(page);
    const [loss] = await rows(page, 'base', 'mult === 0 && !book.includes("featureStart")');
    const [bonus] = await rows(page, 'base', 'book.includes("featureStart")');
    await force(page, [bonus!, ...Array(10).fill(loss)]);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 10);
    // No click anywhere: the bonus's screens continue by themselves, and the run reaches its next rounds.
    await expect.poll(() => spins(page), { timeout: 200_000, intervals: [500] }).toBeGreaterThanOrEqual(3);
    expect((await run(page)).active).toBe(true);
    await page.locator('#AutoplayBtn').click();
    await runEnds(page);
  });

  test('a run the balance cannot pay ends with the insufficient-funds message, and nothing more is sent', async ({ page }) => {
    await boot(page, '&balance=3.5');
    await forceLosses(page, 10);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 10);
    await expect(page.locator('.Dialog__title')).toHaveText('Insufficient funds', { timeout: 60_000 });
    await runEnds(page);
    expect(await spins(page)).toBe(3);
    expect((await snap(page)).balance).toBeCloseTo(0.5, 2);
  });
});

test.describe('autoplay: interrupting a run', () => {
  test('the autoplay button stops the run: the round in play finishes and no other starts', async ({ page }) => {
    await boot(page);
    await forceLosses(page, 20);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 100);
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(2);
    await page.locator('#AutoplayBtn').click();
    const atStop = await spins(page);
    await runEnds(page);
    await page.waitForTimeout(1500);
    expect(await spins(page)).toBe(atStop);
    await expect(page.locator('#AutoplayBtn')).not.toHaveClass(/is-counting/);
  });

  test('the round button only hurries the round in play: the run goes on', async ({ page }) => {
    await boot(page);
    await forceLosses(page, 20);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 100);
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [50] }).toBeGreaterThanOrEqual(1);
    // Through a round the round button wears its STOP face (#StopBtn); between rounds of a run
    // SPIN is disabled. A short timeout: a press that waited for the run to end would prove nothing.
    await page.locator('#StopBtn').click({ timeout: 5_000 });
    const atPress = await spins(page);
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(atPress + 2);
    expect((await run(page)).active).toBe(true);
    await page.locator('#AutoplayBtn').click();
    await runEnds(page);
  });

  test('Space only hurries the round in play: the run goes on', async ({ page }) => {
    await boot(page);
    await forceLosses(page, 20);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 100);
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [50] }).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Space');
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(3);
    expect((await run(page)).active).toBe(true);
    await page.locator('#AutoplayBtn').click();
    await runEnds(page);
  });

  test('a lost connection ends the run: the notice blocks, and once the connection is back the game waits', async ({ page }) => {
    await boot(page);
    await forceLosses(page, 20);
    await countSpins(page);
    await openPanel(page);
    await tapRounds(page, 100);
    await expect.poll(() => spins(page), { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(2);
    // The connection drops as the next round is sent; the core reconnects by itself.
    await page.evaluate(() => (window as any).__GAME__.network.simulateOutage(3000, { at: 'next-spin' }));
    await expect(page.locator('.Dialog__title')).toHaveText('Connection lost', { timeout: 15_000 });
    expect((await run(page)).active).toBe(false);
    // Back: the notice goes by itself. The round whose answer was lost finished on the server,
    // and the core offers to show it; the player skips it here.
    await expect(page.locator('.Dialog__title')).toHaveText('Your last round', { timeout: 30_000 });
    await page.locator('.Dialog__action', { hasText: 'Skip' }).click();
    await expect(page.locator('#DialogWindow')).toBeHidden({ timeout: 10_000 });
    await waitIdle(page);
    const after = await spins(page);
    await page.waitForTimeout(2000);
    expect(await spins(page)).toBe(after);
    expect((await run(page)).active).toBe(false);
    await expect(page.locator('#AutoplayBtn')).not.toHaveClass(/is-counting/);
  });

  test('a tap on the game closes the panel without starting a run', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    const { width, height } = page.viewportSize()!;
    await page.mouse.click(width * 0.3, height * 0.3);
    await expect(page.locator('#AutoplayNav')).toBeHidden();
    expect((await run(page)).active).toBe(false);
    expect((await snap(page)).phase).toBe('idle');
  });
});

for (const [name, viewport] of [
  ['a phone held upright', { width: 390, height: 844 }],
  ['a phone held sideways', { width: 844, height: 390 }],
] as const) {
  test(`autoplay on ${name}: the panel's settings, the start on a tap and the stop work by touch`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await boot(page);
    await page.locator('#AutoplayBtn').tap();
    await expect(page.locator('#AutoplayNav')).toBeVisible();
    await page.locator('#AutoplayAdvancedToggle').tap();
    await page.locator('#LossLimitNavList li[data-openui-generated]', { hasText: '5×' }).tap();
    await page.locator('label[for="StopOnFeatureToggle"]').tap();
    await forceLosses(page, 20);
    await countSpins(page);
    await page.locator('#AutoplayNavList li', { hasText: /^100$/ }).tap();
    expect(await run(page)).toMatchObject({ active: true, lossLimit: 5, stopOnFeature: true });
    await runEnds(page);
    expect(await spins(page)).toBe(5);
    await ctx.close();
  });
}
