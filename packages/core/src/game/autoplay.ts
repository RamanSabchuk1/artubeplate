// The player's autoplay. The HUD owns the run: how many rounds, the loss and single-win limits
// (it counts every settled round through `reportRound`), and the stop on the autoplay button. The
// core plays the rounds and ends the run where only it can see why:
//   - a round settles, a short gap (`autoplayGapMs`, shortened by turbo), the next one starts;
//   - "stop on any win" after a paying round, a notice that is up, a session that is over;
//   - a balance that cannot pay the next round, with the insufficient-funds message (the HUD
//     says it itself when the balance is under the bet; a boost's round costs more than that);
//   - "stop on special feature win" when the game marks its bonus's start
//     (`ctx.turbo.feature(true)`), so the bonus plays at its own pace and waits for the player.

import type { OpenUI } from '@open-slot-ui/core';
import { nextRoundPrice } from '../engine/phases';
import type { PhaseContext } from '../engine/fsm';
import type { TurboClock } from '../engine/turbo';

export interface AutoplayLoopOptions {
  /** The HUD's state: its autoplay run, the stop settings, the notice panel. */
  ui: OpenUI;
  turbo: TurboClock;
  stores: PhaseContext['stores'];
  /** Start a round; false when the game cannot start one now. */
  beginSpin: () => boolean;
  /** The round machine is between rounds. */
  idle: () => boolean;
  /** The session is over: no more rounds of any kind. */
  terminal: () => boolean;
  /** The round button is held down (hold to spin): rounds go on without a run. */
  holding: () => boolean;
  /** Tell the player the balance cannot pay the next round (the HUD's insufficient-funds message). */
  noFunds: () => void;
  /** The gap between two rounds, ms (turbo-scaled). Default 250. */
  gapMs?: number;
}

/** Play the player's autoplay runs. Returns the disposer. */
export function autoplayLoop(o: AutoplayLoopOptions): () => void {
  const { ui, turbo, stores } = o;
  const gapMs = o.gapMs ?? 250;
  let wasSpinning = false;
  const offs = [
    ui.on('autoplayStarted', () => {
      turbo.setAutoplay(true);
      o.beginSpin();
    }),
    ui.on('autoplayStopped', () => turbo.setAutoplay(o.holding())),
    // "Stop on special feature win": the bonus starts, the run ends, and the bonus waits for the player.
    turbo.onFeature((on) => {
      if (on && ui.autoplay.isActive && ui.stopOnFeature.isOn) ui.autoplay.stop();
    }),
    stores.ui.spinning.subscribe((spinning) => {
      const settled = wasSpinning && !spinning;
      wasSpinning = spinning;
      if (!settled) return;
      void turbo.delay(gapMs).then(() => {
        if (!o.idle() || !(ui.autoplay.isActive || o.holding())) return;
        if (ui.noticePanel.isOpen || o.terminal()) return ui.autoplay.stop();
        // "Stop on any win": a paying round ends the run here, before the next round.
        if (ui.autoplay.isActive && ui.stopOnAnyWin.isOn && stores.balance.lastWin.get() > 0) return ui.autoplay.stop();
        if (stores.balance.balance.get() + 1e-9 < nextRoundPrice(stores)) {
          const running = ui.autoplay.isActive;
          ui.autoplay.stop();
          // The HUD's own message (a balance under the bet) is up by now; never a second one.
          if (running && !ui.noticePanel.isOpen) o.noFunds();
          return;
        }
        o.beginSpin();
      });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
