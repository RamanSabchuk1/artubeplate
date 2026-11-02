// Turbo speed + slam-stop, owned by the core. The HUD's turbo control (a 2- or 3-mode cycler)
// drives a speed multiplier; the game's Present phase awaits `ctx.turbo.delay(ms)` for its
// spin/anim durations, so turbo shortens them and a slam-stop (`skipRequested`) resolves them
// instantly — with ZERO game logic. Compliance waits (minimumRoundDuration) use `ctx.ticker`,
// NOT this, so they're never sped up or skipped.

/** Delay multipliers per turbo level: off (1×) / turbo (0.4×) / super (0.12×). */
export const DEFAULT_TURBO_SPEEDS = [1, 0.4, 0.12];

export interface TurboState {
  /** 0 = off, 1 = turbo, 2 = super — the HUD turbo cycler's index. */
  readonly level: number;
  /** The EFFECTIVE delay multiplier right now — the turbo level, floored by the autoplay
   *  speed while autoplay is running (`ctx.turbo.delay` already applies it). */
  readonly speed: number;
  /** True while rounds start by themselves: the player's autoplay/hold, or an operator's free
   *  rounds. A game's screens should continue by themselves then (`autoContinueMs`). Only the
   *  player's autoplay also shortens animations (see `speed`). */
  readonly autoplay: boolean;
  /** True once the player slam-stopped this round (delays resolve instantly). */
  readonly skipped: boolean;
  /** A turbo- + autoplay- + slam-stop-aware delay for GAME animations. NOT for compliance waits. */
  delay(ms: number): Promise<void>;
  /**
   * `delay(ms)` with a floor of real time: shortened by turbo, autoplay and a slam like any
   * delay, but never under `floorMs` of wall-clock time. For what must be read at any pace: a
   * word on screen, a summed win box. NOT for compliance waits (those use `ctx.ticker`).
   */
  beat(ms: number, floorMs: number): Promise<void>;
  /**
   * The game is in its bonus (true) or back in the base game (false). While it is, the HUD's
   * BONUS GAME turbo scope sets `level` and `speed`, and autoplay never shortens the pace: the
   * player set the bonus's speed on its own switch. Crossing that line clears a slam: a slam
   * of the spin that triggered the bonus never plays the bonus at slam speed.
   */
  feature(active: boolean): void;
  /**
   * A new spin starts inside the round: a free spin, a respin. A speed the player chose during
   * the last one takes effect here, so the current spin finishes at the pace it started with and
   * the next ones use the new one (Artube TRC "Speed Mode Toggle During Spin", in a bonus too).
   * Call it at the start of every bonus spin; the bonus edges (`feature`) count as one.
   */
  spin(): void;
}

export type TurboScope = 'base' | 'bonus';

export class TurboClock implements TurboState {
  private readonly speeds: number[];
  /** Delay multiplier applied while autoplay/hold runs (the floor for `speed`). Defaults to
   *  the turbo (level-1) speed, so autoplay plays at least at turbo pace even at turbo off. */
  private readonly autoplaySpeed: number;
  /** The level per scope: the HUD's BASE GAME and BONUS GAME rows under each turbo switch. */
  private readonly levels: Record<TurboScope, number> = { base: 0, bonus: 0 };
  private _feature = false;
  private _autoplay = false;
  /** An operator's free-rounds campaign is playing itself. */
  private _freeRounds = false;
  private _skipped = false;
  /** While a round runs its pace is held: a level change waits here for the next round. */
  private _hold = false;
  private readonly _next: Partial<Record<TurboScope, number>> = {};
  private readonly pending = new Set<() => void>();
  private readonly featureListeners = new Set<(active: boolean) => void>();

  constructor(speeds?: number[], autoplaySpeed?: number) {
    this.speeds = speeds && speeds.length ? speeds : DEFAULT_TURBO_SPEEDS;
    this.autoplaySpeed = autoplaySpeed ?? this.speeds[1] ?? 0.5;
  }

