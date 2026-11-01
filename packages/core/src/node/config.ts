// Give an artifact folder a client config when it has none: infer the board + symbol set from the
// base mode's books and write it into index.json as `settings.config`. index.json is the one file
// that is not compressed, so this is a plain rewrite; the weights/books are untouched.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDecoded, streamLines } from './fsSource';
import { inferSlotConfig } from '../math/infer';
import { parseManifest } from '../math/manifest';

export interface EnsureConfigResult {
  /** `kept` — the folder already had a config (and `force` was off). */
  status: 'kept' | 'written';
  notes: string[];
}

export async function ensureConfig(dir: string, opts: { force?: boolean; title?: string } = {}): Promise<EnsureConfigResult> {
  const path = join(dir, 'index.json');
  const raw = JSON.parse(await readFile(path, 'utf8')) as { settings?: Record<string, unknown>; modes?: unknown };
  if (raw.settings?.config !== undefined && !opts.force) return { status: 'kept', notes: ['index.json already has settings.config (use --force to replace it)'] };
  const { manifest } = parseManifest(JSON.stringify({ ...raw, settings: { ...raw.settings, config: {} } }));
  if (!manifest) throw new Error('index.json is not a valid Artube manifest — fix it first (`artubeplate math validate`)');
  const base = manifest.settings.gameModes.find((g) => (g.type ?? 'None') === 'None') ?? manifest.settings.gameModes[0]!;
  const files = manifest.modes.find((m) => m.name === base.name)!;
  const inferred = await inferSlotConfig(streamLines(openDecoded(join(dir, files.events))), opts.title ? { title: opts.title } : {});
  raw.settings = { ...raw.settings, config: inferred.config };
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  return {
    status: 'written',
    notes: [
      `inferred a ${inferred.config.board.reels}×${inferred.config.board.rows} board and ${inferred.config.symbols.length} symbols from ${inferred.scanned} "${base.name}" books`,
      ...inferred.notes,
      'no paytable could be inferred — add settings.config.pays and paylines (or pays.ways) for the rules window',
    ],
  };
}
