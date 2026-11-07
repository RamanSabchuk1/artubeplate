// An in-process, AUTHORITATIVE fake of the Artube RGS that plays the game's REAL math folder.
//
// It does what the platform does, by the documented rules: builds `gameSettings` from the
// manifest (Purchase → BuyFeature, priceMultiplier = cost / betCredit), charges
// `allowedBets[betIndex] × priceMultiplier`, draws a weights row by weight, pays
// `bet × multiplier / betCredit`, applies a platform max-win cap, and returns the book line as
// `spinResult.payload` untouched. Free-rounds campaigns follow the RGS rules (activate once per
// connection, `betIndex: null`, no paid buys → 622, played out → 634), and the error codes are
// the real ones, so a game's error handling is exercised before it ever meets the platform.
//
// Scriptable for tests and QA: force the next row, inject an error, simulate a dropped
// connection, a balance change from outside, or the platform closing the session.

import { loadArtifact, drawRow, mulberry32, type LoadedArtifact, type LoadedMode } from '../math/artifact';
import {
  normalizeCampaign,
  parsePayload,
  type BalanceResponse,
  type FreeRoundCampaign,
  type GameModeInfo,
  type RestoredRound,
  type RoundResponse,
  type SessionResponse,
  type SpinRequest,
} from './protocol';
import { currencyFor } from '../currency';
import { RgsError, RGS_ERRORS, rgsErrorFrom } from './errors';
import {
  DEFAULT_ANSWER_TIMES,
  RgsEmitter,
  awaitAnswer,
  sleep,
  startWithRetries,
  type AnswerTimes,
  type RgsEventName,
  type RgsEvents,
  type RgsTransport,
} from './network';
import type { MockBoot } from './runtime';

/** The math next to the page, so a demo build plays from any folder of any host. */
function defaultMathUrl(): string {
  return typeof document !== 'undefined' ? new URL('__artubeplate/math/', document.baseURI).href : '/__artubeplate/math/';
}

export interface MockRgsOptions {
  /** The math: a URL of the artifact folder (default `__artubeplate/math/` next to the page:
   *  served by the artubeplate Vite plugin in dev, copied in by a demo build), an already-loaded
   *  artifact, or a loader. */
  math?: string | LoadedArtifact | (() => Promise<LoadedArtifact>);
  balance?: number;
  /** Currency code; `null` → a demo session. Default `EUR`. */
  currency?: string | null;
  currencyMinimalUnit?: number;
  allowedBets?: number[];
  defaultBetIndex?: number;
  availableAutoSpinCounts?: number[];
  locales?: string[];
  /** Platform max win in the session currency (`null`/0 = no cap). */
  platformMaxWin?: number | null;
  showRtpOptions?: boolean;
  /** Offer a free-rounds campaign. */
  frc?: { rounds: number; bet?: number; campaignId?: string; validTo?: string } | null;
  gamificationToken?: string | null;
  /** Deterministic draws. Default: `Math.random`. */
  seed?: number;
  /** Simulated round-trip (ms). Default 120. */
  latency?: number;
  /** Errors to fail the next spins with, in order (errorIds). */
  errors?: number[];
  /** Force upcoming draws: `{ mode, row }` — the next spin of `mode` lands on that book row. */
  force?: Array<{ mode: string; row: number }>;
  /**
   * Script the first connection, with the real client's retries and `connecting` events:
   * `session-over` — the hub refuses the session (its 501 close); `offline` — the server is
   * never reached; `flaky` — it connects on the third attempt.
   */
  boot?: MockBoot;
  /** How long the client waits on a late spin (`simulateNoAnswer`, `simulateSlowAnswer`). */
  answer?: Partial<AnswerTimes>;
}

/** How the hub turns a session away (DEV, a session opened again elsewhere or expired). */
const SESSION_REFUSED =
  'Server returned an error on close: Connection closed with an error. HubException: Operation failed with error code 501. Error message: The session is invalid or cannot be retrieved';

const DEFAULT_BETS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

/** How `simulateOutage` drops the connection. */
export interface OutageOptions {
  /** `'next-spin'` (default): when the next spin is sent; `'now'`: at once. */
  at?: 'now' | 'next-spin';
  /** For a spin caught in it: `'answer'` (default) — the round was played and only the
   *  answer was lost; `'request'` — the spin never reached the server. */
  lost?: 'answer' | 'request';
  /** When the automatic reconnect gives up (`closed`, still retrying). Default 7 500 ms,
   *  about as long as the real client's five attempts take. */
  giveUpAfter?: number;
}

