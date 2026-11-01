// Load an artifact into memory and draw outcomes from it — what the RGS does server-side, done
// in the browser for the local mock. The weights load up front (they are small and every draw
// needs them); a mode's books load the first time that mode plays, and stay as raw bytes with a
// line index, so only the drawn line is ever decoded. Tens of MiB of books are fine; a multi-GiB
// production set belongs on the platform, not in a browser tab.

import { decompress } from 'fzstd';
import { parseManifest, clientGameModes, type ClientGameMode } from './manifest';
import type { ArtubeManifest, ManifestModeType } from './types';

export interface LoadedMode {
  name: string;
  type: ManifestModeType;
  cost: number;
  rtp: number;
  volatility?: string;
  priceMultiplier: number;
  /** Row multipliers in credits, in row order. */
  multipliers: Float64Array;
  /** Running sum of weights (row i covers [cum[i-1], cum[i])). */
  cumulative: Float64Array;
  totalWeight: number;
  /** The book lines: fetched on the first `load()`, decoded one at a time by `at()`. */
  books: BookLines;
}

/** A books file held as bytes plus a line index: `load()` once, then `at(i)` decodes line i. */
export class BookLines {
  private bytes: Uint8Array | null = null;
  private starts: Uint32Array | null = null;
  private loading: Promise<void> | null = null;

  /** `length` is the weights table's row count: the books must have exactly that many lines. */
  constructor(
    readonly length: number,
    private readonly fetchBytes: () => Promise<Uint8Array>,
    private readonly label = 'books',
  ) {}

  /** In-memory lines (tests, small sets). */
  static of(lines: string[]): BookLines {
    const b = new BookLines(lines.length, async () => new TextEncoder().encode(lines.join('\n')));
    void b.load();
    return b;
  }

  get loaded(): boolean {
    return this.starts !== null;
  }

  /** Fetch and index the file (once; later calls share the first). */
  load(): Promise<void> {
    return (this.loading ??= this.fetchBytes().then((bytes) => this.index(bytes)));
  }

  /** Line `i` (call after `load()` resolved). */
  at(i: number): string {
    if (!this.bytes || !this.starts) throw new Error(`${this.label}: not loaded yet (await load() first)`);
    if (i < 0 || i >= this.length) throw new RangeError(`${this.label}: no line ${i} (0..${this.length - 1})`);
    const end = i + 1 < this.length ? this.starts[i + 1]! - 1 : this.bytes.length;
    return utf8.decode(this.bytes.subarray(this.starts[i]!, end));
  }

  forEach(fn: (line: string, i: number) => void): void {
    for (let i = 0; i < this.length; i++) fn(this.at(i), i);
  }

  private index(bytes: Uint8Array): void {
    // A single trailing newline is allowed (it does not start a line); an empty file has none.
    const n = bytes.length && bytes[bytes.length - 1] === 10 ? bytes.length - 1 : bytes.length;
    const starts: number[] = n ? [0] : [];
    for (let i = 0; i < n; i++) if (bytes[i] === 10) starts.push(i + 1);
    if (starts.length !== this.length) throw new Error(`math: ${this.label} has ${starts.length} lines but its weights table has ${this.length} rows`);
    this.bytes = n === bytes.length ? bytes : bytes.subarray(0, n);
    this.starts = Uint32Array.from(starts);
  }
}

export interface LoadedArtifact {
  manifest: ArtubeManifest;
  betCredit: number;
  modes: Map<string, LoadedMode>;
  /** What the client receives as `gameSettings.gameModes`. */
  gameModes: ClientGameMode[];
}

export interface LoadArtifactOptions {
  fetch?: typeof fetch;
  /** zstd decoder (default: fzstd). */
  decompress?: (data: Uint8Array) => Uint8Array;
}

const utf8 = new TextDecoder();

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Fetch + decode an artifact folder served at `baseUrl` (with a trailing slash). */
export async function loadArtifact(baseUrl: string, opts: LoadArtifactOptions = {}): Promise<LoadedArtifact> {
  const f = opts.fetch ?? fetch;
  const unzstd = opts.decompress ?? ((d: Uint8Array) => decompress(d));
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  const res = await f(`${base}index.json`);
  if (!res.ok) throw new Error(`math: cannot fetch ${base}index.json (${res.status})`);
  const { manifest, issues } = parseManifest(await res.text());
  if (!manifest) throw new Error(`math: index.json is invalid — ${issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')}`);

  const readBytes = async (file: string): Promise<Uint8Array> => {
    const r = await f(`${base}${file}`);
    if (!r.ok) throw new Error(`math: cannot fetch ${base}${file} (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return file.endsWith('.zst') ? unzstd(bytes) : bytes;
  };

  const byName = new Map(manifest.settings.gameModes.map((g) => [g.name, g]));
  const modes = new Map<string, LoadedMode>();
  await Promise.all(
    manifest.modes.map(async (m) => {
      const gm = byName.get(m.name)!;
      const rows = splitLines(utf8.decode(await readBytes(m.weights)));
      const books = new BookLines(rows.length, () => readBytes(m.events), `mode "${m.name}" books`);
      const multipliers = new Float64Array(rows.length);
      const cumulative = new Float64Array(rows.length);
      let total = 0;
      rows.forEach((row, i) => {
        const [, w, mult] = row.split(',');
        total += Number(w);
        cumulative[i] = total;
        multipliers[i] = Number(mult);
      });
      modes.set(m.name, {
        name: m.name,
        type: gm.type ?? 'None',
        cost: gm.cost,
        rtp: gm.rtp,
        ...(gm.volatility ? { volatility: gm.volatility } : {}),
        priceMultiplier: gm.cost / manifest.settings.betCredit,
        multipliers,
        cumulative,
        totalWeight: total,
        books,
      });
    }),
  );
  return { manifest, betCredit: manifest.settings.betCredit, modes, gameModes: clientGameModes(manifest) };
}

/** Pick a row index by weight. `u` is uniform in [0, 1). Binary search over the running sums. */
export function drawRow(mode: LoadedMode, u: number): number {
  const target = u * mode.totalWeight;
  let lo = 0;
  let hi = mode.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (mode.cumulative[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Deterministic PRNG (mulberry32) for reproducible mock sessions. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
