# How artubeplate talks to the Artube RGS

This page maps each rule of the Artube RGS client contract to the place in `@artubeplate/core`
that implements it, and lists what the public docs leave open. Platform source:
[SignalR Contract](https://docs-review.artube-888.live/en/backend/rgs/signalr-contract/),
[Session and Spin Lifecycle](https://docs-review.artube-888.live/en/backend/rgs/session-spin-lifecycle/),
[Errors and Retries](https://docs-review.artube-888.live/en/backend/rgs/errors-and-retries/),
[Free Rounds in RGS](https://docs-review.artube-888.live/en/backend/rgs/free-rounds-campaign/),
[Max Win](https://docs-review.artube-888.live/en/features/max-win/).

## The connection

```
wss://<same host as the game>/api-rgs/api/slot?sessionId=<uuid>&game=<the launch URL's gameId>
```

| Rule | Where |
|---|---|
| The operator creates the session and puts `sessionId` in the launch URL. The game never creates one. | `readRuntime()` reads `sessionId` (also `sessionID`, `session_id`, `session`). |
| `game` comes from the launch URL's `gameId`: the publicGameId on DEV and production, `<publicGameId>-stage` on Stage. Never hardcode it. | `readRuntime()` reads `?gameId=` (also `?game=`, `?gameServerId=`); `GameConfig.gameServerId` (the template's `VITE_GAME_SERVER_ID`) is only a fallback. A real launch without one fails at boot with a message naming the problem. |
| `lng` is the interface language; fall back to English. | `readRuntime()` reads `?lng=` (also `lang`, `language`, `locale`). |
| The hub path is relative to the page, with the inner `/api`. | `DEFAULT_RGS_PATH = '/api-rgs/api/slot'`; `?rgs=` overrides it for local testing. |
| Register notification handlers before `start()`. | `ArtubeRgsClient` registers all three in its constructor. |
| SignalR's automatic reconnect does not cover the first `start()`. | `connect()` retries the first start 3 times with backoff. |
| One connection per session; a second one replaces the first. | `NotifyNewConnectionHasOpened` stops the connection (so auto-reconnect cannot take the session back) and shows a blocking "Opened elsewhere" notice. |

Without a `sessionId` (a bare `npm run dev`), or with `?mock=1`, the core runs the **mock RGS**
instead: an in-process implementation of the same contract that draws outcomes from the game's own
`math/` folder. See [The local mock](#the-local-mock). Only `vite dev` and demo builds may do that
(the artubeplate Vite plugin tells the core): a build for Artube has no math in it, so opened
without a session it shows a "No game session" screen instead.

## Hub methods

| Method | Request | Used by |
|---|---|---|
| `session` | none | Boot, and after every reconnect or unknown spin outcome (`recover()`). |
| `spin` | `{ gameMode, betIndex }` | `SpinPhase`. `betIndex` is the HUD bet stepper's index into `allowedBets`; `null` during free rounds. |
| `balance` | none | Available on the transport. The core prefers `session` for recovery (demo sessions can drop restored round state on `balance`). |
| `activateFreeRoundCampaign` | `{ campaignId }` | When the player accepts the offer, and again after a reconnect. |

Every response goes through a tolerant normalizer (`normalizeSession`, `normalizeRound`,
`normalizeCampaign`, `normalizeBalance` in `rgs/protocol.ts`): camelCase or snake_case, numbers
or numeric strings, a payload delivered as nested JSON or as a JSON string. The rest of the core
sees one typed shape.

## Money

| Rule | Where |
|---|---|
| The bet is sent as an **index**. Price = `allowedBets[i] × priceMultiplier`. | The HUD's bet ladder is built from `allowedBets` / `defaultBetIndex`. `SpinPhase` sends the index and shows the price only as an optimistic debit. |
| The platform computes the money; show what it returns. | Settle shows `RoundResponse.balance` and `totalWin`. The book never pays. |
| The returned balance already contains the win. | During the round the HUD shows `balance − totalWin`, then lands the real balance when Settle presents the win. |
| `NotifyBalanceChanged` may arrive out of order. | Applied only while idle, never mid-round. |
| A refused spin (502, 503, 601, 622…) never happened. | The optimistic debit is put back and the error is shown. |
| Demo session: `currency: null`. | Amounts show "DEMO" in place of a currency (1.00 DEMO), and a "Demo play" hint appears at boot. |

## Game modes

`gameSettings.gameModes` is an array of `{ id, rtp, volatility, priceMultiplier, type }`. The core
looks modes up by `id` and builds the HUD from them:

- `None`: the base game. The default mode is the one named `base`, else the first `None` mode.
- `BuyFeature` (manifest `Purchase`): a **Buy** card in the feature sheet, priced
  `bet × priceMultiplier`, with the confirm step. Plays that mode once.
- `LuckyBet`: an **Activate** card. While on, every spin plays that mode and the bet readout shows
  the effective stake.

Card copy comes from `GameConfig.modes[id]` (the template takes it from `settings.config.modes`).
The cards come in the session's order; `GameConfig.buyOrder: 'price'` lists them cheapest first by
`priceMultiplier` (a `LuckyBet` at its full price per round), equal prices in the session's order.
`nextAvailableGameModes` is a UI hint only; the server does not enforce it and the core does not
depend on it.

## Errors

The client branches on `errorId` only. `rgsErrorFrom()` accepts a SignalR `HubException`, an error
object the call resolves to, or a bare transport failure (no `errorId`: the outcome is unknown).

| errorId | Retry | What the player sees |
|---|---|---|
| 429 rate limited | Yes: 3 times with backoff, any method (the call was refused before it ran). | "Slow down" if it persists. |
| 500 technical | `session`/`balance`: 2 times. **`spin`: never.** A 500 or a transport failure on `spin` means the outcome is unknown: block input, reconnect, call `session`, replace state. | Whatever the platform reports after recovery. |
| 501, 507 session over | No. | Blocking "Session ended". Nothing else is sent. |
| 502 invalid bet | No. | Notice, then a `session` refresh. |
| 503 insufficient funds | No. | The HUD's funds message. |
| 600 invalid game settings | No. | Blocking "Game unavailable" (the artifact or the platform is at fault). |
| 601 unknown mode | No. | Notice, then a `session` refresh. |
| 622 buy unavailable | No. | Notice. |
| 631, 637 campaign not found / unavailable | No. | Notice, campaign cleared, back to paid play. |
| 634 campaign played out | No. | Notice, campaign cleared, back to paid play. |
| 638 campaign already active | No. | Nothing: keep spinning. |

## Reconnects

SignalR reconnects automatically (5 attempts: 0, 1, 2, 5 and 10 seconds). While it does, autoplay
stops and a blocking "Reconnecting…" notice is shown. When it is back, the core calls `session`
and **replaces** its state: balance, bet ladder (keeping the player's bet if it is still offered),
modes, campaign. It never repeats a spin. If all attempts fail, a blocking "Connection lost" notice
offers a reload.

`session.round` (the round the runtime still holds) is treated as **advisory**. When it names a
round this browser session has not shown yet, for example after a reload mid-animation, the
player is offered to watch it. A replay moves no money and is not added to history, net position
or autoplay counts.

## Free rounds

1. `session` carries `freeRoundCampaign`. After the game is on screen, and before any replay
   offer, the player is offered "N free rounds at X per round" (Play now / Later). A campaign
   started in an earlier session is offered as "N of M free rounds left" with the win so far
   (Continue / Later). Every new session gets the offer (TRC "FRC Acceptance").
   - The choice is kept per `sessionId` (`game/frc.ts`). A reload after accepting shows the rounds
     left with one "Continue" and carries on (TRC "Refresh During FRC").
   - "Later" is not offered again in the same session (TRC "FRC Decline").
2. Play now → `activateFreeRoundCampaign { campaignId }`. A campaign whose bet is not in
   `allowedBets` is not activated.
3. While active: `spin { gameMode: <base mode>, betIndex: null }`, the bet ladder and buy button
   are disabled, a queued buy is dropped, and the HUD shows rounds left and the campaign win from
   the `freeRoundCampaign` block on each `RoundResponse`. The rounds play by themselves (TRC "FRC
   Auto-play"): each starts once the last has settled and no notice is open. No replay offer is
   shown while they play.
4. After a reconnect the activation is gone (it is per connection), so the core activates again.
5. When the campaign is complete: a summary notice with the total, then back to the player's own bet.

## Max win

`sessionSettings.platformMaxWin` is the operator's cap in the session currency. When a round's
credited win was cut by it, the normal presentation still plays in full, then Settle shows a
**blocking** "Maximum win reached" modal with the credited amount. `GameConfig.maxWinX` (the math's
own cap, × bet) is shown separately in the HUD and the rules.

## Other platform pieces

- **Loader.** `@artube/loader` is mandatory on the platform. The template adds
  `artubePartnerLoader()` to Vite, and the core drives its progress bar through boot. With
  `loader: { manual: true }` the game calls `ctx.loader.done()` once its art is on screen.
- **Gamification.** When `session.gamificationToken` is present on a real launch, the core starts
  the platform's widget ([Artube's frontend integration](https://docs.artube-888.live/en/features/gamification-integration/frontend-integration/)).
  It never blocks the game and is skipped on the mock. The core loads the launcher script into
  `<head>`, adds the `<div id="wagercraft">` the launcher mounts the widget into (it refuses to
  start without one, which the docs do not mention), and calls `init` with the token, the session
  id, the language, a position and the environment:
  - `env` is `demo` on Artube Dev and `prod` on Artube Prod; a wrong one fails authorisation.
    The host decides by its labels: `rc` → `rc`, `stable` → `stable`, a `cdn…` label → `prod`,
    anything else (`dev.artube-888.live`) → `demo`. `?gamificationEnv=prod` or
    `gamification: { env }` overrides it.
  - The position defaults to the top-right corner (`top: 8px, right: 8px`), clear of the spin
    button, the menu and the bet panel in every HUD layout. A game whose own pieces sit there
    passes `gamification: { position }`, fixed or a function of the screen
    (`{ orientation, touch, width, height }`); the core asks again on every resize and orientation
    change and sends `wagercraft:update-position` when the answer changes.
  - `gamification: false` turns the widget off.
- **Lobby.** `?lobbyUrl=` adds a Home row to the menu.
- **Device.** `?channel=desktop|mobile` is passed to the HUD layout.

## The local mock

`MockRgs` implements the same four methods and three notifications over the game's own artifact:
it loads `index.json`, the weights and the books (served by the Vite plugin at
`/__artubeplate/math/`), draws a row by weight, and pays `multiplier / betCredit × bet`. It follows
the platform rules: bets by index, `betIndex: null` during free rounds, 622 on a buy during free
rounds, per-connection campaign activation, the max-win cap, demo sessions.

Scenario knobs on the URL:

| Parameter | Effect |
|---|---|
| `?balance=250` | Starting balance. |
| `?currency=USD`, `?currency=demo` | Session currency; `demo` makes `currency: null`. |
| `?frc=10&frcBet=1` | Offer a 10-round campaign at bet 1. |
| `?maxWin=500` | A platform max-win cap of 500. |
| `?seed=42` | Deterministic draws. |
| `?latency=400` | Round-trip in ms. |
| `?mockError=503` | The next spin fails with this errorId (a comma list is a sequence). |
| `?force=buyfs:12` | The next round of `buyfs` lands on book row 12 (a comma list). |
| `?gamification=1` | Hand out a dummy gamification token (the widget itself only starts on a real launch). |
| `?mock=1` | Use the mock even when the URL carries a `sessionId` (dev and demo builds only). |

And from the console (`window.__GAME__` in the template):

```js
__GAME__.inspect()                           // phase, balance, bet, last win, free rounds…
__GAME__.requestSpin(); __GAME__.requestBuy('buyfs')
__GAME__.network.forceRow('base', 12)        // next base round = book row 12
await __GAME__.network.rowsWhere('base', (credits, book) => book.includes('featureStart'))
__GAME__.network.failNext(503)               // next spin refused
__GAME__.network.simulateReconnect()         // drop + restore the connection
__GAME__.network.externalBalanceChange(500)  // a deposit → NotifyBalanceChanged
__GAME__.network.closeSession()              // NotifySessionClosed
__GAME__.network.replaceConnection()         // NotifyNewConnectionHasOpened
```

The Artube docs mention a local RGS sandbox as planned but not available yet. Until it exists, this
mock is the way to exercise the client end to end before you have a real session.

Once you have one (a launch URL from the Artube team), the dev server can play it without a deploy:
`ARTUBE_HOST=https://<launch URL host> npm run dev` proxies `/api-rgs` (HTTP and WebSocket) to that
environment, and `http://localhost:8080/?sessionId=…&gameId=…` connects to the real hub. Artube
Hub's Play on Localhost opens exactly that URL.

## Open questions in the public docs

The docs name these fields but not their exact shape. The core accepts every reasonable variant,
but they should be confirmed with the Artube team before launch:

1. **How errors arrive.** A rejected `invoke` (`HubException` with the `errorId` in the message or
   an inner object) or a resolved `{ errorId, message }` object? Both are handled.
2. **The restored `round` in `SessionResponse`.** Its fields (`roundId`, `gameMode`, `bet`,
   `totalWin`, `spinResult`?) are not listed. The core reads them tolerantly, keeps the raw object,
   and only offers a replay when it finds a payload.
3. **`freeRoundCampaign` / `FrcResponse` fields.** The core reads `campaignId` (or `id`), `bet`,
   `roundsTotal`, `roundsLeft`, `totalWin`, `validFrom`, `validTo` and `isComplete`, in camelCase
   or snake_case. A campaign without `isComplete` counts as complete when no rounds are left.
4. **`platformMaxWin`.** The feature page names `platform_max_win`; the contract lists
   `platformMaxWin`. A number or an object (`{ isVisible, baseCurrencyValue, playerCurrencyValue }`)
   is accepted. **How a capped round is flagged** in `RoundResponse` is not specified: the core
   reads `isPlatformMaxWinReached` / `maxWinReached`, and otherwise infers the cap when
   `totalWin < bet × winMultiplier`.
5. **Which `gameMode` to send during free rounds.** The docs say to use "a campaign-allowed mode".
   The core sends the base mode.
6. **`securityHash`.** "Pass through unchanged", but not to which call. The core keeps it on the
   session and sends nothing extra.
7. **The gameServerId in the launch URL.** Whether operator launch URLs carry `game=` is not
   stated. The core takes it from the URL when present and from the build otherwise.
