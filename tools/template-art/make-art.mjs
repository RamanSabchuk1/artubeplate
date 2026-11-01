// Draw the showcase's placeholder art into the template's raw-assets/ (the asset pipeline packs it).
//
//   node tools/template-art/make-art.mjs [template dir]
//
// Every piece is SVG written here and rendered by Chromium, so there is no third-party art and no
// emoji artwork to license. The glyph font is Montserrat (SIL OFL), from the template's own
// @fontsource package. Needs Playwright (Chromium).

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const template = resolve(process.argv[2] ?? 'packages/create-artubeplate/template');
const raw = join(template, 'raw-assets');
const require = createRequire(join(template, 'package.json'));
const fontFile = join(dirname(require.resolve('@fontsource/montserrat/package.json')), 'files/montserrat-latin-900-normal.woff2');
const FONT = `@font-face{font-family:Montserrat;font-weight:900;src:url(data:font/woff2;base64,${readFileSync(fontFile).toString('base64')}) format('woff2')}`;
const INK = '#0b0d12';

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

// ── symbol glyphs (centred on 0,0, about 180 px across) ─────────────────────────────────────
const letter = (t, size = 150) =>
  `<text x="0" y="${Math.round(size * 0.35)}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="${size}" fill="#fff" stroke="${INK}" stroke-width="12" stroke-linejoin="round" paint-order="stroke">${t}</text>`;

const catHead = ({ fur, inner = '#f2a7b5', eye = '#3ccf7a', extra = '', marks = '' }) => `
  <g stroke="${INK}" stroke-width="6" stroke-linejoin="round">
    <path d="M-60,-6 L-52,-86 L-12,-50 Z" fill="${fur}"/><path d="M60,-6 L52,-86 L12,-50 Z" fill="${fur}"/>
    <path d="M-48,-22 L-46,-66 L-22,-46 Z" fill="${inner}" stroke-width="0"/><path d="M48,-22 L46,-66 L22,-46 Z" fill="${inner}" stroke-width="0"/>
    <ellipse cx="0" cy="8" rx="66" ry="58" fill="${fur}"/>
    ${marks}
    <path d="M-38,-2 Q-24,-18 -10,-2 Q-24,12 -38,-2 Z" fill="${eye}"/><path d="M38,-2 Q24,-18 10,-2 Q24,12 38,-2 Z" fill="${eye}"/>
    <ellipse cx="-24" cy="-2" rx="3.5" ry="10" fill="${INK}" stroke-width="0"/><ellipse cx="24" cy="-2" rx="3.5" ry="10" fill="${INK}" stroke-width="0"/>
    <path d="M-8,18 L8,18 L0,28 Z" fill="#e98aa0" stroke-width="4"/>
    <path d="M0,28 Q-6,38 -16,36 M0,28 Q6,38 16,36" fill="none" stroke-width="4"/>
    <path d="M-20,26 L-62,18 M-20,32 L-60,36 M20,26 L62,18 M20,32 L60,36" stroke="#fff" stroke-width="3" opacity="0.85"/>
    ${extra}
  </g>`;

