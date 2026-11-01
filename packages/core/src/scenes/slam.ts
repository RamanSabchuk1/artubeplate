// The slam-stop of a reel set, with the one case a plain `skipSpin()` gets wrong.

/** What `slamReels` needs from a reel set; pixi-reels' ReelSet fits. */
export interface SlammableReels {
  readonly reels: ReadonlyArray<{ readonly speedNormalized: number }>;
  skipSpin(): void;
}

/** A frame ticker (pixi's `Ticker` fits). */
export interface FrameTicker {
  add(fn: () => void): unknown;
  remove(fn: () => void): unknown;
}

export interface SlamReelsOptions {
  /** Whether a spin is under way. Without one the slam is immediate. Default true. */
  spinning?: boolean;
  /** The longest the slam waits for the last reel to push off, ms. Default 500. */
  maxWaitMs?: number;
  /** The clock, ms (tests). Default `performance.now`. */
  now?: () => number;
}

/**
 * Slam-stop a reel set. The reels push off a beat apart, so a slam can come before the last one
 * has started, and a still reel told to stop jumps straight to its new symbols. Until every reel
 * moves (half a second at most) the slam waits on the ticker; then they all land at once.
 * `skipSpin` throwing (nothing was spinning) is swallowed.
 */
export function slamReels(reels: SlammableReels, ticker: FrameTicker, opts: SlamReelsOptions = {}): void {
  const slam = (): void => {
    try {
      reels.skipSpin();
    } catch {
      /* not spinning */
    }
  };
  const started = (): boolean => reels.reels.every((r) => r.speedNormalized > 0.05);
  if (opts.spinning === false || started()) {
    slam();
    return;
  }
  const now = opts.now ?? ((): number => performance.now());
  const until = now() + (opts.maxWaitMs ?? 500);
  const tick = (): void => {
    if (!started() && now() <= until) return;
    ticker.remove(tick);
    slam();
  };
  ticker.add(tick);
}
