// Session + game config → the open-slot-ui UISpec and the buy-sheet cards. Everything money- or
// mode-shaped comes from the SESSION (the platform owns bets, currency, modes, prices, RTP); the
// game config only adds names, copy, rules and feel.

import type { BuyFeature } from '@open-slot-ui/dom';
import { LABEL_KEYS, resolveHudChrome, type BlockSpec, type GameFacts, type GameModeFact, type HudChromeSpec, type MenuItemSpec, type MenuSpec, type UISpec } from '@open-slot-ui/core';
import type { GameModeInfo, SessionResponse } from '../rgs/protocol';
import { rulesKit, type GameConfig } from './config';
import { currencyFor } from '../currency';

/**
 * The bar's own English copy — BONUS BUY, BUY BONUS, PRESS PLAY TO SPIN!, BALANCE… — from
 * open-slot-ui's label table. Seeded under the game's messages so a host dictionary (which the
 * core always passes) still reads like the classic bar instead of falling to sentence case.
 */
const HUD_COPY: Record<string, string> = Object.fromEntries(
  Object.entries(LABEL_KEYS as Record<string, { en?: string }>).flatMap(([key, entry]) => (entry.en ? [[key, entry.en]] : [])),
);

/** The game's messages over the HUD copy; the session language falls back to English, key by key. */
export function messagesFor(language: string, messages: Record<string, Record<string, string>> = {}): Record<string, Record<string, string>> {
  const en = { ...HUD_COPY, ...messages.en };
  return { ...messages, en, [language]: { ...en, ...messages[language] } };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]+/g, ' ');

/** The base mode: `base` if the maths has one, else the first `None` mode, else the first mode. */
export function baseModeOf(modes: GameModeInfo[]): GameModeInfo | undefined {
  return modes.find((m) => m.id === 'base' && m.type === 'None') ?? modes.find((m) => m.type === 'None') ?? modes[0];
}

/**
 * The cards the buy sheet offers: every `BuyFeature` mode is a one-shot BUY (price =
 * priceMultiplier × bet), every `LuckyBet` mode an activatable BOOST (its `cost` is the surcharge
 * over a base spin; the HUD adds the bet back and shows the full price per round, which is what
 * the mode is charged). They come in the session's order, or cheapest first with
 * `config.buyOrder: 'price'`.
 */
export function buyCardsFor(session: SessionResponse, config: GameConfig): BuyFeature[] {
  const modes = session.gameSettings.gameModes.filter((m) => m.type !== 'None');
  // By what one round costs, the boosts at their full price. The sort is stable, so equal prices
  // keep the platform's order, and it sorts the filtered copy: the session's list stays as sent.
  if (config.buyOrder === 'price') modes.sort((a, b) => a.priceMultiplier - b.priceMultiplier);
  const out: BuyFeature[] = [];
  for (const m of modes) {
    const copy = config.modes?.[m.id] ?? {};
    const variant = m.type === 'BuyFeature' ? 'buy' : 'boost';
    const cost = variant === 'buy' ? m.priceMultiplier : Math.max(0, m.priceMultiplier - 1);
    const vol = copy.volatility ?? (m.volatility ? `Volatility: ${m.volatility}` : undefined);
    const name = copy.name ?? cap(m.id);
    out.push({
      id: m.id,
      name,
      variant,
      cost: Number(cost.toFixed(6)),
      ...(copy.image ? { image: copy.image } : {}),
      ...(copy.description ? { description: copy.description } : {}),
      ...(vol ? { volatility: vol } : {}),
      // The confirm step says what happens, with the price in it (`{{price}}` interpolates).
      confirm:
        copy.confirm ??
        (variant === 'buy' ? `Buying ${name} costs {{price}} and starts the round immediately.` : `${name} makes every round cost {{price}} until you switch it off.`),
    });
  }
  return out;
}

/** Declared facts for the rules audit + the auto RTP/max-win grid — one row per mode. */
export function factsFor(session: SessionResponse, config: GameConfig): GameFacts {
  const modes: GameModeFact[] = session.gameSettings.gameModes.map((m) => ({
    id: m.id,
    name: config.modes?.[m.id]?.name ?? cap(m.id),
    kind: m.type === 'BuyFeature' ? 'buy' : m.type === 'LuckyBet' ? 'boost' : 'base',
    cost: m.type === 'LuckyBet' ? Math.max(0, m.priceMultiplier - 1) : m.priceMultiplier,
    rtp: m.rtp,
    ...(config.maxWinX ? { maxWinX: config.maxWinX } : {}),
  }));
  const base = baseModeOf(session.gameSettings.gameModes);
  return {
    modes,
    ...(config.freeSpins !== undefined ? { freeSpins: config.freeSpins } : {}),
    ...(base?.volatility ? { volatility: base.volatility } : {}),
    ...(config.maxWinX ? { maxWinCapX: config.maxWinX } : {}),
  };
}

/** The SPACEBAR TO SPIN row of the ☰ menu. The HUD owns it (open-slot-ui ≥ 0.17): `ui.spacebar`
 *  holds the state, the keyboard handler obeys it, and the row is dropped on a touch device. The
 *  core only adds the row and gives it the skin's keycap glyph (`-off`, and `-on` when it is on). */
export const SPACEBAR_ROW: MenuItemSpec = { id: 'spacebar', kind: 'spacebar', icon: 'icon-spacebar-off' };

