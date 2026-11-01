// The weights table — `id,weight,multiplier` per row, integers only. A streaming accumulator:
// push the decompressed lines one at a time (works for a 200-row toy and a 50 GiB production
// table alike) and it keeps the exact sums the Hub computes RTP from, plus every rule check.

import { LIMITS, type Issue } from './types';

const ROW_RE = /^(\d+),(\d+),(\d+)$/;
/** Report at most this many findings per rule, so a broken 10M-row file stays readable. */
const MAX_PER_CODE = 20;
const U63 = (1n << 63n) - 1n;

export interface WeightsSummary {
  rows: number;
  /** Σ weight (exact). */
  sumW: bigint;
  /** Σ weight × multiplier (exact). */
  sumWM: bigint;
  /** Σ weight × multiplier² (exact) — for the variance. */
  sumWM2: bigint;
  /** Σ weight over rows with multiplier > 0. */
  hitW: bigint;
  /** multiplier → per-row weight (the platform requires ONE weight per multiplier). */
  byMultiplier: Map<bigint, { weight: bigint; count: number }>;
  maxMultiplier: bigint;
  bytes: number;
}

export class WeightsAccumulator {
  readonly issues: Issue[] = [];
  private readonly perCode = new Map<string, number>();
  private rows = 0;
  private sumW = 0n;
  private sumWM = 0n;
  private sumWM2 = 0n;
  private hitW = 0n;
  private maxM = 0n;
  private bytes = 0;
  private readonly byM = new Map<bigint, { weight: bigint; count: number; firstLine: number }>();
  /** Multiplier per row, in order — kept (as numbers) so books can be cross-checked. */
  readonly multipliers: number[] = [];

  constructor(
    private readonly mode: string,
    private readonly file: string,
    private readonly opts: { keepMultipliers?: boolean } = {},
  ) {}

  private issue(level: Issue['level'], code: string, message: string, line?: number): void {
    const n = (this.perCode.get(code) ?? 0) + 1;
    this.perCode.set(code, n);
    if (n <= MAX_PER_CODE) this.issues.push({ level, code, message, mode: this.mode, file: this.file, ...(line ? { line } : {}) });
    else if (n === MAX_PER_CODE + 1) this.issues.push({ level, code, message: `…more "${code}" findings suppressed.`, mode: this.mode, file: this.file });
  }

  /** Feed one line (WITHOUT its trailing `\n`). `lineNo` is 1-based. */
  push(line: string, lineNo: number): void {
    this.bytes += line.length + 1;
    if (line.length === 0) {
      this.issue('error', 'weights-blank-line', 'Blank line — the weights table may not contain empty lines.', lineNo);
      return;
    }
    if (lineNo === 1 && line.charCodeAt(0) === 0xfeff) {
      this.issue('error', 'weights-bom', 'The file starts with a byte-order mark (BOM); save it as plain UTF-8.', lineNo);
      line = line.slice(1);
    }
    if (line.length > LIMITS.weightsLineBytes) this.issue('error', 'weights-line-length', `Row is ${line.length} bytes; the limit is ${LIMITS.weightsLineBytes}.`, lineNo);
    const m = ROW_RE.exec(line);
    if (!m) {
      const hint = line.endsWith('\r')
        ? ' (Windows line endings — use \\n only)'
        : /[a-z]/i.test(line)
          ? ' (a header or text? the file must hold values only)'
          : /\s/.test(line)
            ? ' (no spaces allowed)'
            : /[.eE+-]/.test(line)
              ? ' (integers only: no sign, decimal point or exponent)'
              : '';
      this.issue('error', 'weights-row', `Row must be exactly \`id,weight,multiplier\` in ASCII digits${hint}: ${JSON.stringify(line.slice(0, 60))}`, lineNo);
      return;
    }
    const weight = BigInt(m[2]!);
    const mult = BigInt(m[3]!);
    if ((m[2]!.length > 1 && m[2]!.startsWith('0')) || (m[3]!.length > 1 && m[3]!.startsWith('0')))
      this.issue('warn', 'weights-leading-zero', 'Leading zeros in a number — legal digits, but a strict parser may reject them.', lineNo);
    if (weight < 1n) {
      this.issue('error', 'weights-zero', 'Weight is 0 — every weight must be ≥ 1 (drop the row from BOTH files instead).', lineNo);
      return;
    }
    if (weight > U63 || mult > U63) this.issue('warn', 'weights-overflow', 'A value exceeds 2^63−1 — it may overflow a 64-bit integer on the platform.', lineNo);

    const prev = this.byM.get(mult);
    if (prev) {
      if (prev.weight !== weight)
        this.issue(
          'error',
          'weights-same-multiplier',
          `Multiplier ${mult} has weight ${weight} here but ${prev.weight} on line ${prev.firstLine} — rows sharing a multiplier must share the same weight.`,
          lineNo,
        );
      prev.count++;
    } else {
      this.byM.set(mult, { weight, count: 1, firstLine: lineNo });
    }

    this.rows++;
    this.sumW += weight;
    this.sumWM += weight * mult;
    this.sumWM2 += weight * mult * mult;
    if (mult > 0n) this.hitW += weight;
    if (mult > this.maxM) this.maxM = mult;
    if (this.opts.keepMultipliers !== false) this.multipliers.push(Number(mult));
  }

  /** Close the table: the checks that need every row. */
  finish(): WeightsSummary {
    if (this.rows === 0) this.issue('error', 'weights-empty', 'The weights table has no rows.');
    if (this.byM.size > LIMITS.distinctMultipliers)
      this.issue('error', 'weights-distinct', `${this.byM.size} distinct multipliers; the limit is ${LIMITS.distinctMultipliers} per mode.`);
    const byMultiplier = new Map<bigint, { weight: bigint; count: number }>();
    for (const [k, v] of this.byM) byMultiplier.set(k, { weight: v.weight, count: v.count });
    return {
      rows: this.rows,
      sumW: this.sumW,
      sumWM: this.sumWM,
      sumWM2: this.sumWM2,
      hitW: this.hitW,
      byMultiplier,
      maxMultiplier: this.maxM,
      bytes: this.bytes,
    };
  }
}

/** Exact RTP percent from the sums (the Hub's formula): Σ(w·m) / Σw / cost × 100. */
export function exactRtp(sumWM: bigint, sumW: bigint, cost: number): number {
  if (sumW === 0n || cost <= 0) return 0;
  // Scale by 1e8 before the integer divide to keep 8 decimals of the percentage.
  const scaled = (sumWM * 100n * 100_000_000n) / (sumW * BigInt(cost));
  return Number(scaled) / 100_000_000;
}

/** Round to 2 decimals the way the Hub compares (half away from zero). */
export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

/** Does a declared RTP pass against the computed one (both rounded to 2 dp, ±0.50 pp)? */
export function rtpPasses(declared: number, actual: number): boolean {
  return Math.abs(round2(declared) - round2(actual)) <= LIMITS.rtpTolerance + 1e-9;
}

/** Ratio of two bigints as a float, without overflowing Number on huge sums. */
export function ratio(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  const scale = 1_000_000_000_000n;
  return Number((a * scale) / b) / 1e12;
}
