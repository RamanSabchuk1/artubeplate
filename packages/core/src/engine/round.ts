// The round model the engine drives. MONEY comes from the RGS (`RoundResponse`) and nothing
// else; the game's `interpretBook` only turns the opaque book payload into its own model
// (`data`) — the one place a game touches a round.

import type { RoundResponse } from '../rgs/protocol';

/** Money + mode facts of a settled round (MAJOR units). */
export interface RoundInfo {
  roundId: string;
  /** The `gameMode` id played. */
  mode: string;
  modeType: 'None' | 'LuckyBet' | 'BuyFeature';
  /** Base bet (the round's `bet`). */
  bet: number;
  /** How many base bets the mode costs. */
  priceMultiplier: number;
  /** What the player paid: `bet × priceMultiplier`, or 0 in a free round. */
  stake: number;
  /** `spinResult.winMultiplier` — the win as × base bet (before any platform cap). */
  multiplier: number;
  /** The win the platform CREDITED (after the max-win cap). Show this, never your own maths. */
  totalWin: number;
  /** The platform max-win cap cut this round's win. */
  maxWinReached: boolean;
  /** Played inside an operator free-rounds campaign. */
  freeRound: boolean;
}

/** A resolved round: money facts + the game's parsed model + the raw response. */
export interface GameRound<T = unknown, P = unknown> extends RoundInfo {
  /** The game's model, from `interpretBook` — what the Present phase animates. */
  data: T;
  /** Authoritative balance after the round (the win is already in it). */
  balance: number;
  raw: RoundResponse<P>;
  /** A REPLAY of an already-settled round (restored after a reload/reconnect): Present plays it,
   *  Settle shows it — but it is never reported to net position, history or autoplay again. */
  replay?: boolean;
}

/** The game's one seam into a round: the book payload (typed `P`) → its own model. Pure. */
export type InterpretBook<T, P = unknown> = (payload: P, info: RoundInfo) => T;

/** Round money to the currency's minimal unit (float-noise safe). */
export function roundMoney(x: number, unit = 0.01): number {
  const decimals = Math.max(0, Math.round(-Math.log10(unit)));
  return Number((Math.round(x / unit) * unit).toFixed(decimals));
}
