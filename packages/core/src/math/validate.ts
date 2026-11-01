// Validate a whole artifact the way Artube Hub's "Start Math Verification" does — structure,
// positional correspondence, limits, one zstd stream per file, and RTP recomputed exactly from
// the weights — so a set is known-good BEFORE it is uploaded. Storage-agnostic: the CLI feeds
// it files from disk, a test feeds it buffers.

import { parseManifest, requiredFiles } from './manifest';
import { WeightsAccumulator, exactRtp, round2, rtpPasses, ratio, type WeightsSummary } from './weights';
import { BooksAccumulator } from './books';
import { inspectZstdFrames, frameProblem, type ByteReader } from './zstdFrame';
import { LIMITS, type Issue, type ModeReport, type ValidationReport } from './types';

/** A flat folder of files, as the validator needs to see it. */
export interface ArtifactSource {
  /** Every file name in the folder (the set must be flat — no subfolders). */
  list(): Promise<string[]>;
  size(name: string): Promise<number>;
  text(name: string): Promise<string>;
  /** Random access to the RAW (compressed) bytes, for the frame check. */
  open(name: string): Promise<{ read: ByteReader; close(): Promise<void> }>;
  /** The DECOMPRESSED file as lines (no `\n`). A single final newline yields no empty line. */
  lines(name: string): AsyncIterable<string>;
}

export interface ValidateOptions {
  /** Cross-check each book's own `payoutMultiplier` against its weights row (default true). */
  crossCheckBooks?: boolean;
  /** Called as each mode starts / finishes (CLI progress). */
  onProgress?: (msg: string) => void;
}

const TAIL_X = [10, 100, 1000];

