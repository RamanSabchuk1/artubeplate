import { defineConfig } from 'tsdown';

// @artubeplate/core ships one entry per public subpath — ESM only (the games are all ESM/Vite)
// plus rolled-up .d.ts. tsdown externalizes every dependency + peerDependency, so nothing here
// bundles the peers — the game supplies @open-slot-ui, @artube/loader, zvuk, and pixi.js + gsap
// for the `scenes`, `ui`, `fx` and `motion` entries (motion also inlines its
// motion-style.json, so the subpath is one file).
//
// Three entries are Node-only and never reach a browser bundle: `vite` (the plugin that serves
// math/ to the mock RGS in dev), `node` (read/write/convert artifact folders) and `cli` (the
// `artubeplate` bin). They share the isomorphic `math` code with the browser mock.
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      rgs: 'src/rgs/index.ts',
      math: 'src/math/index.ts',
      audio: 'src/audio/index.ts',
      rules: 'src/rules/index.ts',
      scenes: 'src/scenes/index.ts',
      ui: 'src/ui/index.ts',
      fx: 'src/fx/index.ts',
      motion: 'src/motion/index.ts',
      assets: 'src/assets/index.ts',
      testing: 'src/testing/index.ts',
    },
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { vite: 'src/vite.ts', node: 'src/node/index.ts', cli: 'src/cli/index.ts' },
    format: ['esm'],
    platform: 'node',
    // Plain `.js` like the browser entries (the package is `type: module`), so the exports map
    // and the bin point at one naming scheme.
    fixedExtension: false,
    external: [/^node:/, 'vite'],
    dts: true,
    sourcemap: true,
    clean: false,
  },
]);
