import { describe, it, expect, beforeAll } from 'vitest';
import { FSM, defaultPhases, InstantTicker, TurboClock, type PhaseContext, type Phase, type GameRound } from '../src/engine/index';
import { RootStore } from '../src/stores/index';
import { MockRgs } from '../src/rgs/MockRgs';
import { mockHud } from '../src/testing/index';
import type { LoadedArtifact } from '../src/math/artifact';
import type { RgsTransport } from '../src/rgs/network';
import { loadTemplateMath } from './helpers';

let art: LoadedArtifact;
beforeAll(async () => {
  art = await loadTemplateMath();
});

/** A whole round machine, headless: MockRgs + recording HUD + instant clock. */
async function rig(opts: { network?: RgsTransport; present?: Phase; mock?: ConstructorParameters<typeof MockRgs>[0] } = {}) {
  const network = opts.network ?? new MockRgs({ math: art, latency: 0, seed: 3, ...opts.mock });
  const session = await network.session();
  const stores = new RootStore();
  stores.session.current.set(session);
  stores.frc.campaign.set(session.freeRoundCampaign);
  stores.balance.balance.set(session.balance);
  stores.balance.betIndex.set(3);
  stores.balance.bet.set(session.sessionSettings.allowedBets[3]!);
  const hud = mockHud();
  const recovered: string[] = [];
  const settled: GameRound[] = [];
  const fsm = new FSM<unknown, null, unknown>([...defaultPhases(), ...(opts.present ? [opts.present] : [])]);
  const ctx: PhaseContext<unknown, null, unknown> = {
    config: { title: 't' },
    stores,
    network,
    hud,
    ticker: new InstantTicker(),
    view: null,
    audio: null,
    turbo: new TurboClock(),
    interpretBook: (payload) => payload,
    fsm,
    round: null,
    recover: async (r) => void recovered.push(r),
    afterRound: async (r) => void settled.push(r as GameRound),
  };
  fsm.bind(ctx);
  await fsm.transition('idle');
  return { network: network as MockRgs, stores, hud, fsm, ctx, recovered, settled };
}

describe('the round machine (headless)', () => {
  it('idle → spin → present → settle → idle, money from the server, reported once', async () => {
    const { network, stores, hud, fsm, settled } = await rig({ mock: { balance: 100 } });
    network.forceRow('base', (await network.rowsWhere('base', (m) => m === 300))[0]!); // a 3× round
    await fsm.transition('spin');
    expect(fsm.current).toBe('idle');
    expect(stores.balance.balance.get()).toBe(100 - 1 + 3);
    expect(stores.balance.lastWin.get()).toBe(3);
    expect(hud.reportedRounds()).toEqual([{ win: 3, stake: 1 }]);
    expect(hud.states()).toEqual(['idle', 'play', 'winPresentation', 'idle']);
    expect(settled[0]).toMatchObject({ mode: 'base', stake: 1, totalWin: 3, multiplier: 3, freeRound: false });
  });

  it('during Present the bar shows the balance WITHOUT the win (the round is already settled)', async () => {
    let seen = -1;
    const present: Phase = {
      name: 'present',
      async enter(ctx) {
        seen = ctx.stores.balance.balance.get();
        await ctx.fsm.transition('settle');
      },
    };
    const { network, fsm } = await rig({ present, mock: { balance: 100 } });
    network.forceRow('base', (await network.rowsWhere('base', (m) => m === 300))[0]!);
    await fsm.transition('spin');
    expect(seen).toBe(99);
  });

  it('a refused spin (503) never happened: the optimistic debit is undone, nothing reported', async () => {
    const { stores, hud, fsm, recovered } = await rig({ mock: { balance: 100, errors: [503] } });
    await fsm.transition('spin');
    expect(stores.balance.balance.get()).toBe(100);
    expect(hud.calls.some((c) => c.m === 'showRgsError' && c.args[0] === 'ERR_IPB')).toBe(true);
    expect(hud.reportedRounds()).toEqual([]);
    expect(recovered).toEqual([]);
  });

  it('a spin with NO answer is not retried and not refunded: it goes to recovery', async () => {
    const base = new MockRgs({ math: art, latency: 0, balance: 100 });
    let spins = 0;
    const flaky: RgsTransport = Object.assign(Object.create(base), {
      spin: async () => {
        spins++;
        throw new Error('Invocation canceled due to the underlying connection being closed.');
      },
      session: () => base.session(),
    });
    const { stores, fsm, recovered } = await rig({ network: flaky });
    await fsm.transition('spin');
    expect(spins).toBe(1);
    expect(recovered).toHaveLength(1);
    expect(stores.balance.balance.get()).toBe(99); // unknown — the boot layer re-reads the session
    expect(fsm.current).toBe('idle');
  });

  it('a free round sends betIndex null, charges nothing, and reports a zero stake', async () => {
    const { network, stores, hud, fsm } = await rig({ mock: { balance: 100, frc: { rounds: 2, bet: 0.5 } } });
    const c = stores.frc.campaign.get()!;
    await network.activateFreeRoundCampaign(c.campaignId);
    stores.frc.activated.set(true);
    network.forceRow('base', (await network.rowsWhere('base', (m) => m === 0))[0]!);
    await fsm.transition('spin');
    expect(stores.balance.balance.get()).toBe(100);
    expect(hud.reportedRounds()).toEqual([{ win: 0, stake: 0 }]);
    expect(stores.frc.campaign.get()).toMatchObject({ roundsLeft: 1 });
  });

  it('a capped win shows the blocking max-win notice with the credited amount', async () => {
    const { network, hud, fsm } = await rig({ mock: { platformMaxWin: 2 } });
    network.forceRow('base', (await network.rowsWhere('base', (m) => m >= 1000))[0]!);
    await fsm.transition('spin');
    const n = hud.notices.find((x) => x.title === 'Maximum win reached');
    expect(n?.blocking).toBe(true);
    expect(n?.message).toContain('2.00');
  });

  it('a buy plays its mode once, at bet × priceMultiplier', async () => {
    const { network, stores, fsm, settled } = await rig({ mock: { balance: 1000 } });
    stores.ui.oneShotMode.set('buyfs');
    network.forceRow('buyfs', 0);
    await fsm.transition('spin');
    expect(settled[0]).toMatchObject({ mode: 'buyfs', modeType: 'BuyFeature', stake: 100 });
    expect(stores.ui.nextMode()).toBe('base'); // one-shot consumed
  });
});
