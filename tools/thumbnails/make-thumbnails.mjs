// Render the Artube Hub thumbnails from a running build of the game.
//
//   node tools/thumbnails/make-thumbnails.mjs <game url> <out dir>
//   (e.g. a `npm run build:demo` served locally: http://127.0.0.1:5343/)
//
// Artube wants two sizes, each as JPEG and PSD, with the game's title on them:
//   301×180, JPEG ≤ 50 KB      400×535, JPEG ≤ 100 KB
// Each size is rendered at 4× / 2× in the matching orientation with the HUD hidden. The PSD carries
// three layers (the title on its own, the art under it, and the flattened image) so a designer can
// swap the art and keep the title. Needs Playwright (Chromium) and ImageMagick 7 (`magick`).

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [, , url = 'http://127.0.0.1:5343/', outArg = 'thumbnails'] = process.argv;
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'thumbs-'));

const SIZES = [
  { name: 'thumbnail-301x180', w: 301, h: 180, scale: 4, maxKB: 50 },
  { name: 'thumbnail-400x535', w: 400, h: 535, scale: 2, maxKB: 100 },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const s of SIZES) {
    const context = await browser.newContext({ viewport: { width: s.w * s.scale, height: s.h * s.scale }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      window.__PIXI_APP_INIT__ = (app) => (window.__APP__ = app);
    });
    const page = await context.newPage();
    await page.goto(new URL('?intro=0', url).href);
    await page.waitForFunction(() => window.__GAME__?.inspect?.().phase === 'idle' && window.__APP__, null, { timeout: 60_000 });
    // No HUD on a thumbnail; let the play area take the whole frame.
    await page.evaluate(() => {
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(1500);

    const layer = (mode) =>
      page.evaluate((m) => {
        const app = window.__APP__;
        const find = (c) => (c.label === 'logo' ? c : (c.children ?? []).map(find).find(Boolean));
        const logo = find(app.stage);
        const path = new Set();
        for (let p = logo; p; p = p.parent) path.add(p);
        const walk = (c) => {
          for (const k of c.children ?? []) {
            if (m === 'all') k.visible = k.__thumbVisible ?? k.visible;
            else {
              k.__thumbVisible ??= k.visible;
              if (m === 'title') k.visible = path.has(k) || isInside(k);
              if (m === 'art') k.visible = k === logo ? false : k.__thumbVisible;
            }
            walk(k);
          }
        };
        const isInside = (k) => {
          for (let p = k; p; p = p.parent) if (p === logo) return true;
          return false;
        };
        walk(app.stage);
        app.renderer.background.alpha = m === 'title' ? 0 : 1;
        document.body.style.background = m === 'title' ? 'transparent' : '';
        document.documentElement.style.background = m === 'title' ? 'transparent' : '';
      }, mode);

    const shot = async (mode, file) => {
      await layer(mode);
      await page.waitForTimeout(300);
      await page.screenshot({ path: file, omitBackground: mode === 'title' });
    };
    const full = join(tmp, `${s.name}-full.png`);
    const art = join(tmp, `${s.name}-art.png`);
    const title = join(tmp, `${s.name}-title.png`);
    await shot('all', full);
    await shot('art', art);
    await shot('title', title);
    await shot('all', full);
    await context.close();

    const size = `${s.w}x${s.h}!`;
    const small = (f) => {
      const o = f.replace('.png', `-${s.w}.png`);
      execFileSync('magick', [f, '-filter', 'Lanczos', '-resize', size, '-colorspace', 'sRGB', o]);
      return o;
    };
    const [fullS, artS, titleS] = [small(full), small(art), small(title)];
    const jpg = join(out, `${s.name}.jpg`);
    execFileSync('magick', [fullS, '-strip', '-sampling-factor', '4:2:0', '-define', `jpeg:extent=${s.maxKB - 2}kb`, jpg]);
    // PSD: the first image is the flattened composite; the rest become layers, named by label.
    const psd = join(out, `${s.name}.psd`);
    execFileSync('magick', [fullS, '(', artS, '-set', 'label', 'Art', ')', '(', titleS, '-set', 'label', 'Title', ')', '-compress', 'Zip', psd]);
    const kb = (f) => Math.round(statSync(f).size / 102.4) / 10;
    console.log(`${s.name}: jpg ${kb(jpg)} KB (limit ${s.maxKB}), psd ${kb(psd)} KB`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
