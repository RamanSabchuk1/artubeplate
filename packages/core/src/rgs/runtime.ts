/**
 * Launch parameters. The OPERATOR creates the session and opens the game with it in the URL;
 * the game never creates one. What the runtime needs:
 *
 *   sessionId   — `?sessionId=<uuid>` (also `sessionID` / `session_id`), from the operator
 *   game        — the hub's `game`: the launch URL's `?gameId=` (Artube's name for it; `?game=` /
 *                 `?gameServerId=` work too). It is the publicGameId on DEV and production and
 *                 `<publicGameId>-stage` on Stage, so it is read from the URL, never hardcoded;
 *                 the value the game was built with (`VITE_GAME_SERVER_ID`) is only a fallback
 *   lang        — `?lng=` (Artube's name for it; also `lang` / `language` / `locale`), falling
 *                 back to `en`
 *
 * The frontend and the RGS share one origin: the hub is `/api/rgs/slot` RELATIVE to the page
 * (the ingress rewrites `/api/rgs/` to `/api/` and forwards to `/api/slot`).
 *
 * No `sessionId` (a bare `pnpm dev`) or `?mock=true` → the in-process MOCK RGS, which plays the
 * game's own math folder — but only where the mock can work (see {@link MOCK_ALLOWED}): a build
 * for Artube has no math in it, so there a launch without a session is an error, never a mock.
 * Mock-only knobs ride on the URL too (see {@link MockLaunch}).
 */

export const DEFAULT_RGS_PATH = '/api/rgs/slot';

declare const __ARTUBEPLATE_MOCK__: boolean | undefined;

/**
 * Whether this build may play on the local mock RGS. The artubeplate Vite plugin defines it: true
 * in `vite dev` and in a demo build (`demoBuild`, the math ships with it), false in the build you
 * hand to Artube. Without the plugin (tests, another bundler) the mock stays available.
 */
export const MOCK_ALLOWED: boolean = typeof __ARTUBEPLATE_MOCK__ === 'boolean' ? __ARTUBEPLATE_MOCK__ : true;

/** Mock RGS knobs, read from the URL so any scenario is one link away. */
export interface MockLaunch {
  /** `?balance=250` — starting balance. */
  balance?: number;
  /** `?currency=USD` — `?currency=demo` (or `null`) makes a demo session. */
  currency?: string | null;
  /** `?frc=10` — offer a free-rounds campaign with 10 rounds. `?frcBet=1`. */
  frcRounds?: number;
  frcBet?: number;
  /** `?maxWin=500` — a platform max-win cap in the session currency. */
  maxWin?: number;
  /** `?seed=42` — deterministic draws. */
  seed?: number;
  /** `?latency=400` — simulated round-trip in ms. */
  latency?: number;
  /** `?mockError=503` — the next spin fails with this errorId (comma list for a sequence). */
  errors?: number[];
  /** `?force=buyfs:12` — the next round of mode `buyfs` lands on book row 12 (comma list). */
  force?: Array<{ mode: string; row: number }>;
  /** `?gamification=1` — hand out a dummy gamificationToken. */
  gamification?: boolean;
  /**
   * `?mockBoot=session-over|offline|flaky` — script the first connection: the hub refuses the
   * session (its 501), the server is never reached, or it connects on the third attempt.
   */
  boot?: MockBoot;
}

/** How the mock's first connection goes (see {@link MockLaunch.boot}). */
export type MockBoot = 'session-over' | 'offline' | 'flaky';

export interface RuntimeConfig {
  sessionId: string | null;
  /** The hub's `game` query parameter (the launch URL's `gameId`). */
  game: string | null;
  language: string;
  /** Use the in-process mock RGS. */
  mock: boolean;
  /** Hub URL (relative to the page by default). `?rgs=` overrides for local testing. */
  rgsUrl: string;
  /** `?channel=desktop|mobile` — the operator's statement about the DEVICE. */
  channel?: 'desktop' | 'mobile';
  /** `?lobbyUrl=` — where HOME goes (adds the lobby row to the menu). */
  lobbyUrl?: string;
  /** `?gamificationEnv=demo|prod|rc|stable` — the gamification widget's environment, when the host does not tell. */
  gamificationEnv?: string;
  mockLaunch: MockLaunch;
}

type ParamSource = (name: string) => string | undefined;

