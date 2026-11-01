// Slot math — pure-TS model. Shared by the generator (books + weights export)
// and, in shape, by the client's event replay. 5×4 board, 40 lines, wilds (reels 2–5, ×2/×3
// summing), paw scatter (pays + free spins), reel-1 full-cat-column respin, free spins with
// sticky wilds + retrigger, buy, lucky-bet ante. All money is in TOTAL-BET multiples; the book
// `payoutMultiplier` is `roundMultiplier × 100`. No third-party game/studio names anywhere.

export const REELS = 5;
export const ROWS = 4;
export const NUM_LINES = 40;
export const LINE_BET = 1 / NUM_LINES; // a line-bet is 1/40 of the total bet
export const WIN_CAP = 5000; // × total bet — the round ends immediately at the cap

// ── symbols ────────────────────────────────────────────────────────────────
export type Sym = 'H1' | 'H2' | 'H3' | 'H4' | 'M1' | 'M2' | 'A' | 'K' | 'Q' | 'J' | 'T' | 'W' | 'S';
export const CATS: Sym[] = ['H1', 'H2', 'H3', 'H4']; // respin-eligible high symbols
export const WILD: Sym = 'W';
export const SCAT: Sym = 'S';
const isWild = (s: Sym): boolean => s === WILD;

/** Paytable in × LINE-BET, by matching count (3/4/5). */
export const PAYTABLE: Record<Sym, Record<number, number>> = {
  H1: { 3: 60, 4: 200, 5: 800 },
  H2: { 3: 50, 4: 150, 5: 500 },
  H3: { 3: 30, 4: 80, 5: 300 },
  H4: { 3: 20, 4: 50, 5: 200 },
  M1: { 3: 14, 4: 30, 5: 150 },
  M2: { 3: 10, 4: 20, 5: 100 },
  A: { 3: 6, 4: 12, 5: 60 },
  K: { 3: 6, 4: 12, 5: 60 },
  Q: { 3: 4, 4: 10, 5: 40 },
  J: { 3: 4, 4: 10, 5: 40 },
  T: { 3: 4, 4: 10, 5: 40 },
  W: {},
  S: {},
};
const PAYING: Sym[] = ['H1', 'H2', 'H3', 'H4', 'M1', 'M2', 'A', 'K', 'Q', 'J', 'T'];
/** Scatter pays × TOTAL bet for 3/4/5 anywhere. */
export const SCATTER_PAY: Record<number, number> = { 3: 5, 4: 5, 5: 5 };
/** Scatter count → free-spins awarded. */
export const FS_AWARD: Record<number, number> = { 3: 8, 4: 12, 5: 16 };

// ── 40 paylines (row per reel, rows 0..3) ────────────────────────────────────
// 4 horizontals + a canonical zig/zag set over a 5×4 board.
export const LINES40: number[][] = [
  [0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3],
  [0, 1, 2, 1, 0], [1, 2, 3, 2, 1], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2],
  [0, 0, 1, 0, 0], [1, 1, 2, 1, 1], [2, 2, 3, 2, 2], [3, 3, 2, 3, 3],
  [0, 1, 0, 1, 0], [1, 2, 1, 2, 1], [2, 1, 2, 1, 2], [3, 2, 3, 2, 3],
  [0, 1, 1, 1, 0], [1, 2, 2, 2, 1], [2, 3, 3, 3, 2], [1, 0, 0, 0, 1],
  [2, 1, 1, 1, 2], [3, 2, 2, 2, 3], [0, 0, 1, 2, 3], [3, 3, 2, 1, 0],
  [0, 1, 2, 3, 3], [3, 2, 1, 0, 0], [1, 1, 0, 1, 1], [2, 2, 1, 2, 2],
  [1, 1, 2, 1, 1], [2, 2, 3, 2, 2], [0, 1, 2, 2, 3], [3, 2, 1, 1, 0],
  [0, 2, 0, 2, 0], [1, 3, 1, 3, 1], [0, 3, 0, 3, 0], [3, 0, 3, 0, 3],
  [0, 2, 3, 2, 0], [3, 1, 0, 1, 3], [1, 3, 3, 3, 1], [2, 0, 0, 0, 2],
];

// ── RNG (mulberry32, seedable → reproducible books) ──────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <X>(rng: () => number, a: readonly X[]): X => a[Math.floor(rng() * a.length)]!;
/** Round to 6 decimals — keeps float noise (0.15000000000000002) out of the books. */
export const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

// ── per-reel WEIGHTED distributions (NO strips) ──────────────────────────────
// Every board cell is sampled INDEPENDENTLY from its reel's weighted distribution. There are no
// strip runs, so no-win frames are varied (never a wall of identical full columns) and the shape
// is easy to balance. Low cards are COMMON (frequent SMALL wins → a healthy, non-tail-heavy RTP);
// cats are RARE. The generator pins the exact RTP afterwards; the WEIGHTS below set the SHAPE.
export interface ReelDist { syms: Sym[]; cum: number[]; total: number }
export type ReelDists = ReelDist[];
export type Weights = Partial<Record<Sym, number>>;

