import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { convertStake, validateDir } from '../src/node';
import { inferSlotConfig, kindOf } from '../src/math/infer';
import { onDisk, z } from './helpers';

// A Stake math-sdk publish folder: float costs, a PLAIN csv lookup, zero weights, books that share
// a payout with different weights, and math-sdk books (padded boards, `{ name }` cells).
const cell = (n: string): { name: string } => ({ name: n });
const book = (id: number, payout: number, board: string[][] = [['L1', 'H1', 'W', 'L2', 'L1'], ['S', 'L2', 'L1', 'H2', 'L2'], ['L1', 'L3', 'H1', 'L1', 'W']]) =>
  JSON.stringify({ id, payoutMultiplier: payout, events: [{ index: 0, type: 'reveal', board: board.map((col) => col.map(cell)), paddingPositions: [0, 0, 0], gameType: 'basegame' }] });

function stakeFolder(): string {
  // 3 reels × (3 visible + 2 padding) = 5 cells per reel.
  const lookup = [
    [1, 500, 0],
    [2, 300, 0], // same payout 0, different weight
    [3, 120, 200],
    [4, 80, 200], // same payout 200, different weight (3:2)
    [5, 0, 5000], // zero weight — must be dropped from BOTH files
    [6, 1, 1000],
  ];
  const books = lookup.map(([id, , p]) => book(id!, p!));
  return onDisk({
    'index.json': JSON.stringify({ modes: [{ name: 'base', cost: 1.0, events: 'books_base.jsonl.zst', weights: 'lookUpTable_base_0.csv' }] }),
    'lookUpTable_base_0.csv': lookup.map((r) => r.join(',')).join('\n') + '\n',
    'books_base.jsonl.zst': z(books.join('\n')),
  });
}

const readRows = (dir: string): number[][] =>
  zstdDecompressSync(readFileSync(join(dir, 'lookUpTable_base_0.csv.zst')))
    .toString()
    .split('\n')
    .map((l) => l.split(',').map(Number));
const readBooks = (dir: string): Array<{ id: number }> =>
  zstdDecompressSync(readFileSync(join(dir, 'books_base.jsonl.zst')))
    .toString()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('convertStake (Stake math-sdk → Artube)', () => {
  it('FLATTEN: equal weights per payout, zero rows gone, positions kept, RTP kept, set is valid', async () => {
    const out = join(onDisk({}), 'out');
    const report = await convertStake({ input: stakeFolder(), out });
    const rows = readRows(out);
    const books = readBooks(out);
    expect(rows).toHaveLength(5);
    expect(books.map((b) => b.id)).toEqual(rows.map((r) => r[0])); // positional correspondence
    expect(rows.find((r) => r[0] === 5)).toBeUndefined(); // zero weight dropped
    const w0 = rows.filter((r) => r[2] === 0).map((r) => r[1]);
    const w200 = rows.filter((r) => r[2] === 200).map((r) => r[1]);
    expect(new Set(w0).size).toBe(1);
    expect(new Set(w200).size).toBe(1);
    expect(report[0]).toMatchObject({ groupsEqualized: 2, zeroWeightDropped: 1, rowsIn: 6, rowsOut: 5 });
    expect(report[0]!.rtpAfter).toBeCloseTo(report[0]!.rtpBefore, 6);
    const r = await validateDir(out);
    expect(r.ok).toBe(true);
    const idx = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(idx.settings.gameModes[0]).toMatchObject({ name: 'base', cost: 100, type: 'None' });
    // A starter client config was inferred from the books (padding rows stripped).
    expect(idx.settings.config.board).toEqual({ reels: 3, rows: 3 });
    expect(idx.settings.config.wild.symbol).toBe('W');
    expect(idx.settings.config.scatter.symbol).toBe('S');
  });

  it('REPLICATE: duplicates books in proportion so every book keeps its exact probability', async () => {
    const out = join(onDisk({}), 'out');
    await convertStake({ input: stakeFolder(), out, equalize: 'replicate' });
    const rows = readRows(out);
    const total = rows.reduce((s, r) => s + r[1]!, 0);
    const mass = (id: number): number => rows.filter((r) => r[0] === id).reduce((s, r) => s + r[1]!, 0) / total;
    // Original: ids 1..4,6 have weights 500,300,120,80,1 of 1001.
    expect(mass(3)).toBeCloseTo(120 / 1001, 9);
    expect(mass(4)).toBeCloseTo(80 / 1001, 9);
    expect(mass(1)).toBeCloseTo(500 / 1001, 9);
    expect(readBooks(out).map((b) => b.id)).toEqual(rows.map((r) => r[0]));
    expect((await validateDir(out)).ok).toBe(true);
  });

  it('refuses a cost that is not a whole number of credits', async () => {
    const dir = onDisk({
      'index.json': JSON.stringify({ modes: [{ name: 'base', cost: 1.005, events: 'b.jsonl.zst', weights: 'w.csv' }] }),
      'w.csv': '1,1,0',
      'b.jsonl.zst': z('{}'),
    });
    await expect(convertStake({ input: dir, out: join(onDisk({}), 'o') })).rejects.toThrow(/whole number of credits/);
  });
});

describe('inferSlotConfig', () => {
  it('reads board size + symbols, strips math-sdk padding, guesses kinds', async () => {
    const lines = [book(1, 0, [['L1', 'H1', 'W', 'L2', 'L1'], ['S', 'L2', 'L1', 'H2', 'L2'], ['L1', 'L3', 'H1', 'L1', 'W'], ['A', 'K', 'Q', 'J', 'T']])];
    const { config, notes } = await inferSlotConfig(lines);
    expect(config.board).toEqual({ reels: 4, rows: 3 });
    expect(config.symbols[0]!.kind).toBe('wild');
    expect(config.symbols.map((s) => s.id)).toEqual(expect.arrayContaining(['H1', 'H2', 'L1', 'L2', 'L3', 'S', 'W', 'A']));
    expect(notes.join(' ')).toMatch(/padding/);
    expect([kindOf('H3'), kindOf('L1'), kindOf('W'), kindOf('S'), kindOf('K'), kindOf('BONUS')]).toEqual(['high', 'low', 'wild', 'scatter', 'low', 'scatter']);
  });
});
