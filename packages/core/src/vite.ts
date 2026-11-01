// @artubeplate/core/vite — the dev-server half of the local mock RGS.
//
// The game's math lives in `math/` — OUTSIDE `public/`, so it never ships in the client bundle
// (the RGS serves outcomes in production; the math is uploaded to Artube Hub separately). In
// `vite dev` this plugin serves that folder at `/__artubeplate/math/` for the in-process mock, and
// validates it on start so a broken set is loud before anyone presses spin.
//
// `artubeplate({ demoBuild: true })` also copies it into the build, for a standalone demo deploy
// that runs on the mock (never do this for the build you hand to Artube). The plugin also tells the
// core whether the mock may run at all (`__ARTUBEPLATE_MOCK__`): yes in dev and in a demo build, no
// in a plain build — a deployed game without a session in its URL says so instead of looking for
// math that is not there.
//
// With `ARTUBE_HOST=https://<host of an Artube launch URL>` the dev server also proxies `/api-rgs`
// (HTTP + WebSocket) to that environment, so a REAL session plays from localhost with no deploy:
// open `http://localhost:8080/?sessionId=…&gameId=…` (both from the launch URL; Artube Hub's
// Play on Localhost opens exactly that, so games serve dev on 8080).
//
// With a `raw-assets/` folder the plugin also runs the ASSET PIPELINE (./assets/pipeline):
// AssetPack packs spritesheets, makes @0.5x and webp copies, encodes audio to webm (Opus) + mp3,
// and gives every file a content hash, into `public/assets/`. In `vite dev` it watches the folder
// and reloads the page on every change; `vite build` runs it once first. The game imports the
// manifest as the virtual module `artubeplate:assets`.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { extname, join, resolve, normalize, sep } from 'node:path';
import type { Plugin, ProxyOptions, ResolvedConfig } from 'vite';
import { validateDir } from './node/index';
import { ASSETS_MODULE, EMPTY_MANIFEST, buildAssets, resolveAssets, watchAssets, type AssetsOptions, type ResolvedAssets } from './assets/pipeline';

export type { AssetsOptions } from './assets/pipeline';

export interface ArtubeplatePluginOptions {
  /** The math folder (default: `$ARTUBEPLATE_MATH`, else `math`, relative to the Vite root). */
  mathDir?: string;
  /** URL prefix it is served under (default `/__artubeplate/math/`). */
  base?: string;
  /** Validate the set when the dev server starts (default true). */
  validate?: boolean;
  /** Copy the math into the build output too (a mock-only demo deploy). Default false. */
  demoBuild?: boolean;
  /**
   * Proxy `/api-rgs` (the RGS hub, HTTP + WebSocket) to this Artube environment in `vite dev`:
   * the host of a launch URL the Artube team gave you. Default: `$ARTUBE_HOST`. Dev server only.
   */
  rgsHost?: string;
  /**
   * The asset pipeline (AssetPack): `raw-assets/` → `public/assets/`, with the manifest as the
   * module `artubeplate:assets`. On whenever the folder exists; `false` turns it off. Needs the
   * `@assetpack/core` package.
   */
  assets?: AssetsOptions | false;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Serve files of `dir` under `prefix` (dev only). */
function serveFolder(prefix: string, dir: string, fallbackType = 'application/octet-stream') {
  return (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: string): void }, next: () => void): void => {
    const url = (req.url ?? '').split('?')[0]!;
    if (!url.startsWith(prefix)) return next();
    const rel = decodeURIComponent(url.slice(prefix.length));
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end(`artubeplate: ${rel} is not in ${dir}`);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? fallbackType);
    createReadStream(file).pipe(res as never);
  };
}

/** The dev-server proxy that sends `/api-rgs` to a real Artube environment. */
export function rgsProxy(host: string): Record<string, ProxyOptions> {
  const target = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).origin;
  return {
    '/api-rgs': {
      target,
      changeOrigin: true,
      secure: true,
      ws: true,
      // The hub sees its own origin, as it would for the game served from the Artube CDN.
      headers: { origin: target },
      rewriteWsOrigin: true,
      // Any affinity cookie the environment sets must come back through localhost.
      cookieDomainRewrite: '',
    },
  };
}

export const MATH_URL = '/__artubeplate/math/';

