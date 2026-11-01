// Stake Engine math-sdk output → an Artube artifact.
//
// The two formats are siblings — same `lookUpTable_<mode>_0` / `books_<mode>.jsonl.zst` names,
// same `id,weight,payout` rows, payouts already integers × 100 — but Artube adds four rules the
// Stake publish folder does not follow:
//
//   1. a `settings` block (betCredit, gameModes with INTEGER credit costs, types, RTP),
//   2. the weights table zstd-compressed too (`.csv.zst`),
//   3. NO zero weights,
//   4. rows sharing a multiplier must share ONE weight — Stake's optimizer weights each book
//      separately, so its tables routinely break this.
//
// (4) is the interesting one. Within a payout value the platform draws books uniformly, so the
// fix is a choice: FLATTEN (every row in the group gets the group's mean weight — payout
// distribution and RTP kept, the mix of books inside the group becomes uniform) or REPLICATE
// (duplicate book lines in proportion to their weights, then one weight per group — exact up to
// a copy budget, bigger files; duplicates sit next to each other so zstd barely notices).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDecoded, streamLines } from './fsSource';
import { writeArtifact, type ModeToWrite, type WeightRow } from './write';
import { ensureConfig } from './config';
import { exactRtp, round2 } from '../math/weights';
import { LIMITS, type ManifestModeType, type Volatility } from '../math/types';

export interface FromStakeOptions {
  /** The Stake `publish_files` folder (index.json + lookUpTable_* + books_*). */
  input: string;
  /** Output folder — replaced with exactly the Artube set. */
  out: string;
  /** Credits per base bet. Default 100 (Stake payouts are already × 100). */
  betCredit?: number;
  /** Per-mode manifest type. Default: price 1× → None, below 5× → LuckyBet, else Purchase. */
  types?: Record<string, ManifestModeType>;
  /** One volatility for all modes, or per mode. */
  volatility?: Volatility | Record<string, Volatility>;
  /** `settings.config` — the game's own client configuration. */
  config?: unknown;
  equalize?: 'flatten' | 'replicate';
  /** Replicate budget: at most this many lines per original row in a group. Default 32. */
  maxCopies?: number;
  log?: (msg: string) => void;
}

export interface ConvertedMode {
  name: string;
  type: ManifestModeType;
  cost: number;
  rowsIn: number;
  rowsOut: number;
  zeroWeightDropped: number;
  groupsEqualized: number;
  rtpBefore: number;
  rtpAfter: number;
  distinctMultipliers: number;
}

interface StakeIndex {
  modes: Array<{ name: string; cost: number; events: string; weights: string }>;
}

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};

function defaultType(priceMultiplier: number): ManifestModeType {
  if (priceMultiplier <= 1) return 'None';
  if (priceMultiplier < 5) return 'LuckyBet';
  return 'Purchase';
}