const GLYPHS = {
  // Sacred cat: sand fur, a gold usekh collar.
  H1: catHead({
    fur: '#e9c27a',
    extra: `<path d="M-58,52 Q0,96 58,52 L50,70 Q0,108 -50,70 Z" fill="#f4c542"/><g fill="#2b6cb0" stroke-width="3"><circle cx="-30" cy="72" r="6"/><circle cx="0" cy="80" r="7"/><circle cx="30" cy="72" r="6"/></g>`,
  }),
  // Temple cat: black fur, a striped nemes headdress.
  H2: catHead({
    fur: '#262a33',
    inner: '#6b4a7a',
    eye: '#f6c844',
    extra: `<path d="M-66,-4 L-86,70 L-52,64 L-40,30 Z" fill="#f4c542"/><path d="M66,-4 L86,70 L52,64 L40,30 Z" fill="#f4c542"/>
      <path d="M-74,26 L-50,22 M-80,46 L-46,42 M74,26 L50,22 M80,46 L46,42" stroke="#2b6cb0" stroke-width="7"/>`,
  }),
  // Street cat: orange tabby, a notched ear.
  H3: catHead({
    fur: '#e7893a',
    marks: `<path d="M-14,-46 L-10,-24 M0,-50 L0,-26 M14,-46 L10,-24" stroke="#9c4a12" stroke-width="7" fill="none"/>`,
    extra: `<path d="M44,-70 L50,-60 L56,-72" fill="#0b0d12" stroke-width="0"/>`,
  }),
  // House cat: grey, a bell on a red collar.
  H4: catHead({
    fur: '#aab0bb',
    eye: '#5aa9f0',
    extra: `<path d="M-50,58 Q0,82 50,58" fill="none" stroke="#c0392b" stroke-width="12"/><circle cx="0" cy="76" r="13" fill="#f4c542"/><path d="M-6,78 L6,78" stroke-width="3"/>`,
  }),
  // Ankh, in gold.
  M1: `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" fill="#f4c542">
    <path d="M0,-92 C-40,-92 -46,-40 -14,-12 L-70,-12 L-70,14 L-16,14 L-16,92 L16,92 L16,14 L70,14 L70,-12 L14,-12 C46,-40 40,-92 0,-92 Z M0,-66 C18,-66 20,-36 0,-20 C-20,-36 -18,-66 0,-66 Z" fill-rule="evenodd"/></g>`,
  // Crook (heka), striped gold and blue.
  M2: `<g stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M18,92 L18,-34 C18,-82 -46,-84 -50,-44 C-52,-22 -30,-14 -22,-30" stroke-width="30"/>
    <path d="M18,92 L18,-34 C18,-82 -46,-84 -50,-44 C-52,-22 -30,-14 -22,-30" stroke="#f4c542" stroke-width="18"/>
    <path d="M18,70 L18,56 M18,30 L18,16 M18,-10 L18,-24 M-6,-70 L-14,-62 M-44,-56 L-36,-48" stroke="#2b6cb0" stroke-width="18" stroke-linecap="butt"/></g>`,
  // Wild: a pearl burst under the word (no gold: the defaults stay neutral).
  W: `<g><polygon points="${Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 ? 62 : 96;
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ')}" fill="#e8f1f5" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <text x="0" y="22" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="64" fill="#1f6f8b" stroke="#fff" stroke-width="10" stroke-linejoin="round" paint-order="stroke">WILD</text></g>`,
  // Paw scatter: a paw print on a glowing ring.
  S: `<g><circle r="84" fill="none" stroke="#7fd6ff" stroke-width="10" opacity="0.9"/><circle r="84" fill="none" stroke="#e9f8ff" stroke-width="3"/>
    <g fill="#fff" stroke="${INK}" stroke-width="6"><path d="M-40,34 C-40,0 -20,-6 0,-6 C20,-6 40,0 40,34 C40,58 18,56 0,50 C-18,56 -40,58 -40,34 Z" fill="#f7d6df"/>
    <ellipse cx="-48" cy="-18" rx="13" ry="18"/><ellipse cx="-20" cy="-46" rx="14" ry="19"/><ellipse cx="20" cy="-46" rx="14" ry="19"/><ellipse cx="48" cy="-18" rx="13" ry="18"/></g></g>`,
  A: letter('A'),
  K: letter('K'),
  Q: letter('Q'),
  J: letter('J'),
  T: letter('10', 120),
};

const SYMBOLS = { H1: '#b23a48', H2: '#7b4bd6', H3: '#2f8f6e', H4: '#2b6cb0', M1: '#4a5a73', M2: '#5b6272', A: '#3a4a5c', K: '#4a3d5c', Q: '#3a5448', J: '#5a3a46', T: '#3f444d', W: '#1f6f8b', S: '#2a1f3d' };

// Each symbol comes three ways, all on the same 256² canvas so they line up: `sym-<id>` (tile and
// glyph together, for cards and screens), and `tile-<id>` + `glyph-<id>` for the reels, where the
// win animates the glyph alone and the tile stays still.
const tile = (id, color, parts = 'both') => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.28)}"/><stop offset="1" stop-color="${shade(color, -0.35)}"/></linearGradient>
    <radialGradient id="shine" cx="0.5" cy="0.08" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.45"/></filter>
  </defs>
  ${parts === 'glyph' ? '' : `<g filter="url(#sh)"><rect x="14" y="10" width="228" height="228" rx="44" fill="url(#g)" stroke="${shade(color, -0.6)}" stroke-width="6"/>
  <rect x="14" y="10" width="228" height="228" rx="44" fill="url(#shine)"/></g>`}
  ${parts === 'tile' ? '' : `<g transform="translate(128 126)">${GLYPHS[id]}</g>`}</svg>`;

// ── backgrounds: a desert night, calm in the middle where the board sits ─────────────────────
const backdrop = ({ sky, horizon, glow, dune, pyramid, rim }) => {
  const stars = Array.from({ length: 140 }, (_, i) => {
    const x = (i * 7919) % 2560;
    const y = (i * 104729) % 760;
    const r = 1 + ((i * 31) % 3) * 0.6;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.25 + ((i * 17) % 10) / 20}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1600" viewBox="0 0 2560 1600">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="0.62" stop-color="${horizon}"/><stop offset="0.7" stop-color="${glow}"/></linearGradient>
      <radialGradient id="calm" cx="0.5" cy="0.48" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>
    </defs>
    <rect width="2560" height="1600" fill="url(#sky)"/>${stars}
    <circle cx="1980" cy="300" r="90" fill="#fff6dc" opacity="0.9"/><circle cx="1980" cy="300" r="160" fill="#fff6dc" opacity="0.12"/>
    <path d="M180,1120 L640,560 L1100,1120 Z" fill="${pyramid}"/><path d="M640,560 L1100,1120 L760,1120 Z" fill="#000" opacity="0.25"/>
    <path d="M1500,1120 L1880,660 L2260,1120 Z" fill="${pyramid}"/><path d="M1880,660 L2260,1120 L1980,1120 Z" fill="#000" opacity="0.25"/>
    <path d="M1060,1120 L1290,840 L1520,1120 Z" fill="${pyramid}"/>
    <path d="M640,560 L180,1120 M1880,660 L1500,1120" stroke="${rim}" stroke-width="5" opacity="0.7"/>
    <path d="M0,1080 C420,1010 820,1150 1280,1090 C1720,1030 2100,1130 2560,1060 L2560,1600 L0,1600 Z" fill="${dune}"/>
    <path d="M0,1260 C520,1180 900,1320 1400,1250 C1860,1190 2200,1290 2560,1230 L2560,1600 L0,1600 Z" fill="#000" opacity="0.35"/>
    <rect width="2560" height="1600" fill="url(#calm)"/><rect width="2560" height="1600" fill="url(#vig)"/></svg>`;
};

