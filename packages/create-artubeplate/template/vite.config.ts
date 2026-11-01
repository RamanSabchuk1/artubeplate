import { defineConfig } from 'vite';
import { artubePartnerLoader } from '@artube/loader';
import { artubeplate } from '@artubeplate/core/vite';

// Artube serves the built game from a CDN path → RELATIVE asset URLs on build; the RGS lives on
// the SAME origin at `/api-rgs/…`, so there is no backend host to configure anywhere.
//
// The math (index.json + lookUpTable_* + books_*) lives in the top-level `math/` folder, OUTSIDE
// `public/`, so it never ships in `dist/`: upload `math/` to Artube Hub; Artube's pipeline builds
// `dist/` and puts it on the CDN. In dev the artubeplate plugin serves `math/` to the local mock RGS
// and validates it. A plain build never runs the mock (it has no math), so a deployed game opened
// without a session says so. `npm run build:demo` (`--mode demo`) is a standalone demo: the math
// ships in the build and the local mock plays it, from any folder of any static host. Never hand
// that build to Artube.
//
// Port 8080 is where Artube Hub's "Play on Localhost" opens the game.
export default defineConfig(({ command, mode }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [
    // The Artube loading screen — mandatory for every game on the platform.
    artubePartnerLoader(),
    artubeplate({ demoBuild: mode === 'demo' }),
  ],
  server: { host: true, port: 8080 },
  build: {
    // Never inline audio as a data: URL, however small (should you import a sound directly
    // instead of putting it in raw-assets/): the audio engine picks WebM or MP3 by the file
    // extension, and a data: URL has none.
    assetsInlineLimit: (file: string) => (/\.(webm|mp3|m4a|ogg|wav)$/i.test(file) ? false : undefined),
    // Content-hashed file names (Vite's default) are REQUIRED: the Artube CDN caches every
    // asset for a year (`immutable`). Never override `assetFileNames`/`entryFileNames` to drop the hash.
    target: 'es2022',
    // One game bundle (pixi + the HUD + the RGS client) is ~850 kB before gzip; that is expected.
    chunkSizeWarningLimit: 1500,
  },
  // The game, the core, the HUD and pixi-reels must share ONE copy of these.
  resolve: { dedupe: ['pixi.js', 'gsap', '@open-slot-ui/core', '@open-slot-ui/dom'] },
}));
