import { describe, it, expect, beforeAll } from 'vitest';
import { MockRgs } from '../src/rgs/MockRgs';
import { RGS_ERRORS } from '../src/rgs/errors';
import type { LoadedArtifact } from '../src/math/artifact';
import { loadTemplateMath } from './helpers';

let art: LoadedArtifact;
beforeAll(async () => {
  art = await loadTemplateMath();
});
const mock = (o: ConstructorParameters<typeof MockRgs>[0] = {}) => new MockRgs({ math: art, latency: 0, seed: 1, ...o });

describe('MockRgs — the RGS rules, on the showcase math', () => {
  it('session: gameSettings come from the manifest (Purchase → BuyFeature, price = cost / betCredit)', async () => {
    const s = await mock().session();
    expect(s.gameSettings.betCredit).toBe(100);
    expect(s.gameSettings.gameModes.map((m) => [m.id, m.type, m.priceMultiplier])).toEqual([
      ['base', 'None', 1],
      ['buyfs', 'BuyFeature', 100],
      ['luckybet', 'LuckyBet', 1.25],
    ]);
    expect((s.gameSettings.config as { schema: string }).schema).toBe('artubeplate/slot@1');
  });

  it('charges allowedBets[betIndex] × priceMultiplier and pays bet × multiplier / betCredit', async () => {
    const m = mock({ balance: 1000 });
    const lossRow = (await m.rowsWhere('luckybet', (mult) => mult === 0))[0]!;
    m.forceRow('luckybet', lossRow);
    const r = await m.spin({ gameMode: 'luckybet', betIndex: 4 }); // bet 2
    expect(r.bet).toBe(2);
    expect(r.balance).toBe(1000 - 2.5);
    const winRow = (await m.rowsWhere('base', (mult) => mult === 300))[0]!;
    m.forceRow('base', winRow);
    const w = await m.spin({ gameMode: 'base', betIndex: 3 }); // bet 1, 3×
    expect(w.totalWin).toBe(3);
    expect(w.spinResult.winMultiplier).toBe(3);
    expect((w.spinResult.payload as { payoutMultiplier: number }).payoutMultiplier).toBe(300);
  });

  it('rejects unknown modes (601), bad indexes (502) and unaffordable rounds (503)', async () => {
    const m = mock({ balance: 50 });
    await expect(m.spin({ gameMode: 'Base', betIndex: 0 })).rejects.toMatchObject({ errorId: RGS_ERRORS.UNKNOWN_MODE }); // case-sensitive
    await expect(m.spin({ gameMode: 'base', betIndex: 99 })).rejects.toMatchObject({ errorId: RGS_ERRORS.INVALID_BET });
    await expect(m.spin({ gameMode: 'base', betIndex: null })).rejects.toMatchObject({ errorId: RGS_ERRORS.INVALID_BET });
    await expect(m.spin({ gameMode: 'buyfs', betIndex: 3 })).rejects.toMatchObject({ errorId: RGS_ERRORS.INSUFFICIENT_FUNDS }); // 100 > 50
  });

  it('applies the platform max-win cap to the credited win', async () => {
    const m = mock({ platformMaxWin: 3 });
    m.forceRow('base', (await m.rowsWhere('base', (mult) => mult >= 1000))[0]!);
    const r = await m.spin({ gameMode: 'base', betIndex: 3 });
    expect(r.totalWin).toBe(3);
    expect(r.maxWinReached).toBe(true);
  });

  it('free rounds: activate once per connection, betIndex null, no charge, no paid buys, then played out', async () => {
    const m = mock({ balance: 100, frc: { rounds: 2, bet: 0.5 } });
    const s = await m.session();
    const c = s.freeRoundCampaign!;
    expect(c).toMatchObject({ roundsLeft: 2, bet: 0.5 });
    await m.activateFreeRoundCampaign(c.campaignId);
    await expect(m.activateFreeRoundCampaign(c.campaignId)).rejects.toMatchObject({ errorId: RGS_ERRORS.FRC_ALREADY_ACTIVE });
    await expect(m.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: RGS_ERRORS.INVALID_BET });
    await expect(m.spin({ gameMode: 'buyfs', betIndex: null })).rejects.toMatchObject({ errorId: RGS_ERRORS.BUY_UNAVAILABLE });
    m.forceRow('base', (await m.rowsWhere('base', (mult) => mult === 0))[0]!);
    const r1 = await m.spin({ gameMode: 'base', betIndex: null });
    expect(r1.balance).toBe(100); // free
    expect(r1.freeRoundCampaign).toMatchObject({ roundsLeft: 1 });
    await m.spin({ gameMode: 'base', betIndex: null });
    await expect(m.activateFreeRoundCampaign(c.campaignId)).rejects.toMatchObject({ errorId: RGS_ERRORS.FRC_PLAYED_OUT });
  });

  it('a reconnect loses the activation (the campaign itself comes back in session)', async () => {
    const m = mock({ frc: { rounds: 3 } });
    const c = (await m.session()).freeRoundCampaign!;
    await m.activateFreeRoundCampaign(c.campaignId);
    await m.simulateReconnect(0);
    await expect(m.activateFreeRoundCampaign(c.campaignId)).resolves.toMatchObject({ campaignId: c.campaignId });
  });

  it('injected errors and a closed session', async () => {
    const m = mock({ errors: [503] });
    await expect(m.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: 503 });
    m.closeSession();
    await expect(m.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: RGS_ERRORS.SESSION_UNUSABLE });
  });

  it('draws by weight: the long-run average payout converges to the declared RTP', async () => {
    const m = mock({ balance: 1e9, seed: 42 });
    let paid = 0;
    let won = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const r = await m.spin({ gameMode: 'base', betIndex: 3 });
      paid += 1;
      won += r.totalWin;
    }
    // Showcase base RTP is 96.2%, a very volatile set: allow a wide statistical band.
    expect(won / paid).toBeGreaterThan(0.6);
    expect(won / paid).toBeLessThan(1.4);
  });
});
