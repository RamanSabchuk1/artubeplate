/**
 * The Artube RGS client contract — the wire shapes of the SignalR hub a game talks to.
 *
 *   wss://<host>/api/rgs/slot?sessionId=<uuid>&game=<the launch URL's gameId>
 *   methods:        session · spin { gameMode, betIndex } · balance · activateFreeRoundCampaign { campaignId }
 *   notifications:  NotifyBalanceChanged · NotifySessionClosed · NotifyNewConnectionHasOpened
 *
 * Money is MAJOR units of the session currency everywhere on this wire (a balance of 150.75 is
 * 150.75). The round's outcome is the studio's own book line, delivered untouched as
 * `spinResult.payload` — the platform never parses it.
 *
 * The docs name these fields but leave a few shapes open (the restored `round`, the campaign
 * block, `platformMaxWin`), so every response goes through a TOLERANT normalizer below: camelCase
 * or snake_case, a number or an object, a JSON string or nested JSON — one typed shape out.
 *
 * @see https://docs-review.artube-888.live/en/backend/rgs/signalr-contract/
 */

/** Hub method names (exactly as the runtime registers them). */
export const HUB_METHODS = Object.freeze({
  session: 'session',
  spin: 'spin',
  balance: 'balance',
  activateFreeRoundCampaign: 'activateFreeRoundCampaign',
});

/** Server → client notifications. Register handlers BEFORE `start()`. */
export const HUB_NOTIFICATIONS = Object.freeze({
  balanceChanged: 'NotifyBalanceChanged',
  sessionClosed: 'NotifySessionClosed',
  newConnection: 'NotifyNewConnectionHasOpened',
});

/** A mode as the client sees it (`gameSettings.gameModes[i]`). Look modes up by `id`. */
export interface GameModeInfo {
  /** The string sent in `spin` (case-sensitive; = the manifest `name`). */
  id: string;
  rtp: number;
  volatility?: string;
  /** How many base bets one round of this mode costs (`cost / betCredit`). */
  priceMultiplier: number;
  /** Manifest `Purchase` arrives as `BuyFeature`. */
  type: 'None' | 'LuckyBet' | 'BuyFeature';
}

/** The platform's round win cap, converted to the session currency (shape varies by path). */
export interface PlatformMaxWin {
  isVisible?: boolean;
  baseCurrencyValue?: number;
  playerCurrencyValue?: number;
}

export interface SessionSettings {
  /** Currency code; `null` means a DEMO session. */
  currency: string | null;
  /** Smallest unit, e.g. 0.01 — for formatting amounts. */
  currencyMinimalUnit?: number;
  /** The bets this session may stake; `spin.betIndex` is a POSITION in this list. */
  allowedBets: number[];
  defaultBetIndex: number;
  /** Auto-spin options for the UI (there is no server auto-spin — the client loops `spin`). */
  availableAutoSpinCounts?: number[];
  locales?: string[];
  platformMaxWin?: number | PlatformMaxWin | null;
}

export interface GameSettings {
  /** Credits per base bet, from the maths manifest. */
  betCredit: number;
  /** Whether the UI should offer an RTP choice (operator setting). */
  showRtpOptions?: boolean;
  /** An ARRAY — never index it by name. */
  gameModes: GameModeInfo[];
  /** `settings.config` from the manifest, verbatim — the game's own configuration. */
  config?: unknown;
}

/** An operator free-rounds campaign (normalized). */
export interface FreeRoundCampaign {
  campaignId: string;
  /** The campaign's fixed bet (major units). */
  bet: number;
  roundsTotal: number;
  roundsLeft: number;
  /** Win accumulated over the campaign so far. */
  totalWin: number;
  validFrom?: string;
  validTo?: string;
  isComplete: boolean;
}

