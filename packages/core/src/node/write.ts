// Write an Artube artifact to disk: `index.json` (uncompressed) + per mode a weights table and a
// books file, each compressed as exactly ONE zstd stream (the Hub rejects concatenated frames).
// Rows carry exact integers; RTP is computed from them and — unless the caller pins it — written
// as the declared figure, so the set passes verification by construction.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { zstdCompressSync, createZstdCompress, constants as zc } from 'node:zlib';
import { once } from 'node:events';
import { join } from 'node:path';
import { exactRtp, round2 } from '../math/weights';
import type { ArtubeManifest, ManifestGameMode, ManifestModeType, Volatility } from '../math/types';

export interface WeightRow {
  id: number | bigint;
  weight: number | bigint;
  multiplier: number | bigint;
}

export interface ModeToWrite {
  name: string;
  /** Price in credits (integer ≥ 1). */
  cost: number;
  type?: ManifestModeType;
  volatility?: Volatility;
  /** Pin the declared RTP (percent). Default: computed from the rows, rounded to 2 dp. */
  rtp?: number;
  rows: WeightRow[];
  /** One JSON line per row, same order (strings are written verbatim; objects are stringified). */
  books: Iterable<string | object> | AsyncIterable<string | object>;
}

export interface ArtifactToWrite {
  betCredit: number;
  config?: unknown;
  modes: ModeToWrite[];
  /** Replace the folder's contents (default true) — the set must hold nothing extra. */
  clean?: boolean;
  /** zstd level (default 19). */
  level?: number;
}

export interface WrittenMode {
  name: string;
  rows: number;
  rtp: number;
  weightsFile: string;
  eventsFile: string;
}

export const weightsFileName = (mode: string): string => `lookUpTable_${mode}_0.csv.zst`;
export const booksFileName = (mode: string): string => `books_${mode}.jsonl.zst`;

/** Compress a whole buffer as one zstd frame. */
export function zstdOne(data: Uint8Array | string, level = 19): Buffer {
  return zstdCompressSync(typeof data === 'string' ? Buffer.from(data) : data, { params: { [zc.ZSTD_c_compressionLevel]: level, [zc.ZSTD_c_checksumFlag]: 1 } });
}

/** Stream lines into one zstd frame on disk (constant memory for big books). Lines are joined
 *  with `\n` and the file gets NO trailing newline (no chance of reading as a blank last line). */
export async function writeZstdLines(path: string, lines: Iterable<string> | AsyncIterable<string>, level = 19): Promise<number> {
  const out = createWriteStream(path);
  const z = createZstdCompress({ params: { [zc.ZSTD_c_compressionLevel]: level, [zc.ZSTD_c_checksumFlag]: 1 } });
  z.pipe(out);
  let n = 0;
  let buf: string[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (!buf.length) return;
    const chunk = buf.join('');
    buf = [];
    bytes = 0;
    if (!z.write(chunk)) await once(z, 'drain');
  };
  for await (const line of lines as AsyncIterable<string>) {
    buf.push(n === 0 ? line : `\n${line}`);
    bytes += line.length + 1;
    n++;
    if (bytes >= 1 << 20) await flush();
  }
  await flush();
  z.end();
  await once(out, 'finish');
  return n;
}

async function* toLines(books: ModeToWrite['books']): AsyncGenerator<string> {
  for await (const b of books as AsyncIterable<string | object>) yield typeof b === 'string' ? b : JSON.stringify(b);
}

/** Write the whole set. Returns what was written (with the RTP computed per mode). */
export async function writeArtifact(dir: string, art: ArtifactToWrite): Promise<{ manifest: ArtubeManifest; modes: WrittenMode[] }> {
  if (art.clean !== false) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const level = art.level ?? 19;
  const written: WrittenMode[] = [];
  const gameModes: ManifestGameMode[] = [];

  for (const m of art.modes) {
    let sumW = 0n;
    let sumWM = 0n;
    const csv = m.rows
      .map((r) => {
        const w = BigInt(r.weight);
        const mult = BigInt(r.multiplier);
        if (w < 1n) throw new Error(`mode ${m.name}: weight must be ≥ 1 (row id ${r.id})`);
        sumW += w;
        sumWM += w * mult;
        return `${r.id},${w},${mult}`;
      })
      .join('\n');
    const rtp = m.rtp ?? round2(exactRtp(sumWM, sumW, m.cost));
    await writeFile(join(dir, weightsFileName(m.name)), zstdOne(csv, level));
    const n = await writeZstdLines(join(dir, booksFileName(m.name)), toLines(m.books), level);
    if (n !== m.rows.length) throw new Error(`mode ${m.name}: ${m.rows.length} rows but ${n} books — they must match one to one`);
    gameModes.push({ name: m.name, cost: m.cost, type: m.type ?? 'None', rtp, ...(m.volatility ? { volatility: m.volatility } : {}) });
    written.push({ name: m.name, rows: n, rtp, weightsFile: weightsFileName(m.name), eventsFile: booksFileName(m.name) });
  }

  const manifest: ArtubeManifest = {
    settings: { betCredit: art.betCredit, gameModes, ...(art.config !== undefined ? { config: art.config } : {}) },
    modes: art.modes.map((m) => ({ name: m.name, events: booksFileName(m.name), weights: weightsFileName(m.name) })),
  };
  await writeFile(join(dir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, modes: written };
}
