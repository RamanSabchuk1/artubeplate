// What a game imports is what it ships.
// - A build for Artube never ships the mock RGS: `loadNetwork` imports it behind the
//   `__ARTUBEPLATE_MOCK__` define, which the artubeplate Vite plugin sets false for a plain build
//   (true for `vite dev` and demo builds).
// - The scenes and fx subpaths only bring what is used: the scene director alone carries no
//   shader transitions or gsap, the particle blitter alone carries no pylinka.
// - The assets subpath stays out of a game that does not import it, and its runtime side never
//   carries the Node-side AssetPack pipeline (which only the Vite plugin imports).
// Each case bundles a fixture in fixtures/treeshake with Vite (minified, as for production) and
// reads the output. Every marker is also checked present in a build that does use it, so a
// marker that never appears cannot make a check pass.
import { describe, it, expect } from 'vitest';
import { build, type Rollup } from 'vite';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const FIXTURES = join(__dirname, 'fixtures/treeshake');

/** Strings only the mock RGS, its math loader or fzstd carry (method names survive minifying). */
const MOCK = [
  'forceRow', // MockRgs's QA API
  'simulateReconnect',
  'mock: injected error', // MockRgs's scripted failures
  'cannot fetch', // the math loader (math/artifact)
  'invalid zstd data', // fzstd
];
const SHADERS = 'transition(vUV)'; // scenes/shaders: the transition fragment wrapper
const GSAP = /GreenSock|gsap/i;
const PYLINKA = /pylinka/i;
const ASSETS = 'webm|mp3|m4a|ogg|wav|flac'; // assets/index: what counts as an audio file
const PIPELINE = 'artubeplate-manifest.json'; // assets/pipeline: the AssetPack manifest it writes

async function bundle(entry: string, mock = false): Promise<string> {
  const result = (await build({
    root: FIXTURES,
    configFile: false,
    logLevel: 'silent',
    define: { __ARTUBEPLATE_MOCK__: JSON.stringify(mock) },
    build: { write: false, rollupOptions: { input: join(FIXTURES, entry) } },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  return (Array.isArray(result) ? result : [result])
    .flatMap((o) => o.output)
    .map((f) => (f.type === 'chunk' ? f.code : ''))
    .join('\n');
}

describe('tree-shaking: the mock RGS stays out of a build for Artube', () => {
  it('a plain build of a game has no MockRgs, no math loader and no fzstd', async () => {
    const code = await bundle('game.ts');
    for (const marker of MOCK) expect(code, marker).not.toContain(marker);
    // …nor anything from the scenes or fx subpaths it does not import.
    expect(code).not.toContain(SHADERS);
    expect(code).not.toMatch(GSAP);
    expect(code).not.toMatch(PYLINKA);
    expect(code).not.toContain(ASSETS);
  }, 120_000);

  it('a dev or demo build of the same game still has them', async () => {
    const code = await bundle('game.ts', true);
    for (const marker of MOCK) expect(code, marker).toContain(marker);
  }, 120_000);
});

describe('tree-shaking: the scenes and fx subpaths bring only what is used', () => {
  it('the scene director alone: no shader transitions, no gsap', async () => {
    const code = await bundle('scenes-director.ts');
    expect(code).not.toContain(SHADERS);
    expect(code).not.toMatch(GSAP);
    expect(await bundle('scenes-all.ts')).toContain(SHADERS);
  }, 120_000);

  it('the particle blitter alone: no pylinka', async () => {
    expect(await bundle('fx-blitter.ts')).not.toMatch(PYLINKA);
    expect(await bundle('fx-all.ts')).toMatch(PYLINKA);
  }, 120_000);
});

describe('tree-shaking: the assets subpath', () => {
  it('its runtime side is only in a game that imports it, and never carries the Node pipeline', async () => {
    const code = await bundle('assets-all.ts');
    expect(code).toContain(ASSETS); // …and the game build above does not
    expect(code).not.toContain(PIPELINE);
    expect(readFileSync(join(__dirname, '../src/assets/pipeline.ts'), 'utf8')).toContain(PIPELINE); // the marker is real
  }, 120_000);
});
