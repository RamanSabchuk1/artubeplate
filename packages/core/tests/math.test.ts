import { describe, it, expect } from 'vitest';
import { validateArtifact } from '../src/math/validate';
import { parseManifest, clientGameModes } from '../src/math/manifest';
import { exactRtp, rtpPasses } from '../src/math/weights';
import { inspectZstdFrames, bufferReader, frameProblem } from '../src/math/zstdFrame';
import { jsonDepth } from '../src/math/books';
import { validateDir } from '../src/node';
import { artifact, memSource, z, rtpOf, TEMPLATE_MATH, type ModeSpec } from './helpers';

const BASE: ModeSpec = { name: 'base', cost: 100, rows: [[0, 1, 0], [1, 1, 192]] }; // RTP 96% exactly (the docs' worked example)
const codes = async (files: Record<string, string | Uint8Array>): Promise<string[]> => (await validateArtifact(memSource(files))).issues.filter((i) => i.level === 'error').map((i) => i.code);

describe('RTP — the Hub formula', () => {
  it('reproduces the documented worked example (96%)', () => {
    expect(exactRtp(192n, 2n, 100)).toBe(96);
    expect(rtpOf(BASE.rows, 100)).toBe(96);
  });
  it('tolerance is ±0.50 pp after rounding both to 2 dp', () => {
    expect(rtpPasses(96, 95.5)).toBe(true);
    expect(rtpPasses(96, 96.5)).toBe(true);
    expect(rtpPasses(96, 95.49)).toBe(false);
    expect(rtpPasses(94, 96)).toBe(false);
  });
  it('is computed against cost, not betCredit (a pricier mode needs bigger payouts)', () => {
    expect(exactRtp(192n, 2n, 7500)).toBeCloseTo(1.28, 6);
  });
  it('stays exact on huge integer weights', () => {
    const w = 10n ** 18n;
    expect(exactRtp(w * 96n, w, 100)).toBe(96);
  });
});

describe('validateArtifact — every Hub rule', () => {
  it('passes a valid set and reports per-mode numbers', async () => {
    const r = await validateArtifact(memSource(artifact([BASE])));
    expect(r.ok).toBe(true);
    expect(r.modes[0]).toMatchObject({ name: 'base', actualRtp: 96, passed: true, rows: 2, distinctMultipliers: 2, hitRate: 0.5, maxWinX: 1.92 });
  });

  it('rejects a missing books file and extra files (with a .DS_Store hint)', async () => {
    const files = artifact([BASE]);
    delete files['books_base.jsonl.zst'];
    files['.DS_Store'] = 'junk';
    const r = await validateArtifact(memSource(files));
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['file-missing', 'file-extra']));
    expect(r.issues.find((i) => i.code === 'file-extra')!.message).toMatch(/macOS/);
  });

  it('rejects rows sharing a multiplier with different weights', async () => {
    expect(await codes(artifact([{ name: 'base', cost: 100, rtp: 10, rows: [[1, 1, 10], [2, 2, 10]] }]))).toContain('weights-same-multiplier');
  });

  it('rejects zero weights, headers, spaces, CRLF and blank lines', async () => {
    const make = (csv: string): Record<string, string | Uint8Array> => {
      const f = artifact([BASE]);
      f['lookUpTable_base_0.csv.zst'] = z(csv);
      return f;
    };
    expect(await codes(make('0,0,0\n1,1,192'))).toContain('weights-zero');
    expect(await codes(make('id,weight,multiplier\n0,1,0\n1,1,192'))).toContain('weights-row');
    expect(await codes(make('0, 1,0\n1,1,192'))).toContain('weights-row');
    expect(await codes(make('0,1,0\r\n1,1,192'))).toContain('weights-row');
    expect(await codes(make('0,1,0\n\n1,1,192'))).toContain('weights-blank-line');
  });

  it('accepts one trailing newline but not two', async () => {
    const f = artifact([BASE]);
    f['lookUpTable_base_0.csv.zst'] = z('0,1,0\n1,1,192\n');
    expect((await validateArtifact(memSource(f))).ok).toBe(true);
    f['lookUpTable_base_0.csv.zst'] = z('0,1,0\n1,1,192\n\n');
    expect((await validateArtifact(memSource(f))).ok).toBe(false);
  });

  it('rejects books that do not line up with the weights', async () => {
    const f = artifact([BASE]);
    f['books_base.jsonl.zst'] = z('{"a":1}');
    expect(await codes(f)).toContain('books-count');
  });

  it('rejects a book line that is not ONE JSON object/array', async () => {
    const withBooks = (b: string[]): Record<string, string | Uint8Array> => artifact([{ ...BASE, books: b }]);
    expect(await codes(withBooks(['{"a":1}', '{"a":'.concat('')]))).toContain('books-json');
    expect(await codes(withBooks(['{"a":1}', '42']))).toContain('books-not-object');
    expect(await codes(withBooks(['{"a":1}', 'null']))).toContain('books-not-object');
    expect(await codes(withBooks(['', '{"a":1}']))).toContain('books-blank-line'); // a blank LAST line reads as the final newline
  });

  it('enforces the 96 KiB line and depth-64 limits', async () => {
    const deep = '['.repeat(70) + ']'.repeat(70);
    const big = JSON.stringify({ pad: 'x'.repeat(100 * 1024) });
    expect(await codes(artifact([{ ...BASE, books: ['{}', deep] }]))).toContain('books-depth');
    expect(await codes(artifact([{ ...BASE, books: ['{}', big] }]))).toContain('books-line-length');
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
  });

  it('warns when a book states a payout its weights row does not pay', async () => {
    const r = await validateArtifact(memSource(artifact([{ ...BASE, books: ['{"payoutMultiplier":0}', '{"payoutMultiplier":191}'] }])));
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('books-payout-mismatch');
  });

  it('rejects an RTP outside the tolerance', async () => {
    expect(await codes(artifact([{ ...BASE, rtp: 94 }]))).toContain('rtp-mismatch');
    expect(await codes(artifact([{ ...BASE, rtp: 95.6 }]))).not.toContain('rtp-mismatch');
  });

  it('rejects more than 10,000 distinct multipliers per mode', async () => {
    const rows: Array<[number, number, number]> = Array.from({ length: 10_001 }, (_, i) => [i, 1, i]);
    // A huge cost keeps the RTP legal while every row pays a different amount.
    expect(await codes(artifact([{ name: 'base', cost: 500_000, rows }]))).toContain('weights-distinct');
  });

  it('rejects concatenated zstd streams and trailing bytes (without decompressing)', async () => {
    const one = z('0,1,0\n1,1,192');
    const two = new Uint8Array([...z('0,1,0\n'), ...z('1,1,192')]);
    const tail = new Uint8Array([...one, 1, 2, 3, 4, 5]);
    expect(frameProblem(await inspectZstdFrames(bufferReader(one), one.length))).toBeUndefined();
    expect(frameProblem(await inspectZstdFrames(bufferReader(two), two.length))).toMatch(/2 concatenated/);
    expect(frameProblem(await inspectZstdFrames(bufferReader(tail), tail.length))).toMatch(/trailing/);
    expect(frameProblem(await inspectZstdFrames(bufferReader(one.subarray(0, 9)), 9))).toMatch(/truncated/);
    const f = artifact([BASE]);
    f['lookUpTable_base_0.csv.zst'] = two;
    expect(await codes(f)).toContain('zstd-stream');
  });
});

