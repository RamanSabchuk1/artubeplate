import { describe, it, expect, beforeAll } from 'vitest';
import { formatAmount, type CurrencySpec } from '@open-slot-ui/core';
import { FSM, defaultPhases, InstantTicker, TurboClock, exactMoney, nextRoundPrice, type PhaseContext } from '../src/engine/index';
import { RootStore } from '../src/stores/index';
import { MockRgs } from '../src/rgs/MockRgs';
import { normalizeSession, type RoundResponse, type SessionResponse } from '../src/rgs/protocol';
import type { RgsTransport } from '../src/rgs/network';
import { mockHud } from '../src/testing/index';
import { currencyFor } from '../src/currency';
import type { LoadedArtifact } from '../src/math/artifact';
import { loadTemplateMath } from './helpers';

/**
 * THE BALANCE NEVER READS MORE THAN THE PLAYER HAS, AT ANY STEP OF A ROUND.
 *
 * Artube's game designer, Mad Dogs on DEV in KWD (3 decimals), a bet of 0.400: "here it is not
 * rounded, I press spin, it got rounded, then again it is not rounded… it spun, it showed a six,
 * the spin ended: a five, and I won nothing". The bar read 99,998.645, then 99,998.246 while the
 * reels spun (a drop of 0.399), then 99,998.245 when the losing round ended. The wallet held more
 * decimals than KWD shows (99,998.6455), the bar rounds down, but the debit at the press was
 * rounded to the NEAREST unit: 99,998.2455 read .246, more than the player had, then the server's
 * balance read .245. The core now keeps money exact and the HUD rounds it down where it is shown.
 */

const kwd = currencyFor('KWD', 0.001);
const usd = currencyFor('USD', 0.01);

/** A round machine whose `session` and `spin` answer exactly what the test says. */
async function round(o: { currency: string; unit: number; balance: number; bets: number[]; answer: Pick<RoundResponse, 'balance' | 'totalWin'> }) {
  const session = normalizeSession({
    balance: o.balance,
    sessionSettings: { currency: o.currency, currencyMinimalUnit: o.unit, allowedBets: o.bets, defaultBetIndex: 0 },
    gameSettings: { betCredit: 1, gameModes: [{ id: 'base', rtp: 96, priceMultiplier: 1, type: 'None' }] },
  }) as SessionResponse;
  const network = {
    kind: 'mock',
    connect: async () => {},
    session: async () => session,
    balance: async () => ({ balance: o.answer.balance, currency: o.currency }),
    activateFreeRoundCampaign: async () => null,
    on: () => () => {},
    dispose: async () => {},
    spin: async () =>
      ({
        roundId: 'r1',
        gameMode: 'base',
        bet: o.bets[0],
        balance: o.answer.balance,
        totalWin: o.answer.totalWin,
        platformMaxWin: null,
        spinResult: { winMultiplier: 0, payload: {}, nextAvailableGameModes: [] },
        freeRoundCampaign: null,
        maxWinReached: false,
      }) as unknown as RoundResponse,
  } as unknown as RgsTransport;
  const stores = new RootStore();
  stores.session.current.set(session);
  stores.balance.balance.set(session.balance);
  stores.balance.betIndex.set(0);
  stores.balance.bet.set(o.bets[0]!);
  const fsm = new FSM<unknown, null, unknown>(defaultPhases());
  const ctx: PhaseContext<unknown, null, unknown> = {
    config: { title: 't' },
    stores,
    network,
    hud: mockHud(),
    ticker: new InstantTicker(),
    view: null,
    audio: null,
    turbo: new TurboClock(),
    interpretBook: (payload) => payload,
    fsm,
    round: null,
    recover: async () => {},
    afterRound: async () => {},
  };
  fsm.bind(ctx);
  await fsm.transition('idle');
  return { stores, fsm };
}

/** Every balance the bar shows through one round, as the HUD shows it (rounded down), in order. */
async function shown(o: Parameters<typeof round>[0], currency: CurrencySpec): Promise<{ readouts: string[]; values: number[] }> {
  const { stores, fsm } = await round(o);
  const values: number[] = [stores.balance.balance.get()];
  const off = stores.balance.balance.subscribe((v) => values.push(v));
  await fsm.transition('spin');
  off();
  expect(fsm.current).toBe('idle');
  const readouts: string[] = [];
  for (const v of values) {
    const r = formatAmount(v, currency, { round: 'down' });
    if (readouts[readouts.length - 1] !== r) readouts.push(r);
  }
  return { readouts, values };
}

