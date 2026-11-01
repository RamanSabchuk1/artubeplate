// Infer a starter client config (`settings.config`, schema artubeplate/slot@1) from the BOOKS —
// for math that arrives without one (a Stake math-sdk export, a hand-made set). The books'
// `reveal` events say how big the board is and which symbol ids exist; naming conventions
// (H*/M*/L*, W, S, card ranks) give each a kind and a placeholder look. The paytable cannot be
// read from outcomes, so it is left out — the game plays, the rules just have no pay table
// until someone adds it.

import type { SlotConfig, SlotSymbol, SymbolKind } from '../rules/index';

export interface InferredConfig {
  config: SlotConfig;
  /** How many book lines were read. */
  scanned: number;
  notes: string[];
}

const PALETTE: Record<SymbolKind, string[]> = {
  high: ['#c79a2e', '#9c6b2e', '#2f8f4e', '#6c40c9', '#b23a48', '#2b7bb9'],
  mid: ['#1f6f9f', '#55617a', '#7a5a9e', '#3d8a7a'],
  low: ['#2e7d32', '#c2185b', '#e65100', '#6a1b9a', '#b8860b', '#00838f', '#5d4037'],
  wild: ['#fff0a0'],
  scatter: ['#12233a'],
  special: ['#8a3ffc', '#d81b60', '#00897b'],
};

/** Guess a symbol's kind from its id (math-sdk: H1…, L1…, W, S; cards: A K Q J 10 T 9). */
export function kindOf(id: string): SymbolKind {
  const u = id.toUpperCase();
  if (u === 'W' || u.startsWith('WILD') || /^W\d*$/.test(u)) return 'wild';
  if (u === 'S' || u.startsWith('SCAT') || u === 'BN' || u === 'BONUS' || /^S\d*$/.test(u)) return 'scatter';
  if (/^H\d+$/.test(u)) return 'high';
  if (/^M\d+$/.test(u)) return 'mid';
  if (/^L\d+$/.test(u) || /^(A|K|Q|J|T|10|9)$/.test(u)) return 'low';
  return 'special';
}

const RANK: Record<SymbolKind, number> = { wild: 0, scatter: 1, high: 2, mid: 3, low: 4, special: 5 };
const cellId = (c: unknown): string => (typeof c === 'string' ? c : c && typeof c === 'object' && 'name' in c ? String((c as { name: unknown }).name) : String(c));

/** Read up to `maxBooks` book lines and infer the board + symbol set. */
export async function inferSlotConfig(lines: Iterable<string> | AsyncIterable<string>, opts: { maxBooks?: number; title?: string } = {}): Promise<InferredConfig> {
  const max = opts.maxBooks ?? 5000;
  const ids = new Map<string, number>();
  const shapes = new Map<string, number>();
  let padded = 0;
  let scanned = 0;
  for await (const line of lines as AsyncIterable<string>) {
    if (scanned++ >= max) break;
    let book: unknown;
    try {
      book = JSON.parse(line);
    } catch {
      continue;
    }
    const events = Array.isArray(book) ? book : ((book as { events?: unknown[]; state?: unknown[] })?.events ?? (book as { state?: unknown[] })?.state ?? []);
    for (const ev of events as Array<Record<string, unknown>>) {
      if (!ev || ev.type !== 'reveal' || !Array.isArray(ev.board)) continue;
      const board = ev.board as unknown[][];
      const rows = Math.max(...board.map((c) => (Array.isArray(c) ? c.length : 0)));
      if (Array.isArray(ev.paddingPositions)) padded++;
      shapes.set(`${board.length}x${rows}`, (shapes.get(`${board.length}x${rows}`) ?? 0) + 1);
      for (const col of board) for (const c of Array.isArray(col) ? col : []) ids.set(cellId(c), (ids.get(cellId(c)) ?? 0) + 1);
    }
  }
  const notes: string[] = [];
  const [shape] = [...shapes.entries()].sort((a, b) => b[1] - a[1]);
  let [reels, rows] = (shape?.[0] ?? '5x3').split('x').map(Number) as [number, number];
  // math-sdk boards carry one padding row above and below the visible window.
  if (padded > 0) {
    rows -= 2;
    notes.push('boards carry padding rows (math-sdk) — the visible window is 2 rows shorter');
  }
  if (!shape) notes.push('no reveal events found — defaulted to a 5×3 board');
  if (shapes.size > 1) notes.push(`several board shapes seen (${[...shapes.keys()].join(', ')}) — used the most common`);

  const used: Record<SymbolKind, number> = { wild: 0, scatter: 0, high: 0, mid: 0, low: 0, special: 0 };
  const symbols: SlotSymbol[] = [...ids.keys()]
    .map((id) => ({ id, kind: kindOf(id) }))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map(({ id, kind }) => {
      const pal = PALETTE[kind];
      const color = pal[used[kind]++ % pal.length]!;
      const label = kind === 'wild' ? 'WILD' : kind === 'scatter' ? '★' : id.length <= 3 ? id : id.slice(0, 3);
      const name = kind === 'wild' ? 'Wild' : kind === 'scatter' ? 'Scatter' : id;
      return { id, name, kind, label, color };
    });

  const wild = symbols.find((s) => s.kind === 'wild');
  const scatter = symbols.find((s) => s.kind === 'scatter');
  return {
    config: {
      schema: 'artubeplate/slot@1',
      ...(opts.title ? { title: opts.title } : {}),
      board: { reels, rows },
      symbols,
      ...(wild ? { wild: { symbol: wild.id } } : {}),
      ...(scatter ? { scatter: { symbol: scatter.id } } : {}),
    },
    scanned: Math.min(scanned, max),
    notes,
  };
}