/** What a spin whose answer the dropped connection took fails with (SignalR's own wording). */
const lostAnswer = (): RgsError => new RgsError(undefined, 'Invocation canceled due to the underlying connection being closed.', 'spin');

/** What a call made while the connection is down fails with (the real client's wording). */
const notConnected = (method: string): RgsError => new RgsError(undefined, 'not connected (Reconnecting)', method);

export class MockRgs implements RgsTransport {
  readonly kind = 'mock' as const;
  private readonly events = new RgsEmitter();
  private art: LoadedArtifact | null = null;
  private balanceValue: number;
  private readonly unit: number;
  private readonly rng: () => number;
  private campaign: FreeRoundCampaign | null;
  /** The activated flag is PER CONNECTION on the real RGS (lost on reconnect) — same here. */
  private campaignActivated = false;
  private lastRound: RoundResponse | null = null;
  private seq = 0;
  private closed = false;
  private busy = false;
  /** A simulated outage is on: every call fails as the real client's does when not connected. */
  private offline = false;
  /** An outage waiting for the next spin to start (`simulateOutage({ at: 'next-spin' })`). */
  private outageArmed: Required<OutageOptions> & { ms: number } | null = null;
  /** The next spin's answer is late or never comes (`simulateNoAnswer`, `simulateSlowAnswer`). */
  private answerArmed: { kind: 'none' | 'slow'; played: boolean; ms: number; times: AnswerTimes } | null = null;
  private readonly errorQueue: number[];
  private readonly forceQueue: Array<{ mode: string; row: number }>;

  constructor(private readonly opts: MockRgsOptions = {}) {
    this.balanceValue = opts.balance ?? 1000;
    // The currency's own decimals decide the default unit (JPY, IRR… have none).
    this.unit = opts.currencyMinimalUnit ?? 10 ** -currencyFor(opts.currency ?? null).decimals;
    this.rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
    this.errorQueue = [...(opts.errors ?? [])];
    this.forceQueue = [...(opts.force ?? [])];
    const bets = opts.allowedBets ?? DEFAULT_BETS;
    this.campaign = opts.frc
      ? {
          campaignId: opts.frc.campaignId ?? 'mock-campaign',
          bet: opts.frc.bet ?? bets[Math.min(bets.length - 1, opts.defaultBetIndex ?? 3)]!,
          roundsTotal: opts.frc.rounds,
          roundsLeft: opts.frc.rounds,
          totalWin: 0,
          validFrom: new Date(Date.now() - 3_600_000).toISOString(),
          validTo: opts.frc.validTo ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
          isComplete: false,
        }
      : null;
  }

