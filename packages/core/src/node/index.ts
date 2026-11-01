// @artubeplate/core/node — the Node-only half of the math tooling: read a folder as an
// ArtifactSource, write a set as one-stream zstd files, convert Stake math-sdk output, normalize
// a hand-made folder. The `artubeplate` CLI is a thin shell over these.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { validateArtifact, type ValidateOptions } from '../math/validate';
import { loadArtifact, type LoadedArtifact } from '../math/artifact';
import type { ValidationReport } from '../math/types';
import { dirSource } from './fsSource';

export * from './fsSource';
export * from './write';
export * from './fromStake';
export * from './pack';
export * from './config';

/** Validate an artifact folder on disk exactly as the Hub would. */
export function validateDir(dir: string, opts?: ValidateOptions): Promise<ValidationReport> {
  return validateArtifact(dirSource(dir), opts);
}

/** Load an artifact folder from disk for the mock RGS (`new MockRgs({ math })`) — headless tests. */
export function loadArtifactDir(dir: string): Promise<LoadedArtifact> {
  const base = 'file:///artifact/';
  return loadArtifact(base, {
    fetch: (async (url: string) => {
      const name = decodeURIComponent(String(url).slice(base.length));
      const buf = await readFile(join(dir, name)).catch(() => null);
      if (!buf) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }) as unknown as typeof fetch,
    decompress: (d) => new Uint8Array(zstdDecompressSync(d)),
  });
}