export function urlParam(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

const first = (param: ParamSource, ...names: string[]): string | undefined => {
  for (const n of names) {
    const v = param(n);
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
};
const numberOr = (v: string | undefined): number | undefined => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function readRuntime(opts: { param?: ParamSource; overrides?: Partial<RuntimeConfig>; gameServerId?: string; allowMock?: boolean } = {}): RuntimeConfig {
  const param = opts.param ?? urlParam;
  const allowMock = opts.allowMock ?? MOCK_ALLOWED;
  const sessionId = first(param, 'sessionId', 'sessionID', 'session_id', 'session') ?? null;
  const rawLang = first(param, 'lng', 'lang', 'language', 'locale');
  const language = (rawLang ?? 'en').toLowerCase().split(/[-_]/)[0] || 'en';
  const channel = param('channel');
  const cur = param('currency');
  const force = (param('force') ?? '')
    .split(',')
    .map((s) => s.split(':'))
    .filter((p) => p.length === 2 && Number.isFinite(Number(p[1])))
    .map(([mode, row]) => ({ mode: mode!, row: Number(row) }));
  const errors = (param('mockError') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const base: RuntimeConfig = {
    sessionId,
    game: first(param, 'gameId', 'game', 'gameServerId') ?? opts.gameServerId ?? null,
    language,
    mock: allowMock && (param('mock') === 'true' || param('mock') === '1' || !sessionId),
    rgsUrl: first(param, 'rgs', 'rgsUrl') ?? DEFAULT_RGS_PATH,
    ...(channel === 'desktop' || channel === 'mobile' ? { channel } : {}),
    ...(first(param, 'lobbyUrl', 'lobby_url', 'lobby') ? { lobbyUrl: first(param, 'lobbyUrl', 'lobby_url', 'lobby')! } : {}),
    ...(param('gamificationEnv') ? { gamificationEnv: param('gamificationEnv')!.toLowerCase() } : {}),
    mockLaunch: {
      ...(numberOr(param('balance')) !== undefined ? { balance: numberOr(param('balance'))! } : {}),
      ...(cur !== undefined ? { currency: cur === 'demo' || cur === 'null' ? null : cur.toUpperCase() } : {}),
      ...(numberOr(param('frc')) ? { frcRounds: numberOr(param('frc'))! } : {}),
      ...(numberOr(param('frcBet')) ? { frcBet: numberOr(param('frcBet'))! } : {}),
      ...(numberOr(param('maxWin')) ? { maxWin: numberOr(param('maxWin'))! } : {}),
      ...(numberOr(param('seed')) !== undefined ? { seed: numberOr(param('seed'))! } : {}),
      ...(numberOr(param('latency')) !== undefined ? { latency: numberOr(param('latency'))! } : {}),
      ...(errors.length ? { errors } : {}),
      ...(force.length ? { force } : {}),
      ...(param('gamification') === '1' || param('gamification') === 'true' ? { gamification: true } : {}),
      ...(['session-over', 'offline', 'flaky'].includes(param('mockBoot') ?? '') ? { boot: param('mockBoot') as MockBoot } : {}),
    },
  };
  return { ...base, ...opts.overrides, mockLaunch: { ...base.mockLaunch, ...opts.overrides?.mockLaunch } };
}

/** Launched by the operator for real (a session in the URL and the mock not forced). */
export function isArtubeLaunch(runtime: RuntimeConfig = readRuntime()): boolean {
  return !!runtime.sessionId && !runtime.mock;
}

/** The hub URL with both mandatory query parameters. */
export function hubUrl(runtime: Pick<RuntimeConfig, 'rgsUrl' | 'sessionId' | 'game'>): string {
  if (!runtime.sessionId) throw new Error('No sessionId in the launch URL — the operator creates the session and opens the game with it.');
  if (!runtime.game)
    throw new Error('No game id — an Artube launch URL carries it as `?gameId=` (the publicGameId; `<publicGameId>-stage` on Stage). For a hand-made URL add `&gameId=…`, or build with a fallback `gameServerId` (VITE_GAME_SERVER_ID).');
  const sep = runtime.rgsUrl.includes('?') ? '&' : '?';
  return `${runtime.rgsUrl}${sep}sessionId=${encodeURIComponent(runtime.sessionId)}&game=${encodeURIComponent(runtime.game)}`;
}