/** A round the runtime still holds for this session (restored on `session`). ADVISORY. */
export interface RestoredRound<P = unknown> {
  roundId?: string;
  gameMode?: string;
  bet?: number;
  totalWin?: number;
  winMultiplier?: number;
  payload?: P;
  /** Everything the server sent, for games that know more about the shape. */
  raw: unknown;
}

export interface SessionResponse<P = unknown> {
  /** Opaque token — pass through unchanged. */
  securityHash?: string;
  balance: number;
  /** The round to restore, or `null` on a fresh session. */
  round: RestoredRound<P> | null;
  sessionSettings: SessionSettings;
  gameSettings: GameSettings;
  freeRoundCampaign: FreeRoundCampaign | null;
  gamificationToken: string | null;
}

export interface SpinRequest {
  /** A `gameModes[].id`, case-sensitive. */
  gameMode: string;
  /** Index into `allowedBets`; MUST be `null` during an active free-rounds campaign. */
  betIndex: number | null;
}

export interface SpinResult<P = unknown> {
  /** The win as a multiple of the base bet. */
  winMultiplier: number;
  /** The book line from the maths — nested JSON, never a string. */
  payload: P;
  /** A UI hint (not enforced by the server; empty = no restriction). */
  nextAvailableGameModes: string[];
}

export interface RoundResponse<P = unknown> {
  roundId: string;
  gameMode: string;
  /** The round's BASE bet (before the mode's price multiplier). */
  bet: number;
  /** Balance after the round — the win is already in it. */
  balance: number;
  /** The win credited this round (after the platform max-win cap). */
  totalWin: number;
  platformMaxWin?: number | PlatformMaxWin | null;
  spinResult: SpinResult<P>;
  freeRoundCampaign: FreeRoundCampaign | null;
  /** Set when the platform capped the win (explicit flag if the server sends one, else inferred). */
  maxWinReached: boolean;
}

export interface BalanceResponse {
  balance: number;
  currency?: string | null;
}

// ─── normalizers ─────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Read `camelCase` or `snake_case` (or `PascalCase`) — whichever the server used. */
function pick(o: Rec, camel: string): unknown {
  if (camel in o) return o[camel];
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  if (snake in o) return o[snake];
  const pascal = camel[0]!.toUpperCase() + camel.slice(1);
  if (pascal in o) return o[pascal];
  return undefined;
}
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

/** A payload may arrive as nested JSON (the contract) or, defensively, as a JSON string. */
export function parsePayload<P = unknown>(v: unknown): P {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as P;
    } catch {
      return v as P;
    }
  }
  return v as P;
}

export function normalizeCampaign(raw: unknown): FreeRoundCampaign | null {
  if (!isRec(raw)) return null;
  const id = str(pick(raw, 'campaignId')) ?? str(pick(raw, 'id'));
  if (!id) return null;
  const roundsTotal = num(pick(raw, 'roundsTotal'));
  const roundsLeft = num(pick(raw, 'roundsLeft'), roundsTotal);
  const complete = pick(raw, 'isComplete');
  return {
    campaignId: id,
    bet: num(pick(raw, 'bet')),
    roundsTotal,
    roundsLeft,
    totalWin: num(pick(raw, 'totalWin')),
    ...(str(pick(raw, 'validFrom')) ? { validFrom: str(pick(raw, 'validFrom'))! } : {}),
    ...(str(pick(raw, 'validTo')) ? { validTo: str(pick(raw, 'validTo'))! } : {}),
    isComplete: typeof complete === 'boolean' ? complete : roundsLeft <= 0,
  };
}

