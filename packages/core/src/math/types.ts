// The Artube maths artifact — the studio's half of the RGS contract, as types + limits.
//
// An artifact is a FLAT folder: one uncompressed `index.json` manifest plus, per game mode, a
// weights table (`id,weight,multiplier`, zstd-compressed CSV) and a books file (one JSON payload
// per line, zstd-compressed JSONL). Row N of the weights describes the outcome stored on line N
// of the books. The platform draws a row by `weight` with its own RNG, pays `multiplier`
// credits, and hands the book line to the client untouched as `spinResult.payload`.
//
// Source of truth: https://docs-review.artube-888.live/en/backend/rgs/preparing-math/

/** Every documented limit, in one place (the Hub rejects a set that breaks any of them). */
export const LIMITS = Object.freeze({
  /** `index.json`, uncompressed. */
  manifestBytes: 4 * 1024 * 1024,
  modesMin: 1,
  modesMax: 50,
  modeNameMax: 32,
  fileNameMax: 255,
  /** One weights row, `id,weight,multiplier`. */
  weightsLineBytes: 128,
  /** One book line (one JSON object/array). */
  bookLineBytes: 96 * 1024,
  jsonDepth: 64,
  /** Distinct `multiplier` values per mode's table. */
  distinctMultipliers: 10_000,
  totalCompressedBytes: 10 * 1024 ** 3,
  totalUncompressedBytes: 50 * 1024 ** 3,
  /** Declared vs computed RTP, percentage points (both rounded to 2 dp first). */
  rtpTolerance: 0.5,
});

/** A mode's type in the MANIFEST. The client receives `Purchase` as `BuyFeature`. */
export type ManifestModeType = 'None' | 'LuckyBet' | 'Purchase';
export const MANIFEST_MODE_TYPES: readonly ManifestModeType[] = Object.freeze(['None', 'LuckyBet', 'Purchase']);

export type Volatility = 'Very High' | 'High' | 'Medium' | 'Low' | 'Very Low';
export const VOLATILITIES: readonly Volatility[] = Object.freeze(['Very High', 'High', 'Medium', 'Low', 'Very Low']);

/** `settings.gameModes[i]` — the game model of one mode. */
export interface ManifestGameMode {
  /** `[A-Za-z0-9_]{1,32}`, unique. This is the id the client sends in `spin`. */
  name: string;
  /** Mode price in credits, integer ≥ 1. `priceMultiplier = cost / betCredit`. */
  cost: number;
  /** Default `None`. Case-sensitive. */
  type?: ManifestModeType;
  /** Declared RTP percent, 0 < rtp < 100. Verified against the weights (±0.50 pp). */
  rtp: number;
  volatility?: Volatility;
}

/** `modes[i]` — which files belong to a mode (1:1 with `gameModes` by name). */
export interface ManifestMode {
  name: string;
  /** Books file (`.jsonl.zst`). */
  events: string;
  /** Weights file (`.csv.zst`). */
  weights: string;
}

export interface ArtubeManifest {
  settings: {
    /** Credits per base bet (integer ≥ 1). 100 → payout steps of 0.01 × bet. */
    betCredit: number;
    gameModes: ManifestGameMode[];
    /** The game's own settings — opaque to the platform, delivered to the client as
     *  `gameSettings.config`. artubeplate's template reads its board/paytable from here. */
    config?: unknown;
  };
  modes: ManifestMode[];
}

/** One finding. `error` = the Hub would reject the set; `warn` = legal but suspicious. */
export interface Issue {
  level: 'error' | 'warn';
  code: string;
  message: string;
  mode?: string;
  file?: string;
  /** 1-based line number inside the (decompressed) file. */
  line?: number;
}

/** Per-mode verdict + the numbers a math review wants. */
export interface ModeReport {
  name: string;
  type: ManifestModeType;
  cost: number;
  priceMultiplier: number;
  declaredRtp: number;
  /** RTP computed from the weights exactly (the Hub's formula), rounded to 2 dp. */
  actualRtp: number;
  /** Unrounded RTP percent (for display with more precision). */
  actualRtpExact: number;
  passed: boolean;
  rows: number;
  distinctMultipliers: number;
  /** Share of total weight that pays > 0. */
  hitRate: number;
  /** Biggest multiplier, in CREDITS, and as × base bet. */
  maxMultiplier: number;
  maxWinX: number;
  /** Probability of the max multiplier (0..1). */
  maxWinProbability: number;
  /** Std-dev of the payout per unit of mode cost (a volatility proxy). */
  stdDev: number;
  /** P(win ≥ k × base bet) for a few thresholds. */
  tail: Array<{ x: number; probability: number }>;
  booksBytes: number;
  weightsBytes: number;
}

export interface ValidationReport {
  ok: boolean;
  manifest?: ArtubeManifest;
  modes: ModeReport[];
  issues: Issue[];
}
