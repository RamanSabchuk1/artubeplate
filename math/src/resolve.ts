// Round resolution — composes the base spin, the reel-0 respin, the scatter pay, and the
// free-spins feature (sticky wilds + retrigger) into one ordered `events[]` book that the
// client replays, plus the capped `payoutMultiplier` (× total bet × 100). Modes: base, buyfs
// (buy free spins, 100×), luckybet (ante). All wins are in × total bet.

import {
  BASE_DISTS, LUCKY_DISTS, fsDists, sampleReel, WIN_CAP, ROWS, REELS, WILD, SCAT, FS_AWARD, SCATTER_PAY,
  spinBoard, rollWildMults, evaluateLines, scatterPositions, fullCatColumn, r6,
  type Board, type ReelDists, type WildMults, type LineWin,
} from './game';

export type Mode = 'base' | 'buyfs' | 'luckybet';
/** RTP/tail knobs (free-spins wild density + sticky-wild cap). Bigger = bigger free-spins wins =
 *  a fatter tail (higher max win + ETL). The base game stays light (frequent small wins), so the
 *  ETL has lots of headroom; the excitement/max-win comes from stacking sticky wilds in free spins. */
export interface Tune { fsWild: number; stickyCap: number }
export const DEFAULT_TUNE: Tune = { fsWild: 9, stickyCap: 10 };
export interface RoundResult { events: Ev[]; payoutMultiplier: number; win: number } // win × total bet
export type Ev = Record<string, unknown> & { index: number; type: string };

const distsFor = (mode: Mode): ReelDists => (mode === 'luckybet' ? LUCKY_DISTS : BASE_DISTS);
const wildList = (w: WildMults): { reel: number; row: number; mult: number }[] =>
  [...w.entries()].map(([k, mult]) => { const [reel, row] = k.split(',').map(Number); return { reel: reel!, row: row!, mult }; });
const clone = (b: Board): Board => b.map((r) => [...r]);

/** Place 3/4/5 scatters at random positions (buy trigger) on a base board. */
function forceScatters(board: Board, count: number, rng: () => number): void {
  const cells: [number, number][] = [];
  for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) cells.push([reel, row]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cells[i], cells[j]] = [cells[j]!, cells[i]!]; }
  for (let i = 0; i < count; i++) { const [reel, row] = cells[i]!; board[reel]![row] = SCAT; }
}

export function resolveRound(mode: Mode, rng: () => number, tune: Tune = DEFAULT_TUNE): RoundResult {
  const events: Ev[] = [];
  let idx = 0;
  const push = (type: string, extra: Record<string, unknown> = {}): void => { events.push({ index: idx++, type, ...extra }); };
  let win = 0; // running total, × total bet

  const reveal = (board: Board, wilds: WildMults, gameType: 'base' | 'free'): void =>
    push('reveal', { board, wilds: wildList(wilds), gameType });
  const winInfo = (wins: LineWin[]): number => {
    const total = wins.reduce((s, w) => s + w.win, 0);
    if (wins.length) push('winInfo', { totalWin: r6(total), wins });
    return total;
  };

  // ── base spin ──────────────────────────────────────────────────────────────
  const dists = distsFor(mode);
  const board = spinBoard(dists, rng);
  if (mode === 'buyfs') forceScatters(board, [3, 4, 5][Math.floor(rng() * 3)]!, rng);
  const wilds = rollWildMults(board, rng);
  reveal(board, wilds, 'base');
  win += winInfo(evaluateLines(board, wilds));

  // ── respin (reel-0 full-cat column keeps that cat + wilds; redraw rest) ──────
  const cat = fullCatColumn(board);
  const scats0 = scatterPositions(board);
  if (cat && scats0.length < 3) {
    for (let r = 0; r < 3; r++) { // up to 3 respins, stop on a cat win
      const b = clone(board);
      for (let reel = 1; reel < REELS; reel++) for (let row = 0; row < ROWS; row++)
        if (!(wilds.has(`${reel},${row}`))) b[reel]![row] = sampleReel(dists[reel]!, rng);
      const rw = rollWildMults(b, rng);
      for (const [k, m] of wilds) rw.set(k, m); // keep base wilds sticky through the respin
      push('reveal', { board: b, wilds: wildList(rw), gameType: 'respin' });
      const wins = evaluateLines(b, rw);
      win += winInfo(wins);
      if (wins.some((w) => w.symbol === cat)) break;
    }
  }

  // ── scatter pay + free-spins trigger ────────────────────────────────────────
  const scats = scatterPositions(board);
  if (scats.length >= 3) {
    const count = Math.min(5, scats.length);
    win += SCATTER_PAY[count]!;
    push('scatterWin', { count, win: SCATTER_PAY[count], positions: scats.slice(0, count) });
    win += runFreeSpins(FS_AWARD[count]!, tune, push, rng, (n) => win + n <= WIN_CAP);
  }

  win = Math.min(win, WIN_CAP);
  win = r6(win);
  push('finalWin', { amount: win });
  return { events, payoutMultiplier: Math.round(win * 100), win };
}

/** Free-spins feature: sticky wilds accumulate across spins; a full cat column on reel 0
 *  retriggers (+2). Returns the feature win (× total bet). */
function runFreeSpins(
  award: number,
  tune: Tune,
  push: (type: string, extra?: Record<string, unknown>) => void,
  rng: () => number,
  underCap: (n: number) => boolean,
): number {
  const MAX_FS = 60; // hard bound so retriggers can't run away
  const dists = fsDists(tune.fsWild);
  const sticky: WildMults = new Map(); // reel,row → mult, persists all round
  let total = 0;
  let remaining = award;
  let done = 0;
  push('featureStart', { totalSpins: award });
  while (remaining > 0 && done < MAX_FS) {
    remaining--; done++;
    push('updateFreeSpin', { current: done, total: award });
    const b = spinBoard(dists, rng);
    // apply sticky wilds from prior spins
    for (const [k] of sticky) { const [reel = 0, row = 0] = k.split(',').map(Number); b[reel]![row] = WILD; }
    const STICKY_CAP = tune.stickyCap;
    const fresh = rollWildMults(b, rng);
    for (const [k, m] of fresh) if (Number(k.split(',')[0]) >= 1 && !sticky.has(k) && sticky.size < STICKY_CAP) sticky.set(k, m); // wilds reels 2–5 stick (capped)
    for (const [k, m] of sticky) fresh.set(k, m);
    // `reveal.wilds` carries the merged sticky+fresh wilds (reel,row,mult) — the client reads
    // sticky positions from there, so no separate stickyWilds/setTotalWin events (size).
    push('reveal', { board: b, wilds: [...fresh.entries()].map(([k, mult]) => { const [reel, row] = k.split(',').map(Number); return { reel: reel!, row: row!, mult }; }), gameType: 'free' });
    const wins = evaluateLines(b, fresh);
    const w = wins.reduce((s, x) => s + x.win, 0);
    if (wins.length) push('winInfo', { totalWin: r6(w), wins });
    total += w;
    if (fullCatColumn(b) && award < MAX_FS) { award += 2; remaining += 2; push('freeSpinTrigger', { add: 2, total: award }); }
    if (!underCap(total)) break; // cap reached — stop the feature
  }
  push('freeSpinEnd', { total });
  return total;
}
