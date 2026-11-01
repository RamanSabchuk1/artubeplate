// A folder on disk as an ArtifactSource — streaming, so a production-size set validates in
// constant memory: zstd is decompressed as a stream (node:zlib), lines are split by hand (NOT
// readline, which would silently swallow the `\r` of Windows line endings the Hub rejects).

import { readdir, stat, readFile, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { join } from 'node:path';
import type { ArtifactSource } from '../math/validate';

/** Split a byte stream into lines. Strict UTF-8 (invalid bytes throw). A final `\n` yields no empty line. */
export async function* streamLines(stream: AsyncIterable<Buffer | Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder('utf-8', { fatal: true });
  let rest = '';
  for await (const chunk of stream) {
    const parts = (rest + dec.decode(chunk, { stream: true })).split('\n');
    rest = parts.pop() ?? '';
    for (const p of parts) yield p;
  }
  rest += dec.decode();
  if (rest.length) yield rest;
}

/** The decompressed contents of a file as a byte stream (`.zst` → zstd, anything else raw). */
export function openDecoded(path: string): AsyncIterable<Buffer> {
  const raw = createReadStream(path, { highWaterMark: 1 << 20 });
  return path.endsWith('.zst') ? raw.pipe(createZstdDecompress()) : raw;
}

export function dirSource(dir: string): ArtifactSource {
  return {
    async list() {
      // Everything counts — a stray `.DS_Store` or a subfolder is an extra file to the Hub too.
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    },
    async size(name) {
      return (await stat(join(dir, name))).size;
    },
    async text(name) {
      return readFile(join(dir, name), 'utf8');
    },
    async open(name) {
      const fh = await open(join(dir, name), 'r');
      return {
        read: async (offset, length) => {
          const buf = new Uint8Array(length);
          const { bytesRead } = await fh.read(buf, 0, length, offset);
          return buf.subarray(0, bytesRead);
        },
        close: () => fh.close(),
      };
    },
    lines(name) {
      return streamLines(openDecoded(join(dir, name)));
    },
  };
}
