// The book → the view model. `interpretBook` is PURE: it folds the book's ordered event list
// (the payload the platform hands over untouched as `spinResult.payload`) into a structured round
// the Present phases walk: a base stage, its respins, an optional scatter pay, an optional
// free-spins round. It never computes money — the round's win is the platform's (`info.totalWin`).
//
// It reads the artubeplate book contract (docs/MATH_CONTRACT.md) and is TOLERANT of the common
// Stake-Engine math-sdk dialect too (`basegame`/`freegame`, `{ name }` board cells, padded
// boards, `totalFs`, `kind` for count), so math converted with `artubeplate math from-stake`
// usually plays unchanged. Unknown events are ignored.

import type { RoundInfo } from '@artubeplate/core';

export type Board = string[][]; // [reel][row]
export interface Cell {
  reel: number;
  row: number;
}
export interface WildPos extends Cell {
  mult: number;
}
export interface WinLine {
  line: number;
  symbol: string;
  count: number;
  /** × TOTAL bet. */
  win: number;
  mult: number;
  cells: Cell[];
}
export interface Stage {
  board: Board;
  wilds: WildPos[];
  wins: WinLine[];
}
export interface ScatterHit {
  count: number;
  win: number;
  cells: Cell[];
}
export interface FreeSpin extends Stage {
  /** Spins this spin added (a retrigger), 0 otherwise. */
  retrigger: number;
}
export interface FreeRound {
  totalSpins: number;
  spins: FreeSpin[];
}
export interface SpinModel {
  base: Stage;
  respins: Stage[];
  scatter: ScatterHit | null;
  free: FreeRound | null;
  /** The platform's credited win (after any cap) — for the big-win beat. */
  totalWin: number;
  /** × base bet. */
  multiplier: number;
}

/** The raw book line (loosely typed — the payload is the math's own contract). */
export type Book = { events?: unknown[]; state?: unknown[] } | unknown[];

type Ev = Record<string, unknown> & { type?: string };
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** A board cell may be `"H1"` or `{ name: "H1", … }` (math-sdk). */
const cellId = (c: unknown): string => (typeof c === 'string' ? c : c && typeof c === 'object' && 'name' in c ? String((c as { name: unknown }).name) : String(c));

/** Normalize a board to [reel][row] ids, dropping math-sdk padding rows when present. */
export function normalizeBoard(raw: unknown, rows: number): Board {
  if (!Array.isArray(raw)) return [];
  return raw.map((col) => {
    const ids = Array.isArray(col) ? col.map(cellId) : [];
    return ids.length === rows + 2 ? ids.slice(1, rows + 1) : ids.slice(0, rows);
  });
}

const cells = (raw: unknown): Cell[] =>
  Array.isArray(raw) ? raw.filter((p) => p && typeof p === 'object').map((p) => ({ reel: num((p as Ev).reel), row: num((p as Ev).row) })) : [];

function toWins(raw: unknown): WinLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Ev => !!w && typeof w === 'object')
    .map((w) => {
      const meta = (w.meta && typeof w.meta === 'object' ? w.meta : {}) as Ev;
      return {
        line: num(w.line ?? meta.lineIndex, -1),
        symbol: String(w.symbol ?? ''),
        count: num(w.count ?? w.kind),
        win: num(w.win),
        mult: num(w.mult ?? meta.multiplier ?? meta.globalMult, 1),
        cells: cells(w.positions),
      };
    });
}

/** 1 when the book's wins are already × bet; 0.01 when they are × 100 (math-sdk). */
export function unitScale(rawTotal: number, multiplier: number): number {
  if (!(rawTotal > 0) || !(multiplier > 0)) return 1;
  return rawTotal / multiplier > 20 ? 0.01 : 1;
}

export function interpretBook(payload: unknown, info: RoundInfo, rows: number): SpinModel {
  const book = payload as Book;
  const events = (Array.isArray(book) ? book : Array.isArray(book?.events) ? book.events : Array.isArray(book?.state) ? book.state : []) as Ev[];
  const base: Stage = { board: [], wilds: [], wins: [] };
  const respins: Stage[] = [];
  let scatter = null as ScatterHit | null;
  let free = null as FreeRound | null;
  let current: Stage | null = base;

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    switch (ev.type) {
      case 'reveal': {
        const stage: Stage = { board: normalizeBoard(ev.board, rows), wilds: [], wins: [] };
        stage.wilds = Array.isArray(ev.wilds) ? ev.wilds.map((w) => ({ ...cells([w])[0]!, mult: num((w as Ev).mult, 1) })) : [];
        const gt = String(ev.gameType ?? 'base').toLowerCase();
        if (gt === 'respin') {
          respins.push(stage);
          current = stage;
        } else if (gt.startsWith('free')) {
          const spin: FreeSpin = { ...stage, retrigger: 0 };
          (free ??= { totalSpins: 0, spins: [] }).spins.push(spin);
          current = spin;
        } else {
          Object.assign(base, stage);
          current = base;
        }
        break;
      }
      case 'winInfo':
        if (current) current.wins = toWins(ev.wins);
        break;
      case 'scatterWin':
        scatter = { count: num(ev.count), win: num(ev.win), cells: cells(ev.positions) };
        break;
      case 'featureStart':
        free = { totalSpins: num(ev.totalSpins ?? ev.totalFs), spins: free?.spins ?? [] };
        break;
      case 'freeSpinTrigger': {
        if (!free) {
          // math-sdk dialect: the trigger STARTS the feature (its positions are the scatters).
          free = { totalSpins: num(ev.totalFs ?? ev.total ?? ev.add), spins: [] };
          if (!scatter && Array.isArray(ev.positions)) scatter = { count: ev.positions.length, win: 0, cells: cells(ev.positions) };
        } else {
          // A retrigger: attributed to the spin that awarded it (its beat plays after that spin).
          const awarded = free.totalSpins + free.spins.reduce((s, x) => s + x.retrigger, 0);
          const add = num(ev.add, Math.max(0, num(ev.totalFs ?? ev.total) - awarded));
          const spins = free.spins;
          if (spins.length) spins[spins.length - 1]!.retrigger += add;
        }
        break;
      }
      default:
        break; // updateFreeSpin / freeSpinEnd / finalWin / setWin …: the reveals + the platform's win cover these
    }
  }
  // Win UNITS: artubeplate books state wins as × total bet; the Stake math-sdk writes them × 100.
  // The platform's own multiplier says which: scale the book's wins so they add up to it.
  const stages: Stage[] = [base, ...respins, ...(free?.spins ?? [])];
  const rawTotal = stages.reduce((s, st) => s + st.wins.reduce((a, w) => a + w.win, 0), 0) + (scatter?.win ?? 0);
  const k = unitScale(rawTotal, info.multiplier);
  if (k !== 1) {
    for (const st of stages) for (const w of st.wins) w.win *= k;
    if (scatter) scatter.win *= k;
  }
  // A book whose feature ran longer than its stated award (a cap, a dialect we don't read) still
  // plays every spin it contains.
  if (free) {
    const awarded = free.totalSpins + free.spins.reduce((s, x) => s + x.retrigger, 0);
    if (awarded < free.spins.length) free.totalSpins += free.spins.length - awarded;
  }
  return { base, respins, scatter, free, totalWin: info.totalWin, multiplier: info.multiplier };
}