describe('what the bar reads through a round, when the wallet holds more decimals than the currency shows', () => {
  it('the designer\'s round: 99,998.645, then .245 at the press (a drop of exactly the 0.400 bet), and .245 when the losing round ends', async () => {
    const { readouts, values } = await shown({ currency: 'KWD', unit: 0.001, balance: 99998.6455, bets: [0.4], answer: { balance: 99998.2455, totalWin: 0 } }, kwd);
    expect(readouts).toEqual(['KD99,998.645', 'KD99,998.245']);
    expect(readouts).not.toContain('KD99,998.246');
    // never above the wallet: it held 99,998.6455 before the round and 99,998.2455 after the debit
    expect(Math.max(...values.slice(1))).toBeLessThanOrEqual(99998.2455);
  });

  it('a bet finer than the currency\'s unit (a converted bet of 0.3994 KWD): the press and the end read the same', async () => {
    const { readouts } = await shown({ currency: 'KWD', unit: 0.001, balance: 99999.629, bets: [0.3994], answer: { balance: 99999.229, totalWin: 0 } }, kwd);
    expect(readouts).toEqual(['KD99,999.629', 'KD99,999.229']);
  });

  it('a win the platform credits rounded down (USD on DEV: a 0.012 win credits 0.01): no dip while the win plays, then the credited balance', async () => {
    const { readouts } = await shown({ currency: 'USD', unit: 0.01, balance: 99881.85, bets: [0.1], answer: { balance: 99881.76, totalWin: 0.012 } }, usd);
    expect(readouts).toEqual(['$99,881.85', '$99,881.75', '$99,881.76']);
  });

  it('a win that is credited in full: the debited balance while the win plays, then the balance with the win', async () => {
    const { readouts } = await shown({ currency: 'KWD', unit: 0.001, balance: 99999.6295, bets: [0.4], answer: { balance: 99999.2531, totalWin: 0.0236 } }, kwd);
    expect(readouts).toEqual(['KD99,999.629', 'KD99,999.229', 'KD99,999.253']);
  });

  it('the price is the platform\'s, exact: bet × priceMultiplier, never rounded to the unit', () => {
    expect(exactMoney(0.3994 * 1.25)).toBe(0.49925);
    expect(exactMoney(99998.6455 - 0.4)).toBe(99998.2455);
    expect(exactMoney(0.1 + 0.2)).toBe(0.3);
    const stores = new RootStore();
    stores.session.current.set(
      normalizeSession({
        balance: 1,
        sessionSettings: { currency: 'KWD', currencyMinimalUnit: 0.001, allowedBets: [0.3994], defaultBetIndex: 0 },
        gameSettings: { betCredit: 1, gameModes: [{ id: 'base', rtp: 96, priceMultiplier: 1, type: 'None' }, { id: 'ante', rtp: 96, priceMultiplier: 1.25, type: 'LuckyBet' }] },
      }) as SessionResponse,
    );
    stores.ui.baseMode = 'base';
    stores.balance.bet.set(0.3994);
    expect(nextRoundPrice(stores)).toBe(0.3994);
    stores.ui.activeMode.set('ante');
    expect(nextRoundPrice(stores)).toBe(0.49925);
  });
});

describe('the mock keeps a balance the way the platform does', () => {
  let art: LoadedArtifact;
  beforeAll(async () => {
    art = await loadTemplateMath();
  });

  it('down to the currency\'s unit after a round, and charging the exact price', async () => {
    const m = new MockRgs({ math: art, latency: 0, seed: 1, currency: 'KWD', currencyMinimalUnit: 0.001, balance: 99998.6455, allowedBets: [0.4] });
    const [loss] = await m.rowsWhere('base', (mult) => mult === 0);
    m.forceRow('base', loss!);
    const r = await m.spin({ gameMode: 'base', betIndex: 0 });
    expect(r.totalWin).toBe(0);
    expect(r.balance).toBe(99998.245); // 99,998.2455 kept down to the unit
  });
});
