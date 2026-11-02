// The default round phases (Idle → Spin → Present → Settle). The game writes Present (animate
// the round) and may override any of these.
//
// The money rules the RGS docs spell out live HERE, so no game can get them wrong:
//   · the stake is `allowedBets[betIndex] × priceMultiplier`, sent as an INDEX, never an amount
//   · during free rounds `betIndex` is `null` and the campaign's bet applies (price 0)
//   · the balance shown during the animation is the server balance MINUS the win (the round is
//     already settled server-side); the win lands on the bar at Settle
//   · a spin with no answer is NEVER retried: the boot layer reconnects and reads `session`
//   · a spin the server REFUSED (an errorId) did not happen: the optimistic debit is undone

import { rgsErrorFrom, RGS_ERRORS } from '../rgs/errors';
import { presentRgsError } from './errors';
import { roundMoney, type RoundInfo } from './round';
import type { Phase, PhaseContext, ViewHooks } from './fsm';

/** The wallet's balance, read now; `null` when it cannot be read (no connection, an error). */
async function walletBalance(network: PhaseContext['network']): Promise<number | null> {
  if (network.connected === false) return null;
  try {
    const { balance } = await network.balance();
    return Number.isFinite(balance) ? balance : null;
  } catch {
    return null;
  }
}

/** Wait for the next spin (the HUD's `spinRequested` drives the transition to Spin). */
export class IdlePhase<T = unknown, V = unknown, P = unknown> implements Phase<T, V, P> {
  readonly name = 'idle';
  enter(ctx: PhaseContext<T, V, P>): void {
    ctx.stores.ui.spinning.set(false);
    ctx.hud.spinIdle();
    ctx.hud.setHudState('idle');
  }
}

/** Pick the mode, take the stake, ask the RGS, parse the round, hand off to Present. */
export class SpinPhase<T = unknown, V = unknown, P = unknown> implements Phase<T, V, P> {
  readonly name = 'spin';
  async enter(ctx: PhaseContext<T, V, P>): Promise<void> {
    const { stores, network, hud } = ctx;
    const view = ctx.view as ViewHooks | null | undefined;
    const frc = stores.frc.active;
    const campaign = stores.frc.campaign.get();
    // Free rounds play the base mode at the campaign's bet — a queued buy is dropped.
    const modeId = frc ? (stores.ui.oneShotMode.set(null), stores.ui.baseMode) : stores.ui.nextMode();
    const mode = stores.session.mode(modeId);
    if (!mode) {
      await hud.notice({ title: 'Mode unavailable', message: `The game mode "${modeId}" is not offered in this session.` });
      await ctx.fsm.transition('idle');
      return;
    }
    const bet = frc && campaign ? campaign.bet : stores.balance.bet.get();
    const betIndex = frc ? null : stores.balance.betIndex.get();
    const unit = stores.session.current.get()?.sessionSettings.currencyMinimalUnit ?? 0.01;
    const stake = frc ? 0 : roundMoney(bet * mode.priceMultiplier, unit);
    let before = stores.balance.balance.get();
    // A cheap pre-check; the server's own 503 stays authoritative. The bar can be behind the wallet
    // (a deposit made in the lobby since the last read): read it before refusing the spin.
    if (!frc && before + 1e-9 < stake) {
      const fresh = await walletBalance(network);
      if (fresh !== null) {
        stores.balance.balance.set(fresh);
        before = fresh;
      }
    }
    if (!frc && before + 1e-9 < stake) {
      hud.showRgsError('ERR_IPB');
      await ctx.fsm.transition('idle');
      return;
    }

    stores.ui.spinning.set(true);
    hud.setWin(0);
    hud.setHudState('play');
    hud.spinBusy();
    if (stake > 0) stores.balance.balance.set(roundMoney(before - stake, unit));
    view?.onSpinStart?.();

    let res;
    try {
      res = await network.spin<P>({ gameMode: mode.id, betIndex });
    } catch (e) {
      const err = rgsErrorFrom(e, 'spin');
      view?.onSpinAbort?.();
      if (err.transport || err.errorId === RGS_ERRORS.TECHNICAL) {
        // Outcome unknown — the player may or may not have been charged. Do NOT retry. A server
        // error (500) is said out loud once the balance is the server's again; a lost connection
        // already has its own notice.
        await ctx.recover(
          `spin: ${err.message}`,
          err.transport
            ? undefined
            : { notice: { title: 'Something went wrong', message: 'The game server reported an error. Your balance has been reloaded from the server.' } },
        );
      } else {
        stores.balance.balance.set(before); // refused → the round never happened
        // Refused for funds: the bar showed more than the wallet holds. Show the wallet's.
        if (err.errorId === RGS_ERRORS.INSUFFICIENT_FUNDS) {
          const fresh = await walletBalance(network);
          if (fresh !== null) stores.balance.balance.set(fresh);
        }
        const policy = await presentRgsError(hud, err);
        if (policy.refresh) await ctx.recover('refresh after error');
      }
      if (ctx.fsm.current === 'spin') await ctx.fsm.transition('idle');
      return;
    }

    hud.spinStoppable();
    const info: RoundInfo = {
      roundId: res.roundId,
      mode: res.gameMode || mode.id,
      modeType: mode.type,
      bet: res.bet || bet,
      priceMultiplier: mode.priceMultiplier,
      stake,
      multiplier: res.spinResult.winMultiplier,
      totalWin: res.totalWin,
      maxWinReached: res.maxWinReached,
      freeRound: frc,
    };
    let data: T;
    try {
      data = ctx.interpretBook(res.spinResult.payload, info);
    } catch (e) {
      // The money is settled no matter what the payload says; show the result without the show.
      console.error('[artubeplate] interpretBook failed — settling without presentation', e);
      data = undefined as T;
    }
    ctx.round = { ...info, data, balance: res.balance, raw: res };
    if (res.freeRoundCampaign) stores.frc.campaign.set(res.freeRoundCampaign);
    // The server balance already contains the win; hold it back until the win is presented.
    stores.balance.balance.set(roundMoney(res.balance - res.totalWin, unit));
    await ctx.fsm.transition(data === undefined ? 'settle' : 'present');
  }
}