/** Build a cumulative-weight sampler for one reel. */
export function buildDist(w: Weights): ReelDist {
  const syms: Sym[] = []; const cum: number[] = []; let total = 0;
  for (const [s, weight] of Object.entries(w)) { const n = weight ?? 0; if (n <= 0) continue; total += n; syms.push(s as Sym); cum.push(total); }
  return { syms, cum, total };
}
/** Weighted-sample one symbol from a reel (binary search over the cumulative weights). */
export function sampleReel(d: ReelDist, rng: () => number): Sym {
  const r = rng() * d.total;
  let lo = 0, hi = d.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (d.cum[mid]! <= r) lo = mid + 1; else hi = mid; }
  return d.syms[lo]!;
}

// Common low-card weights shared by every reel: 10/J/Q frequent, A/K a notch less, mids rarer,
// cats rarest. Frequent low 3-of-a-kinds are what keep the RTP tail light (see the ETL check).
const LOW: Weights = { T: 32, J: 30, Q: 28, A: 22, K: 22, M2: 15, M1: 11, H4: 7, H3: 5, H2: 4, H1: 3 };
// Per-reel decoration: reel 0 carries the cats (the respin trigger) + a scatter and NO wild;
// reels 1-4 add the wild + scatter. A wild weight of `w` gives ~w/total wilds per cell.
const reelWeights = (reel: number, scatter: number, wild: number, catBoost = 1): Weights => {
  const w: Weights = { ...LOW };
  if (reel === 0) { w.H1 = 3 * catBoost; w.H2 = 4 * catBoost; w.H3 = 7 * catBoost; w.H4 = 10 * catBoost; w.S = scatter; }
  else { w.W = wild; w.S = scatter; }
  return w;
};

/** Base reels. Reel 0 is cat-heavy (respin), no wild; reels 1-4 carry the wild + a few scatters. */
export const BASE_DISTS: ReelDists = [0, 1, 2, 3, 4].map((r) => buildDist(reelWeights(r, r === 0 ? 3 : 5, 7)));
/** Lucky-bet ante: more scatters than base (more free-spins triggers) but tuned so its tail
 *  liability keeps a safe margin under the 0.80 cap; buyfs (100% free spins) owns the 5000x max. */
export const LUCKY_DISTS: ReelDists = [0, 1, 2, 3, 4].map((r) => buildDist(reelWeights(r, r === 0 ? 4 : 6, 7)));
/** Free-spins reels: richer cats + a tunable wild density (`fsWild`). Sticky wilds make these
 *  powerful, so the wild weight + the sticky cap are the RTP/tail knobs the calibrator sweeps. */
export function fsDists(fsWild: number): ReelDists {
  return [0, 1, 2, 3, 4].map((r) => buildDist(reelWeights(r, r === 0 ? 3 : 2, fsWild, 1.5)));
}

// ── board + evaluation ───────────────────────────────────────────────────────
export type Board = Sym[][]; // [reel][row]

/** Sample each cell INDEPENDENTLY from its reel's weighted distribution → varied boards. */
export function spinBoard(dists: ReelDists, rng: () => number): Board {
  return dists.map((d) => Array.from({ length: ROWS }, () => sampleReel(d, rng)));
}

export interface LineWin {
  line: number;
  symbol: Sym;
  count: number;
  win: number; // × total bet
  mult: number; // summed wild multiplier (≥1)
  positions: { reel: number; row: number }[];
}

/** A per-landed-wild multiplier map (reel,row → 2|3). Built at reveal. */
export type WildMults = Map<string, number>;
const key = (reel: number, row: number): string => `${reel},${row}`;

export function rollWildMults(board: Board, rng: () => number): WildMults {
  const m: WildMults = new Map();
  for (let reel = 0; reel < REELS; reel++)
    for (let row = 0; row < ROWS; row++) if (isWild(board[reel]![row]!)) m.set(key(reel, row), rng() < 0.5 ? 2 : 3);
  return m;
}

/** Evaluate all 40 lines with wild substitution; a line pays the best paying symbol it can
 *  form, its multiplier the SUM of wild mults on the winning reels (≥1). */
export function evaluateLines(board: Board, wilds: WildMults): LineWin[] {
  const wins: LineWin[] = [];
  LINES40.forEach((rowsPerReel, li) => {
    const cells = rowsPerReel.map((row, reel) => ({ reel, row, sym: board[reel]![row]! }));
    let best: LineWin | null = null;
    for (const s of PAYING) {
      let count = 0;
      for (const c of cells) {
        if (c.sym === s || isWild(c.sym)) count++;
        else break;
      }
      if (count < 3) continue;
      const pay = PAYTABLE[s][count];
      if (!pay) continue;
      const positions = cells.slice(0, count).map((c) => ({ reel: c.reel, row: c.row }));
      const mult = Math.max(1, positions.reduce((sum, p) => sum + (wilds.get(key(p.reel, p.row)) ?? 0), 0));
      const win = r6(pay * LINE_BET * mult); // × total bet (rounded: books carry clean decimals)
      if (!best || win > best.win) best = { line: li, symbol: s, count, win, mult, positions };
    }
    if (best) wins.push(best);
  });
  return wins;
}

export function scatterPositions(board: Board): { reel: number; row: number }[] {
  const out: { reel: number; row: number }[] = [];
  for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (board[reel]![row] === SCAT) out.push({ reel, row });
  return out;
}

/** Full column of a single cat on reel 0 → that cat (respin / retrigger trigger). */
export function fullCatColumn(board: Board): Sym | null {
  const col = board[0]!;
  const first = col[0]!;
  return CATS.includes(first) && col.every((s) => s === first) ? first : null;
}