export async function validateArtifact(src: ArtifactSource, opts: ValidateOptions = {}): Promise<ValidationReport> {
  const issues: Issue[] = [];
  const modes: ModeReport[] = [];
  const files = await src.list();

  if (!files.includes('index.json')) {
    issues.push({ level: 'error', code: 'manifest-missing', message: 'index.json is missing — the manifest must sit at the top of the folder, uncompressed.' });
    return { ok: false, modes, issues };
  }
  const manifestText = await src.text('index.json');
  const { manifest, issues: mIssues } = parseManifest(manifestText, await src.size('index.json'));
  issues.push(...mIssues);
  if (!manifest) return { ok: false, modes, issues };

  // ── the file set: exactly index.json + a pair per mode, nothing extra ─────────────
  const required = requiredFiles(manifest);
  const expectedCount = 1 + 2 * manifest.modes.length;
  for (const f of required) if (!files.includes(f)) issues.push({ level: 'error', code: 'file-missing', message: `"${f}" is referenced by index.json but is not in the folder.`, file: f });
  const extra = files.filter((f) => !required.includes(f));
  for (const f of extra) {
    const hint = f === '.DS_Store' ? ' (a macOS folder file — delete it before uploading)' : f.endsWith('/') ? ' (the set must be flat — no subfolders)' : '';
    issues.push({
      level: 'error',
      code: 'file-extra',
      message: `"${f}" is not part of the set${hint} — the folder must hold ONLY index.json and each mode's two files (${expectedCount} files).`,
      file: f,
    });
  }

  let compressedTotal = 0;
  let uncompressedTotal = 0;
  const byName = new Map(manifest.settings.gameModes.map((g) => [g.name, g]));
  const betCredit = manifest.settings.betCredit;

  for (const mode of manifest.modes) {
    const gm = byName.get(mode.name)!;
    opts.onProgress?.(`mode ${mode.name}: checking ${mode.weights} + ${mode.events}`);
    const present = files.includes(mode.weights) && files.includes(mode.events);
    if (!present) continue;

    // One complete zstd stream per file.
    let framesOk = true;
    for (const f of [mode.weights, mode.events]) {
      const size = await src.size(f);
      compressedTotal += size;
      const h = await src.open(f);
      try {
        const problem = frameProblem(await inspectZstdFrames(h.read, size));
        if (problem) {
          framesOk = false;
          issues.push({ level: 'error', code: 'zstd-stream', message: `${f}: ${problem}.`, mode: mode.name, file: f });
        }
      } finally {
        await h.close();
      }
    }
    if (!framesOk) continue;

    const wAcc = new WeightsAccumulator(mode.name, mode.weights, { keepMultipliers: opts.crossCheckBooks !== false });
    let n = 0;
    try {
      for await (const line of src.lines(mode.weights)) wAcc.push(line, ++n);
    } catch (e) {
      issues.push({ level: 'error', code: 'weights-read', message: `${mode.weights}: cannot decompress (${(e as Error).message}).`, mode: mode.name, file: mode.weights });
      continue;
    }
    const w: WeightsSummary = wAcc.finish();
    issues.push(...wAcc.issues);

    const bAcc = new BooksAccumulator(mode.name, mode.events, opts.crossCheckBooks === false ? undefined : wAcc.multipliers);
    n = 0;
    try {
      for await (const line of src.lines(mode.events)) bAcc.push(line, ++n);
    } catch (e) {
      issues.push({ level: 'error', code: 'books-read', message: `${mode.events}: cannot decompress (${(e as Error).message}).`, mode: mode.name, file: mode.events });
      continue;
    }
    bAcc.finish(w.rows);
    issues.push(...bAcc.issues);
    uncompressedTotal += w.bytes + bAcc.bytes;

    const actualExact = exactRtp(w.sumWM, w.sumW, gm.cost);
    const actual = round2(actualExact);
    const passed = rtpPasses(gm.rtp, actual);
    if (!passed)
      issues.push({
        level: 'error',
        code: 'rtp-mismatch',
        message: `Declared RTP ${gm.rtp} but the weights give ${actualExact.toFixed(4)} (${actual}) — outside ±${LIMITS.rtpTolerance} pp. RTP is Σ(weight×multiplier)/Σweight/cost×100.`,
        mode: mode.name,
      });
    else if (Math.abs(round2(gm.rtp) - actual) > 0.1)
      issues.push({ level: 'warn', code: 'rtp-drift', message: `Declared RTP ${gm.rtp} passes, but the weights give ${actual} — players read the declared figure.`, mode: mode.name });

    // Tail + max-win odds from the per-multiplier masses.
    let maxMass = 0n;
    const tailMass = TAIL_X.map(() => 0n);
    for (const [m, { weight, count }] of w.byMultiplier) {
      const mass = weight * BigInt(count);
      if (m === w.maxMultiplier) maxMass += mass;
      TAIL_X.forEach((x, i) => {
        if (m >= BigInt(x * betCredit)) tailMass[i] = tailMass[i]! + mass;
      });
    }
    const mean = ratio(w.sumWM, w.sumW) / gm.cost;
    const meanSq = ratio(w.sumWM2, w.sumW) / (gm.cost * gm.cost);
    modes.push({
      name: mode.name,
      type: gm.type ?? 'None',
      cost: gm.cost,
      priceMultiplier: gm.cost / betCredit,
      declaredRtp: gm.rtp,
      actualRtp: actual,
      actualRtpExact: actualExact,
      passed,
      rows: w.rows,
      distinctMultipliers: w.byMultiplier.size,
      hitRate: ratio(w.hitW, w.sumW),
      maxMultiplier: Number(w.maxMultiplier),
      maxWinX: Number(w.maxMultiplier) / betCredit,
      maxWinProbability: ratio(maxMass, w.sumW),
      stdDev: Math.sqrt(Math.max(0, meanSq - mean * mean)),
      tail: TAIL_X.map((x, i) => ({ x, probability: ratio(tailMass[i]!, w.sumW) })),
      booksBytes: bAcc.bytes,
      weightsBytes: w.bytes,
    });
  }

  if (compressedTotal > LIMITS.totalCompressedBytes)
    issues.push({ level: 'error', code: 'set-too-large', message: `The set is ${compressedTotal} bytes compressed; the limit is 10 GiB.` });
  if (uncompressedTotal > LIMITS.totalUncompressedBytes)
    issues.push({ level: 'error', code: 'set-too-large-raw', message: `The set is ${uncompressedTotal} bytes uncompressed; the limit is 50 GiB.` });

  return { ok: !issues.some((i) => i.level === 'error'), manifest, modes, issues };
}

/** "1 in 1,234,567" for a probability (or "never" / "—"). */
export function oddsText(p: number): string {
  if (!(p > 0)) return 'never';
  const n = 1 / p;
  return `1 in ${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n >= 10 ? 1 : 2)}`;
}
