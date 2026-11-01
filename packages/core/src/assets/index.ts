// @artubeplate/core/assets — the game side of the asset pipeline.
//
//   import assets from 'artubeplate:assets';            // the manifest (from raw-assets/)
//   import { loadAssets, soundsFromManifest } from '@artubeplate/core/assets';
//
//   audio: { sounds: soundsFromManifest(assets), bgm: 'base' }        // in createArtubeGame
//   await loadAssets(assets, { onProgress: (p) => ctx.loader.setProgress(p) });   // in mountView
//   Texture.from('sym-H1')                              // a frame of a {tps} spritesheet, by name
//
// Textures go through Pixi's Assets (it picks @0.5x or @1x and webp or png per device); audio
// never does: `soundsFromManifest` hands every sound to zvuk, routed by its folder.

import { Assets, type AssetsManifest, type UnresolvedAsset } from 'pixi.js';
import type { BusName, SoundEntry } from '../audio/index';

/** The base path of the processed files, relative to the page (the plugin's `output`). */
export const DEFAULT_ASSETS_BASE = 'assets';

const AUDIO_EXT = /\.(webm|mp3|m4a|ogg|wav|flac)$/i;
const BUSES: readonly string[] = ['music', 'ambience', 'reels', 'symbols', 'anticipation', 'wins', 'voiceover', 'ui', 'reverb'];

type Entry = UnresolvedAsset & { alias?: string | string[]; src?: string | string[] };

const srcsOf = (a: Entry): string[] => (Array.isArray(a.src) ? a.src : a.src ? [a.src as string] : []).map((s) => (typeof s === 'string' ? s : String((s as { src?: string }).src ?? '')));
const isAudio = (a: Entry): boolean => {
  const s = srcsOf(a);
  return s.length > 0 && s.every((x) => AUDIO_EXT.test(x));
};
/** The path inside raw-assets without its {tags} or its source extension (`audio/reels/reel-stop.1`). */
const pathOf = (a: Entry): string => {
  const al = Array.isArray(a.alias) ? a.alias : a.alias ? [a.alias] : [];
  const longest = [...al].sort((x, y) => y.length - x.length)[0] ?? srcsOf(a)[0] ?? '';
  return longest.replace(AUDIO_EXT, '');
};
const join = (base: string, p: string): string => (base ? `${base.replace(/\/$/, '')}/${p}` : p);

/** The manifest without its audio (Pixi has no loader for it; zvuk plays it). */
export function textureManifest(manifest: AssetsManifest): AssetsManifest {
  return {
    bundles: manifest.bundles
      .map((b) => ({ ...b, assets: (Array.isArray(b.assets) ? (b.assets as Entry[]) : []).filter((a) => !isAudio(a)) }))
      .filter((b) => (b.assets as Entry[]).length > 0),
  };
}

export interface LoadAssetsOptions {
  /** Bundles to load. Default: every bundle that has textures (or data), in manifest order. */
  bundles?: string[];
  /** Where the processed files are served, relative to the page. Default `assets`. */
  basePath?: string;
  /** 0..1 as the bundles load (feed the loader's progress bar). */
  onProgress?: (progress: number) => void;
}

let initialized = false;

/**
 * Load the manifest's texture bundles through Pixi's Assets, with progress. Pixi resolves each
 * texture to the best resolution and format for the device. Safe to call more than once (later
 * calls load further bundles).
 */
export async function loadAssets(manifest: AssetsManifest, opts: LoadAssetsOptions = {}): Promise<void> {
  const textures = textureManifest(manifest);
  if (!initialized) {
    initialized = true;
    await Assets.init({ manifest: textures, basePath: opts.basePath ?? DEFAULT_ASSETS_BASE });
  }
  const names = opts.bundles ?? textures.bundles.map((b) => b.name);
  if (!names.length) {
    opts.onProgress?.(1);
    return;
  }
  await Assets.loadBundle(names, (p) => opts.onProgress?.(p));
}

export interface SoundsFromManifestOptions {
  /** Where the processed files are served, relative to the page. Default `assets`. */
  basePath?: string;
  /** The bus for a sound outside any bus folder. Default `ui`. */
  defaultBus?: BusName;
  /** Seconds of crossfade at a plain music loop's boundary (no authored intro/outro). Default 0.4. */
  loopCrossfade?: number;
}

/**
 * The manifest's audio as zvuk entries, by convention:
 * - the folder is the bus: `audio/reels/reel-stop.wav` plays on `reels` as `reel-stop`;
 * - `name.1.wav`, `name.2.wav`… are VARIANTS of `name` (a different take on every play);
 * - in `music/`, `base.intro` / `base.loop` / `base.outro` are the stems of the track `base`
 *   (a lone `music/base.wav` is a plain loop).
 */
export function soundsFromManifest(manifest: AssetsManifest, opts: SoundsFromManifestOptions = {}): SoundEntry[] {
  const base = opts.basePath ?? DEFAULT_ASSETS_BASE;
  const fallback = opts.defaultBus ?? 'ui';
  const singles = new Map<string, { bus: BusName; takes: Map<number, string[]> }>();
  const music = new Map<string, { bus: BusName; intro?: string[]; loop?: string[]; outro?: string[] }>();
  for (const bundle of manifest.bundles) {
    for (const a of (Array.isArray(bundle.assets) ? bundle.assets : []) as Entry[]) {
      if (!isAudio(a)) continue;
      const urls = srcsOf(a)
        .sort((x, y) => Number(/\.mp3$/i.test(x)) - Number(/\.mp3$/i.test(y))) // webm (Opus) first, mp3 fallback
        .map((s) => join(base, s));
      const parts = pathOf(a).split('/');
      const file = parts.pop()!;
      const busDir = [...parts].reverse().find((p) => BUSES.includes(p));
      const bus = (busDir ?? fallback) as BusName;
      if (bus === 'music' || bus === 'ambience') {
        const m = /^(.*?)(?:\.(intro|loop|outro))?$/.exec(file)!;
        const track = music.get(m[1]!) ?? { bus };
        track[(m[2] as 'intro' | 'loop' | 'outro' | undefined) ?? 'loop'] = urls;
        music.set(m[1]!, track);
        continue;
      }
      const v = /^(.*)\.(\d+)$/.exec(file);
      const name = v ? v[1]! : file;
      const entry = singles.get(name) ?? { bus, takes: new Map<number, string[]>() };
      entry.takes.set(v ? Number(v[2]) : 0, urls);
      singles.set(name, entry);
    }
  }
  const out: SoundEntry[] = [];
  for (const [name, s] of singles) {
    const takes = [...s.takes.entries()].sort((x, y) => x[0] - y[0]).map(([, u]) => u);
    out.push(takes.length > 1 ? { name, kind: 'variants', urls: takes, bus: s.bus } : { name, url: takes[0]!, bus: s.bus });
  }
  for (const [name, m] of music) {
    if (!m.loop) continue;
    const authored = !!(m.intro || m.outro);
    out.push({
      name,
      kind: 'music',
      loop: m.loop,
      ...(m.intro ? { intro: m.intro } : {}),
      ...(m.outro ? { outro: m.outro } : {}),
      ...(authored ? {} : { loopCrossfadeMs: (opts.loopCrossfade ?? 0.4) * 1000 }),
      bus: m.bus as 'music' | 'ambience',
    });
  }
  return out;
}
