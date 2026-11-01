// Static game configuration. Almost everything the player sees comes from the SESSION (bets,
// currency, modes, prices, RTP — the platform's) and from the math's `settings.config` (board,
// symbols, paytable, card copy, rules text — yours, delivered with the math). This file only says
// how to read them, plus the few knobs the platform cannot know.

import type { AudioSpec, GameConfig } from '@artubeplate/core';
import { buildSlotRules, symbolTile } from '@artubeplate/core/rules';
import { slotFromSession } from './game/slot';
// The manifest of raw-assets/ (the asset pipeline): textures for Pixi, sounds for zvuk.
import assets from 'artubeplate:assets';
import { soundsFromManifest } from '@artubeplate/core/assets';

// A simple gradient card for a mode (buy feature / lucky bet) — replace with real art.
const cardArt = (glyph: string, from: string, to: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="132" font-family="system-ui,sans-serif" font-size="84" font-weight="900" text-anchor="middle" fill="#fff" stroke="rgba(0,0,0,0.5)" stroke-width="8" paint-order="stroke">${glyph}</text></svg>`,
  )}`;

export const GAME_CONFIG: GameConfig = {
  title: '{{name}}',
  version: '0.1.0',
  // A fallback for the hub's `game` query parameter. Artube's launch URL carries it as `?gameId=`
  // (your publicGameId; `<publicGameId>-stage` on Stage), which always wins; VITE_GAME_SERVER_ID
  // in `.env` only covers hand-made local URLs without one.
  ...(import.meta.env.VITE_GAME_SERVER_ID ? { gameServerId: import.meta.env.VITE_GAME_SERVER_ID } : {}),
  autoplay: { lossLimits: [5, 20, 50, 100], winLimits: [10, 50, 100] },
  // Everything else is read from the math once the session arrives.
  fromSession: (session, kit) => {
    const slot = slotFromSession(session.gameSettings.config);
    const title = slot.title && !slot.title.includes('{{') ? slot.title : '{{name}}';
    const modes: GameConfig['modes'] = {};
    for (const m of session.gameSettings.gameModes) {
      const copy = slot.modes?.[m.id];
      const scatter = slot.symbols.find((s) => s.kind === 'scatter');
      modes[m.id] = {
        ...(copy?.name ? { name: copy.name } : {}),
        ...(copy?.description ? { description: copy.description } : {}),
        image: copy?.image ?? (m.type === 'BuyFeature' ? (scatter ? symbolTile(scatter, 320) : cardArt('★', '#3a404c', '#15181e')) : cardArt('+', '#2ea043', '#14532d')),
      };
    }
    return {
      title,
      modes,
      ...(slot.maxWin ? { maxWinX: slot.maxWin } : {}),
      ...(slot.scatter?.freeSpins ? { freeSpins: { count: Math.min(...Object.values(slot.scatter.freeSpins)), retrigger: !!slot.freeSpins?.retrigger } } : { freeSpins: false as const }),
      rules: buildSlotRules({ slot, modes: session.gameSettings.gameModes, title, names: Object.fromEntries(Object.entries(modes).flatMap(([id, c]) => (c?.name ? [[id, c.name]] : []))), money: kit.money }),
    };
  },
};

// Audio. Every file in raw-assets/audio{m}/ is a sound (the asset pipeline encodes it to webm +
// mp3): the folder is its bus (reels, symbols, wins, ui, music…), `reel-stop.1/.2/.3` are variants
// (a different take on every play), `music/base` and `music/bonus` are the two tracks. The core
// mixes them through zvuk: a compressor on every bus, a limiter on the master, the music ducking
// under the wins bus, the HUD's SOUND / MUSIC rows and mute (saved), sound paused while the tab
// is hidden, and the base track started on the first tap. The scene plays `spin-loop`,
// `reel-stop` and `scatter` as the reels move; the Present phases play `winline`, `big-win`,
// `fs-start`, `retrigger` and `fs-end`, and crossfade `base` ↔ `bonus`.
export const AUDIO: AudioSpec = {
  sounds: soundsFromManifest(assets),
  // `button` covers every HUD button, the bet ▲ / ▼ included (keyboard too), so there is no `bet`
  // entry: it would click twice on each bet change.
  inputSounds: { spin: 'spin', autoplay: 'click', toggle: 'click', button: 'click', skip: 'skip' },
  bgm: 'base',
};