export function normalizeGameModes(raw: unknown): GameModeInfo[] {
  const list = Array.isArray(raw) ? raw : isRec(raw) ? Object.entries(raw).map(([id, v]) => ({ id, ...(isRec(v) ? v : {}) })) : [];
  return list.filter(isRec).map((m) => {
    const type = str(pick(m, 'type'));
    return {
      id: str(pick(m, 'id')) ?? str(pick(m, 'name')) ?? '',
      rtp: num(pick(m, 'rtp')),
      ...(str(pick(m, 'volatility')) ? { volatility: str(pick(m, 'volatility'))! } : {}),
      priceMultiplier: num(pick(m, 'priceMultiplier'), 1),
      type: type === 'LuckyBet' ? 'LuckyBet' : type === 'BuyFeature' || type === 'Purchase' ? 'BuyFeature' : 'None',
    };
  });
}

function normalizeMaxWin(v: unknown): number | PlatformMaxWin | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return num(v);
  if (isRec(v))
    return {
      ...(typeof pick(v, 'isVisible') === 'boolean' ? { isVisible: pick(v, 'isVisible') as boolean } : {}),
      ...(pick(v, 'baseCurrencyValue') !== undefined ? { baseCurrencyValue: num(pick(v, 'baseCurrencyValue')) } : {}),
      ...(pick(v, 'playerCurrencyValue') !== undefined ? { playerCurrencyValue: num(pick(v, 'playerCurrencyValue')) } : {}),
    };
  return undefined;
}

/** The cap in the PLAYER's currency, or undefined if none/unknown. */
export function maxWinAmount(v: number | PlatformMaxWin | null | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v > 0 ? v : undefined;
  const n = v.playerCurrencyValue ?? v.baseCurrencyValue;
  return n != null && n > 0 ? n : undefined;
}

export function normalizeRestoredRound<P>(raw: unknown): RestoredRound<P> | null {
  if (!isRec(raw)) return null;
  // Artube sends the round's steps as `spinResults`, never empty; the LAST one is the outcome (what
  // `spin` returned as `spinResult`). A spin-shaped `spinResult` or a flat `payload` still work.
  const steps = pick(raw, 'spinResults');
  const last = Array.isArray(steps) && steps.length ? (steps[steps.length - 1] as unknown) : undefined;
  const sr = isRec(last) ? last : pick(raw, 'spinResult');
  const payload = isRec(sr) ? pick(sr, 'payload') : pick(raw, 'payload');
  const wm = isRec(sr) ? pick(sr, 'winMultiplier') : pick(raw, 'winMultiplier');
  return {
    ...(str(pick(raw, 'roundId')) ? { roundId: str(pick(raw, 'roundId'))! } : {}),
    ...(str(pick(raw, 'gameMode')) ? { gameMode: str(pick(raw, 'gameMode'))! } : {}),
    ...(pick(raw, 'bet') !== undefined ? { bet: num(pick(raw, 'bet')) } : {}),
    ...(pick(raw, 'totalWin') !== undefined ? { totalWin: num(pick(raw, 'totalWin')) } : pick(raw, 'win') !== undefined ? { totalWin: num(pick(raw, 'win')) } : {}),
    ...(wm !== undefined ? { winMultiplier: num(wm) } : {}),
    ...(payload !== undefined ? { payload: parsePayload<P>(payload) } : {}),
    raw,
  };
}

