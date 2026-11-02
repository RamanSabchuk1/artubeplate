import { expect, type Page } from '@playwright/test';

// Shared by the e2e specs: the showcase on the mock RGS. `window.__GAME__` is the ArtubeGame handle
// (inspect / requestSpin / requestBuy / hud / network = the MockRgs, scriptable: forceRow,
// failNext, rowsWhere, simulateReconnect…).

export type Snap = { phase: string; balance: number; bet: number; lastWin: number; freeRoundsActive: boolean; currency: string | null };

export const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__GAME__.inspect());

export async function boot(page: Page, query = ''): Promise<void> {
  // `intro=0`: straight to the game (the intro has its own tests below).
  await page.goto(`/?seed=7&latency=40&intro=0${query}`);
  await expect(page.locator('#PlaceBetBtn')).toBeVisible();
  await expect.poll(async () => (await snap(page)).phase).toBe('idle');
  // Turbo on: the rounds run at the turbo pace.
  await page.evaluate(() => (window as any).__GAME__.hud.ui.speeds[0].set(true));
}

export async function waitIdle(page: Page, timeout = 90_000): Promise<Snap> {
  await expect.poll(async () => (await snap(page)).phase, { timeout, intervals: [200] }).toBe('idle');
  return snap(page);
}

export const hudState = (page: Page): Promise<string | null> => page.locator('.OpenSlotUiContainer').getAttribute('data-state');

/** A bonus screen (rules / total) is up: the bar has stepped aside and the screen waits. Click it
 *  away (the first click may only finish its entrance). */
export async function continueScreen(page: Page): Promise<void> {
  const { width, height } = page.viewportSize()!;
  for (let i = 0; i < 5 && (await hudState(page)) === 'hidden'; i++) {
    await page.mouse.click(width / 2, height / 2);
    await page.waitForTimeout(700);
  }
  expect(await hudState(page)).not.toBe('hidden');
}

/** Book rows of a mode matching a predicate, straight from the mock's loaded math. */
export function rows(page: Page, mode: string, pred: string): Promise<number[]> {
  return page.evaluate(([m, p]) => (window as any).__GAME__.network.rowsWhere(m, new Function('mult', 'book', `return ${p}`)), [mode, pred] as const);
}
