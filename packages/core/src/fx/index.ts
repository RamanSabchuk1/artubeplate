// @artubeplate/core/fx — cartoon effects for the moments a slot lives on, out of the box:
//
//   Blitter     sprites burst out of a point and streak into a target, calling back on each
//               arrival (coins into a total, sparks into a jackpot meter). CPU sprites + GSAP-free
//               ticker math, exact arrival callbacks.
//   CartoonFx   GPU particle bursts on pylinka: sparkles, shards, dust puffs, confetti, a glow
//               flash. Pooled emitters, presets as plain data, the game's own art or the defaults.
//   StickerBakery  bakes the ink line and the white die-cut border onto flat art at load, so every
//               piece gets the same line weight.
//
// Needs pixi.js v8; CartoonFx also needs @pylinka/core and @pylinka/graph (optional peers of
// this package: install them in the game to use it).
export * from './blitter';
export * from './bursts';
export * from './textures';
export * from './sticker-bake';
export * from './silhouette';
export * from './line-show';
