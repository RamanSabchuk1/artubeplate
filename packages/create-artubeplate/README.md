# create-artubeplate

Scaffold a slot game for the **Artube RGS** on
[`@artubeplate/core`](https://github.com/lowres-labs/artubeplate/tree/main/packages/core), optionally
with the math you already have.

```bash
npm create artubeplate@latest my-game
# or with your math:
npm create artubeplate@latest my-game -- --math ./path/to/math --game-server-id <gameServerId>

cd my-game
npm install
npm run math:check   # the checks Artube Hub runs on upload
npm run dev          # plays on a local mock RGS that draws from math/
```

`pnpm create artubeplate my-game` and `yarn create artubeplate my-game` work too.

## Options

| Option | |
|---|---|
| `--math <dir>` | Use this math instead of the showcase math. An **Artube upload set** (`index.json` with `settings`) is copied into `math/`, only the files `index.json` references. A **Stake Engine `publish_files` folder** is staged in `math-stake/`; convert it after install with `npm run math:from-stake -- math-stake --out math`. |
| `--game-server-id <id>` | Writes `VITE_GAME_SERVER_ID` to `.env`: a fallback for the hub's `game` parameter. Artube launch URLs carry it as `?gameId=` (your publicGameId; `<publicGameId>-stage` on Stage), which always wins. |
| `--core <spec>` | The `@artubeplate/core` to depend on. Default: the published `^0.1.0`. For a core that is not on npm yet, pass a packed `.tgz`: it is copied into the project's `vendor/` and written as `file:vendor/<name>.tgz`, so the project installs anywhere, Artube's pipeline included. A folder is written as an absolute `file:` path, which only works on this machine. |
| `-y`, `--yes` | No prompts. |

## What you get

A complete game that plays out of the box:

- A pixi-reels slot whose board, symbols, paytable, paylines, mode cards and rules are read from
  the math's `settings.config`. A new math folder reconfigures it without code changes.
- The open-slot-ui HUD: bet ladder, spin and slam-stop, autoplay with limits, turbo, buy-feature
  and lucky-bet cards, history, sound and music, the rules window.
- Everything the platform requires, handled by the core: the Artube loader, `session`, free-rounds
  campaigns, the max-win modal, reconnects, error codes, one connection per session, demo sessions.
- A local mock RGS for `npm run dev`, with URL knobs for every scenario (`?frc=10`,
  `?mockError=503`, `?maxWin=500`, `?currency=demo`, `?force=buyfs:12`…).
- The math tooling as npm scripts: `math:check`, `math:stats`, `math:config`, `math:from-stake`.
- Ready for Artube's pipeline (Artube's own, not part of the project): `npm ci && npm run build`
  gives `dist/` with relative, content-hashed assets. The dev server runs on port 8080, where Hub's
  Play on Localhost opens the game.

The generated project's own README explains the files and the path to production.

## License

MIT © Dmitry Vasiliev
