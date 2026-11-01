// Base observable state, on open-slot-ui's zero-dependency `Signal` (the HUD already ships it, so
// the core adds no state library). Game-agnostic: a game keeps its own stores next to these.
// All money is MAJOR units of the session currency.

import { Signal } from '@open-slot-ui/core';
import type { FreeRoundCampaign, GameModeInfo, SessionResponse } from '../rgs/protocol';

/** Player funds + the stake. */
export class BalanceStore {
  /** What the bar shows. Authoritative after every round (the server's figure). */
  readonly balance = new Signal(0);
  /** Base bet — `allowedBets[betIndex]`. */
  readonly bet = new Signal(0);
  /** Position in `allowedBets` — what `spin` actually sends. */
  readonly betIndex = new Signal(0);
  readonly lastWin = new Signal(0);
}

/** Session facts from `session` — replaced wholesale after every reconnect. */
export class SessionStore {
  readonly current = new Signal<SessionResponse | null>(null);

  get value(): SessionResponse {
    const s = this.current.get();
    if (!s) throw new Error('[artubeplate] no session yet');
    return s;
  }
  get demo(): boolean {
    return this.current.get()?.sessionSettings.currency === null;
  }
  get allowedBets(): number[] {
    return this.current.get()?.sessionSettings.allowedBets ?? [];
  }
  get betCredit(): number {
    return this.current.get()?.gameSettings.betCredit ?? 100;
  }
  /** Modes are an ARRAY on the wire — always look them up by id. */
  mode(id: string): GameModeInfo | undefined {
    return this.current.get()?.gameSettings.gameModes.find((m) => m.id === id);
  }
  get modes(): GameModeInfo[] {
    return this.current.get()?.gameSettings.gameModes ?? [];
  }
}

/** Round/UI state. */
export class UiStore {
  readonly spinning = new Signal(false);
  /** A one-shot mode for the next spin (a bought feature) — wins over `activeMode`. */
  readonly oneShotMode = new Signal<string | null>(null);
  /** The persistent active mode (a LuckyBet ante). */
  readonly activeMode = new Signal<string | null>(null);
  /** The base mode id — the first `None` mode (`base` in the manifest convention). */
  baseMode = 'base';

  /** The mode for the next spin: one-shot, then the active ante, then the base mode. */
  nextMode(): string {
    const m = this.oneShotMode.get() ?? this.activeMode.get() ?? this.baseMode;
    this.oneShotMode.set(null);
    return m;
  }
}

/** An operator free-rounds campaign. `activated` is per CONNECTION (lost on reconnect). */
export class FreeRoundsStore {
  readonly campaign = new Signal<FreeRoundCampaign | null>(null);
  readonly activated = new Signal(false);

  /** Spinning free rounds right now: activated, not complete, rounds left. */
  get active(): boolean {
    const c = this.campaign.get();
    return this.activated.get() && !!c && !c.isComplete && c.roundsLeft > 0;
  }
}

export class RootStore {
  readonly balance = new BalanceStore();
  readonly session = new SessionStore();
  readonly ui = new UiStore();
  readonly frc = new FreeRoundsStore();
}