export function artubeplate(opts: ArtubeplatePluginOptions = {}): Plugin {
  const base = opts.base ?? MATH_URL;
  let config: ResolvedConfig;
  let dir = '';
  const rgsHost = opts.rgsHost ?? process.env.ARTUBE_HOST;
  const assetOpts = opts.assets === false ? null : (opts.assets ?? {});
  let assets: ResolvedAssets | null = null;
  let manifest: unknown = EMPTY_MANIFEST;
  let manifestReady: Promise<unknown> = Promise.resolve(EMPTY_MANIFEST);
  let stopWatch: (() => Promise<void>) | null = null;
  const RESOLVED = `\0${ASSETS_MODULE}`;
  return {
    name: 'artubeplate',
    config(user, env) {
      const mock = env.command === 'serve' || !!opts.demoBuild;
      // The core reaches some packages only through dynamic imports (the mock's zstd decoder, the
      // pylinka GPU particles, the zvuk mixer). Vite's dev server would find them late, re-bundle and
      // reload the page on a fresh cache, so pre-bundle them up front: fzstd always (the core's own
      // dependency), the optional peers when the game has them installed.
      const root = resolve(user.root ?? process.cwd());
      const installed = (name: string): boolean => existsSync(join(root, 'node_modules', name, 'package.json'));
      const lazy = [
        '@artubeplate/core > fzstd',
        ...(installed('@pylinka/core') ? ['@pylinka/core/pixi'] : []),
        ...(installed('@schmooky/zvuk') ? ['@schmooky/zvuk'] : []),
      ];
      return {
        define: { __ARTUBEPLATE_MOCK__: JSON.stringify(mock) },
        ...(env.command === 'serve' ? { optimizeDeps: { include: lazy } } : {}),
        ...(rgsHost ? { server: { proxy: rgsProxy(rgsHost) } } : {}),
      };
    },
    configResolved(c) {
      config = c;
      // `ARTUBEPLATE_MATH=../other-set npm run dev` plays another math folder without editing anything.
      dir = resolve(c.root, opts.mathDir ?? process.env.ARTUBEPLATE_MATH ?? 'math');
      if (assetOpts) assets = resolveAssets(c.root, c.publicDir || resolve(c.root, 'public'), assetOpts);
    },
    resolveId(id) {
      return id === ASSETS_MODULE ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      manifest = await manifestReady;
      return `export default ${JSON.stringify(manifest)};`;
    },
    async buildStart() {
      if (!assets || !assetOpts || config.command !== 'build' || !existsSync(assets.entry)) return;
      const t0 = Date.now();
      manifestReady = buildAssets(assets, assetOpts);
      manifest = await manifestReady;
      config.logger.info(`  [artubeplate] assets built into ${assets.output} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    },
    async closeBundle() {
      await stopWatch?.();
    },
    configureServer(server) {
      if (assets && assetOpts && existsSync(assets.entry)) {
        const a = assets;
        manifestReady = watchAssets(a, assetOpts, (m) => {
          manifest = m;
          const mod = server.moduleGraph.getModuleById(RESOLVED);
          if (mod) server.moduleGraph.invalidateModule(mod);
          manifestReady = Promise.resolve(m);
          server.ws.send({ type: 'full-reload' });
          config.logger.info('  [artubeplate] raw-assets changed: rebuilt, reloading');
        }).then((w) => {
          stopWatch = w.stop;
          server.httpServer?.once('close', () => void w.stop());
          return w.ready;
        });
        config.logger.info(`\n  [artubeplate] watching ${a.entry} → ${a.output}`);
      }
      if (rgsHost) {
        const target = Object.values(rgsProxy(rgsHost))[0]!.target as string;
        config.logger.info(`\n  [artubeplate] /api-rgs → ${target} (the REAL RGS). Open this page with ?sessionId=…&gameId=… from a launch URL.`);
      }
      if (opts.validate !== false) {
        void validateDir(dir)
          .then((r) => {
            const log = config.logger;
            if (r.ok) log.info(`\n  [artubeplate] math OK — ${r.modes.map((m) => `${m.name} ${m.actualRtp}%`).join(', ')} (served at ${base})`);
            else {
              log.warn(`\n  [artubeplate] math/ FAILS the Hub checks (the mock may still run):`);
              for (const i of r.issues.filter((x) => x.level === 'error').slice(0, 12)) log.warn(`    ✖ ${i.message}`);
              log.warn('    run `npm run math:check` for the full report');
            }
          })
          .catch((e: unknown) => config.logger.warn(`  [artubeplate] cannot read ${dir}: ${e instanceof Error ? e.message : String(e)}`));
      }
      server.middlewares.use(serveFolder(base, dir));
    },
    async writeBundle(output) {
      if (!opts.demoBuild || !existsSync(dir)) return;
      const outDir = output.dir ?? resolve(config.root, config.build.outDir);
      await cp(dir, join(outDir, base.replace(/^\/|\/$/g, '')), { recursive: true });
      config.logger.warn(`  [artubeplate] demoBuild: math copied into the build — do NOT upload this build to Artube.`);
    },
  };
}

export default artubeplate;