  get level(): number {
    return this.levels[this._feature ? 'bonus' : 'base'];
  }
  get speed(): number {
    const levelSpeed = this.speeds[this.level] ?? this.speeds[this.speeds.length - 1] ?? 1;
    // In the bonus the pace is the bonus switch's alone. In the base game autoplay shortens
    // animations even at turbo off — but never SLOWS a faster turbo level.
    if (this._feature) return levelSpeed;
    return this._autoplay ? Math.min(levelSpeed, this.autoplaySpeed) : levelSpeed;
  }
  get autoplay(): boolean {
    return this._autoplay || this._freeRounds;
  }
  get skipped(): boolean {
    return this._skipped;
  }
  /** The game said it is in its bonus (`feature(true)`): the core ignores slams there unless
   *  the game allows skipping a bonus. */
  get inFeature(): boolean {
    return this._feature;
  }

  /** Set the turbo level (clamped to the configured speeds). While the pace is held (a round is
   *  running) the change waits for `hold(false)`: a round finishes at the speed it started with. */
  setLevel(index: number, scope: TurboScope = 'base'): void {
    const i = Number.isFinite(index) ? Math.trunc(index) : 0;
    const level = Math.max(0, Math.min(i, this.speeds.length - 1));
    if (this._hold) this._next[scope] = level;
    else this.levels[scope] = level;
  }

  /** Hold the pace for the round that is running (true), or let a waiting change in (false). */
  hold(on: boolean): void {
    this._hold = on;
    if (!on) this.applyWaiting();
  }

  /** A spin boundary inside the round (a free spin, a respin): a waiting change comes in, and
   *  the pace stays held for the rest of the round. */
  spin(): void {
    this.applyWaiting();
  }

  private applyWaiting(): void {
    for (const scope of ['base', 'bonus'] as const) {
      const next = this._next[scope];
      if (next !== undefined) this.levels[scope] = next;
      delete this._next[scope];
    }
  }

  feature(active: boolean): void {
    const edge = active !== this._feature;
    // A slam belongs to the part of the round it was pressed in. Without this, slamming the reels
    // of the spin that lands the bonus left `skipped` set for the whole round, and every delay
    // and animation of the bonus ran at slam speed with turbo off.
    if (edge) {
      this._skipped = false;
      // Crossing into (or out of) the bonus starts a new spin: a speed chosen on the way counts.
      this.applyWaiting();
    }
    this._feature = active;
    if (edge) for (const fn of [...this.featureListeners]) fn(active);
  }

  /** Hear the bonus's edges (`feature(true)` and `feature(false)`, once each): the core ends the
   *  player's autoplay at a bonus when they asked it to stop on a feature. Returns the unsubscribe. */
  onFeature(fn: (active: boolean) => void): () => void {
    this.featureListeners.add(fn);
    return () => void this.featureListeners.delete(fn);
  }

  /** Mark autoplay/hold as running so `delay()` shortens game animations. The core sets
   *  this on autoplayStarted/holdSpinStarted and clears it when they stop. */
  setAutoplay(active: boolean): void {
    this._autoplay = active;
  }

  /** Operator free rounds play themselves: they count as autoplay for the game's screens (a
   *  bonus inside one continues by itself), but the pace stays the player's — turbo is theirs
   *  to choose during a campaign (Artube TRC "FRC Turbo Mode"). */
  setFreeRounds(active: boolean): void {
    this._freeRounds = active;
  }

  /** Slam-stop: resolve every in-flight delay + make the rest of the round instant. */
  skip(): void {
    this._skipped = true;
    const cbs = [...this.pending];
    this.pending.clear();
    for (const cb of cbs) cb();
  }

  /** Clear the slam-stop flag — the core calls this at the start of each spin. */
  resetSkip(): void {
    this._skipped = false;
  }

  beat(ms: number, floorMs: number): Promise<void> {
    return Promise.all([this.delay(ms), new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, floorMs)))]).then(() => undefined);
  }

  delay(ms: number): Promise<void> {
    if (this._skipped || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms * this.speed);
      this.pending.add(finish);
    });
  }
}