describe('parseManifest', () => {
  const ok = JSON.parse(artifact([BASE])['index.json'] as string);
  const issues = (m: unknown): string[] => parseManifest(JSON.stringify(m)).issues.filter((i) => i.level === 'error').map((i) => i.code);

  it('enforces names, costs, types, RTP bounds and the gameModes ↔ modes mapping', () => {
    const bad = structuredClone(ok);
    bad.settings.gameModes[0].name = 'base mode';
    expect(issues(bad)).toContain('mode-name');
    const cost = structuredClone(ok);
    cost.settings.gameModes[0].cost = 1.5;
    expect(issues(cost)).toContain('mode-cost');
    const type = structuredClone(ok);
    type.settings.gameModes[0].type = 'purchase';
    expect(issues(type)).toContain('mode-type');
    const rtp = structuredClone(ok);
    rtp.settings.gameModes[0].rtp = 100;
    expect(issues(rtp)).toContain('mode-rtp');
    const unmapped = structuredClone(ok);
    unmapped.modes = [];
    expect(issues(unmapped)).toContain('mode-unmapped');
  });

  it('maps Purchase → BuyFeature and cost → priceMultiplier for the client', () => {
    const m = parseManifest(JSON.stringify({ settings: { betCredit: 100, gameModes: [{ name: 'bonus', cost: 7500, type: 'Purchase', rtp: 96 }], config: {} }, modes: [{ name: 'bonus', events: 'b.jsonl.zst', weights: 'w.csv.zst' }] })).manifest!;
    expect(clientGameModes(m)).toEqual([{ id: 'bonus', rtp: 96, priceMultiplier: 75, type: 'BuyFeature' }]);
  });
});

describe('the showcase math in the template', () => {
  it('is a valid Artube upload set', async () => {
    const r = await validateDir(TEMPLATE_MATH);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.modes.map((m) => [m.name, m.type, m.priceMultiplier])).toEqual([
      ['base', 'None', 1],
      ['buyfs', 'Purchase', 100],
      ['luckybet', 'LuckyBet', 1.25],
    ]);
  });
});
