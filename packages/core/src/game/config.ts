// The per-game configuration handed to `createArtubeGame`. Everything MONEY- or MODE-shaped comes
// from the RGS session (bets, currency, modes, RTP, prices); this is only what the platform
// cannot know — names, card copy, rules, feel.

import { formatAmount, type BlockSpec, type HudChromeSpec, type JurisdictionConfig, type MenuSpec, type UISpec } from '@open-slot-ui/core';
import type { SessionResponse } from '../rgs/protocol';
import { currencyFor } from '../currency';

/**
 * What a game's rules (and `fromSession`) are handed, so the numbers a TRC reviewer checks come
 * out right without each game re-deriving them from the session.
 */
export interface RulesKit {
  /** The session's default bet (the bet the player starts on). */
  readonly bet: number;
  /** `x` times the default bet, in the session's currency — "€16.00": worked examples. */
  money(x: number): string;
  /**
   * What ONE round of a mode costs, as a multiple of the bet — "2×". A buy's price, and for a
   * boost (lucky bet, ante) the FULL price per round, not the surcharge: the rules template's
   * `{{cost.<id>}}` is the surcharge (open-slot-ui's definition), which reads wrong as a price.
   */
  price(modeId: string): string;
}

const timesText = (x: number): string => `${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}×`;

/** The kit for a session. */
export function rulesKit(session: SessionResponse): RulesKit {
  const ss = session.sessionSettings;
  const bet = ss.allowedBets[ss.defaultBetIndex] ?? ss.allowedBets[0] ?? 1;
  const currency = currencyFor(ss.currency, ss.currencyMinimalUnit);
  return {
    bet,
    money: (x) => formatAmount(x * bet, currency),
    price: (id) => timesText(session.gameSettings.gameModes.find((m) => m.id === id)?.priceMultiplier ?? 1),
  };
}

/** Copy + art for one mode's buy/boost card (keyed by the manifest mode name). */
export interface ModeCopy {
  /** Card title. Default: the mode id, capitalized. */
  name?: string;
  /** The line under the title. */
  description?: string;
  /** Card art (URL or data URI). */
  image?: string;
  /** "Volatility: High" line (default: the manifest's volatility). */
  volatility?: string;
  /** Confirm-step body; `{{price}}` interpolates. */
  confirm?: string;
}

export interface GameConfig {
  title: string;
  version?: string;
  /**
   * A fallback for the hub's `game` parameter. A real Artube launch carries it in the URL as
   * `?gameId=` (the publicGameId; `<publicGameId>-stage` on Stage), which always wins; this is
   * for hand-made local URLs without one.
   */
  gameServerId?: string;
  /** Card copy per mode id (buy features and lucky bets come from the session's gameModes). */
  modes?: Record<string, ModeCopy>;
  /**
   * The order of the buy sheet's cards. `'session'` (the default) keeps the order of the session's
   * gameModes. `'price'` lists them by what one round costs the player, cheapest first: the mode's
   * `priceMultiplier`, which for a lucky bet is its full price per round (the price its card shows),
   * not the surcharge in the card's `cost`. Equal prices keep the session's order.
   */
  buyOrder?: 'session' | 'price';
  /**
   * The INFO window: an open-slot-ui MenuSpec (paytable → rules), plain blocks, or a function of
   * the session — so the rules can be built from the modes, prices and RTPs the platform sent
   * (see `buildSlotRules` in `@artubeplate/core/rules`).
   */
  rules?: MenuSpec | BlockSpec[] | ((session: SessionResponse, kit: RulesKit) => MenuSpec | BlockSpec[]);
  /** Maximum win as × base bet — shown in the MAX WIN overlay and the rules. */
  maxWinX?: number;
  /** Free-spins facts for the rules audit (`false` = the game has none). */
  freeSpins?: { count?: number; retrigger?: boolean } | false;
  /**
   * The in-feature counter next to TOTAL WIN (`hud.setFreeSpins(n)` drives it). By default it is
   * "FREE SPINS" with a number; a Hold & Win sets `{ label: 'Respins', lives: 3 }` for its lives:
   * the caption changes and `lives` pips (lit up to n) replace the number.
   */
  featureCounter?: { label?: string; lives?: number };
  /** i18n messages per locale for the HUD + the core's own notices. */
  messages?: Record<string, Record<string, string>>;
  /** Delay multipliers per speed level (off / turbo / super). Default `[1, 0.4, 0.12]`. */
  turboSpeeds?: number[];
  /** Pause between autoplay spins (ms, turbo-scaled). Default 250. */
  autoplayGapMs?: number;
  /** Autoplay responsible-gambling stops offered in the panel (× bet). */
  autoplay?: { lossLimits?: number[]; winLimits?: number[]; requireLimits?: boolean; stopOnAnyWin?: boolean };
  /** A round never settles faster than this (ms) — a compliance floor some markets set. */
  minRoundMs?: number;
  /**
   * Let the player skip inside a bonus (Space, the round button's STOP, a tap on the game).
   * Default false: a bonus has no round button and plays out at its own pace.
   */
  bonusSkip?: boolean;
  /** Compliance switches applied at boot (e.g. `{ displayRTP: true }`). */
  jurisdiction?: JurisdictionConfig;
  /** HUD chrome overrides (features, speeds, menu rows, readouts, dock). */
  hud?: HudChromeSpec;
  /** Any other open-slot-ui UISpec fields, merged last (escape hatch). */
  spec?: Partial<UISpec>;
  /**
   * Derive config from the SESSION once it arrives — e.g. title, max win, card copy and rules
   * from the math's `settings.config` (`session.gameSettings.config`). Merged over this config.
   */
  fromSession?: (session: SessionResponse, kit: RulesKit) => Partial<Omit<GameConfig, 'fromSession'>>;
}

/** The effective config for a session: `config` with `fromSession(session)` merged over it. */
export function resolveGameConfig(config: GameConfig, session: SessionResponse): GameConfig {
  const extra = config.fromSession?.(session, rulesKit(session));
  if (!extra) return config;
  const defined = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  return { ...config, ...defined, modes: { ...config.modes, ...extra.modes } };
}
