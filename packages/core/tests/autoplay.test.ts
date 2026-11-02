// The player's autoplay, played for real: the HUD's own autoplay control (open-slot-ui, headless)
// owns the run, the round machine plays each round on the mock RGS with the template's math, and
// the core's loop (../src/game/autoplay) starts the next one and ends the run where only the core
// can see why. Every setting a player can choose, every way to interrupt a run, every way it ends.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createUI, type OpenUI } from '@open-slot-ui/core';
import { FSM, defaultPhases, InstantTicker, TurboClock, type PhaseContext, type Phase } from '../src/engine/index';
import { RootStore } from '../src/stores/index';
import { MockRgs } from '../src/rgs/MockRgs';
import { mockHud, type RecordingHud } from '../src/testing/index';
import { autoplayLoop } from '../src/game/autoplay';
import type { LoadedArtifact } from '../src/math/artifact';
import { loadTemplateMath } from './helpers';

let art: LoadedArtifact;
beforeAll(async () => {
  art = await loadTemplateMath();
});

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

interface Rig {
  ui: OpenUI;
  hud: RecordingHud;
  network: MockRgs;
  stores: RootStore;
  turbo: TurboClock;
  fsm: FSM<unknown, null, unknown>;
  /** Spins the transport was asked for. */
  spins: () => number;
  /** Rounds whose book started a bonus, as the game saw them. */
  bonuses: string[];
  /** The session ended (`terminal` in the boot). */
  end: () => void;
  /** Book rows of a mode whose multiplier (in hundredths of the bet) and book match. */
  rows: (mode: string, pred: (mult: number, book: string) => boolean) => Promise<number[]>;
  /** Wait until the run is over and the machine is back between rounds. */
  settled: () => Promise<void>;
}

/**
 * A game with the real HUD state and the real round loop. `present` marks a bonus the way a game
 * does: `ctx.turbo.feature(true)` when its book starts one, `feature(false)` when it is over.
 */
async function rig(opts: { balance?: number; betIndex?: number; requireLimits?: boolean; gameStopsOnFeature?: boolean } = {}): Promise<Rig> {
  const network = new MockRgs({ math: art, latency: 0, seed: 11, ...(opts.balance !== undefined ? { balance: opts.balance } : {}) });
  const session = await network.session();
  const stores = new RootStore();
  stores.session.current.set(session);
  stores.balance.balance.set(session.balance);
  const bets = session.sessionSettings.allowedBets;
  const index = opts.betIndex ?? 0;
  stores.balance.betIndex.set(index);
  stores.balance.bet.set(bets[index]!);
  const ui = createUI({
    betLadder: { levels: bets, index },
    autoplay: { options: [3, 10, 100], lossLimits: [3, 5], winLimits: [2, 5], startOnSelect: true, stopControl: 'autoplay-button', ...(opts.requireLimits ? { requireLimits: true } : {}) },
  });
  // The bar shows the core's balance and bet, as the DOM HUD's binding keeps it.
  disposers.push(stores.balance.balance.subscribe((v) => ui.balance.set(v)));
  disposers.push(stores.balance.bet.subscribe((v) => ui.bet.set(v)));
  const hud = mockHud();
  // Every message the HUD shows, whether the core asks for it or the HUD says it by itself.
  const show = ui.showRgsError.bind(ui);
  ui.showRgsError = ((code: string, o?: Parameters<OpenUI['showRgsError']>[1]) => {
    hud.calls.push({ m: 'showRgsError', args: [code] });
    return show(code, o);
  }) as OpenUI['showRgsError'];
  Object.assign(hud, {
    reportRound: (win: number, stake: number) => {
      hud.calls.push({ m: 'reportRound', args: [win, stake] });
      ui.reportRound(win, stake);
    },
    showRgsError: (code: string) => ui.showRgsError(code),
    autoplay: { active: () => ui.autoplay.isActive, stopOnFeature: () => ui.stopOnFeature.isOn, stopOnAnyWin: () => ui.stopOnAnyWin.isOn, stop: () => ui.autoplay.stop() },
  });
  const turbo = new TurboClock();
  const bonuses: string[] = [];
  const present: Phase<unknown, null, unknown> = {
    name: 'present',
    async enter(ctx) {
      if (JSON.stringify(ctx.round?.data ?? '').includes('featureStart')) {
        // A game that still checks the setting itself at its trigger (the template does): harmless.
        if (opts.gameStopsOnFeature && ctx.hud.autoplay.active() && ctx.hud.autoplay.stopOnFeature()) ctx.hud.autoplay.stop();
        ctx.turbo.feature(true);
        bonuses.push(ctx.turbo.autoplay ? 'played by itself' : 'waited for the player');
        ctx.turbo.feature(false);
      }
      await ctx.fsm.transition('settle');
    },
  };
  const fsm = new FSM<unknown, null, unknown>([...defaultPhases<unknown, null, unknown>().filter((p) => p.name !== 'present'), present]);
  const ctx: PhaseContext<unknown, null, unknown> = {
    config: { title: 't' },
    stores,
    network,
    hud,
    ticker: new InstantTicker(),
    view: null,
    audio: null,
    turbo,
    interpretBook: (payload) => payload,
    fsm,
    round: null,
    recover: async () => {},
    afterRound: async () => {},
  };
  fsm.bind(ctx);
  await fsm.transition('idle');
  let spins = 0;
  const spin = network.spin.bind(network);
  network.spin = ((req: Parameters<MockRgs['spin']>[0]) => {
    spins++;
    return spin(req);
  }) as MockRgs['spin'];
  let terminal = false;
  const beginSpin = (): boolean => {
    if (fsm.current !== 'idle' || terminal) return false;
    turbo.resetSkip();
    void fsm.transition('spin');
    return true;
  };
  disposers.push(
    autoplayLoop({ ui, turbo, stores, beginSpin, idle: () => fsm.current === 'idle', terminal: () => terminal, holding: () => false, noFunds: () => hud.showRgsError('ERR_IPB'), gapMs: 1 }),
  );
  const settled = async (): Promise<void> => {
    const t0 = Date.now();
    // Over when the run has stopped and the machine has stayed between rounds for a few ticks.
    let quiet = 0;
    while (quiet < 5) {
      if (Date.now() - t0 > 30_000) throw new Error('the run never ended');
      await new Promise((r) => setTimeout(r, 10));
      quiet = !ui.autoplay.isActive && fsm.current === 'idle' ? quiet + 1 : 0;
    }
  };
  return {
    ui,
    hud,
    network,
    stores,
    turbo,
    fsm,
    spins: () => spins,
    bonuses,
    end: () => void (terminal = true),
    rows: (mode, pred) => network.rowsWhere(mode, pred),
    settled,
  };
}

