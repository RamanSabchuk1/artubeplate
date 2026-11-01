// The asset pipeline (Node side): AssetPack turns `raw-assets/` into game-ready files.
//
//   raw-assets/                       public/assets/  (generated, git-ignored)
//   ├── game{m}/                  →   game/…           a manifest bundle per {m} folder
//   │   ├── symbols{tps}/*.png    →   one spritesheet, @1x and @0.5x, png + webp
//   │   └── bg/*.jpg              →   jpg + webp, @1x and @0.5x
//   └── audio{m}/<bus>/*.wav      →   webm (Opus) + mp3, the codec ladder zvuk picks from
//
// Every output name carries a content hash, so the Artube CDN's year-long cache never serves a
// stale file. The manifest is not a file the game fetches: the Vite plugin hands it to the code as
// the virtual module `artubeplate:assets`, so it is bundled (and hashed) with the JS.
// AssetPack is an optional peer dependency, loaded only when a `raw-assets` folder exists.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AssetsOptions {
  /** The raw assets folder, relative to the Vite root. Default `raw-assets`. No folder, no pipeline. */
  entry?: string;
  /** The output folder inside Vite's public dir. Default `assets` (`public/assets`). */
  output?: string;
  /** Texture resolutions. Default `{ default: 1, low: 0.5 }`: Pixi picks @0.5x on small screens. */
  resolutions?: Record<string, number>;
  /** Image formats. Default png + webp (Pixi loads webp where the browser supports it). */
  images?: { png?: boolean; webp?: boolean; avif?: boolean; jpg?: boolean };
  /** Audio bitrates in kbps. Default effects 64 (Opus) / 96 (mp3) mono; music 96 / 128 stereo. */
  audio?: { effects?: { opus?: number; mp3?: number }; music?: { opus?: number; mp3?: number } };
  /** Extra AssetPack config merged over ours (pipes, ignore, assetSettings…). */
  assetpack?: Record<string, unknown>;
}

export interface ResolvedAssets {
  entry: string;
  output: string;
  /** Where AssetPack writes the manifest (inside its cache folder, never served). */
  manifestFile: string;
  cacheDir: string;
}

export const ASSETS_MODULE = 'artubeplate:assets';
export const EMPTY_MANIFEST = { bundles: [] as unknown[] };

export function resolveAssets(root: string, publicDir: string, opts: AssetsOptions): ResolvedAssets {
  const cacheDir = resolve(root, '.assetpack');
  return {
    entry: resolve(root, opts.entry ?? 'raw-assets'),
    output: resolve(publicDir, opts.output ?? 'assets'),
    manifestFile: join(cacheDir, 'artubeplate-manifest.json'),
    cacheDir,
  };
}

/** The AssetPack config for an artubeplate game. */
export async function assetPackConfig(r: ResolvedAssets, opts: AssetsOptions): Promise<Record<string, unknown>> {
  const { pixiPipes } = await import('@assetpack/core/pixi');
  const fx = { opus: opts.audio?.effects?.opus ?? 64, mp3: opts.audio?.effects?.mp3 ?? 96 };
  const music = { opus: opts.audio?.music?.opus ?? 96, mp3: opts.audio?.music?.mp3 ?? 128 };
  const audioOutputs = (channels: number, rate: { opus: number; mp3: number }) => [
    { formats: ['.webm'], recompress: true, options: { audioCodec: 'libopus', audioBitrate: rate.opus, audioChannels: channels, audioFrequency: 48000 } },
    { formats: ['.mp3'], recompress: true, options: { audioBitrate: rate.mp3, audioChannels: channels, audioFrequency: 44100 } },
  ];
  const images = { png: true, webp: true, avif: false, jpg: true, ...opts.images };
  return {
    entry: r.entry,
    output: r.output,
    cache: true,
    cacheLocation: r.cacheDir,
    logLevel: 'warn',
    // Notes next to the art (a README, a .psd source) are not game assets.
    ignore: ['**/*.md', '**/*.txt', '**/*.psd', '**/.DS_Store'],
    pipes: [
      ...pixiPipes({
        cacheBust: true,
        resolutions: opts.resolutions ?? { default: 1, low: 0.5 },
        compression: { png: images.png, webp: images.webp, avif: images.avif, jpg: images.jpg },
        texturePacker: { texturePacker: { removeFileExtension: true } },
        audio: { inputs: ['.wav', '.mp3', '.ogg', '.flac', '.webm', '.m4a'], outputs: audioOutputs(1, fx) },
        manifest: { output: r.manifestFile, trimExtensions: true, createShortcuts: true },
      }),
    ],
    // Music stays stereo, at a higher bitrate.
    assetSettings: [{ files: ['**/music/**'], settings: { audio: { outputs: audioOutputs(2, music) } } }],
    ...opts.assetpack,
  };
}

export function readManifest(r: ResolvedAssets): unknown {
  if (!existsSync(r.manifestFile)) return EMPTY_MANIFEST;
  return JSON.parse(readFileSync(r.manifestFile, 'utf8')) as unknown;
}

/** One build of the assets (`vite build`, or the `artubeplate assets` command). */
export async function buildAssets(r: ResolvedAssets, opts: AssetsOptions): Promise<unknown> {
  if (!existsSync(r.entry)) return EMPTY_MANIFEST;
  const { AssetPack } = await import('@assetpack/core');
  const ap = new AssetPack((await assetPackConfig(r, opts)) as never);
  await ap.run();
  return readManifest(r);
}

/** Watch the raw assets (dev): `onChange` gets the new manifest after every rebuild. */
export async function watchAssets(r: ResolvedAssets, opts: AssetsOptions, onChange: (manifest: unknown) => void): Promise<{ stop(): Promise<void>; ready: Promise<unknown> }> {
  if (!existsSync(r.entry)) return { stop: async () => {}, ready: Promise.resolve(EMPTY_MANIFEST) };
  const { AssetPack } = await import('@assetpack/core');
  const ap = new AssetPack((await assetPackConfig(r, opts)) as never);
  let first = true;
  let markReady!: (m: unknown) => void;
  const ready = new Promise<unknown>((res) => (markReady = res));
  void ap.watch(() => {
    const manifest = readManifest(r);
    if (first) {
      first = false;
      markReady(manifest);
    } else onChange(manifest);
  });
  return { stop: () => ap.stop(), ready };
}