// ── particles for the fx bursts and the blitter ─────────────────────────────────────────────
const FX = {
  'fx-spark': `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="64" cy="64" r="40" fill="url(#g)" opacity="0.6"/><path d="M64,4 C68,52 76,60 124,64 C76,68 68,76 64,124 C60,76 52,68 4,64 C52,60 60,52 64,4 Z" fill="#fff"/></svg>`,
  'fx-dot': `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="64" cy="64" r="62" fill="url(#g)"/></svg>`,
  'fx-coin': `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="56" fill="#f4c542" stroke="${INK}" stroke-width="6"/><circle cx="64" cy="64" r="42" fill="none" stroke="#c9901a" stroke-width="5"/>
    <g transform="translate(64 64) scale(0.36)" fill="#c9901a" stroke="none"><path d="M0,-92 C-40,-92 -46,-40 -14,-12 L-70,-12 L-70,14 L-16,14 L-16,92 L16,92 L16,14 L70,14 L70,-12 L14,-12 C46,-40 40,-92 0,-92 Z M0,-66 C18,-66 20,-36 0,-20 C-20,-36 -18,-66 0,-66 Z" fill-rule="evenodd"/></g></svg>`,
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, w, h, file, { jpeg = false } = {}) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html><head><style>${FONT}html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: !jpeg, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 90 } : {}) });
    console.log(file.slice(raw.length + 1));
  };
  for (const [id, color] of Object.entries(SYMBOLS)) {
    await render(tile(id, color), 256, 256, join(raw, 'game{m}/symbols{tps}', `sym-${id}.png`));
    await render(tile(id, color, 'tile'), 256, 256, join(raw, 'game{m}/symbols{tps}', `tile-${id}.png`));
    await render(tile(id, color, 'glyph'), 256, 256, join(raw, 'game{m}/symbols{tps}', `glyph-${id}.png`));
  }
  for (const [name, svg] of Object.entries(FX)) await render(svg, 128, 128, join(raw, 'game{m}/fx{tps}', `${name}.png`));
  await render(backdrop({ sky: '#070b1f', horizon: '#26355f', glow: '#7d5a63', dune: '#2f2a2e', pyramid: '#1b1c2b', rim: '#c9cfdc' }), 2560, 1600, join(raw, 'game{m}/bg', 'bg-base.jpg'), { jpeg: true });
  await render(backdrop({ sky: '#12061f', horizon: '#3d1a5c', glow: '#9a4f86', dune: '#2a1a30', pyramid: '#1a1028', rim: '#d8b7ff' }), 2560, 1600, join(raw, 'game{m}/bg', 'bg-bonus.jpg'), { jpeg: true });
} finally {
  await browser.close();
}
writeFileSync(join(raw, 'README.md'), `# raw-assets

The game's source art and sound. \`npm run dev\` and \`npm run build\` run the asset pipeline over
this folder (AssetPack, through the artubeplate Vite plugin) into \`public/assets/\`, and the game
reads the result as \`import assets from 'artubeplate:assets'\`.

| Folder tag | What happens |
|---|---|
| \`name{m}\` | a manifest bundle: \`loadAssets(assets, { bundles: ['name'] })\` loads it |
| \`name{tps}\` | the PNGs inside are packed into one spritesheet; each frame keeps its file name (\`sym-H1\`, \`tile-H1\`, \`glyph-H1\`) |
| (images) | @1x and @0.5x, png/jpg + webp; Pixi picks per device |
| \`audio{m}/<bus>/\` | webm (Opus) + mp3; the folder is the bus (reels, symbols, anticipation, wins, voiceover, ui, music, ambience) |

Sound names: \`reel-stop.wav\` plays as \`reel-stop\`; \`reel-stop.1.wav\`, \`reel-stop.2.wav\` are variants
(a different take on every play); in \`music/\`, \`base.intro\`, \`base.loop\` and \`base.outro\` are the
stems of the track \`base\`. The placeholder art here is drawn by artubeplate's
\`tools/template-art/make-art.mjs\`; the placeholder sounds by \`tools/sfx/make_sfx.py\`.
`);
