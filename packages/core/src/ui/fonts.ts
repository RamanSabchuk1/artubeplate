// Web fonts must be loaded before pixi measures and rasterizes text, or the first frames render in
// a fallback face (and keep its metrics). Bundle the font with the game (e.g. `@fontsource/*` in
// Vite — no third-party font CDN at runtime) and await it before building text.

/**
 * Wait for web fonts: CSS font shorthands such as `'800 1em Montserrat'`. Resolves after
 * `timeoutMs` at the latest, so a missing font never blocks the game (it falls back).
 */
export async function ensureFonts(fonts: string[], timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const load = Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => [])));
  await Promise.race([load, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
