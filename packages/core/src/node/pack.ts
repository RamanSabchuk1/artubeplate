// Normalize a hand-made Artube folder: every weights/books file becomes exactly one zstd stream
// named `.csv.zst` / `.jsonl.zst` (plain `.csv`/`.jsonl` get compressed, multi-frame `.zst`
// files get re-framed), the manifest is rewritten to match, and nothing extra is copied.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { openDecoded, streamLines } from './fsSource';
import { writeZstdLines } from './write';
import { parseManifest } from '../math/manifest';
import type { ArtubeManifest } from '../math/types';

export async function packDir(input: string, out: string, log: (m: string) => void = () => {}): Promise<ArtubeManifest> {
  const { manifest, issues } = parseManifest(await readFile(join(input, 'index.json'), 'utf8'));
  if (!manifest) throw new Error(`index.json: ${issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')}`);
  if (input === out) throw new Error('pack writes a NEW folder — pass a different --out');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const zst = (name: string, ext: '.csv' | '.jsonl'): string => {
    const base = name.replace(/\.zst$/, '');
    return base.endsWith(ext) ? `${base}.zst` : `${base}${ext}.zst`;
  };
  const modes = [];
  for (const m of manifest.modes) {
    const weights = zst(m.weights, '.csv');
    const events = zst(m.events, '.jsonl');
    // Re-emit line by line: this also drops a trailing newline and any `\r`.
    const clean = async function* (file: string): AsyncGenerator<string> {
      for await (const line of streamLines(openDecoded(join(input, file)))) yield line.replace(/\r$/, '');
    };
    const nw = await writeZstdLines(join(out, weights), clean(m.weights));
    const nb = await writeZstdLines(join(out, events), clean(m.events));
    log(`· ${m.name}: ${m.weights} → ${weights} (${nw} rows), ${m.events} → ${events} (${nb} lines)`);
    modes.push({ name: m.name, events, weights });
  }
  const packed: ArtubeManifest = { settings: manifest.settings, modes };
  await writeFile(join(out, 'index.json'), `${JSON.stringify(packed, null, 2)}\n`);
  return packed;
}