/** DEFAULT Present — nothing to animate. The game overrides `present` to play its scene. */
export class PresentPhase<T = unknown, V = unknown, P = unknown> implements Phase<T, V, P> {
  readonly name = 'present';
  async enter(ctx: PhaseContext<T, V, P>): Promise<void> {
    await ctx.fsm.transition('settle');
  }
}

/** What the next round costs the player, as the spin phase charges it: the bet times the price of
 *  the mode that is switched on (a boost), rounded to the currency's smallest unit, or nothing
 *  during operator free rounds. A bought feature is one round and never repeats. */
export function nextRoundPrice(stores: PhaseContext['stores']): number {
  if (stores.frc.active) return 0;
  const mode = stores.session.mode(stores.ui.activeMode.get() ?? stores.ui.baseMode);
  const unit = stores.session.current.get()?.sessionSettings.currencyMinimalUnit ?? 0.01;
  return roundMoney(stores.balance.bet.get() * (mode?.priceMultiplier ?? 1), unit);
}

/** Land the authoritative balance + win, cap notice, history, then Idle. */
export class SettlePhase<T = unknown, V = unknown, P = unknown> implements Phase<T, V, P> {
  readonly name = 'settle';
  private startedAt = 0;

  /** The boot calls this at the start of every round (for `minRoundMs`). */
  markStart(now: number): void {
    this.startedAt = now;
  }

  async enter(ctx: PhaseContext<T, V, P>): Promise<void> {
    const r = ctx.round;
    if (r) {
      ctx.stores.balance.balance.set(r.balance);
      ctx.stores.balance.lastWin.set(r.totalWin);
      ctx.hud.setWin(r.totalWin);
      ctx.hud.setHudState(r.totalWin > 0 ? 'winPresentation' : 'result');
      if (!r.replay) ctx.hud.reportRound(r.totalWin, r.stake);
      // A run that cannot pay its next round ends here and says why (Artube's checklist: autoplay
      // stops on a low balance with a message). The HUD ends a run by itself, with the
      // insufficient-funds message, once the balance falls under the bet; a boost's round costs
      // more than the bet, and a balance between the two is left to the core.
      if (!r.replay && ctx.hud.autoplay.active() && r.balance + 1e-9 < nextRoundPrice(ctx.stores)) {
        ctx.hud.autoplay.stop();
        ctx.hud.showRgsError('ERR_IPB');
      }
      const minMs = ctx.config.minRoundMs ?? 0;
      const elapsed = (ctx.ticker.now() - this.startedAt) * 1000;
      if (minMs > 0 && elapsed < minMs) await ctx.ticker.delay(minMs - elapsed);
      if (r.maxWinReached) {
        // Artube: after the normal win announcers, a BLOCKING modal naming the capped amount.
        await ctx.hud.notice({
          title: 'Maximum win reached',
          message: `You have reached the maximum win for this round. Your win has been capped at ${ctx.hud.format(r.totalWin)}.`,
          actions: [{ label: 'OK', primary: true }],
          blocking: true,
        });
      }
      if (!r.replay) await ctx.afterRound(r);
    }
    ctx.stores.ui.spinning.set(false);
    await ctx.fsm.transition('idle');
  }
}

export function defaultPhases<T = unknown, V = unknown, P = unknown>(): Phase<T, V, P>[] {
  return [new IdlePhase<T, V, P>(), new SpinPhase<T, V, P>(), new PresentPhase<T, V, P>(), new SettlePhase<T, V, P>()];
}
