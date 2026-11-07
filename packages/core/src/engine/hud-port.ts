// The slice of the HUD the ENGINE drives. A structural interface, so the round FSM runs headless
// in a unit test (see `mockHud()` in /testing); `createArtubeGame` adapts the real open-slot-ui
// DOM HUD onto it.

/** The HUD state machine (open-slot-ui `HudState`) — the bar lays itself out from it. */
export type HudStateName = 'idle' | 'play' | 'result' | 'winPresentation' | 'autoplay' | 'autoplayEnd' | 'featureEnter' | 'featurePlay' | 'featureExit' | 'hidden';

export interface NoticeRequest {
  title?: string;
  message: string;
  /** Buttons, left to right. Default: a single OK. */
  actions?: Array<{ label: string; primary?: boolean }>;
  /** Blocking: locks the HUD; no backdrop/✕ dismiss. */
  blocking?: boolean;
}

export interface HudPort {
  setBalance(major: number): void;
  /** The bar's WIN readout (counts up). */
  setWin(major: number): void;
  /** The in-feature TOTAL WIN. */
  setTotalWin(major: number): void;
  /** The in-feature free-spins counter (0 = none). */
  setFreeSpins(n: number): void;
  /** Operator free rounds left (0 hides the counter). */
  setFreeRounds(n: number): void;
  setHudState(state: HudStateName): void;
  /** Round button: pressed, waiting for the server (dim, no slam yet). */
  spinBusy(): void;
  /** Round button: the result is in — a press now slam-stops. */
  spinStoppable(): void;
  spinIdle(): void;
  /** One settled round → net position + autoplay limits. `stake` is what the player paid. */
  reportRound(win: number, stake: number): void;
  /**
   * The player's autoplay: whether a run is going, what the player chose to stop it on, and a
   * stop. The core ends a run by itself on every setting: "stop on feature" when the game marks
   * its bonus's start (`ctx.turbo.feature(true)`), "stop on any win" after a paying round, and a
   * run that cannot pay its next round, with the insufficient-funds message.
   */
  autoplay: { active(): boolean; stopOnFeature(): boolean; stopOnAnyWin(): boolean; stop(): void };
  /** The HUD's localized message for an RGS-style code (`ERR_IPB`, …). */
  showRgsError(code: string, opts?: { message?: string; title?: string; blocking?: boolean }): void;
  /** Show a notice; resolves with the index of the pressed action (−1 if dismissed). */
  notice(req: NoticeRequest): Promise<number>;
  hideNotice(): void;
  /** Format money in the session currency, at its minimal unit, rounded down: a win on the canvas
   *  never reads more than it is (1986.5 KRW reads ₩1,986). */
  format(major: number): string;
  lock(): void;
  unlock(): void;
}
