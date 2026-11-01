// Test helpers: build artifact folders in memory (or on disk) with real zstd, exactly as the Hub
// would receive them.
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bufferReader } from '../src/math/zstdFrame';
import type { ArtifactSource } from '../src/math/validate';
import type { LoadedArtifact } from '../src/math/artifact';
import { loadArtifactDir } from '../src/node';

export const z = (s: string | Uint8Array): Uint8Array => new Uint8Array(zstdCompressSync(typeof s === 'string' ? Buffer.from(s) : s));

export type Files = Record<string, string | Uint8Array>;

/** An in-memory ArtifactSource. Strings are stored as-is (for index.json / plain files). */
export function memSource(files: Files): ArtifactSource {
  const bytes = (name: string): Uint8Array => {
    const f = files[name];
    if (f === undefined) throw new Error(`no such file ${name}`);
    return typeof f === 'string' ? new TextEncoder().encode(f) : f;
  };
  return {
    async list() {
      return Object.keys(files);
    },
    async size(name) {
      return bytes(name).length;
    },
    async text(name) {
      return new TextDecoder().decode(bytes(name));
    },
    async open(name) {
      return { read: bufferReader(bytes(name)), close: async () => {} };
    },
    async *lines(name) {
      const raw = bytes(name);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(name.endsWith('.zst') ? zstdDecompressSync(raw) : raw);
      const parts = text.split('\n');
      if (parts.length && parts[parts.length - 1] === '') parts.pop();
      yield* parts;
    },
  };
}

export interface ModeSpec {
  name: string;
  cost: number;
  type?: string;
  rtp?: number;
  rows: Array<[number, number, number]>; // id, weight, multiplier
  books?: string[];
}

/** RTP (percent, 2 dp) of rows at a cost. */
export function rtpOf(rows: Array<[number, number, number]>, cost: number): number {
  const w = rows.reduce((s, r) => s + r[1], 0);
  const wm = rows.reduce((s, r) => s + r[1] * r[2], 0);
  return Math.round((wm / w / cost) * 100 * 100) / 100;
}

/** A complete, valid artifact for the given modes (books default to `{ payoutMultiplier }`). */
export function artifact(modes: ModeSpec[], extra: { betCredit?: number; config?: unknown } = {}): Files {
  const files: Files = {};
  const manifest = {
    settings: {
      betCredit: extra.betCredit ?? 100,
      gameModes: modes.map((m) => ({ name: m.name, cost: m.cost, type: m.type ?? 'None', rtp: m.rtp ?? rtpOf(m.rows, m.cost), volatility: 'High' })),
      config: extra.config ?? { schema: 'artubeplate/slot@1', board: { reels: 3, rows: 3 }, symbols: [{ id: 'A' }] },
    },
    modes: modes.map((m) => ({ name: m.name, events: `books_${m.name}.jsonl.zst`, weights: `lookUpTable_${m.name}_0.csv.zst` })),
  };
  files['index.json'] = JSON.stringify(manifest);
  for (const m of modes) {
    files[`lookUpTable_${m.name}_0.csv.zst`] = z(m.rows.map((r) => r.join(',')).join('\n'));
    files[`books_${m.name}.jsonl.zst`] = z((m.books ?? m.rows.map((r) => JSON.stringify({ id: r[0], payoutMultiplier: r[2], events: [] }))).join('\n'));
  }
  return files;
}

/** Write files into a fresh temp folder; returns its path. */
export function onDisk(files: Files, sub = ''): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'artubeplate-')), sub);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
  return dir;
}

export const TEMPLATE_MATH = join(__dirname, '../../create-artubeplate/template/math');

/** Load the showcase math through the browser loader (fetch + zstd), from disk. */
export function loadTemplateMath(): Promise<LoadedArtifact> {
  return loadArtifactDir(TEMPLATE_MATH);
}

export const templateFiles = (): string[] => readdirSync(TEMPLATE_MATH);
