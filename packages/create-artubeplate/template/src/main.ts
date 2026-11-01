// Bootstrap. `createArtubeGame` runs the whole Artube boot — the mandatory Artube loader, the RGS
// connection (the real SignalR hub when the operator launched the game with a session, else the
// local mock playing THIS folder's math/), the session, the open-slot-ui HUD, free rounds,
// reconnects, errors, max win, autoplay, audio — and the round loop. This game supplies the
// config, a pure interpretBook, the pixi scene and its Present phases.

// The UI font, bundled with the game (no font CDN at runtime): the weights the type roles use.
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import { createArtubeGame, currencyFor } from '@artubeplate/core';
import { loadAssets } from '@artubeplate/core/assets';
// The manifest of raw-assets/, built by the asset pipeline (the artubeplate Vite plugin).
import assets from 'artubeplate:assets';
import { ensureFonts } from '@artubeplate/core/ui';
import { formatAmount } from '@open-slot-ui/core';
import { Scene } from './scene/Scene';
import { Overlay } from './ui/overlay';
import { makePresentPhases, type PresentDeps } from './phases/present';
import { interpretBook, type SpinModel } from './game/model';
import { slotFromSession } from './game/slot';
import { introFor } from './game/intro';
import { bonusName, bonusRules } from '@artubeplate/core/rules';
import { GAME_CONFIG, AUDIO } from './config';

const deps: PresentDeps = {};

let rows = 3;

const game = createArtubeGame<SpinModel, Scene, unknown>({
  config: GAME_CONFIG,
  audio: AUDIO,
  // Pure: payload → model. `rows` is known once the session (and so the math's config) arrived.
  interpretBook: (payload, info) => interpretBook(payload, info, rows),
  phases: makePresentPhases(deps),
  loader: { manual: true },
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
  mountView: async (host, ctx) => {
    // Text is rasterized once: wait for the font first, or it renders (and measures) in a fallback.
    // The art loads meanwhile, through the loader's progress bar.
    await Promise.all([
      ensureFonts(['600 1em Montserrat', '800 1em Montserrat', '900 1em Montserrat']),
      loadAssets(assets, { onProgress: (p) => ctx.loader.setProgress?.(0.6 + 0.35 * p) }),
    ]);
    const slot = slotFromSession(ctx.gameConfig);
    rows = slot.board.rows;
    deps.wildId = slot.symbols.find((s) => s.kind === 'wild')?.id ?? slot.wild?.symbol;
    deps.stickyWilds = !!slot.freeSpins?.sticky;
    deps.bonus = { name: bonusName(slot), rules: bonusRules(slot, ctx.config.title) };
    // The intro (if any) is the first scene; the core waits on `scene.whenPlayable()` for it.
    const scene = new Scene(host, slot, ctx.turbo, { title: ctx.config.title, intro: introFor(slot, ctx), audio: ctx.audio });
    // Dev handle: the logo, the board and the play area, for layout checks in the browser.
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __SCENE__: scene });
    await scene.whenReady();
    const ss = ctx.session.sessionSettings;
    const currency = currencyFor(ss.currency, ss.currencyMinimalUnit);
    deps.overlay = new Overlay(scene.fx, (n) => formatAmount(n, currency), scene.playArea, {
      // Each tier of a big win (BIG, MEGA, EPIC) lands with its stinger.
      onTier: () => ctx.audio?.play('big-win', { bus: 'wins' }),
      // Where the HUD's controls move the board (a phone held sideways), the win box and the banner follow it.
      pins: () => scene.pins(),
    });
    scene.onSpin(() => void deps.overlay?.hideWin());
    scene.onSlam(() => deps.overlay?.announcer.skip());
    scene.startAfter(ctx.loader.done()); // reveal the game; the intro starts once the loader is gone
    return scene;
  },
});

// Dev/QA handle: `__GAME__.inspect()`, `__GAME__.requestSpin()`, `__GAME__.requestBuy('buyfs')`,
// and on the mock `__GAME__.network.forceRow('base', 12)` / `.failNext(503)` / `.simulateReconnect()`.
// Only on the dev server (`import.meta.env.DEV`): the build Artube serves carries no debug handle.
if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __GAME__: game });
void game.start().catch((err) => console.error('[{{name}}] boot failed', err));
