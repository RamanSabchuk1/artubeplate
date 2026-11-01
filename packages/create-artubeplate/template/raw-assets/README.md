# raw-assets

The game's source art and sound. `npm run dev` and `npm run build` run the asset pipeline over
this folder (AssetPack, through the artubeplate Vite plugin) into `public/assets/`, and the game
reads the result as `import assets from 'artubeplate:assets'`.

| Folder tag | What happens |
|---|---|
| `name{m}` | a manifest bundle: `loadAssets(assets, { bundles: ['name'] })` loads it |
| `name{tps}` | the PNGs inside are packed into one spritesheet; each frame keeps its file name (`sym-H1`, `tile-H1`, `glyph-H1`) |
| (images) | @1x and @0.5x, png/jpg + webp; Pixi picks per device |
| `audio{m}/<bus>/` | webm (Opus) + mp3; the folder is the bus (reels, symbols, anticipation, wins, voiceover, ui, music, ambience) |

Sound names: `reel-stop.wav` plays as `reel-stop`; `reel-stop.1.wav`, `reel-stop.2.wav` are variants
(a different take on every play); in `music/`, `base.intro`, `base.loop` and `base.outro` are the
stems of the track `base`. The placeholder art here is drawn by artubeplate's
`tools/template-art/make-art.mjs`; the placeholder sounds by `tools/sfx/make_sfx.py`.