/** Force the next rounds of a mode onto book rows, in order. The template's math holds each
 *  outcome once (with its weight), so a run of losses repeats one losing row. */
function force(r: Rig, mode: string, rows: number[]): void {
  for (const row of rows) r.network.forceRow(mode, row);
}
const errors = (r: Rig): string[] => r.hud.calls.filter((c) => c.m === 'showRgsError').map((c) => c.args[0] as string);
const reported = (r: Rig): number => r.hud.calls.filter((c) => c.m === 'reportRound').length;

describe('autoplay: the settings a player chooses', () => {
  it('a number of rounds plays exactly that many rounds, then the run ends', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(10).fill(losses[0]!));
    r.ui.autoplay.begin(10);
    expect(r.ui.autoplay.isActive).toBe(true);
    expect(r.turbo.autoplay).toBe(true); // the rounds play at the autoplay pace
    await r.settled();
    expect(r.spins()).toBe(10);
    expect(reported(r)).toBe(10);
    expect(r.ui.autoplay.count.get()).toBe(0);
    expect(r.turbo.autoplay).toBe(false);
    expect(errors(r)).toEqual([]);
  });

  it('the count goes down one round at a time', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(3).fill(losses[0]!));
    const counts: number[] = [];
    disposers.push(r.ui.autoplay.count.subscribe((c) => counts.push(c)));
    r.ui.autoplay.begin(3);
    await r.settled();
    expect(counts.slice(-4)).toEqual([3, 2, 1, 0]);
  });

  it('a loss limit ends the run once the rounds have lost that many bets', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100, { lossLimit: 3 });
    await r.settled();
    expect(r.spins()).toBe(3); // three lost bets = the 3× loss limit
  });

  it('a single-win limit ends the run on the first win that large', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    const [big] = await r.rows('base', (m, b) => m >= 500 && m <= 2000 && !b.includes('featureStart'));
    force(r, 'base', [...Array(2).fill(losses[0]!), big!, ...Array(8).fill(losses[0]!)]);
    r.ui.autoplay.begin(100, { singleWinLimit: 5 });
    await r.settled();
    expect(r.spins()).toBe(3); // the third round won 5× the bet or more
  });

  it('a win under the single-win limit does not end the run', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    const [small] = await r.rows('base', (m, b) => m > 0 && m < 200 && !b.includes('featureStart'));
    force(r, 'base', [small!, ...Array(2).fill(losses[0]!)]);
    r.ui.autoplay.begin(3, { singleWinLimit: 2 });
    await r.settled();
    expect(r.spins()).toBe(3);
  });

  it('stop on any win ends the run after the first paying round', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    const [small] = await r.rows('base', (m, b) => m > 0 && m < 200 && !b.includes('featureStart'));
    force(r, 'base', [losses[0]!, small!, ...Array(9).fill(losses[0]!)]);
    r.ui.stopOnAnyWin.toggle();
    r.ui.autoplay.begin(100, { stopOnAnyWin: true });
    await r.settled();
    expect(r.spins()).toBe(2);
  });

  it('stop on special feature win ends the run when a bonus starts, and the bonus waits for the player', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    const [bonus] = await r.rows('base', (_m, b) => b.includes('featureStart'));
    force(r, 'base', [losses[0]!, bonus!, ...Array(9).fill(losses[0]!)]);
    r.ui.stopOnFeature.toggle();
    r.ui.autoplay.begin(100);
    await r.settled();
    expect(r.spins()).toBe(2);
    expect(r.bonuses).toEqual(['waited for the player']);
  });

  it('a game that also stops the run at its trigger itself changes nothing', async () => {
    const r = await rig({ gameStopsOnFeature: true });
    const [bonus] = await r.rows('base', (_m, b) => b.includes('featureStart'));
    force(r, 'base', [bonus!]);
    r.ui.stopOnFeature.toggle();
    r.ui.autoplay.begin(100);
    await r.settled();
    expect(r.spins()).toBe(1);
    expect(r.bonuses).toEqual(['waited for the player']);
  });

  it('without stop on feature the bonus plays by itself and the run goes on', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    const [bonus] = await r.rows('base', (_m, b) => b.includes('featureStart'));
    force(r, 'base', [losses[0]!, bonus!, losses[0]!]);
    r.ui.autoplay.begin(3);
    await r.settled();
    expect(r.spins()).toBe(3);
    expect(r.bonuses).toEqual(['played by itself']);
  });

  it('a market that requires limits gets no run until both are set', async () => {
    const r = await rig({ requireLimits: true });
    r.ui.autoplay.begin(10);
    expect(r.ui.autoplay.isActive).toBe(false);
    r.ui.autoplay.begin(10, { lossLimit: 5 });
    expect(r.ui.autoplay.isActive).toBe(false);
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(10).fill(losses[0]!));
    r.ui.autoplay.begin(10, { lossLimit: 5, singleWinLimit: 5 });
    expect(r.ui.autoplay.isActive).toBe(true);
    await r.settled();
    expect(r.spins()).toBe(5);
  });
});

