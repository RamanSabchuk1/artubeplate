# {{name}}

A slot game for the Artube RGS, built on
[`@artubeplate/core`](https://github.com/lowres-labs/artubeplate).

```bash
npm install
npm run dev          # http://localhost:8080, on a local mock RGS that plays math/
npm run math:check   # the checks Artube Hub runs on upload
npm run build        # dist/: index.html + content-hashed assets, relative paths
```

Out of the box it is a complete, playable game: art and sound through an asset pipeline, a mixed
and compressed soundtrack, an intro, transitions, a counted-up big-win announcer, free spins with
their own music, and every Artube TRC requirement the client owns already handled (see
[The Artube TRC checklist](#the-artube-trc-checklist)). Replace the art and the sounds in
`raw-assets/`, the math in `math/`, and it is your game.

## The math

`math/` is the game's Artube upload set: `index.json` plus a weights table and a books file per
mode. It drives everything:

- **The platform** draws outcomes from it: prices, RTPs and payouts all come from here.
- **This client** reads `settings.config` from `index.json` to build the reels, the symbols, the
  paytable, the mode cards and the rules, and animates each round from its book line.

To use different math, replace `math/` and run `npm run math:check`.

| You have | Run |
|---|---|
| An Artube set | Copy it into `math/`. |
| A Stake Engine `publish_files` folder | `npm run math:from-stake -- <folder> --out math` |
| A set with no `settings.config` | `npm run math:config` (infers the board and symbols; add the paytable by hand) |
| A set somewhere else | `ARTUBEPLATE_MATH=/path/to/set npm run dev` |

`npm run math:stats` prints RTP, hit rate, max win and win odds per mode. The formats are described
in [docs/MATH_CONTRACT.md](https://github.com/lowres-labs/artubeplate/blob/main/docs/MATH_CONTRACT.md).

`math/` is outside `public/`, so it never ends up in `dist/`. In `npm run dev` the artubeplate Vite
plugin serves it to the mock and validates it on start.

## The files

| File | What it is |
|---|---|
| `src/main.ts` | The boot: one `createArtubeGame` call wiring the pieces below. |
| `src/config.ts` | Static config: a fallback game id (`VITE_GAME_SERVER_ID`), autoplay limits, audio. Title, modes, max win and rules are read from the session. |
| `src/game/slot.ts` | Reads `settings.config` (schema `artubeplate/slot@1`), with a placeholder fallback. |
| `src/game/model.ts` | `interpretBook`: the book's events → a round model (base stage, respins, scatter, free spins). Pure. |
| `src/scene/Scene.ts` | The view: a scene director with the backdrop and the logo as persistent layers, the intro and the game as scenes, and the transitions between them. Symbols are the `sym-<id>` frames of the `raw-assets` spritesheet (else a config `image`, else a code-drawn tile); the backdrops are `bg-base` / `bg-bonus`. The reels play `spin-loop`, `reel-stop` and `scatter`; the blitter flies coins from the scatters into the FREE SPINS plaque. |
| `src/game/intro.ts` | The intro screen: cards from the math's config (or its `intro.slides`) and a volatility strip. |
| `src/scene/logo.ts`, `src/scene/plaque.ts` | The logo (it stays on screen from the intro into the game) and the free-spins plaque. Swap in your art. |
| `src/scene/TileSymbol.ts` | The placeholder symbol: a rounded tile with its label in the game's font; the win pops the label over a soft glow while the tile stays still. |
| `src/layout.ts` | Where everything sits, per orientation, in design units: the logo, the board, the win box and the announcements are SmartContainer pins in canvases fitted into the screen above the HUD bar. Edit the numbers to move or resize them. On a phone held sideways the HUD's controls stand over that screen; there `Scene.pins()` slides the board into the free middle beside them and moves the win box and the banner with it. |
| `src/ui/overlay.ts` | The win box (a base-game win counts up under the board on a phone, over it elsewhere), line-win labels, the announcement banner and the BIG → MEGA → EPIC win announcer, all from `@artubeplate/core/ui`. |
| `src/phases/present.ts` | Animates a round: wins, respins, the scatter, the big-win announcer, and the bonus: coins fly into the plaque, the FREE SPINS announcer, the rules screen (click), the music crossfades to the bonus track, a dissolve into the bonus, free spins that play by themselves (sticky wilds, retriggers), the TOTAL WIN screen (click), back to the base game and its track. |
| `raw-assets/` | The source art and sound: the asset pipeline turns it into `public/assets/` (git-ignored) on every `npm run dev` / `build`. See [Art and sound](#art-and-sound-the-asset-pipeline). |
| `thumbnails/` | The two Artube Hub thumbnails, 301×180 and 400×535, as JPEG (within the 50 / 100 KB limits) and layered PSD, with the title on them. Replace them with your art. |

The core owns the rest: the RGS connection and its recovery rules, the HUD, free rounds, max win,
errors, autoplay, turbo and slam-stop, buy features and lucky bets, history, and the Artube loader.

## Art and sound: the asset pipeline

`raw-assets/` is the source; `npm run dev` watches it and `npm run build` runs it first (AssetPack,
through the artubeplate Vite plugin), writing `public/assets/` with a content hash in every file
name, so the Artube CDN's year-long cache never serves an old file. The game reads the result as a
module:

```ts
import assets from 'artubeplate:assets';                         // the manifest
import { loadAssets, soundsFromManifest } from '@artubeplate/core/assets';

await loadAssets(assets, { onProgress: (p) => ctx.loader.setProgress?.(p) });   // textures
Texture.from('sym-H1');                                           // a spritesheet frame, by file name
const AUDIO = { sounds: soundsFromManifest(assets), bgm: 'base' }; // sounds, routed by folder
```

| In `raw-assets/` | Becomes |
|---|---|
| `game{m}/` | a bundle `game` (`{m}`: one manifest bundle per folder) |
| `game{m}/symbols{tps}/sym-H1.png` … | one spritesheet (`{tps}`), @1x and @0.5x, png + webp; frames keep their file names |
| `game{m}/bg/bg-base.jpg` | jpg + webp, @1x and @0.5x; Pixi picks per device |
| `audio{m}/<bus>/name.wav` | webm (Opus) + mp3; plays as `name` on that bus |
| `audio{m}/reels/reel-stop.1.wav`, `.2`, `.3` | variants: a different take on every `play('reel-stop')` |
| `audio{m}/music/base.mp3`, `bonus.mp3` | the music tracks (`base.intro` / `base.loop` / `base.outro` for stems) |

New art keeps the names and the game picks it up; a new sound is a new file and one
`ctx.audio?.play('its-name')`.

## Sound

The core mixes every sound through [zvuk](https://www.npmjs.com/package/@schmooky/zvuk), set up
for a slot:

- **Buses** by folder: `reels`, `symbols`, `anticipation`, `wins`, `voiceover`, `ui` (the SOUND
  row) and `music`, `ambience` (the MUSIC row). The HUD's rows and its mute drive them, and are
  saved across reloads.
- **A compressor on every bus** (gentle on music, punchy on reels and wins) and a **limiter** on
  the master: loud, even, never clipping. Tune it with `AUDIO.compression` / `AUDIO.limiter`.
- **Ducking**: the music dips under the `wins` bus. **Voice caps**: no machine-gunning.
  **Loudness normalisation** on load. **Paused while the tab is hidden.**
- `ctx.audio.play(name)` (a variants set plays its next take; an unknown name warns once and
  never breaks a round), `ctx.audio.loop(name)` → `.stop()` (the reel-spin bed),
  `ctx.audio.music('bonus')` (a crossfade from the playing track), `stopMusic({ outro: true })`.
- HUD buttons click (`AUDIO.inputSounds`); the base track starts on the first tap.

## The intro and the transitions

After the loader, the player sees an info screen: the logo, a volatility strip and three feature
cards (the wild, the free spins, the max win with the buy and boost prices), written from the
math's `settings.config`, or from `settings.config.intro.slides` when the math provides them.
A click after the prompt appears hands over to the game: the cards fade, the board scales in,
and the background and logo stay put. Entering free spins burns through to the feature look with
a shader dissolve; leaving dims back to the base look.

All of it is `@artubeplate/core/scenes`: scenes are pixi Containers, transitions are `cut`, `dim`,
`shader` and `morph`. See
[docs/SCENES.md](https://github.com/lowres-labs/artubeplate/blob/main/docs/SCENES.md) to build your own
info screen from your art.

## Testing scenarios locally

The mock reads knobs from the URL:

| URL | Scenario |
|---|---|
| `/?frc=10` | A 10-round free-rounds campaign is offered. |
| `/?maxWin=50` | The operator caps wins at 50 per round (the blocking max-win modal). |
| `/?currency=demo` | A demo session. |
| `/?balance=5` | A small balance (insufficient funds). |
| `/?mockError=503` | The next spin is refused with errorId 503 (comma list for a sequence). |
| `/?force=buyfs:12` | The next `buyfs` round lands on book row 12. |
| `/?seed=7&latency=400` | Deterministic draws, slow network. |
| `/?intro=0` · `/?intro=1` | Skip the intro · show it even after "Don't show this again". |

In the browser console, `__GAME__` is the game: `__GAME__.inspect()`, `__GAME__.requestBuy('buyfs')`,
`__GAME__.network.simulateReconnect()`, `__GAME__.network.forceRow('base', 12)`.

## Playing a real Artube session locally

Artube Hub's **Play on Localhost** opens the game URL, session included, on `http://localhost:8080`:
the port `npm run dev` uses. Point the dev server at the DEV host first, so `/api-rgs` reaches the
real RGS:

```bash
ARTUBE_HOST=https://<host of the DEV launch URL> npm run dev
```

The dev server forwards `/api-rgs`, HTTP and WebSocket, to that host. A launch URL from anywhere
else works the same way: open `http://localhost:8080/?sessionId=…&gameId=…` with its values. One
session allows one connection: opening it here takes it over from any other tab.

## Going live

1. **Game id.** Nothing to set: Artube's launch URL carries `sessionId`, `gameId` and `lng`, and
   the hub's `game` is read from `gameId` (your publicGameId on DEV and production,
   `<publicGameId>-stage` on Stage). `VITE_GAME_SERVER_ID` in `.env` is only a fallback for local
   URLs without one.
2. **Math.** `npm run math:check` must say `READY`. In Artube Hub, open the game card, click
   Upload Math, select the `math/` folder, then Start Math Verification. The Artube team promotes
   and publishes it per environment.
3. **Client.** Your game has a `client` repository in Artube's GitLab
   (`<studio group>/<publicGameId>/client`; the game card's Git Repository button opens it). Push
   this project there. The pipeline is Artube's: it lives in your studio's `ci` repository, so this
   project carries no `.gitlab-ci.yml`. It runs `npm ci` and `npm run build` on Node 22 and uploads
   `dist/` to the CDN under `/<publicGameId>/`. `develop` deploys to DEV, `prod` to Stage, and a
   `vX.Y.Z` tag on `prod` (the platform creates it at go-live) to Production. Commit
   `package-lock.json` (`npm ci` needs it), plus `vendor/` if `@artubeplate/core` came from a
   tarball. `npm run lint`, `npm run test:unit` and `npm run analyze:circular` run too, when those
   scripts exist.
4. **Test session.** Open the game from its card in Artube Hub: PLAY or Play in New Tab (with a
   test player), or DEMO. Hub creates the session and puts it in the game URL; the build connects
   to the real RGS at `/api-rgs/api/slot` on the page's own host. A deployed build opened without
   a session shows "No game session"; only `npm run dev` and demo builds play on the mock.

Content-hashed file names are required (the CDN caches assets for a year). The asset pipeline and
Vite do this for everything in `raw-assets/` and everything you import; do not override the output
file names. Other files in `public/` keep their names, so the CDN would keep serving an old copy
after an update: give each new version of such a file a new name.

## The Artube TRC checklist

What Artube's review checks, and who does it. The core and this template handle everything the
client owns, and the testable rows are exercised against every change to artubeplate.

| Checklist section | Handled by | You |
|---|---|---|
| PreChecks: unique name, no brands, clean assets | — | Search the title (it must be unique and trademark-free); keep logos and brands out of the art. |
| Game thumbnails | `thumbnails/`: 301×180 ≤ 50 KB and 400×535 ≤ 100 KB, JPEG + PSD, title on them | Replace with your art, keep the title exact. |
| Auto play: start, counter on STOP, manual stop, low-balance stop with a message | core + HUD | — |
| Bet: display, ± buttons, limits, locked mid-round, currency | core + HUD | — |
| Environment: iOS Safari, Android Chrome, desktop, iframe, DEMO indicator | core + HUD (DEMO as the currency in demo sessions) | Test on devices before go-live. |
| Errors: insufficient funds (no request sent), connection loss, 5xx | core | — |
| Free rounds: offer, decline, auto-play, counter, turbo, total, refresh | core (the FREE ROUNDS box takes the round button's place) | — |
| Free spins: announcer, counter, total win, retrigger, bet lock, refresh | this template (`present.ts`) + core round recovery | Keep the beats when you restyle, and the bonus's edges: autoplay's stop-on-feature check and `ctx.turbo.feature(true)` at the trigger, `ctx.turbo.spin()` at the start of every free spin (a speed switched during one counts from the next), `feature(false)` after the bonus. |
| Loader: Artube logo, studio logo | `@artube/loader` (mandatory) | Add a studio logo only if you want one. |
| Menu: paytable with a money example, rules with modes/prices/RTP/max win, spacebar setting, saved settings, disclaimer | core (`buildSlotRules`) + HUD | Keep the rules' copy in your math's `settings.config`. |
| Performance, responsive (pinch, rotation, small windows) | core + HUD; `Scene.pins()` keeps the board and the logo clear of the HUD's controls | Profile your own art. Pin new pieces through `pins()` if they sit near the screen's edges. |
| Sound: toggle, sounds on spin / win / free spins start and end | core + this template | Replace the sounds. |
| Speed mode: toggle, state, applies from the next round, saved | core + HUD | — |
| Spin, state recovery, win details, English, RTP 95–98 % | core + math checks (`npm run math:check`) | Upload math that passes. |

