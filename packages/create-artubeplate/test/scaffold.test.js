// node --test: the scaffolder end to end, into temp folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeName, titleOf, mathKind, coreSpec, vendoredCore } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'index.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'create-artubeplate-'));

test('names', () => {
  assert.equal(sanitizeName('My Lucky_Cats!'), 'my-lucky-cats');
  assert.equal(titleOf('lucky-cats'), 'Lucky Cats');
});

test('--core: a range stays, a local tarball/folder becomes an absolute file: spec', () => {
  assert.match(coreSpec(undefined), /^\^/);
  assert.equal(coreSpec('^0.2.0'), '^0.2.0');
  assert.equal(coreSpec('next'), 'next');
  assert.equal(coreSpec('./packs/core.tgz', '/work'), 'file:/work/packs/core.tgz');
  assert.equal(coreSpec('file:../core', '/work/games'), 'file:/work/core');
  assert.equal(coreSpec('artubeplate-core-0.1.0.tgz', '/w'), 'file:/w/artubeplate-core-0.1.0.tgz');
});

test('--core with a tarball: vendored into the project with a relative spec', () => {
  assert.equal(vendoredCore(undefined), null);
  assert.equal(vendoredCore('^0.2.0'), null);
  assert.equal(vendoredCore('../core', '/w'), null);
  assert.deepEqual(vendoredCore('./packs/artubeplate-core-0.1.0.tgz', '/work'), { from: '/work/packs/artubeplate-core-0.1.0.tgz', spec: 'file:vendor/artubeplate-core-0.1.0.tgz' });
  const root = tmp();
  writeFileSync(join(root, 'artubeplate-core-0.1.0.tgz'), 'not really a tarball');
  const out = execFileSync('node', [bin, 'v', '--yes', '--core', './artubeplate-core-0.1.0.tgz'], { cwd: root, encoding: 'utf8' });
  const pkg = JSON.parse(readFileSync(join(root, 'v', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@artubeplate/core'], 'file:vendor/artubeplate-core-0.1.0.tgz');
  assert.equal(readFileSync(join(root, 'v', 'vendor', 'artubeplate-core-0.1.0.tgz'), 'utf8'), 'not really a tarball');
  assert.match(out, /vendor\/artubeplate-core-0\.1\.0\.tgz/);
  assert.throws(() => execFileSync('node', [bin, 'w', '--yes', '--core', './missing.tgz'], { cwd: root, stdio: 'pipe' }));
});

test("ready for Artube's pipeline: no CI file of its own, dev on Hub's localhost port, dist ignored at the root only", () => {
  const root = tmp();
  const out = execFileSync('node', [bin, 'ship', '--yes'], { cwd: root, encoding: 'utf8' });
  const dir = join(root, 'ship');
  assert.ok(!existsSync(join(dir, '.gitlab-ci.yml')));
  assert.match(readFileSync(join(dir, 'vite.config.ts'), 'utf8'), /port: 8080/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\/dist$/m);
  assert.doesNotMatch(out, /R2_GAME_ID|gameServerId/);
  assert.match(out, /npm ci/);
});

test('scaffolds the template: name substituted, workspace dep pinned, .gitignore restored, sample math present', () => {
  const root = tmp();
  execFileSync('node', [bin, 'lucky-cats', '--yes'], { cwd: root, stdio: 'pipe' });
  const dir = join(root, 'lucky-cats');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'lucky-cats');
  assert.match(pkg.dependencies['@artubeplate/core'], /^\^/);
  assert.ok(existsSync(join(dir, '.gitignore')));
  assert.ok(!existsSync(join(dir, 'node_modules')));
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<title>Lucky Cats<\/title>/);
  assert.deepEqual(readdirSync(join(dir, 'math')).sort(), ['books_base.jsonl.zst', 'books_buyfs.jsonl.zst', 'books_luckybet.jsonl.zst', 'index.json', 'lookUpTable_base_0.csv.zst', 'lookUpTable_buyfs_0.csv.zst', 'lookUpTable_luckybet_0.csv.zst']);
});

test('ships the source art, sound and thumbnails, never the asset pipeline\'s output', () => {
  const root = tmp();
  execFileSync('node', [bin, 'p', '--yes'], { cwd: root, encoding: 'utf8' });
  const dir = join(root, 'p');
  assert.ok(existsSync(join(dir, 'raw-assets', 'game{m}', 'symbols{tps}')), 'symbol art to pack');
  assert.ok(readdirSync(join(dir, 'raw-assets', 'audio{m}', 'reels')).some((f) => f.endsWith('.wav')), 'sounds to encode');
  for (const f of ['thumbnail-301x180.jpg', 'thumbnail-301x180.psd', 'thumbnail-400x535.jpg', 'thumbnail-400x535.psd']) assert.ok(existsSync(join(dir, 'thumbnails', f)), f);
  assert.ok(!existsSync(join(dir, 'public', 'assets')), 'public/assets is generated, not copied');
  assert.ok(!existsSync(join(dir, '.assetpack')), 'the pipeline cache is not copied');
  const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/public\/assets\/$/m);
  assert.match(gitignore, /^\.assetpack\/$/m);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.devDependencies['@assetpack/core'], 'the pipeline is a dev dependency');
});

test('--math with an Artube set replaces the sample (only the referenced files) and writes .env', async () => {
  const root = tmp();
  const src = join(root, 'their-math');
  mkdirSync(src);
  const tpl = join(here, '..', 'template', 'math');
  for (const f of readdirSync(tpl)) if (f.includes('base') || f === 'index.json') copyFileSync(join(tpl, f), join(src, f));
  const idx = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8'));
  idx.settings.gameModes = idx.settings.gameModes.filter((m) => m.name === 'base');
  idx.modes = idx.modes.filter((m) => m.name === 'base');
  writeFileSync(join(src, 'index.json'), JSON.stringify(idx));
  writeFileSync(join(src, 'notes.txt'), 'not part of the set');
  assert.equal(await mathKind(src), 'artube');
  execFileSync('node', [bin, 'g', '--yes', '--math', src, '--game-server-id', 'srv-42'], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(readdirSync(join(root, 'g', 'math')).sort(), ['books_base.jsonl.zst', 'index.json', 'lookUpTable_base_0.csv.zst']);
  assert.equal(readFileSync(join(root, 'g', '.env'), 'utf8').trim(), 'VITE_GAME_SERVER_ID=srv-42');
});

test('--math with a Stake folder is staged for conversion', async () => {
  const root = tmp();
  const src = join(root, 'stake');
  mkdirSync(src);
  writeFileSync(join(src, 'index.json'), JSON.stringify({ modes: [{ name: 'base', cost: 1, events: 'books_base.jsonl.zst', weights: 'lookUpTable_base_0.csv' }] }));
  writeFileSync(join(src, 'lookUpTable_base_0.csv'), '1,1,0');
  writeFileSync(join(src, 'books_base.jsonl.zst'), 'x');
  assert.equal(await mathKind(src), 'stake');
  const out = execFileSync('node', [bin, 's', '--yes', '--math', src], { cwd: root, encoding: 'utf8' });
  assert.match(out, /math:from-stake/);
  assert.ok(existsSync(join(root, 's', 'math-stake', 'lookUpTable_base_0.csv')));
});

test('refuses a non-empty target', () => {
  const root = tmp();
  mkdirSync(join(root, 'taken'));
  writeFileSync(join(root, 'taken', 'x'), '1');
  assert.throws(() => execFileSync('node', [bin, 'taken', '--yes'], { cwd: root, stdio: 'pipe' }));
});