describe('autoplay: interrupting a run', () => {
  it('the stop lets the round in play finish and starts no other', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100);
    // Stop while the second round is in play.
    while (r.spins() < 2) await new Promise((res) => setTimeout(res, 1));
    r.ui.autoplay.stop();
    await r.settled();
    expect(r.spins()).toBe(2);
    expect(reported(r)).toBe(2); // the round in play still settled
    expect(r.turbo.autoplay).toBe(false);
  });

  it('a slam only hurries the round in play: the run goes on to its count', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(3).fill(losses[0]!));
    r.ui.autoplay.begin(3);
    while (r.spins() < 1) await new Promise((res) => setTimeout(res, 1));
    r.turbo.skip();
    await r.settled();
    expect(r.spins()).toBe(3);
  });

  it('a notice that is up ends the run before the next round', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100);
    while (r.spins() < 1) await new Promise((res) => setTimeout(res, 1));
    r.ui.showNotice([{ kind: 'text', id: 'oops', text: 'Something went wrong' }]);
    await r.settled();
    expect(r.spins()).toBe(1);
  });

  it('a session that is over ends the run', async () => {
    const r = await rig();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100);
    while (r.spins() < 1) await new Promise((res) => setTimeout(res, 1));
    r.end();
    await r.settled();
    expect(r.spins()).toBe(1);
  });
});

describe('autoplay: a run that cannot pay', () => {
  it('ends when the balance cannot pay the next round, with the insufficient-funds message, and sends nothing more', async () => {
    const r = await rig({ balance: 2.5 });
    const bet = r.stores.balance.bet.get();
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100);
    await r.settled();
    expect(r.spins()).toBe(Math.floor(2.5 / bet));
    expect(errors(r)).toEqual(['ERR_IPB']);
    expect(r.ui.noticePanel.isOpen).toBe(true);
  });

  it('a boost that costs more than the bet ends the run as soon as its next round cannot be paid', async () => {
    const r = await rig({ balance: 2.5 });
    const bet = r.stores.balance.bet.get();
    const boost = r.stores.session.mode('luckybet');
    expect(boost?.priceMultiplier).toBeGreaterThan(1);
    r.stores.ui.activeMode.set('luckybet');
    const losses = await r.rows('luckybet', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'luckybet', Array(20).fill(losses[0]!));
    r.ui.autoplay.begin(100);
    await r.settled();
    // A round costs the boosted bet rounded to the cent, as the platform charges it: 0.125 → 0.13.
    const price = Math.round(bet * boost!.priceMultiplier * 100) / 100;
    expect(r.spins()).toBe(Math.floor(2.5 / price + 1e-9));
    expect(errors(r)).toEqual(['ERR_IPB']); // said once, never twice
  });

  it('a run that ends on its count says nothing about funds', async () => {
    const r = await rig({ balance: 100 });
    const losses = await r.rows('base', (m, b) => m === 0 && !b.includes('featureStart'));
    force(r, 'base', Array(3).fill(losses[0]!));
    r.ui.autoplay.begin(3);
    await r.settled();
    expect(errors(r)).toEqual([]);
    expect(r.ui.noticePanel.isOpen).toBe(false);
  });
});

describe('the bonus edges a game marks', () => {
  it('are heard once each, and only when they change', () => {
    const t = new TurboClock();
    const seen: boolean[] = [];
    const off = t.onFeature((on) => seen.push(on));
    t.feature(true);
    t.feature(true);
    t.feature(false);
    t.feature(false);
    off();
    t.feature(true);
    expect(seen).toEqual([true, false]);
  });
});