/**
 * The menu the HUD would build by itself, with SPACEBAR TO SPIN added before INFO. A game
 * that writes its own `hud.menu` keeps it as written; a jurisdiction that bans the spacebar, or a
 * HUD without the ☰ menu, gets no row.
 */
export function withSpacebarRow(hud: HudChromeSpec, config: GameConfig): HudChromeSpec {
  if (hud.menu || config.jurisdiction?.disabledSpacebar || hud.features?.menu === false) return hud;
  const rows: MenuItemSpec[] = resolveHudChrome(hud).menu.map((r) => ({
    id: r.id,
    kind: r.kind,
    ...(r.speed ? { speed: r.speed } : {}),
    label: r.label,
    icon: r.icon,
    ...(r.href ? { href: r.href, target: r.target } : {}),
  }));
  const at = rows.findIndex((r) => r.kind === 'info');
  rows.splice(at < 0 ? rows.length : at, 0, SPACEBAR_ROW);
  return { ...hud, menu: rows };
}

export interface SpecInput {
  session: SessionResponse;
  config: GameConfig;
  language: string;
  lobbyUrl?: string;
  cards: BuyFeature[];
}

/** The game's messages with the feature counter's caption ("RESPINS") when the config sets one. */
function counterMessages(config: GameConfig): Record<string, Record<string, string>> {
  const label = config.featureCounter?.label;
  const en = { ...config.messages?.en, ...(label ? { free_spins_label_uc: label.toUpperCase() } : {}) };
  return { ...config.messages, en };
}

export function buildSpec({ session, config, language, lobbyUrl, cards }: SpecInput): UISpec {
  const ss = session.sessionSettings;
  const base = baseModeOf(session.gameSettings.gameModes);
  const levels = ss.allowedBets.length ? ss.allowedBets : [1];
  const index = Math.max(0, Math.min(levels.length - 1, ss.defaultBetIndex));
  const rules = typeof config.rules === 'function' ? config.rules(session, rulesKit(session)) : config.rules;
  const menu: MenuSpec | undefined = Array.isArray(rules) ? { rules: rules as BlockSpec[] } : (rules as MenuSpec | undefined);


  const autoplayCounts = ss.availableAutoSpinCounts?.filter((n) => n > 0) ?? [];
  return {
    currency: currencyFor(ss.currency, ss.currencyMinimalUnit),
    betLadder: { levels, index },
    autoplay: {
      options: autoplayCounts.length ? autoplayCounts : [10, 25, 50, 100],
      lossLimits: config.autoplay?.lossLimits ?? [5, 20, 50],
      winLimits: config.autoplay?.winLimits ?? [10, 20, 75],
      ...(config.autoplay?.requireLimits ? { requireLimits: true } : {}),
      ...(config.autoplay?.stopOnAnyWin ? { stopOnAnyWin: true } : {}),
      // Artube's TRC checklist: "selecting the number of spins starts an autoplay sequence",
      // and in a round "spin may only fast-forward the current animation, and autoplay may
      // only stop the current autoplay session": the autoplay button counts the run down and
      // stops it, the round button (and the spacebar) only slam.
      startOnSelect: true,
      stopControl: 'autoplay-button',
    },
    ...(base ? { rtp: base.rtp } : {}),
    // The round button held down keeps spinning (the HUD fires holdSpinStarted/Stopped; the core runs the rounds).
    spin: { press: 'hold-to-spin' },
    game: { name: config.title, version: config.version ?? '1.0.0' },
    // The HUD's own defaults (the reference layout): the ☰ menu (sound, music, turbo, super turbo,
    // info, and HOME when the operator gave a lobby — the core navigates the TOP window on its
    // press) and the readouts (free rounds, balance, bet, total win, win).
    hud: withSpacebarRow(
      {
        // An operator's free rounds play by themselves, so TOTAL WIN | FREE ROUNDS take the round
        // button's place while they last (the HUD's own box). A game may say 'inline'.
        freeRounds: 'takeover',
        // Opening TURBO / SUPER TURBO in the menu shows their switches without turning them on
        // (QA: "navigating to the turbo settings activates those modes"), and a tap on the game
        // closes the menu or the autoplay panel.
        speedRow: 'expand',
        closeOnOutsideTap: true,
        ...config.hud,
        features: {
          buyFeature: cards.length > 0,
          lobby: !!lobbyUrl,
          // The operator's iframe owns fullscreen; the game does not draw its own toggle.
          fullscreen: false,
          // Artube keeps the round history on the platform: no in-game HISTORY row or window.
          history: false,
          maxWin: !!config.maxWinX,
          superTurbo: true,
          ...config.hud?.features,
        },
      },
      config,
    ),
    ...(menu ? { menu } : {}),
    facts: factsFor(session, config),
    locale: { locale: language, messages: messagesFor(language, counterMessages(config)) },
    // The core locks the round's controls itself (bet, buy) and keeps SPIN live for slam-stop.
    lockDuringSpin: false,
    ...(config.jurisdiction ? { jurisdiction: config.jurisdiction } : {}),
    ...config.spec,
    // The buy colours are open-slot-ui's own unless the game's theme sets featureBuy /
    // featureBuyText (the coin, and the accents while a lucky bet or a bought feature is on).
    ...(config.spec?.theme ? { theme: config.spec.theme } : {}),
  };
}
