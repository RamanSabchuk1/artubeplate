# artubeplate

A batteries-included starting point for slot games on the **Artube RGS**: bring a math folder,
get a playable, platform-compliant game.

- **`@artubeplate/core`**: the game core. The SignalR RGS client with the platform's retry and
  recovery rules, a local mock RGS that plays your own math, the round state machine, the
  [open-slot-ui](https://github.com/schmooky/open-slot-ui) HUD built from the session, free rounds,
  max win, reconnects, errors, autoplay, turbo, buy features and lucky bets, audio, the
  `artubeplate` math CLI (validate, convert from Stake Engine, pack), and scenes: an intro screen,
  transitions (dim, GPU shader, and keep-the-background morphs on GSAP timelines), and
  `SmartContainer` for layouts per orientation in design units.
- **`create-artubeplate`**: the scaffolder, and the showcase game it copies: a pixi-reels slot whose
  board, symbols, paytable and rules all come from the math's `settings.config`.

Made by Dmitry Vasiliev. MIT.

## New game in four commands

```bash
npm create artubeplate@latest my-game -- --math ./the-math-we-provide
cd my-game
npm install
npm run dev
```

`--math` takes either an **Artube upload set** (`index.json` + `lookUpTable_*.csv.zst` +
`books_*.jsonl.zst`), copied into `math/`, or a **Stake Engine `publish_files` folder**, staged for
conversion:

```bash
npm run math:from-stake -- math-stake --out math   # only for Stake math
npm run math:check                                 # the checks Artube Hub runs on upload
npm run dev                                        # plays on a local mock RGS that draws from math/
npm run build                                      # dist/ for the Artube CDN
```

Without a session in the URL, `npm run dev` runs on the **mock RGS**, which draws outcomes from
`math/` with the same rules as the platform: bets by index, prices, free rounds, the max-win cap,
error codes, reconnects. Opened by an operator (`?sessionId=…`), the same build talks to the real
hub at `/api-rgs/api/slot`.

Without `--math`, the game starts with the showcase math (a 5×4, 40-line slot with wilds,
respins, free spins, a 100× buy and a 1.25× lucky bet). Replace `math/` at any time.

> **Not on npm yet.** Until the packages are published, pack the core and point the scaffolder at
> it (see [Working from this repo](#working-from-this-repo)).

## What a game supplies

The core owns the platform. A game supplies four things, and the template has all four ready:

| | Template file | What it does |
|---|---|---|
| Config | `src/config.ts` | Title, gameServerId, autoplay limits. Everything else is read from the session and the math. |
| `interpretBook` | `src/game/model.ts` | Pure: book payload → a round model. Reads the event contract in [docs/MATH_CONTRACT.md](docs/MATH_CONTRACT.md) and the Stake math-sdk dialect. |
| The scene | `src/scene/Scene.ts` | A pixi-reels board built from `settings.config`. Swap the placeholder tiles for art. |
| Present phases | `src/phases/present.ts` | Walks the model: wins, respins, scatter, free spins, big-win beats. |

```ts
import { createArtubeGame } from '@artubeplate/core';

const game = createArtubeGame({
  config: GAME_CONFIG,
  interpretBook: (payload, info) => interpretBook(payload, info, rows),
  mountView: async (host, ctx) => new Scene(host, slotFromSession(ctx.gameConfig), ctx.turbo),
  phases: makePresentPhases(deps),
  audio: AUDIO,
});
await game.start();
```

`start()` shows the Artube loader, connects, calls `session`, builds the HUD from it (currency,
bet ladder, modes, prices, RTP), mounts the scene, waits for the player to get past the intro
screen, then offers any free-rounds campaign. From then
on the core runs every round and every platform rule. See
[docs/ARTUBE_RGS.md](docs/ARTUBE_RGS.md).

## Docs

- [docs/MATH_CONTRACT.md](docs/MATH_CONTRACT.md): the Artube artifact rules, the `settings.config`
  slot description, the book events the template animates, converting Stake math, shipping math.
- [docs/ARTUBE_RGS.md](docs/ARTUBE_RGS.md): every RGS rule and where the core implements it, the
  mock RGS and its URL knobs, and what the public docs leave open.
- [docs/SCENES.md](docs/SCENES.md): scenes as pixi Containers, the transitions, building an info
  screen and its handoff to the game, and SmartContainer layouts.
- [packages/core/README.md](packages/core/README.md): the core API.
- [packages/create-artubeplate/README.md](packages/create-artubeplate/README.md): scaffolder options.

## Repo layout

```
packages/core/                    @artubeplate/core (+ the artubeplate CLI)
packages/create-artubeplate/      the scaffolder
  template/                       the showcase game = what gets scaffolded (a workspace member)
math/                             dev-only generator of the showcase math (writes template/math/)
e2e/                              Playwright tests against the showcase on the mock RGS
docs/                             the math contract and the RGS mapping
```

## Working from this repo

Requires Node ≥ 22.15 (for `node:zlib` zstd) and pnpm 10.

```bash
pnpm install
pnpm build            # builds @artubeplate/core
pnpm dev              # the showcase at http://localhost:8080 (mock RGS)
pnpm test             # core unit tests + scaffolder tests
pnpm typecheck
pnpm e2e              # Playwright: 31 scenarios on the mock RGS, 16 of them autoplay
pnpm math:check       # validate the showcase math
pnpm math:generate    # regenerate the showcase math (Monte-Carlo, RTP pinned to 96.20)
```

Play any math folder in the showcase without copying it:

```bash
ARTUBEPLATE_MATH=/path/to/math pnpm dev
```

Scaffold a standalone game against a local build of the core (before it is published):

```bash
pnpm --filter @artubeplate/core build
pnpm --filter @artubeplate/core exec pnpm pack --pack-destination ../../.packs
node packages/create-artubeplate/index.js ../my-game --math ./the-math --core ./.packs/artubeplate-core-0.1.0.tgz
```

`--core` writes an absolute `file:` dependency, so `npm install` in the new game works from
anywhere on the machine.

## Releasing

`.github/workflows/release.yml` publishes `@artubeplate/core` and `create-artubeplate` to npm on a
`v*` tag, with npm trusted publishing (no token). The one-time npm and GitHub setup is described at
the top of that file.

## License

MIT © Dmitry Vasiliev
