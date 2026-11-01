// `settings.config` for the showcase — the part of the manifest the platform never reads and
// hands to the client verbatim as `gameSettings.config`. It follows the artubeplate slot schema
// (`artubeplate/slot@1`, see docs/MATH_CONTRACT.md): the template builds its board, symbol tiles,
// paytable, paylines and rules FROM this, so a new math drop reconfigures the client with no code
// change. It is derived from the SAME tables the simulator pays with (game.ts), so the rules the
// player reads can never drift from the math that pays them.

import { REELS, ROWS, PAYTABLE, LINES40, NUM_LINES, SCATTER_PAY, FS_AWARD, WIN_CAP, type Sym } from './game';

const SYMBOLS: Array<{ id: Sym; name: string; kind: 'high' | 'mid' | 'low' | 'wild' | 'scatter'; label: string; color: string }> = [
  { id: 'H1', name: 'Sacred cat', kind: 'high', label: '😺', color: '#b23a48' },
  { id: 'H2', name: 'Temple cat', kind: 'high', label: '🐯', color: '#7b4bd6' },
  { id: 'H3', name: 'Street cat', kind: 'high', label: '🐈', color: '#2f8f6e' },
  { id: 'H4', name: 'House cat', kind: 'high', label: '🐱', color: '#2b6cb0' },
  { id: 'M1', name: 'Ankh', kind: 'mid', label: '☥', color: '#4a5a73' },
  { id: 'M2', name: 'Crook', kind: 'mid', label: '⚑', color: '#5b6272' },
  { id: 'A', name: 'Ace', kind: 'low', label: 'A', color: '#3a4a5c' },
  { id: 'K', name: 'King', kind: 'low', label: 'K', color: '#4a3d5c' },
  { id: 'Q', name: 'Queen', kind: 'low', label: 'Q', color: '#3a5448' },
  { id: 'J', name: 'Jack', kind: 'low', label: 'J', color: '#5a3a46' },
  { id: 'T', name: 'Ten', kind: 'low', label: '10', color: '#3f444d' },
  { id: 'W', name: 'Wild', kind: 'wild', label: 'WILD', color: '#f2f4f7' },
  { id: 'S', name: 'Paw Scatter', kind: 'scatter', label: '🐾', color: '#161b26' },
];

const table: Record<string, Record<string, number>> = {};
for (const [sym, byCount] of Object.entries(PAYTABLE)) {
  if (Object.keys(byCount).length) table[sym] = Object.fromEntries(Object.entries(byCount).map(([k, v]) => [k, v]));
}

export const CLIENT_CONFIG = {
  schema: 'artubeplate/slot@1',
  title: 'Whisker Pharaoh',
  board: { reels: REELS, rows: ROWS },
  symbols: SYMBOLS,
  pays: { unit: 'lineBet', lines: NUM_LINES, table },
  paylines: LINES40,
  wild: { symbol: 'W', reels: [1, 2, 3, 4], multipliers: [2, 3], multipliersAdd: true },
  scatter: {
    symbol: 'S',
    pays: Object.fromEntries(Object.entries(SCATTER_PAY).map(([k, v]) => [k, v])),
    freeSpins: Object.fromEntries(Object.entries(FS_AWARD).map(([k, v]) => [k, v])),
  },
  freeSpins: { retrigger: 2, sticky: true },
  bonus: {
    name: 'Paw Parade',
    rules: [
      'Every Wild that lands during the free spins stays in place until the last one.',
      'Wilds carry 2× or 3×, and several on one line add their multipliers up.',
      'A full column of one cat on reel 1 adds 2 more free spins.',
    ],
  },
  respin: { reel: 0, symbols: ['H1', 'H2', 'H3', 'H4'], max: 3 },
  maxWin: WIN_CAP,
  modes: {
    base: { name: 'Base game' },
    buyfs: { name: 'Free Spins', description: 'Buy the Free Spins round: 3 to 5 Paw Scatters land and 8 to 16 free spins start at once.' },
    luckybet: { name: 'Lucky Bet', description: 'A 1.25× ante that roughly doubles how often Free Spins trigger.' },
  },
  texts: {
    about: '{{title}} is a 5×4 slot with 40 fixed paylines. Match symbols left to right on a line to win; the sacred cats pay the most.',
    wild: 'The Wild lands on reels 2 to 5 and substitutes for every symbol except the Paw Scatter. Each Wild carries a random 2× or 3×; several Wilds on one line ADD their multipliers.',
    scatter: '3, 4 or 5 Paw Scatters anywhere pay 5× the total bet and trigger 8, 12 or 16 Free Spins.',
    freeSpins: 'Wilds that land during Free Spins are STICKY for the rest of the round. A full column of one cat on reel 1 adds +2 Free Spins.',
    respin: 'A full column of one cat on reel 1 holds that column and every Wild, then respins the other reels up to 3 times for a win with that cat.',
  },
} as const;
