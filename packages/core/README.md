# @artubeplate/core

The batteries-included game core for the **Artube RGS**. A game supplies a config, a pure
`interpretBook`, a scene and its Present phase. The core does the rest: the Artube loader, the
SignalR connection, `session`, the HUD, the round loop, free rounds, max win, reconnects, errors,
autoplay, turbo, buy features, lucky bets, audio and gamification.

Built on [open-slot-ui](https://github.com/schmooky/open-slot-ui) (`@open-slot-ui/dom` ≥ 0.18.2, the DOM HUD),
[`@microsoft/signalr`](https://www.npmjs.com/package/@microsoft/signalr),
[`@artube/loader`](https://www.npmjs.com/package/@artube/loader) and
[`@schmooky/zvuk`](https://github.com/schmooky/zvuk) (audio).

The fastest way in is `npm create artubeplate@latest`, which sets all of this up
([create-artubeplate](../create-artubeplate/README.md)).

## Install

```bash
npm i @artubeplate/core @open-slot-ui/core @open-slot-ui/dom @artube/loader @schmooky/zvuk
npm i pixi.js gsap   # for @artubeplate/core/scenes, /ui, /fx and /motion
```

Node ≥ 22.15 for the CLI (it uses `node:zlib` zstd). The browser code has no such requirement.

## The one call

```ts
import { createArtubeGame } from '@artubeplate/core';

const game = createArtubeGame<MyModel, MyScene, MyBook>({
  config: {
    title: 'My Slot',
    gameServerId: import.meta.env.VITE_GAME_SERVER_ID, // fallback for the hub's `game`; launches carry ?gameId=
    modes: { buyfs: { name: 'Free Spins', description: 'Buy 10 free spins.' } },
    maxWinX: 5000,
    rules: (session) => buildMyRules(session),
    fromSession: (session) => ({ /* config derived from session.gameSettings.config */ }),
  },
  interpretBook: (payload, info) => parseBook(payload, info), // pure: book → your model
  mountView: async (host, ctx) => new MyScene(host, ctx),     // your pixi scene
  phases: [myPresentPhase],                                   // Idle, Spin and Settle are provided
  audio: { sounds: [{ name: 'bgm', kind: 'music', loop: bgmUrl }], bgm: 'bgm' }, // import bgmUrl from './bgm.webm' (hashed)
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

await game.start();
```

### What `start()` does

1. Shows the Artube loader and drives its progress.
2. Connects: the real hub when the launch URL carries a `sessionId`, otherwise the mock RGS on
   your `math/` folder.
3. Calls `session` and builds the HUD from it: currency (demo = `null`), the bet ladder from
   `allowedBets`, one card per `BuyFeature` / `LuckyBet` mode with its price, RTPs for the rules.
4. Calls your `mountView`. Its return value is `ctx.view` in the phases.
5. Goes idle, then offers a round the player did not see (after a reload) and the operator's
   free-rounds campaign.

After that the core owns the platform rules for the whole session. The full mapping is in
[docs/ARTUBE_RGS.md](../../docs/ARTUBE_RGS.md).

### The round

`Idle → Spin → Present → Settle`. The core ships Idle, Spin and Settle:

- **Spin** sends `spin { gameMode, betIndex }` (`betIndex: null` in free rounds), debits the price
  optimistically, and calls your view's `onSpinStart()` so the reels move before the answer. On a
  refused spin it restores the balance and shows the error. On an unknown outcome it never retries:
  it reconnects and replaces state from `session`.
- **Present** is yours. `ctx.round` holds the platform's money (`bet`, `stake`, `totalWin`,
  `multiplier`, `maxWinReached`, `freeRound`) and your model in `ctx.round.data`. Use
  `ctx.turbo.delay(ms)` for animation timing: turbo shortens it and a slam-stop resolves it.
  Call `ctx.turbo.feature(true)` when the bonus starts and `feature(false)` when it ends: the bonus
  then takes the BONUS GAME turbo switch, the core ignores slams in it (unless `bonusSkip`), and
  a slam of the spin that landed the bonus is cleared, so the bonus never plays at slam speed.
  Call `ctx.turbo.spin()` at the start of every free spin or respin: a speed the player switched
  during the last one counts from there (the round's pace is held otherwise, so a change made in a
  bonus would only count after it).
  `ctx.turbo.beat(ms, floorMs)` is the same delay with a floor of real time, for what must be read at any pace: a word on screen, a summed win box.
- **Settle** lands the authoritative balance and win, reports the round to the HUD (autoplay
  limits, net position), enforces `minRoundMs`, and shows the blocking max-win modal when the
  platform capped the win. There is no in-game HISTORY: Artube keeps the rounds on the platform.

A view may implement `ViewHooks`: `onSpinStart()`, `onSpinAbort()`, `slamStop()`, and
`whenPlayable()`. With `whenPlayable()`, the core keeps the HUD transparent, inert and
click-through, and holds the first idle and the free-rounds offer until it resolves; an intro
screen uses this.

### `GameConfig`

| Field | |
|---|---|
| `title`, `version` | |
| `gameServerId` | A fallback for the hub's `game` parameter. Artube launch URLs carry it as `?gameId=` (the publicGameId; `<publicGameId>-stage` on Stage), which wins. |
| `modes` | Card copy per mode id: `name`, `description`, `image`, `volatility`, `confirm`. |
| `buyOrder` | The buy sheet's card order: `'session'` (the default) keeps the session's gameModes order; `'price'` lists the cards cheapest first by `priceMultiplier` (a boost at its full price per round, the price its card shows). Equal prices keep the session's order. |
| `rules` | The INFO window: an open-slot-ui `MenuSpec`, blocks, or `(session, kit) => …`. The `RulesKit` gives `kit.price(modeId)` (what one round of a mode costs, e.g. "2×": a boost's full price, not the surcharge `{{cost.<id>}}` names) and `kit.money(x)` (x × the default bet in the session's currency, for worked examples). |
| `maxWinX` | The math's cap as × bet, for the HUD and rules. |
| `freeSpins` | `{ count, retrigger }` or `false`, for the rules audit. |
| `autoplay` | `{ lossLimits, winLimits, requireLimits, stopOnAnyWin }` in × bet. |
| `turboSpeeds`, `autoplayGapMs`, `minRoundMs` | Feel and compliance timing. |
| `bonusSkip` | Let the player skip inside a bonus (Space, the round button's STOP, a tap on the game). Default `false`: a bonus has no round button and plays out at its own pace. The bonus starts at `ctx.turbo.feature(true)`, before its first screen hides the bar. |
| `featureCounter` | The counter beside TOTAL WIN in a feature: `{ label: 'Respins', lives: 3 }` for a Hold & Win shows RESPINS with three pips, lit up to `hud.setFreeSpins(n)`. Default: FREE SPINS and a number. |
| `jurisdiction`, `hud`, `spec`, `messages` | Passed to open-slot-ui. |
| `fromSession(session, kit)` | Derive any of the above from the session (for example from the math's `settings.config`). Merged over the static config; `kit` is the same `RulesKit`. |

### What the core takes care of for Artube's TRC checklist

Every game on the core gets these without a line of its own:

- **Launch.** `sessionId`, `gameId` (the hub's `game`; `<publicGameId>-stage` on Stage) and `lng` are read from the URL. A deployed build never falls back to the mock RGS: opened without a session it says "No game session". The mock is not even in that build: `createArtubeGame` loads it with a dynamic import that only `vite dev` and demo builds keep, so MockRgs, the math loader and fzstd stay out of the bundle you upload (tests/treeshake.test.ts checks it).
- **Money rules.** The stake is sent as a bet index. An unaffordable spin is blocked before any request, with "Insufficient funds", but only after the wallet's balance is read again (a deposit made in the lobby counts). Autoplay stops on a low balance and says why. A refused spin refunds its optimistic debit; one refused for funds shows the wallet's balance.
- **The wallet between rounds.** Besides `NotifyBalanceChanged`, the core reads `balance` when the game comes back into view and every 30 s while it sits idle, so a top-up or a withdrawal elsewhere shows without a reload. A notification the client cannot read is ignored, never shown as 0.
- **Errors.** A server 500 or a lost answer never retries: the session is re-read, and a 500 is reported to the player. A closed session or a second connection is terminal. A session the platform no longer accepts at launch (taken over by another tab, expired; an RGS 501/507 or an HTTP 401/403/501 from the hub) says "Session ended" and how to go on, with no Reload button, since a reload cannot revive it.
- **A lost connection.** Autoplay stops and a "Connection lost" notice with RELOAD blocks the game (the spacebar too). SignalR's automatic reconnect makes 5 attempts; after that the client keeps starting the connection in the background (2 s, 5 s, 10 s, 15 s, then every 30 s, and at once on the browser's `online` event), and the notice says so with RELOAD still there. When the connection is back the notice goes by itself, `session` replaces the state (the balance, a round the server played while the answer was lost, free rounds) and the game plays on. A spin in flight is never sent again. `MockRgs.simulateOutage(ms, { at, lost, giveUpAfter })` loses the connection the same way in `vite dev`.
- **State recovery.** After a reconnect or a reload, the session is the truth. A round the player did not see to the end (Artube's `session.round.spinResults`) is offered as "Your last round… Watch it now?". It is offered once per device and per game, and never while free rounds play.
- **Free rounds.**
  - Every new session opens with the offer, before any "Your last round". It shows the count, the bet and the expiry (read as UTC).
  - A campaign started in an earlier session is offered again with the rounds left and the win so far.
  - After "Play now", the rounds play by themselves at the campaign's bet with the bet locked. Auto-play waits for an open notice to close instead of stopping.
  - While they play, TOTAL WIN | FREE ROUNDS stand in the round button's place and the stake shows among the readouts (the HUD's `hud.freeRounds: 'takeover'`, on by default; a game may set `'inline'`).
  - The player's choice is kept per session. A reload after accepting shows the rounds left with one "Continue" and carries on. "Later" is not asked again in the same session.
  - A reconnect re-activates the campaign silently (Artube's activation is per connection).
  - The summary shows the total.
- **HUD.** Most of these are open-slot-ui's own (≥ 0.18.2); the core turns them on and feeds them.
  - In a demo session (`currency: null`), "DEMO" stands where the currency would: 1.00 DEMO in the balance, win and bet.
  - SPACEBAR TO SPIN in the ☰ menu wherever there is a keyboard, however small the window (a lobby's iframe on a laptop); not on a touch-only phone or when the operator says `channel=mobile`. A press on the bar in a lobby's iframe hands the keyboard to the game.
  - Sound, music, the mute, TURBO / SUPER TURBO and spacebar survive a reload, per game (`mountDomHud(spec, { persist })`).
  - Turbo switched mid-round counts from the next round, and in a bonus from the next bonus spin (`ctx.turbo.spin()`).
  - Phones held sideways: the autoplay sheet scrolls as a whole, and BONUS BUY sets the BET box beside a row of compact cards that scrolls sideways, so every card shows its price and button.
  - Any window: under 260px of height (a phone held sideways in a browser whose bars take a third of the screen) − and + stand beside SPIN and the coin beside ☰; BONUS BUY's cards fit the room above the strip under 292px; on an upright screen narrower than 329px SPIN shrinks with the width. Under 280px of width, 160px of height or 460×260 the screen asks to be turned or made bigger. At the sizes above those the HUD looks as it did.
  - During a round, autoplay or free rounds the bet, the buy coin and the autoplay button are disabled, while SPIN (slam-stop) and STOP stay live.
  - Autoplay: tapping a number of rounds starts the run, with the limits set above it; the CUSTOM limit fields take a number only. Through the run the autoplay button shows the count and is the only stop; the round button and the spacebar only fast-forward the round in play (open-slot-ui's `autoplay.startOnSelect` and `autoplay.stopControl: 'autoplay-button'`, ≥ 0.18.4).
  - Opening TURBO / SUPER TURBO in the menu shows their switches without turning them on (`hud.speedRow: 'expand'`), and a tap on the game closes the ☰ menu and the autoplay panel (`hud.closeOnOutsideTap`). A game may set either back through `hud`.
- **Phones.** No pinch-zoom (iOS ignores `user-scalable=no`): the HUD refuses it, and the core the page. Panning still works.

What stays the game's: the paytable and rules content (`RulesKit` helps), thumbnails, and its own art and sound.

### The game handle

```ts
game.inspect();          // { phase, balance, bet, betIndex, lastWin, currency, spinning, freeRounds, … }
game.requestSpin();      // spin as the round button does (idle only)
game.requestBuy('buyfs');
game.network;            // the transport; the MockRgs instance in local dev
game.hud;                // the mounted open-slot-ui DomHud
game.dispose();
```

### Styling

The HUD is open-slot-ui's DOM HUD in one built-in look, the classic slot bar: the dark plate
with BALANCE / WIN, the boxed BET / SPIN / autoplay panel and the BUY BONUS coin (open-slot-ui's buy colour unless the game's theme sets `featureBuy`) on
desktop; SPIN between − and + over a readout strip on phones; white bonus cards, the black ☰
menu, and TOTAL WIN | FREE SPINS during free spins. It mounts automatically and there is nothing
to pick. The stylesheet (`artubeplateSkinCss`) and its SVG glyphs are drawn in this package, so
the HUD ships no third-party CSS, fonts or images. `hudOptions` passes through to `mountDomHud`.

On a phone held sideways the HUD's controls stand over the play area: the SPIN lane at the right
edge, ☰ and the coin at the left. `measureHudKeepOut(host)` (from `@artubeplate/core/scenes`)
gives their boxes, `inCanvasUnits` turns them into a canvas's design units, and `clearOfHud` moves a
logo out of them (`pinClearOfHud` does the same to a pin). `slideClearOf` moves a board the SPIN lane
laps across into the free middle beside the lane, and shrinks it only as far as sliding does not
clear it (`shrinkClearOf` shrinks a board about a point instead). Where nothing overlaps, nothing
moves. `hudPlayArea` lays its containers out again when those controls change. New games from
`create-artubeplate` start with all of it (`Scene.pins()` in the template).

## Subpaths

| Import | Contents |
|---|---|
| `@artubeplate/core` | `createArtubeGame`, the engine (FSM, phases, turbo, beats), stores, currency, the skin CSS, and everything in `/rgs`. |
| `@artubeplate/core/rgs` | Wire types and tolerant normalizers, `RGS_ERRORS` / `RgsError`, `readRuntime` / `isArtubeLaunch` / `hubUrl`, `ArtubeRgsClient`, `MockRgs`, `loadNetwork` (the transport for this launch; the mock only in dev and demo builds) and `createNetwork` (its synchronous form, which ships the mock in every build). |
| `@artubeplate/core/math` | The artifact rules as code: `validateArtifact` (isomorphic, streaming), `parseManifest`, exact RTP, the zstd one-frame check, `loadArtifact` for the mock, `inferSlotConfig`. |
| `@artubeplate/core/rules` | The `artubeplate/slot@1` schema (`parseSlotConfig`), `buildSlotRules` (paytable, specials, paylines or ways, per-mode sections, RTP grid, controls, legal), `buildIntroSlides` (intro cards from the config and the modes), `symbolTile`. |
| `@artubeplate/core/scenes` | Scenes and transitions for pixi v8 + GSAP: `SceneDirector` (persistent backdrop and foreground layers), `SceneContainer` (a scene that is a pixi Container, laid out in a design frame), `SmartContainer` (per-orientation layout data in design units, `pinChildAt`, a `SmartViewport` such as `hudPlayArea(host)`, the screen above the HUD bar that follows the bar by itself; `measureHudPlayArea` measures it once; `measureHudKeepOut` / `clearOfHud` / `slideClearOf` / `pinClearOfHud` keep a logo, a board and a side column clear of the HUD's controls), `slamReels` (a slam-stop that waits for a reel still pushing off, so it never jumps), transitions `cut`, `dim`, `shader` (dissolve, wipe, iris, burst, halftone, peel, pixelate, fade, or your own GLSL) and `morph` (keep the background, swap objects on GSAP timelines), the timeline helpers `popIn` / `dropIn` / `fadeIn` / `fadeOut` / `scaleIn`, `IntroScene`, and `stickerSlap` (a snapshot of any container presses onto the scene like a bowed sticker; `StickerQuad` is the sheet with movable corners and a `bow`). See [docs/SCENES.md](../../docs/SCENES.md). |
| `@artubeplate/core/ui` | In-canvas UI that looks finished out of the box: `configureTypography` + text roles (`label`, `textStyle`: white, outlined, readable), `ensureFonts`, `WinBox` (count-up), `WinAnnouncer` (BIG → MEGA → EPIC WIN, counted up, text or art titles, FX hooks), `lineWinLabel`, `BigWinBanner`, `drawPanel`, `drawBackdrop`. See [docs/SCENES.md](../../docs/SCENES.md#type-and-win-ui-artubeplatecoreui). |
| `@artubeplate/core/fx` | Cartoon effects: `Blitter` (sprites burst out of a point and streak into a counter, calling back on every arrival) and `CartoonFx` (GPU particle bursts on pylinka: sparkle, shard, puff, confetti, glow; pooled emitters, presets as data, your art or the drawn defaults). `CartoonFx.create()` loads `@pylinka/core` and `@pylinka/graph` when called, so they are needed only by games that use it. `StickerBakery` bakes the sticker look (an ink line hugging the shape, a white border around it, measured against the piece) onto flat art at load, so every piece and anything drawn in code share one line weight; `ink: 0` gives a white edge alone, `wobble` a hand-cut border that swells and thins along the outline, `shadow` a soft halo baked under the whole sticker. `LineShow` draws a line slot's win lines, white and simple: the round's overview (every line at once, every winning symbol woken) and the idle cycle's snake (a thick head tapering to a thin tail racing the zigzag into the last symbol, with an optional thin trail), every fade a group fade through one `AlphaFilter`, so crossing lines and joins never show while they fade; `SilhouetteMask` keeps those lines behind the winning symbols, holes included (a Q's counter), by masking the line layer with the symbols' hole-filled silhouettes re-posed every frame; `silhouetteOf` makes such a silhouette for any texture. See [docs/SCENES.md](../../docs/SCENES.md#effects-artubeplatecorefx). |
| `@artubeplate/core/motion` | The studio motion style as data and code (pixi v8 + GSAP 3): `motion.rig` wraps a piece in a `root` for layout and `move` / `body` layers for motion; `motion.play(rig, name, { variant, dir, speed, on })` plays a primitive from the spec (`appear`, `popIn`, `land`, `slam`, `exit`, `wow` S/M/L, `pulse`, `float`, `tease`, `shake`, `hop`, `roll`, `tumble`, `turn`, `swap`, `flip`); `motion.fly` / `motion.count` / `motion.cascade` / `motion.prism` for groups, counters and cubes; `motion.skip` / `motion.stop`; `motion.settled(animation)` (a promise that also settles when the animation is cut short, for cleanup after it); `motion.seconds` / `motion.ease` for the tokens; and `motion.spec`, the playbook's `motion-style.json`. See [Motion](#motion). |
| `@artubeplate/core/audio` | `GameAudio` / `createGameAudio`: the slot mix on zvuk (below). Loaded lazily by the core when a game passes `audio`. |
| `@artubeplate/core/assets` | The game side of the asset pipeline: `loadAssets` (the manifest's texture bundles through Pixi's Assets, with progress), `soundsFromManifest` (its audio as zvuk entries: folder = bus, `.N` = variants, music stems), `textureManifest`. |
| `@artubeplate/core/testing` | `MockRgs`, `InstantTicker` and `mockHud()`, a recording HUD port, to run whole rounds headless. |
| `@artubeplate/core/vite` | `artubeplate()`: serves `math/` to the mock during `vite dev` and validates it on start; proxies `/api-rgs` to `$ARTUBE_HOST`; runs the asset pipeline over `raw-assets/` (AssetPack: spritesheets, @0.5x, png/webp, webm + mp3, content-hashed names) and serves its manifest as `import assets from 'artubeplate:assets'`. `@assetpack/core` is needed only when the folder exists. |
| `@artubeplate/core/node` | `validateDir`, `loadArtifactDir`, `writeArtifact`, `convertStake`, `packDir`, `ensureConfig`: the Node half of the math tooling. |

## Sound

Pass `audio: { sounds, bgm }` to `createArtubeGame` and the core builds the mix on
[zvuk](https://www.npmjs.com/package/@schmooky/zvuk):

```
master (headroom −3 dB → limiter at −1 dBFS)
├── MUSIC group (the HUD's MUSIC row) → music · ambience          each: compressor → ducker
└── EFFECTS group (the SOUND row) → reels · symbols · anticipation · wins · voiceover · ui · reverb
                                                                  each: compressor, 8-voice cap
```

- A compressor tuned per bus (`BUS_COMPRESSION`: gentle on music, punchy on reels and wins) and a
  limiter on the master, out of the box. `compression: { wins: { ratio: 6 }, ui: false }` tunes a
  bus, `compression: false` / `limiter: false` turn them off.
- The music ducks under `wins` (`duckMusicFrom`, `duckAmount`); every one-shot is loudness
  normalized on load; effects buses cap at 8 voices; everything is suspended while the tab is
  hidden (`pauseWhenHidden`).
- Sounds: one file or a codec ladder (`['x.webm', 'x.mp3']`), `kind: 'variants'` (a different take
  on every play, shuffle-bag by default), or `kind: 'music'` (intro → loop → outro, or a plain loop
  with a seamless crossfade).
- `audio.play(name, { volume, pitch })` (jitter with `{ base, jitter }`; an unknown name warns once
  and never throws), `audio.loop(name)` → `{ stop }`, `audio.music(name)` (crossfades from the
  playing track), `audio.stopMusic({ outro: true })`, `audio.ambience(name)` (a bed under the
  music, never crossfaded).
- The HUD's SOUND / MUSIC rows and mute drive the groups (the HUD saves them); `inputSounds` clicks
  the HUD's buttons (`betUp` / `betDown` tell the bet's direction, `skip` sounds once for every
  slam, by the round button, the spacebar or a tap); `bgm` and the `ambience` beds start on the
  first tap.

With the asset pipeline, `soundsFromManifest(assets)` writes `sounds` for you from
`raw-assets/audio{m}/<bus>/…`.

## Motion

`@artubeplate/core/motion` plays the Lowres Labs studio motion on pixi v8 + GSAP 3. The numbers
come from one JSON (`motion.spec`, the playbook's `motion-style.json`): a frame scale (5, 8, 13, 21,
34, 55, 89 frames at 60 fps), six eases by intent (out, in, glide, pop, wobble, linear) and every
primitive as steps: appear, popIn, land, slam, exit, wow (S, M, L), pulse, float, tease, shake, hop,
roll, tumble, turn, swap, flip, fly, count, cascade. `motion.rig(sprite)` wraps a piece in three
layers: `root` (layout's: pin it), `move` (x, y, angle, alpha) and `body` (scale, squash). Steps
marked `scaled` follow the turbo clock; contacts and accents keep their frames. Every play can
`skip()` to its end pose, and the contacts call back on their frame (`impact`, `pop`, `swap`,
`advance`, `arrive`) for sounds. `motion.seconds('quick')` and `motion.ease('pop')` hand the tokens
to a tween of your own.

```ts
import { motion } from '@artubeplate/core/motion';

motion.speed = () => ctx.turbo.speed;                 // 1, 0.4 or 0.12
const coin = motion.rig(Sprite.from('coin-cyan'));
scene.pinChildAt(coin.root, PINS.coin);                // layout owns root
await motion.play(coin, 'land', { on: { impact: () => sfx.play('coin-land') } });
motion.play(coin, 'wow', { variant: 'M' });
```

## Real RGS or mock

| Launch | Transport |
|---|---|
| `?sessionId=…&gameId=…&lng=…` (an operator launch) | The real hub at `/api-rgs/api/slot?sessionId=…&game=<gameId>`, relative to the page; `lng` picks the language. |
| No `sessionId`, or `?mock=1` | `MockRgs`, drawing from the math the Vite plugin serves. |

The mock takes URL knobs (`?balance=`, `?currency=demo`, `?frc=10`, `?maxWin=`, `?seed=`,
`?latency=`, `?mockError=503`, `?force=buyfs:12`) and a scripting API (`forceRow`, `failNext`,
`simulateReconnect`, `simulateOutage`, `closeSession`, `replaceConnection`, `rowsWhere`…). See
[docs/ARTUBE_RGS.md](../../docs/ARTUBE_RGS.md#the-local-mock).

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { artubePartnerLoader } from '@artube/loader';
import { artubeplate } from '@artubeplate/core/vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [artubePartnerLoader(), artubeplate()],
}));
```

`artubeplate({ mathDir, validate, demoBuild, rgsHost })`: `mathDir` defaults to `$ARTUBEPLATE_MATH`, then
`math`. `rgsHost` (default `$ARTUBE_HOST`) proxies `/api-rgs`, HTTP and WebSocket, to a real Artube
environment during `vite dev`, so `http://localhost:8080/?sessionId=…&gameId=…` (Artube Hub's Play on Localhost) plays a real session. `demoBuild: true` copies the math into the build for a mock-only demo site. Never upload
that build to Artube. The plugin also decides whether the mock may run: in `vite dev` and a demo
build it may; a plain build never runs it, so a deployed game opened without a session shows
"No game session" instead of looking for math.

## The `artubeplate` CLI

```bash
artubeplate math validate <dir> [--json] [--no-books-check]   # every Hub rule; exit 1 on failure
artubeplate math stats <dir>                                   # the same report, never fails
artubeplate math from-stake <publish_files> --out <dir> [--type m=Purchase] [--volatility High]
                                                               # [--config f.json] [--equalize flatten|replicate]
artubeplate math pack <dir> --out <dir>                        # compress and re-frame a hand-made set
artubeplate math config <dir> [--force] [--title <name>]       # infer a starter settings.config
```

The report shows, per mode: price, declared vs computed RTP (exact), rows, distinct multipliers,
hit rate, max win and its odds, and the tail. The rules are listed in
[docs/MATH_CONTRACT.md](../../docs/MATH_CONTRACT.md).

## Testing a game headless

```ts
import { MockRgs, InstantTicker, mockHud } from '@artubeplate/core/testing';
import { loadArtifactDir } from '@artubeplate/core/node';

const rgs = new MockRgs({ math: await loadArtifactDir('math'), seed: 1, latency: 0 });
await rgs.connect();
const session = await rgs.session();
rgs.forceRow('base', 12); // the next base round lands on book row 12
const round = await rgs.spin({ gameMode: 'base', betIndex: session.sessionSettings.defaultBetIndex });
rgs.failNext(503); // the spin after that is refused with errorId 503
```

`mockHud()` records every HUD call and answers notices from a queue, and `InstantTicker` makes
waits free, so a test can drive the FSM through complete rounds without a browser (the core's own
`tests/engine.test.ts` does exactly this).

## License

MIT © Dmitry Vasiliev