  on<K extends RgsEventName>(type: K, fn: (payload: RgsEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  private money(x: number): number {
    const decimals = Math.max(0, Math.round(-Math.log10(this.unit)));
    return Number((Math.round(x / this.unit) * this.unit).toFixed(decimals));
  }

  private async artifact(): Promise<LoadedArtifact> {
    if (this.art) return this.art;
    const m = this.opts.math ?? defaultMathUrl();
    this.art = typeof m === 'string' ? await loadArtifact(m) : typeof m === 'function' ? await m() : m;
    return this.art;
  }

  private async net(method = 'call'): Promise<void> {
    if (this.offline) throw notConnected(method);
    await sleep(this.opts.latency ?? 120);
    if (this.offline) throw notConnected(method);
    if (this.closed) throw new RgsError(RGS_ERRORS.SESSION_UNUSABLE, 'the session is closed');
  }

  /** Whether a call can go out right now (false through a simulated outage). */
  get connected(): boolean {
    return !this.closed && !this.offline;
  }

  private get bets(): number[] {
    return this.opts.allowedBets ?? DEFAULT_BETS;
  }

  async connect(): Promise<void> {
    await this.artifact(); // surface a broken/missing math folder at boot, like a failed connect
    const boot = this.opts.boot;
    if (!boot) return;
    let tries = 0;
    await startWithRetries(
      async () => {
        tries++;
        await sleep(this.opts.latency ?? 120);
        if (boot === 'session-over') throw rgsErrorFrom(new Error(SESSION_REFUSED), 'connect');
        if (boot === 'offline' || (boot === 'flaky' && tries < 3)) throw new RgsError(undefined, 'WebSocket failed to connect.', 'connect');
      },
      { attempts: 5, emit: this.events, final: (e) => rgsErrorFrom(e, 'connect').sessionOver },
    );
  }

  async session<P = unknown>(): Promise<SessionResponse<P>> {
    const art = await this.artifact();
    await this.net('session');
    const gameModes: GameModeInfo[] = art.gameModes.map((g) => ({ ...g }));
    const round: RestoredRound<P> | null = this.lastRound
      ? {
          roundId: this.lastRound.roundId,
          gameMode: this.lastRound.gameMode,
          bet: this.lastRound.bet,
          totalWin: this.lastRound.totalWin,
          winMultiplier: this.lastRound.spinResult.winMultiplier,
          payload: this.lastRound.spinResult.payload as P,
          // As Artube sends it: the round's steps in `spinResults` (the last is the outcome).
          raw: (({ spinResult, ...rest }) => ({ ...rest, spinResults: [spinResult] }))(this.lastRound),
        }
      : null;
    return {
      securityHash: 'mock',
      balance: this.balanceValue,
      round: this.opts.currency === null ? null : round, // demo rounds are not persisted
      sessionSettings: {
        currency: this.opts.currency === undefined ? 'EUR' : this.opts.currency,
        currencyMinimalUnit: this.unit,
        allowedBets: this.bets.slice(),
        defaultBetIndex: Math.min(this.bets.length - 1, this.opts.defaultBetIndex ?? 3),
        availableAutoSpinCounts: this.opts.availableAutoSpinCounts ?? [10, 25, 50, 100],
        locales: this.opts.locales ?? ['en'],
        platformMaxWin: this.opts.platformMaxWin ?? null,
      },
      gameSettings: {
        betCredit: art.betCredit,
        showRtpOptions: this.opts.showRtpOptions ?? false,
        gameModes,
        ...(art.manifest.settings.config !== undefined ? { config: art.manifest.settings.config } : {}),
      },
      freeRoundCampaign: this.campaign && !this.campaign.isComplete ? { ...this.campaign } : null,
      gamificationToken: this.opts.gamificationToken ?? null,
    };
  }

  async balance(): Promise<BalanceResponse> {
    await this.net('balance');
    return { balance: this.balanceValue, currency: this.opts.currency === undefined ? 'EUR' : this.opts.currency };
  }

  async activateFreeRoundCampaign(campaignId: string): Promise<FreeRoundCampaign | null> {
    await this.net('activateFreeRoundCampaign');
    const c = this.campaign;
    if (!c || c.campaignId !== campaignId) throw new RgsError(RGS_ERRORS.FRC_NOT_FOUND, 'free rounds campaign not found', 'activateFreeRoundCampaign');
    if (c.isComplete || c.roundsLeft <= 0) throw new RgsError(RGS_ERRORS.FRC_PLAYED_OUT, 'free rounds campaign already played out', 'activateFreeRoundCampaign');
    if (c.validTo && Date.parse(c.validTo) < Date.now()) throw new RgsError(RGS_ERRORS.FRC_UNAVAILABLE, 'free rounds campaign expired', 'activateFreeRoundCampaign');
    if (this.campaignActivated) throw new RgsError(RGS_ERRORS.FRC_ALREADY_ACTIVE, 'free rounds campaign already activated', 'activateFreeRoundCampaign');
    this.campaignActivated = true;
    return normalizeCampaign(c);
  }

  async spin<P = unknown>(req: SpinRequest): Promise<RoundResponse<P>> {
    const art = await this.artifact();
    if (this.offline) throw notConnected('spin');
    if (this.busy) throw new RgsError(RGS_ERRORS.TECHNICAL, 'a spin is already in flight', 'spin');
    this.busy = true;
    // An outage armed for this spin: the connection drops while it is out.
    const outage = this.outageArmed;
    this.outageArmed = null;
    const late = this.answerArmed;
    this.answerArmed = null;
    try {
      // No answer, and nothing played: the request never got anywhere that answers.
      if (late && !late.played) await this.answerLate<never>(late);
      if (outage?.lost === 'request') {
        await sleep(this.opts.latency ?? 120);
        this.goDown(outage.ms, outage.giveUpAfter);
        throw lostAnswer();
      }
      await this.net('spin');
      const injected = this.errorQueue.shift();
      if (injected !== undefined) throw new RgsError(injected, `mock: injected error ${injected}`, 'spin');

      const mode = art.modes.get(req.gameMode);
      const info = art.gameModes.find((g) => g.id === req.gameMode);
      if (!mode || !info) throw new RgsError(RGS_ERRORS.UNKNOWN_MODE, `unknown or unavailable game mode "${req.gameMode}"`, 'spin');
      // A mode's books arrive the first time it plays (before any money moves).
      await mode.books.load();

      const c = this.campaign;
      const inCampaign = !!c && this.campaignActivated && !c.isComplete && c.roundsLeft > 0;
      let bet: number;
      let price: number;
      if (inCampaign) {
        if (req.betIndex !== null) throw new RgsError(RGS_ERRORS.INVALID_BET, 'betIndex must be null during a free rounds campaign', 'spin');
        if (info.type === 'BuyFeature') throw new RgsError(RGS_ERRORS.BUY_UNAVAILABLE, 'BuyFeature is not available during a free rounds campaign', 'spin');
        bet = c!.bet;
        price = 0;
      } else {
        if (req.betIndex === null) {
          if (c && this.campaignActivated && c.isComplete) throw new RgsError(RGS_ERRORS.FRC_PLAYED_OUT, 'free rounds campaign already played out', 'spin');
          throw new RgsError(RGS_ERRORS.INVALID_BET, 'betIndex is required for a paid spin', 'spin');
        }
        if (!Number.isInteger(req.betIndex) || req.betIndex < 0 || req.betIndex >= this.bets.length)
          throw new RgsError(RGS_ERRORS.INVALID_BET, `betIndex ${req.betIndex} is outside allowedBets`, 'spin');
        bet = this.bets[req.betIndex]!;
        price = this.money(bet * info.priceMultiplier);
        if (this.balanceValue + 1e-9 < price) throw new RgsError(RGS_ERRORS.INSUFFICIENT_FUNDS, 'not enough funds', 'spin');
      }

      const row = this.pickRow(mode);
      const multiplierX = mode.multipliers[row]! / art.betCredit; // × base bet
      const rawWin = this.money(bet * multiplierX);
      const cap = this.opts.platformMaxWin && this.opts.platformMaxWin > 0 ? this.opts.platformMaxWin : Infinity;
      const totalWin = Math.min(rawWin, cap);
      this.balanceValue = this.money(this.balanceValue - price + totalWin);

      let campaignState: FreeRoundCampaign | null = null;
      if (inCampaign && c) {
        c.roundsLeft -= 1;
        c.totalWin = this.money(c.totalWin + totalWin);
        c.isComplete = c.roundsLeft <= 0;
        campaignState = { ...c };
      }

      const round: RoundResponse<P> = {
        roundId: `mock-${Date.now().toString(36)}-${++this.seq}`,
        gameMode: req.gameMode,
        bet,
        balance: this.balanceValue,
        totalWin,
        platformMaxWin: this.opts.platformMaxWin ?? null,
        spinResult: { winMultiplier: multiplierX, payload: parsePayload<P>(mode.books.at(row)), nextAvailableGameModes: [] },
        freeRoundCampaign: campaignState,
        maxWinReached: totalWin < rawWin,
      };
      this.lastRound = round as RoundResponse;
      // Played and paid on the server, and the answer is late or never comes.
      if (late) return await this.answerLate(late, round);
      if (outage) {
        // Played and paid on the server; the answer never makes it back.
        this.goDown(outage.ms, outage.giveUpAfter);
        throw lostAnswer();
      }
      return round;
    } finally {
      this.busy = false;
    }
  }

  /** A spin's answer that is late (`slow`) or never comes, waited on as the real client waits. */
  private answerLate<T>(late: NonNullable<MockRgs['answerArmed']>, value?: T): Promise<T> {
    const answer = late.kind === 'slow' ? sleep(late.ms).then(() => value as T) : new Promise<T>(() => {});
    return awaitAnswer(answer, { method: 'spin', emit: this.events, times: late.times, slow: true, onTimeout: () => this.reconnectAfterSilence() });
  }

  /** The client gave up on an answer and makes the connection again, as the real one does. */
  private reconnectAfterSilence(): void {
    this.offline = true;
    this.events.emit('reconnecting', { error: new Error('mock: the game server did not answer') });
    setTimeout(() => {
      if (this.closed) return;
      this.offline = false;
      this.campaignActivated = false; // per connection, as on the real RGS
      this.events.emit('reconnected', undefined);
    }, (this.opts.latency ?? 120) + 400);
  }

  private pickRow(mode: LoadedMode): number {
    const i = this.forceQueue.findIndex((f) => f.mode === mode.name);
    if (i >= 0) {
      const [f] = this.forceQueue.splice(i, 1);
      return Math.max(0, Math.min(mode.multipliers.length - 1, f!.row));
    }
    return drawRow(mode, this.rng());
  }

  async dispose(): Promise<void> {
    this.closed = true;
  }

  // ── scripting (tests / QA) ─────────────────────────────────────────────────
  /** The next spin of `mode` lands on book row `row`. */
  forceRow(mode: string, row: number): this {
    this.forceQueue.push({ mode, row });
    return this;
  }
  /** The next spin fails with `errorId`. */
  /**
   * The next spin gets no answer: the hub keeps the connection and never answers. `played` (default
   * true): the round was played and paid on the server; false: it never was. The game shows its
   * spinner after `slowMs` (default 5 s) and gives up after `timeoutMs` (default 20 s): the
   * connection is made again and `session` says what happened.
   */
  simulateNoAnswer(opts: { played?: boolean } & Partial<AnswerTimes> = {}): this {
    this.answerArmed = { kind: 'none', played: opts.played ?? true, ms: 0, times: this.answerTimes(opts) };
    return this;
  }

  /** The next spin's answer takes `ms` (the game's spinner shows after `slowMs`, default 5 s). */
  simulateSlowAnswer(ms: number, opts: Partial<AnswerTimes> = {}): this {
    this.answerArmed = { kind: 'slow', played: true, ms, times: this.answerTimes(opts) };
    return this;
  }

  private answerTimes(o: Partial<AnswerTimes>): AnswerTimes {
    return {
      slowMs: o.slowMs ?? this.opts.answer?.slowMs ?? DEFAULT_ANSWER_TIMES.slowMs,
      timeoutMs: o.timeoutMs ?? this.opts.answer?.timeoutMs ?? DEFAULT_ANSWER_TIMES.timeoutMs,
    };
  }

  failNext(errorId: number): this {
    this.errorQueue.push(errorId);
    return this;
  }
  setBalance(v: number): this {
    this.balanceValue = v;
    return this;
  }
  /** A deposit/withdrawal outside the game → `NotifyBalanceChanged`. */
  externalBalanceChange(v: number): void {
    this.balanceValue = v;
    this.events.emit('balanceChanged', { balance: v, currency: this.opts.currency === undefined ? 'EUR' : this.opts.currency });
  }
  /**
   * Lose the connection the way a player's network does, for `ms` (default 8 s). Every call
   * meanwhile fails as the real client's does when it is not connected; a spin caught in it
   * loses its answer (see {@link OutageOptions}). The transport emits `reconnecting`, then —
   * if the outage outlasts `giveUpAfter` — `closed` with `retrying` (the real client keeps
   * trying after its automatic reconnect gave up), and `reconnected` when it is over. The
   * free-rounds activation is lost with the connection, as on the real RGS.
   */
  simulateOutage(ms = 8000, opts: OutageOptions = {}): this {
    const outage = { ms, at: opts.at ?? 'next-spin', lost: opts.lost ?? 'answer', giveUpAfter: opts.giveUpAfter ?? 7_500 };
    if (outage.at === 'now') this.goDown(outage.ms, outage.giveUpAfter);
    else this.outageArmed = outage;
    return this;
  }

  private goDown(ms: number, giveUpAfter: number): void {
    if (this.offline) return;
    this.offline = true;
    this.events.emit('reconnecting', { error: new Error('mock: the connection was lost') });
    const gaveUp = giveUpAfter < ms ? setTimeout(() => this.offline && this.events.emit('closed', { error: new Error('mock: reconnect gave up'), retrying: true }), giveUpAfter) : null;
    setTimeout(() => {
      if (gaveUp) clearTimeout(gaveUp);
      if (this.closed) return;
      this.offline = false;
      this.campaignActivated = false;
      this.events.emit('reconnected', undefined);
    }, ms);
  }

  /** Drop the connection and bring it back after `ms` (the campaign activation is lost, as on the real RGS). */
  async simulateReconnect(ms = 800): Promise<void> {
    this.events.emit('reconnecting', {});
    await sleep(ms);
    this.campaignActivated = false;
    this.events.emit('reconnected', undefined);
  }
  /** The platform ends the session. */
  closeSession(): void {
    this.closed = true;
    this.events.emit('sessionClosed', undefined);
  }
  /** Another tab took the session over. */
  replaceConnection(): void {
    this.closed = true;
    this.events.emit('replaced', undefined);
  }
  /** Book rows of a mode whose multiplier satisfies `pred` — handy to find a bonus to force. */
  async rowsWhere(mode: string, pred: (multiplierCredits: number, book: string) => boolean): Promise<number[]> {
    const m = (await this.artifact()).modes.get(mode);
    if (!m) return [];
    const out: number[] = [];
    await m.books.load();
    m.books.forEach((b, i) => {
      if (pred(m.multipliers[i]!, b)) out.push(i);
    });
    return out;
  }
}
