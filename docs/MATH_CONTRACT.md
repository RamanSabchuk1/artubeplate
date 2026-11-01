# The math contract

A game's `math/` folder answers to two readers at once:

1. **Artube Hub**, which accepts the folder only if it follows the platform's artifact rules
   (section 1). `artubeplate math validate` runs the same checks locally.
2. **The game client**, which reads the slot description in `settings.config` (section 2) and
   animates each round from its book line (section 3).

The platform pays from the weights table. The client never computes money: it shows the win the
RGS credited and uses the book only to animate the round.

Source of truth for the platform side: the Artube docs,
[Preparing Maths](https://docs-review.artube-888.live/en/backend/rgs/preparing-math/) and
[Publishing Maths](https://docs-review.artube-888.live/en/backend/rgs/publishing-math/).

---

## 1. The artifact (what Artube Hub accepts)

A flat folder: one uncompressed manifest plus one weights table and one books file per mode.

```
math/
  index.json                      the manifest (plain JSON, ≤ 4 MiB)
  lookUpTable_base_0.csv.zst      weights: id,weight,multiplier (zstd CSV)
  books_base.jsonl.zst            books: one JSON value per line (zstd JSONL)
  lookUpTable_buyfs_0.csv.zst
  books_buyfs.jsonl.zst
```

The file names are whatever `index.json` references. artubeplate's writers use the names above.
The folder must hold nothing else: a stray `.DS_Store` fails the upload.

### index.json

```json
{
  "settings": {
    "betCredit": 100,
    "gameModes": [
      { "name": "base",     "cost": 100,   "type": "None",     "rtp": 96.2, "volatility": "High" },
      { "name": "luckybet", "cost": 125,   "type": "LuckyBet", "rtp": 96.2, "volatility": "High" },
      { "name": "buyfs",    "cost": 10000, "type": "Purchase", "rtp": 96.2, "volatility": "Very High" }
    ],
    "config": { "schema": "artubeplate/slot@1", "board": { "reels": 5, "rows": 4 }, "symbols": [] }
  },
  "modes": [
    { "name": "base",     "events": "books_base.jsonl.zst",     "weights": "lookUpTable_base_0.csv.zst" },
    { "name": "luckybet", "events": "books_luckybet.jsonl.zst", "weights": "lookUpTable_luckybet_0.csv.zst" },
    { "name": "buyfs",    "events": "books_buyfs.jsonl.zst",    "weights": "lookUpTable_buyfs_0.csv.zst" }
  ]
}
```

| Field | Rule |
|---|---|
| `settings.betCredit` | Integer ≥ 1. How many credits make one base bet. At 100, payouts step in 0.01× of the bet. |
| `gameModes[].name` | `[A-Za-z0-9_]{1,32}`, unique. It is the `gameMode` string the client sends to `spin` (case-sensitive). |
| `gameModes[].cost` | Integer ≥ 1, in credits. The client sees `priceMultiplier = cost / betCredit`. |
| `gameModes[].type` | `None`, `LuckyBet` or `Purchase` (case-sensitive). The client receives `Purchase` as `BuyFeature`. |
| `gameModes[].rtp` | The declared RTP in percent, strictly between 0 and 100. |
| `gameModes[].volatility` | `Very High`, `High`, `Medium`, `Low` or `Very Low`. |
| `settings.config` | Anything. It reaches the client verbatim as `session.gameSettings.config`. The platform never reads it. |
| `modes[]` | `{ name, events, weights }` for every declared mode. Bare file names (no paths), each file used once. |

A game has 1 to 50 modes.

### The weights table

```
0,217638304,0
1,29525956,10
2,10431457,15
```

- Exactly `id,weight,multiplier` per row: ASCII digits, no header, no spaces, LF line endings,
  no blank lines, at most one trailing newline, no byte-order mark, each row ≤ 128 bytes.
- `id` is for you. The platform does not use it to pick an outcome.
- `weight` ≥ 1. A zero weight is rejected: drop the row from both files instead.
- `multiplier` is the payout **in credits** (0 = a loss). The win is `multiplier / betCredit`
  times the base bet: at `betCredit: 100`, `116` pays 1.16× the bet.
- **Rows that pay the same multiplier must have the same weight.**
- At most 10,000 distinct multipliers per mode.

### The books file

- One JSON object or array per line (never `null`, a number or a string), no blank lines.
- Each line ≤ 96 KiB, nesting depth ≤ 64.
- **Row N of the weights describes the outcome on line N of the books.** The line counts must match.
- The platform does not parse the line. It hands it to the client as `spinResult.payload`.

### Compression

Every weights and books file is **exactly one zstd frame**: no concatenated streams, no trailing
bytes. `index.json` is not compressed. The whole set may be up to 10 GiB compressed and 50 GiB
uncompressed.

### RTP

```
computed RTP = Σ(weight × multiplier) / Σ weight / cost × 100
```

The computed RTP must match the declared `rtp` within **±0.50 percentage points** (both rounded
to 2 decimals). RTP is taken against the mode's `cost`, not `betCredit`: a 100× buy feature needs
100× bigger payouts to reach the same RTP.

Worked example: `cost: 100`, rows `0,1,0` and `1,1,192` give 192 / 2 / 100 × 100 = **96%**.

### How the platform plays it

1. The client sends `spin { gameMode, betIndex }`.
2. The platform charges `allowedBets[betIndex] × priceMultiplier`.
3. It draws one row by `weight` with its own RNG and credits `multiplier / betCredit × bet`
   (capped by the operator's max win, if one is set).
4. It returns the book line on the same position as `spinResult.payload`, with
   `winMultiplier = multiplier / betCredit`.

### Checking a set

```bash
npx artubeplate math validate math
```

`math validate` runs every rule above, streaming, without loading whole files into memory. It
exits with code 1 when the Hub would reject the set. `math stats` prints the same report and never
fails. Both print, per mode: price, declared vs computed RTP, row and multiplier counts, hit rate,
max win and its odds, and the tail (odds of a win ≥ 10×, 100×, 1000×). `--json` prints the
report as JSON.

In a game project these are `npm run math:check` and `npm run math:stats`. The dev server also
validates `math/` when it starts.

---

## 2. `settings.config`: the slot description (`artubeplate/slot@1`)

The platform has no idea what a reel is. The template reads the board, the symbols and the
paytable from `settings.config`, so a new math folder reconfigures the reels, the paytable and
the rules with no code change.

```json
{
  "schema": "artubeplate/slot@1",
  "title": "Whisker Pharaoh",
  "board": { "reels": 5, "rows": 4 },
  "symbols": [
    { "id": "H1", "name": "Sacred cat", "kind": "high", "label": "😺", "color": "#c79a2e" },
    { "id": "A",  "name": "Ace",        "kind": "low",  "label": "A" },
    { "id": "W",  "name": "Wild",       "kind": "wild", "label": "W" },
    { "id": "S",  "name": "Paw Scatter","kind": "scatter", "label": "🐾" }
  ],
  "pays": { "unit": "lineBet", "lines": 40, "table": { "H1": { "3": 60, "4": 200, "5": 800 } } },
  "paylines": [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  "wild": { "symbol": "W", "reels": [1, 2, 3, 4], "multipliers": [2, 3], "multipliersAdd": true },
  "scatter": { "symbol": "S", "pays": { "3": 5 }, "freeSpins": { "3": 8, "4": 12, "5": 16 } },
  "freeSpins": { "retrigger": 2, "sticky": true },
  "maxWin": 5000,
  "modes": {
    "buyfs":    { "name": "Free Spins", "description": "Buy the Free Spins round." },
    "luckybet": { "name": "Lucky Bet",  "description": "A 1.25× ante that doubles the trigger rate." }
  },
  "texts": { "about": "{{title}} is a 5×4 video slot with 40 fixed paylines." }
}
```

| Field | Required | Meaning |
|---|---|---|
| `board` | yes | `{ reels, rows }`, positive integers. |
| `symbols` | yes | `{ id, name?, kind?, label?, color?, image? }`. `kind` is `high`, `mid`, `low`, `wild`, `scatter` or `special`. `image` is the symbol's art, used on the reels and in the paytable: a URL, where a relative path resolves against the game's page (keep the files in `public/`). Without it, the client draws a tile from `color` (or a default for the kind) and `label`. |
| `title` | no | The game's name (window title, rules). |
| `pays` | no | `table[symbol][count] = pay`. `unit: "lineBet"` means the pay multiplies one line's bet (total ÷ `lines`); `"totalBet"` means it multiplies the total bet. The rules show every pay as × total bet. `ways` (e.g. `3125`) makes it a ways game when there are no `paylines`: a pay is that of one way, and the rules state the ways and word the worked example as a ways win. |
| `paylines` | no | `[line][reel] = row`, 0-based. Drawn in the rules. |
| `wild` | no | The wild's id, the reels it lands on, its multipliers and whether several on one line add up. |
| `scatter` | no | The scatter's id, its pays by count and the free spins it awards by count. |
| `freeSpins` | no | `retrigger`: spins added by a retrigger. `sticky`: wilds stay for the rest of the round. |
| `bonus` | no | The bonus screens: `name` (big on its rules screen, default "Free spins") and `rules` (what the bonus does, a paragraph each; default `texts.freeSpins`, else derived from `wild` and `freeSpins`). |
| `maxWin` | no | The round cap as × total bet. Shown in the HUD and the rules. |
| `modes` | no | Card copy per mode id: `name`, `description`, `image`. |
| `texts` | no | Your own copy by topic: `about`, `wild`, `scatter`, `freeSpins`, `respin`. `{{title}}` interpolates. |
| `intro` | no | The intro screen: `show: false` turns it off; `subtitle`; `slides: [{ title, text, image?, symbol?, badge? }]` (up to three; `symbol` uses that symbol's tile as art). Without `slides`, cards are derived from the wild, the free spins, the max win and the modes. |

`buildSlotRules` (in `@artubeplate/core/rules`) turns this plus the session's modes into the INFO
window: paytable, wild and scatter panels, paylines (or the ways), one section per extra mode with its price,
free spins, the RTP and max-win grid, the controls and the legal text.

**No config?** The client falls back to a 5×3 board of placeholder tiles and logs why. Run
`npm run math:config` (`artubeplate math config math`) to write a starter config into
`index.json`: it reads the base mode's books to infer the board size and the symbol set, and names
symbols by convention (`H1…` high, `M1…` mid, `L1…`/card ranks low, `W` wild, `S` scatter). It
cannot infer the paytable: add `pays` and `paylines` (or `pays.ways` for a ways game) by hand for the rules window. Editing
`index.json` does not touch the weights or books, so the set stays valid.

---

## 3. The book: what the template animates

The platform delivers the book line untouched. The template's `interpretBook`
(`src/game/model.ts`) folds it into a round model. It reads this event list:

```json
{
  "id": 40,
  "payoutMultiplier": 900,
  "events": [
    { "type": "reveal", "gameType": "base", "board": [["T","S","S","J"], ["K","M2","W","S"], …],
      "wilds": [{ "reel": 1, "row": 2, "mult": 2 }] },
    { "type": "winInfo", "totalWin": 0.7,
      "wins": [{ "line": 32, "symbol": "T", "count": 3, "win": 0.5, "mult": 5,
                 "positions": [{ "reel": 0, "row": 0 }, { "reel": 1, "row": 2 }, { "reel": 2, "row": 0 }] }] },
    { "type": "scatterWin", "count": 4, "win": 5, "positions": [{ "reel": 0, "row": 1 }, …] },
    { "type": "featureStart", "totalSpins": 12 },
    { "type": "reveal", "gameType": "free", "board": [...], "wilds": [...] },
    { "type": "winInfo", "wins": [...] },
    { "type": "freeSpinTrigger", "add": 2 },
    { "type": "freeSpinEnd", "total": 3.3 },
    { "type": "finalWin", "amount": 9 }
  ]
}
```

| Event | Fields | What the client does |
|---|---|---|
| `reveal` | `board` (`[reel][row]` symbol ids), `gameType` (`base`, `respin`, `free…`), `wilds?` (`[{ reel, row, mult }]`) | Lands the reels. A `base` reveal is the base stage, `respin` adds a respin stage, `free…` adds a free spin. With `config.freeSpins.sticky`, free-spin wilds stay pinned until the feature ends. |
| `winInfo` | `wins[]`: `{ line, symbol, count, win, mult, positions[] }` | Shows the wins of the stage just revealed. |
| `scatterWin` | `count`, `win`, `positions[]` | Shows the scatter pay. |
| `featureStart` | `totalSpins` | Starts free spins with that many spins. |
| `freeSpinTrigger` | `add` | A retrigger, credited to the spin before it. |
| anything else | | Ignored (`updateFreeSpin`, `freeSpinEnd`, `finalWin`, your own events). |

Rules:

- **`win` values are × the base bet**: the round's whole bet across all lines, before any mode
  price multiplier. A `win` of 0.5 at a 2.00 bet shows 1.00.
- The line may be `{ "events": [...] }`, a bare array of events, or `{ "state": [...] }`.
  Extra top-level fields are fine.
- If a book carries `payoutMultiplier`, the validator checks it against the row's multiplier and
  warns on a mismatch (it is not a Hub rule).
- The book must agree with its row: its wins add up to `multiplier / betCredit` (before any cap).
  The platform cannot check this, so it is your contract. The client shows the platform's credited
  win either way.
- A book whose feature holds more spins than it announced still plays every spin.

The template also reads the **Stake Engine math-sdk dialect**, so converted Stake math usually
plays unchanged: `gameType: "basegame" | "freegame"`, board cells as `{ "name": "H1" }`, boards
padded with one extra row above and below, `kind` for the count, `meta.lineIndex` /
`meta.multiplier`, `freeSpinTrigger { totalFs, positions }` as the feature start, and wins written
× 100. The unit is detected per round from the platform's `winMultiplier`.

Your own book format is fine too: write your own `interpretBook` and Present phase. The core only
hands you `(payload, info)`.

---

## 4. Bringing math into a game

| You have | Do |
|---|---|
| An Artube set (`index.json` with `settings` + `.csv.zst` + `.jsonl.zst`) | Put it in `math/` (or scaffold with `--math <dir>`), then `npm run math:check`. |
| A Stake Engine `publish_files` folder | `npm run math:from-stake -- <dir> --out math` |
| Plain `.csv` / `.jsonl`, or multi-frame `.zst` files | `npx artubeplate math pack <dir> --out math` |
| A set without `settings.config` | `npm run math:config` |
| A set elsewhere on disk | `ARTUBEPLATE_MATH=../other-set npm run dev` plays it without copying. |

### From Stake Engine

The formats are siblings: same file names, the same `id,weight,payout` rows, payouts already
integers × 100. Artube adds four rules the Stake publish folder does not follow:

| | Stake Engine | Artube |
|---|---|---|
| Manifest | `modes[]` with a float `cost` | `settings` (`betCredit`, typed `gameModes` with integer `cost`, RTP, volatility) + `modes[]` |
| Weights file | plain `.csv` | `.csv.zst`, one zstd frame |
| Zero weights | allowed | rejected |
| Rows sharing a payout | any weights | one shared weight |

`math from-stake` handles all four:

- `betCredit` defaults to 100 (Stake payouts are × 100), so `cost 1.0` becomes 100 credits.
- Mode types default by price: 1× `None`, below 5× `LuckyBet`, otherwise `Purchase`. Override
  with `--type bonus=Purchase` (repeatable).
- Zero-weight rows are dropped from both files.
- Groups of rows sharing a payout get one weight. `--equalize flatten` (default) gives every row
  in a group the group's mean weight: the payout distribution and RTP are kept, the choice of book
  inside the group becomes uniform. `--equalize replicate` duplicates book lines in proportion to
  their weights instead (exact, up to `--max-copies`, default 32 per row; bigger files).
- The declared RTP is recomputed from the converted table.
- Without `--config <file.json>`, a starter `settings.config` is inferred from the books.

Other options: `--volatility High` (or per mode, `--volatility bonus="Very High"`),
`--bet-credit <n>`. The result is validated right away.

---

## 5. Shipping the math

The math never ships inside the client build: `math/` sits outside `public/`, and the Vite plugin
only serves it to the local mock RGS during `vite dev`.

1. `npm run math:check` → `READY`.
2. In Artube Hub (the game must be in `Dev Ready`), open the game card, click Upload Math, select
   the `math/` folder, then Start Math Verification. The Hub validates and compiles it and reports
   declared vs actual RTP per mode.
3. The Artube team promotes and publishes it per environment (DEV, Stage, Production). Publishing
   to DEV does not make it live anywhere else. A rollback is publishing the previous version again.

When the math changes the game's modes, prices or config, the client picks them up from the next
`session`. No client release is needed unless the book format changed.
