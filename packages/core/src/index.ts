// @artubeplate/core — the batteries-included Artube RGS game core.
//
//   createArtubeGame({ config, interpretBook, mountView, phases })  → a whole compliant game
//
// The building blocks are exported too (and at their subpaths): /rgs (transport + mock),
// /math (the artifact rules), /rules (the slot client contract + rules builder), /audio, /testing,
// /vite (the dev plugin) and /node (the math tooling behind the `artubeplate` CLI).
export * from './rgs/index';
export * from './engine/index';
export * from './stores/index';
export * from './currency/index';
export * from './game/index';
export { artubeplateSkinCss } from './skin/index';
