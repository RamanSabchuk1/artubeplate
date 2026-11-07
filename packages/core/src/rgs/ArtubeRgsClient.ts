// The real Artube RGS transport — one SignalR connection per session, the four hub methods, the
// three notifications, and the platform's recovery rules baked in so a game cannot get them
// wrong:
//
//   · handlers are registered BEFORE start() (early notifications are never missed)
//   · the FIRST start is retried with a bounded backoff — SignalR's automatic reconnect only
//     covers a connection that was already up
//   · automatic reconnect: 5 attempts (the platform's reconnect spec), then `closed` with
//     `retrying`: the client keeps starting the connection again in the background (on a
//     backoff, and at once when the browser says it is online), because a player's network can
//     come back long after five attempts ran out, and a game stuck behind a popup until a
//     manual reload is a game QA fails; `reconnected` follows when it is back
//   · HTTP requests (negotiate) time out after 30 s, not SignalR's 100 s: an attempt started
//     while the network was down must not outlive the outage by a minute and a half
//   · 429 → back off and retry the same call; 500 → at most 2 retries for `session`/`balance`;
//     `spin` is NEVER retried (no idempotency key: a repeat is a new round, possibly charged twice)
//   · `NotifyNewConnectionHasOpened` → the connection is dead: stop it, so auto-reconnect cannot
//     steal the session back from the other tab

import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import {
  HUB_METHODS,
  HUB_NOTIFICATIONS,
  balanceIn,
  normalizeBalance,
  normalizeCampaign,
  normalizeRound,
  normalizeSession,
  type BalanceResponse,
  type FreeRoundCampaign,
  type RoundResponse,
  type SessionResponse,
  type SpinRequest,
} from './protocol';
import { RgsError, RGS_ERRORS, errorEnvelope, rgsErrorFrom } from './errors';
import { RgsEmitter, sleep, type RgsEventName, type RgsEvents, type RgsTransport } from './network';

/** The slice of `HubConnection` this client uses — injectable, so tests need no server. */
export interface HubConnectionLike {
  readonly state: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on(method: string, handler: (...args: unknown[]) => void): void;
  onclose(cb: (error?: Error) => void): void;
  onreconnecting(cb: (error?: Error) => void): void;
  onreconnected(cb: (connectionId?: string) => void): void;
}

export interface ArtubeRgsOptions {
  /** Full hub URL, query included (see `hubUrl(runtime)`). */
  url: string;
  /** Build the connection yourself (tests, custom transports/logging). */
  connectionFactory?: (url: string, reconnectDelays: number[]) => HubConnectionLike;
  /** Automatic-reconnect delays; the array length is the attempt count. Default 5 attempts. */
  reconnectDelays?: number[];
  /** Attempts for the very first `start()`. Default 3. */
  startAttempts?: number;
  /**
   * After the automatic reconnect gave up: the waits between the client's own attempts to
   * start the connection again (the last one repeats). Default 2 s, 5 s, 10 s, 15 s, then
   * every 30 s. `[]` turns it off (then `closed` is final).
   */
  reviveDelays?: number[];
  /** Retries after a 429 (rate limit: 5 calls/s per session and method). Default 3. */
  rateLimitRetries?: number;
  /** Retries after a 500 on `session`/`balance` (never on `spin`). Default 2. */
  technicalRetries?: number;
  logLevel?: LogLevel;
}

const DEFAULT_RECONNECT = [0, 1000, 2000, 5000, 10000];
const DEFAULT_REVIVE = [2000, 5000, 10000, 15000, 30000];
/** SignalR waits 100 s for an HTTP request (negotiate) by default. */
const HTTP_TIMEOUT_MS = 30_000;

export function defaultConnectionFactory(logLevel: LogLevel = LogLevel.Warning) {
  return (url: string, reconnectDelays: number[]): HubConnectionLike =>
    new HubConnectionBuilder()
      .withUrl(url, { timeout: HTTP_TIMEOUT_MS })
      .withAutomaticReconnect(reconnectDelays)
      .configureLogging(logLevel)
      .build() as unknown as HubConnectionLike;
}

export class ArtubeRgsClient implements RgsTransport {
  readonly kind = 'artube' as const;
  private readonly events = new RgsEmitter();
  private readonly conn: HubConnectionLike;
  private dead = false;
  /** One call per method at a time on a connection; spins are strictly serial anyway. */
  private spinInFlight = false;
  /** The background attempts after the automatic reconnect gave up are running. */
  private reviving = false;

  constructor(private readonly opts: ArtubeRgsOptions) {
    const factory = opts.connectionFactory ?? defaultConnectionFactory(opts.logLevel);
    this.conn = factory(opts.url, opts.reconnectDelays ?? DEFAULT_RECONNECT);
    // Notifications first — before any start().
    this.conn.on(HUB_NOTIFICATIONS.balanceChanged, (p: unknown) => {
      // A payload this client cannot read says nothing about the wallet: never show 0 for it.
      if (balanceIn(p) === null) return;
      const b = normalizeBalance(p);
      this.events.emit('balanceChanged', { balance: b.balance, currency: b.currency ?? null });
    });
    this.conn.on(HUB_NOTIFICATIONS.sessionClosed, () => {
      this.dead = true;
      this.events.emit('sessionClosed', undefined);
    });
    this.conn.on(HUB_NOTIFICATIONS.newConnection, () => {
      this.dead = true;
      this.events.emit('replaced', undefined);
      void this.conn.stop().catch(() => {}); // don't let auto-reconnect take the session back
    });
    this.conn.onreconnecting((error) => this.events.emit('reconnecting', { ...(error ? { error } : {}) }));
    this.conn.onreconnected(() => this.events.emit('reconnected', undefined));
    this.conn.onclose((error) => {
      // The hub closed the connection because the session is over (the game was opened again in
      // another tab, the session expired: "…error code 501…"). That is final, as the session-closed
      // notification is: no reconnecting to a session that cannot come back.
      if (!this.dead && error && rgsErrorFrom(error, 'connection').sessionOver) return this.sessionOver();
      // Stopped on purpose (disposed, replaced, the session closed): that is final.
      const retrying = !this.dead && (this.opts.reviveDelays ?? DEFAULT_REVIVE).length > 0;
      this.events.emit('closed', { ...(error ? { error } : {}), ...(retrying ? { retrying: true } : {}) });
      if (retrying) void this.revive();
    });
  }