export function normalizeSession<P = unknown>(raw: unknown): SessionResponse<P> {
  if (!isRec(raw)) throw new Error('session: the server returned no SessionResponse');
  const ss = (isRec(pick(raw, 'sessionSettings')) ? pick(raw, 'sessionSettings') : {}) as Rec;
  const gs = (isRec(pick(raw, 'gameSettings')) ? pick(raw, 'gameSettings') : {}) as Rec;
  const currency = pick(ss, 'currency');
  const bets = pick(ss, 'allowedBets');
  const mw = normalizeMaxWin(pick(ss, 'platformMaxWin'));
  const unit = pick(ss, 'currencyMinimalUnit');
  const token = pick(raw, 'gamificationToken');
  return {
    ...(str(pick(raw, 'securityHash')) ? { securityHash: str(pick(raw, 'securityHash'))! } : {}),
    balance: num(pick(raw, 'balance')),
    round: normalizeRestoredRound<P>(pick(raw, 'round')),
    sessionSettings: {
      currency: typeof currency === 'string' && currency.length ? currency : null,
      ...(unit !== undefined ? { currencyMinimalUnit: num(unit, 0.01) } : {}),
      allowedBets: Array.isArray(bets) ? bets.map((b) => num(b)).filter((b) => b > 0) : [],
      defaultBetIndex: num(pick(ss, 'defaultBetIndex')),
      ...(Array.isArray(pick(ss, 'availableAutoSpinCounts')) ? { availableAutoSpinCounts: (pick(ss, 'availableAutoSpinCounts') as unknown[]).map((n) => num(n)) } : {}),
      ...(Array.isArray(pick(ss, 'locales')) ? { locales: (pick(ss, 'locales') as unknown[]).map(String) } : {}),
      ...(mw !== undefined ? { platformMaxWin: mw } : {}),
    },
    gameSettings: {
      betCredit: num(pick(gs, 'betCredit'), 100),
      ...(typeof pick(gs, 'showRtpOptions') === 'boolean' ? { showRtpOptions: pick(gs, 'showRtpOptions') as boolean } : {}),
      gameModes: normalizeGameModes(pick(gs, 'gameModes')),
      ...(pick(gs, 'config') !== undefined ? { config: parsePayload(pick(gs, 'config')) } : {}),
    },
    freeRoundCampaign: normalizeCampaign(pick(raw, 'freeRoundCampaign')),
    gamificationToken: typeof token === 'string' && token.length ? token : null,
  };
}

export function normalizeRound<P = unknown>(raw: unknown): RoundResponse<P> {
  if (!isRec(raw)) throw new Error('spin: the server returned no RoundResponse');
  const sr = (isRec(pick(raw, 'spinResult')) ? pick(raw, 'spinResult') : {}) as Rec;
  const bet = num(pick(raw, 'bet'));
  const totalWin = num(pick(raw, 'totalWin'));
  const winMultiplier = num(pick(sr, 'winMultiplier'));
  const next = pick(sr, 'nextAvailableGameModes');
  const mw = normalizeMaxWin(pick(raw, 'platformMaxWin'));
  const flag = pick(raw, 'isPlatformMaxWinReached') ?? pick(raw, 'maxWinReached');
  // No documented flag: infer the cap from money — the credited win fell short of bet × multiplier.
  const inferred = bet > 0 && winMultiplier > 0 && totalWin + 1e-9 < bet * winMultiplier * (1 - 1e-6);
  return {
    roundId: str(pick(raw, 'roundId')) ?? '',
    gameMode: str(pick(raw, 'gameMode')) ?? '',
    bet,
    balance: num(pick(raw, 'balance')),
    totalWin,
    ...(mw !== undefined ? { platformMaxWin: mw } : {}),
    spinResult: {
      winMultiplier,
      payload: parsePayload<P>(pick(sr, 'payload')),
      nextAvailableGameModes: Array.isArray(next) ? next.map(String) : [],
    },
    freeRoundCampaign: normalizeCampaign(pick(raw, 'freeRoundCampaign')),
    maxWinReached: typeof flag === 'boolean' ? flag : inferred,
  };
}

/** The balance a payload carries, or `null` when it carries none a client could trust (a
 *  notification in a shape this client does not know must not zero the bar). */
export function balanceIn(raw: unknown): number | null {
  const v = typeof raw === 'number' || typeof raw === 'string' ? raw : isRec(raw) ? pick(raw, 'balance') : undefined;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function normalizeBalance(raw: unknown): BalanceResponse {
  if (typeof raw === 'number') return { balance: raw };
  if (!isRec(raw)) return { balance: 0 };
  const c = pick(raw, 'currency');
  return { balance: num(pick(raw, 'balance')), ...(c !== undefined ? { currency: typeof c === 'string' ? c : null } : {}) };
}