export async function convertStake(opts: FromStakeOptions): Promise<ConvertedMode[]> {
  const log = opts.log ?? (() => {});
  const betCredit = opts.betCredit ?? 100;
  const maxCopies = BigInt(opts.maxCopies ?? 32);
  const equalize = opts.equalize ?? 'flatten';
  const index = JSON.parse(await readFile(join(opts.input, 'index.json'), 'utf8')) as StakeIndex;
  if (!Array.isArray(index.modes)) throw new Error('Stake index.json has no `modes` array');

  const report: ConvertedMode[] = [];
  const modes: ModeToWrite[] = [];

  for (const sm of index.modes) {
    const costCredits = Math.round(sm.cost * betCredit);
    if (Math.abs(sm.cost * betCredit - costCredits) > 1e-9 || costCredits < 1)
      throw new Error(`mode ${sm.name}: cost ${sm.cost} × betCredit ${betCredit} is not a whole number of credits — pick a betCredit that makes it one`);
    const type = opts.types?.[sm.name] ?? defaultType(costCredits / betCredit);

    // ── rows ──────────────────────────────────────────────────────────────────
    const ids: string[] = [];
    const weights: bigint[] = [];
    const mults: bigint[] = [];
    let lineNo = 0;
    for await (const line of streamLines(openDecoded(join(opts.input, sm.weights)))) {
      lineNo++;
      if (!line.trim()) continue;
      const [id, w, p] = line.trim().split(',');
      if (id === undefined || w === undefined || p === undefined) throw new Error(`${sm.weights}:${lineNo}: expected id,weight,payout`);
      const payout = BigInt(p);
      const scaled = payout * BigInt(betCredit);
      if (scaled % 100n !== 0n) throw new Error(`${sm.weights}:${lineNo}: payout ${p} is not a whole number of credits at betCredit ${betCredit}`);
      ids.push(id);
      weights.push(BigInt(w));
      mults.push(scaled / 100n);
    }
    const rowsIn = ids.length;
    let before = { sumW: 0n, sumWM: 0n };
    for (let i = 0; i < rowsIn; i++) {
      before.sumW += weights[i]!;
      before.sumWM += weights[i]! * mults[i]!;
    }

    // ── zero weights out, groups equalized ───────────────────────────────────────
    const copies = new Array<bigint>(rowsIn).fill(1n);
    const outWeight = weights.slice();
    let zeroDropped = 0;
    const groups = new Map<bigint, number[]>();
    for (let i = 0; i < rowsIn; i++) {
      if (weights[i]! <= 0n) {
        copies[i] = 0n;
        zeroDropped++;
        continue;
      }
      const g = groups.get(mults[i]!);
      if (g) g.push(i);
      else groups.set(mults[i]!, [i]);
    }
    let equalized = 0;
    for (const members of groups.values()) {
      const first = weights[members[0]!]!;
      if (members.every((i) => weights[i] === first)) continue;
      equalized++;
      const total = members.reduce((s, i) => s + weights[i]!, 0n);
      const n = BigInt(members.length);
      if (equalize === 'flatten') {
        const per = (total + n / 2n) / n || 1n;
        for (const i of members) outWeight[i] = per;
        continue;
      }
      // replicate
      const g = members.reduce((acc, i) => gcd(acc, weights[i]!), 0n);
      let sumCopies = members.reduce((s, i) => s + weights[i]! / g, 0n);
      if (sumCopies <= maxCopies * n) {
        for (const i of members) {
          copies[i] = weights[i]! / g;
          outWeight[i] = g;
        }
      } else {
        const budget = maxCopies * n;
        const per = (total + budget - 1n) / budget;
        sumCopies = 0n;
        let heaviest = members[0]!;
        for (const i of members) {
          const c = (weights[i]! + per / 2n) / per;
          copies[i] = c;
          outWeight[i] = per;
          sumCopies += c;
          if (weights[i]! > weights[heaviest]!) heaviest = i;
        }
        if (sumCopies === 0n) copies[heaviest] = 1n;
      }
    }

    const rows: WeightRow[] = [];
    let after = { sumW: 0n, sumWM: 0n };
    for (let i = 0; i < rowsIn; i++) {
      for (let c = 0n; c < copies[i]!; c++) {
        rows.push({ id: BigInt(ids[i]!), weight: outWeight[i]!, multiplier: mults[i]! });
        after.sumW += outWeight[i]!;
        after.sumWM += outWeight[i]! * mults[i]!;
      }
    }
    if (groups.size > LIMITS.distinctMultipliers)
      log(`! mode ${sm.name}: ${groups.size} distinct multipliers — over the ${LIMITS.distinctMultipliers} limit; coarsen the payouts before uploading`);

    // ── books, streamed through in the same order ───────────────────────────────
    const booksPath = join(opts.input, sm.events);
    async function* books(): AsyncGenerator<string> {
      let i = 0;
      for await (const line of streamLines(openDecoded(booksPath))) {
        if (i >= rowsIn) throw new Error(`${sm.events}: more book lines than weights rows (${rowsIn})`);
        const c = copies[i]!;
        if (c > 0n) {
          const id = /"id"\s*:\s*(\d+)/.exec(line.slice(0, 64))?.[1];
          if (id !== undefined && id !== ids[i]) throw new Error(`${sm.events}:${i + 1}: book id ${id} ≠ lookup row id ${ids[i]} — the files are not in the same order`);
          for (let k = 0n; k < c; k++) yield line;
        }
        i++;
      }
      if (i !== rowsIn) throw new Error(`${sm.events}: ${i} book lines but ${rowsIn} weights rows`);
    }

    const rtpBefore = exactRtp(before.sumWM, before.sumW, costCredits);
    const rtpAfter = exactRtp(after.sumWM, after.sumW, costCredits);
    const vol = typeof opts.volatility === 'string' ? opts.volatility : opts.volatility?.[sm.name];
    modes.push({ name: sm.name, cost: costCredits, type, ...(vol ? { volatility: vol } : {}), rtp: round2(rtpAfter), rows, books: books() });
    report.push({
      name: sm.name,
      type,
      cost: costCredits,
      rowsIn,
      rowsOut: rows.length,
      zeroWeightDropped: zeroDropped,
      groupsEqualized: equalized,
      rtpBefore,
      rtpAfter,
      distinctMultipliers: groups.size,
    });
    log(`· ${sm.name}: ${rowsIn} → ${rows.length} rows, ${equalized} payout group(s) equalized (${equalize}), RTP ${rtpBefore.toFixed(4)} → ${rtpAfter.toFixed(4)}`);
  }

  await writeArtifact(opts.out, { betCredit, ...(opts.config !== undefined ? { config: opts.config } : {}), modes });
  // No client config supplied: infer a starter one from the books so the set plays out of the box.
  if (opts.config === undefined) for (const note of (await ensureConfig(opts.out)).notes) log(`· config: ${note}`);
  return report;
}