  /** The platform will not take this session again: stop, and say so once. */
  private sessionOver(): void {
    if (this.dead) return;
    this.dead = true;
    this.events.emit('sessionClosed', undefined);
  }

  /** Whether a call can go out right now. */
  get connected(): boolean {
    return !this.dead && (this.conn.state === HubConnectionState.Connected || this.conn.state === 'Connected');
  }

  /**
   * The automatic reconnect gave up; keep starting the connection again until it takes (or
   * the session is over). Each wait ends early when the browser reports it is online again.
   */
  private async revive(): Promise<void> {
    if (this.reviving) return;
    this.reviving = true;
    const delays = this.opts.reviveDelays ?? DEFAULT_REVIVE;
    let wake: (() => void) | null = null;
    const online = (): void => wake?.();
    const win = typeof window !== 'undefined' ? window : null;
    win?.addEventListener('online', online);
    try {
      for (let attempt = 0; !this.dead; attempt++) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
        if (this.dead) return;
        try {
          await this.conn.start();
          if (this.dead) return;
          this.events.emit('reconnected', undefined);
          return;
        } catch (e) {
          // The hub answers, and the session is gone: nothing to wait for.
          if (rgsErrorFrom(e, 'connect').sessionOver) return this.sessionOver();
          // Still down: the next wait.
        }
      }
    } finally {
      this.reviving = false;
      win?.removeEventListener('online', online);
    }
  }

  on<K extends RgsEventName>(type: K, fn: (payload: RgsEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  async connect(): Promise<void> {
    const attempts = Math.max(1, this.opts.startAttempts ?? 3);
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.conn.start();
        return;
      } catch (e) {
        last = e;
        // A session the platform refuses is refused again on every attempt.
        if (rgsErrorFrom(e, 'connect').sessionOver) break;
        if (i < attempts - 1) await sleep(500 * 2 ** i);
      }
    }
    throw rgsErrorFrom(last ?? new Error('could not connect to the game server'), 'connect');
  }

  /** Invoke with the documented retry policy. Resolved error envelopes become RgsErrors too. */
  private async call<T>(method: string, args: unknown[], retryTechnical: boolean): Promise<T> {
    if (this.dead) throw new RgsError(RGS_ERRORS.SESSION_UNUSABLE, 'the session is closed', method);
    if (this.conn.state !== HubConnectionState.Connected && this.conn.state !== 'Connected')
      throw new RgsError(undefined, `not connected (${this.conn.state})`, method);
    const rateRetries = this.opts.rateLimitRetries ?? 3;
    const techRetries = retryTechnical ? (this.opts.technicalRetries ?? 2) : 0;
    let rate = 0;
    let tech = 0;
    for (;;) {
      let err: RgsError;
      try {
        const result = await this.conn.invoke<unknown>(method, ...args);
        const env = errorEnvelope(result);
        if (!env) return result as T;
        err = new RgsError(env.errorId, env.message, method);
      } catch (e) {
        err = rgsErrorFrom(e, method);
      }
      if (err.errorId === RGS_ERRORS.RATE_LIMITED && rate < rateRetries) {
        await sleep(250 * 2 ** rate++);
        continue;
      }
      if (err.errorId === RGS_ERRORS.TECHNICAL && tech < techRetries) {
        await sleep(400 * 2 ** tech++);
        continue;
      }
      throw err;
    }
  }

  async session<P = unknown>(): Promise<SessionResponse<P>> {
    return normalizeSession<P>(await this.call(HUB_METHODS.session, [], true));
  }

  async spin<P = unknown>(req: SpinRequest): Promise<RoundResponse<P>> {
    if (this.spinInFlight) throw new RgsError(RGS_ERRORS.TECHNICAL, 'a spin is already in flight on this connection', HUB_METHODS.spin);
    this.spinInFlight = true;
    try {
      // `spin` is never retried on 500 — only a 429 (the call was refused before it ran).
      return normalizeRound<P>(await this.call(HUB_METHODS.spin, [{ gameMode: req.gameMode, betIndex: req.betIndex }], false));
    } finally {
      this.spinInFlight = false;
    }
  }

  async balance(): Promise<BalanceResponse> {
    return normalizeBalance(await this.call(HUB_METHODS.balance, [], true));
  }

  async activateFreeRoundCampaign(campaignId: string): Promise<FreeRoundCampaign | null> {
    const raw = await this.call<unknown>(HUB_METHODS.activateFreeRoundCampaign, [{ campaignId }], false);
    // The response may be the campaign itself or wrap it.
    const wrapped = raw && typeof raw === 'object' && 'freeRoundCampaign' in raw ? (raw as { freeRoundCampaign: unknown }).freeRoundCampaign : raw;
    return normalizeCampaign(wrapped);
  }

  async dispose(): Promise<void> {
    this.dead = true;
    await this.conn.stop().catch(() => {});
  }
}
