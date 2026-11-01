/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fallback for the hub's `game` parameter; Artube launch URLs carry it as `?gameId=`. */
  readonly VITE_GAME_SERVER_ID?: string;
}

/** The manifest of raw-assets/, built by the asset pipeline (the artubeplate Vite plugin). */
declare module 'artubeplate:assets' {
  import type { AssetsManifest } from 'pixi.js';
  const manifest: AssetsManifest;
  export default manifest;
}
