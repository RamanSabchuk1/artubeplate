import { describe, it, expect, vi } from 'vitest';
import { normalizeSession, normalizeRound, normalizeCampaign, maxWinAmount } from '../src/rgs/protocol';
import { rgsErrorFrom, RgsError, RGS_ERRORS } from '../src/rgs/errors';
import { describeRgsError } from '../src/engine/errors';
import { ArtubeRgsClient, type HubConnectionLike } from '../src/rgs/ArtubeRgsClient';
import { readRuntime, hubUrl, isArtubeLaunch } from '../src/rgs/runtime';

describe('protocol normalizers', () => {
  it('reads camelCase, snake_case and nested shapes into one session', () => {
    const s = normalizeSession({
      balance: 150.75,
      round: null,
      session_settings: { currency: 'EUR', currency_minimal_unit: 0.01, allowed_bets: [0.1, 0.5, 1], default_bet_index: 2, platform_max_win: { is_visible: true, player_currency_value: 870 } },
      gameSettings: { betCredit: 100, gameModes: [{ id: 'base', rtp: 96, priceMultiplier: 1, type: 'None' }, { id: 'bonus', rtp: 96, priceMultiplier: 75, type: 'BuyFeature' }], config: '{"board":{"reels":5,"rows":3}}' },
      free_round_campaign: { campaign_id: 'c1', bet: 1, rounds_total: 10, rounds_left: 4, total_win: 3.5, is_complete: false },
      gamificationToken: 'tok',
    });
    expect(s.sessionSettings).toMatchObject({ currency: 'EUR', allowedBets: [0.1, 0.5, 1], defaultBetIndex: 2 });
    expect(maxWinAmount(s.sessionSettings.platformMaxWin)).toBe(870);
    expect(s.gameSettings.gameModes[1]).toEqual({ id: 'bonus', rtp: 96, priceMultiplier: 75, type: 'BuyFeature' });
    expect(s.gameSettings.config).toEqual({ board: { reels: 5, rows: 3 } }); // JSON string → object
    expect(s.freeRoundCampaign).toMatchObject({ campaignId: 'c1', roundsLeft: 4, totalWin: 3.5, isComplete: false });
    expect(s.gamificationToken).toBe('tok');
  });

  it('a null currency is a demo session', () => {
    expect(normalizeSession({ balance: 1, sessionSettings: { currency: null, allowedBets: [1], defaultBetIndex: 0 }, gameSettings: { gameModes: [] } }).sessionSettings.currency).toBeNull();
  });

  it('round: parses a string payload and infers the platform max-win cap from money', () => {
    const r = normalizeRound({ roundId: 'r1', gameMode: 'base', bet: 1, balance: 10, totalWin: 500, spinResult: { winMultiplier: 1200, payload: '{"events":[]}' } });
    expect(r.spinResult.payload).toEqual({ events: [] });
    expect(r.maxWinReached).toBe(true);
    expect(normalizeRound({ roundId: 'r2', bet: 1, totalWin: 2, spinResult: { winMultiplier: 2, payload: {} } }).maxWinReached).toBe(false);
    expect(normalizeRound({ roundId: 'r3', bet: 1, totalWin: 2, isPlatformMaxWinReached: true, spinResult: { winMultiplier: 2, payload: {} } }).maxWinReached).toBe(true);
  });

  it('campaign completeness falls back to roundsLeft', () => {
    expect(normalizeCampaign({ campaignId: 'x', bet: 1, roundsTotal: 3, roundsLeft: 0 })!.isComplete).toBe(true);
    expect(normalizeCampaign(null)).toBeNull();
  });
});

describe('errors', () => {
  it('reads errorIds from envelopes, HubException text and JSON inside messages', () => {
    expect(rgsErrorFrom({ errorId: 503, message: 'no funds' }).errorId).toBe(503);
    expect(rgsErrorFrom({ error: { errorId: '601' } }).errorId).toBe(601);
    expect(rgsErrorFrom(new Error("An unexpected error occurred invoking 'spin' on the server. HubException: errorId: 502 invalid bet")).errorId).toBe(502);
    expect(rgsErrorFrom(new Error('HubException: {"errorId":634,"message":"played out"}')).errorId).toBe(634);
    expect(rgsErrorFrom(new Error('Invocation canceled due to the underlying connection being closed.')).transport).toBe(true);
    expect(rgsErrorFrom(new Error('something odd')).errorId).toBe(500);
  });

  it('maps each documented code to the documented client action', () => {
    const p = (code: number) => describeRgsError(new RgsError(code, ''));
    expect(p(RGS_ERRORS.INSUFFICIENT_FUNDS).kind).toBe('funds');
    expect(p(RGS_ERRORS.SESSION_UNUSABLE).kind).toBe('fatal');
    expect(p(RGS_ERRORS.SESSION_STOPPED).kind).toBe('fatal');
    expect(p(RGS_ERRORS.INVALID_GAME_SETTINGS).kind).toBe('fatal');
    expect(p(RGS_ERRORS.INVALID_BET)).toMatchObject({ kind: 'notice', refresh: true });
    expect(p(RGS_ERRORS.UNKNOWN_MODE)).toMatchObject({ kind: 'notice', refresh: true });
    expect(p(RGS_ERRORS.FRC_ALREADY_ACTIVE).kind).toBe('silent');
  });
});

describe('runtime', () => {
  const at = (q: string) => (n: string) => new URLSearchParams(q).get(n) ?? undefined;
  it('a session in the URL → the real hub, with both mandatory parameters', () => {
    const rt = readRuntime({ param: at('sessionId=abc-123&lang=pt-BR'), gameServerId: 'srv-9' });
    expect(isArtubeLaunch(rt)).toBe(true);
    expect(rt.language).toBe('pt');
    expect(hubUrl(rt)).toBe('/api-rgs/api/slot?sessionId=abc-123&game=srv-9');
  });
  it("an Artube launch URL: the hub's game is ?gameId= (Stage's own id included), the language ?lng=", () => {
    const rt = readRuntime({ param: at('sessionId=s-1&gameId=n4f-stage&lng=de'), gameServerId: 'fallback' });
    expect(rt.language).toBe('de');
    expect(hubUrl(rt)).toBe('/api-rgs/api/slot?sessionId=s-1&game=n4f-stage');
  });
  it('no session (or ?mock=1) → the mock', () => {
    expect(readRuntime({ param: at('') }).mock).toBe(true);
    expect(readRuntime({ param: at('sessionId=x&mock=1') }).mock).toBe(true);
  });
  it('a build for Artube never picks the mock: no session is an error the boot screen explains', () => {
    const rt = readRuntime({ param: at('gameId=g'), allowMock: false });
    expect(rt.mock).toBe(false);
    expect(readRuntime({ param: at('sessionId=x&mock=1&gameId=g'), allowMock: false }).mock).toBe(false);
    expect(() => hubUrl(rt)).toThrow(/sessionId/);
  });
  it('refuses to build a hub URL without a gameServerId', () => {
    expect(() => hubUrl(readRuntime({ param: at('sessionId=x') }))).toThrow(/gameServerId/);
  });
});

/** A fake SignalR connection that records calls and lets the test play the server. */
function fakeConnection(script: Record<string, Array<unknown | Error>>) {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  let onclose: ((e?: Error) => void) | undefined;
  const order: string[] = [];
  const conn: HubConnectionLike & { fire(name: string, ...a: unknown[]): void; calls: Array<[string, unknown[]]>; stopped: number; order: string[] } = {
    state: 'Disconnected',
    calls: [],
    stopped: 0,
    order,
    async start() {
      order.push('start');
      (this as { state: string }).state = 'Connected';
    },
    async stop() {
      this.stopped++;
      (this as { state: string }).state = 'Disconnected';
      onclose?.();
    },
    async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
      this.calls.push([method, args]);
      const next = script[method]?.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
    on(name, fn) {
      order.push(`on:${name}`);
      handlers.set(name, fn);
    },
    onclose(cb) {
      onclose = cb;
    },
    onreconnecting() {},
    onreconnected() {},
    fire(name, ...a) {
      handlers.get(name)?.(...a);
    },
  };
  return conn;
}

describe('ArtubeRgsClient (SignalR)', () => {
  const SESSION = { balance: 10, round: null, sessionSettings: { currency: 'EUR', allowedBets: [1], defaultBetIndex: 0 }, gameSettings: { betCredit: 100, gameModes: [{ id: 'base', rtp: 96, priceMultiplier: 1, type: 'None' }] } };
  const ROUND = { roundId: 'r', gameMode: 'base', bet: 1, balance: 9, totalWin: 0, spinResult: { winMultiplier: 0, payload: { events: [] } } };

  it('registers every notification handler BEFORE start()', async () => {
    const conn = fakeConnection({});
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    await c.connect();
    const start = conn.order.indexOf('start');
    expect(conn.order.slice(0, start)).toEqual(['on:NotifyBalanceChanged', 'on:NotifySessionClosed', 'on:NotifyNewConnectionHasOpened']);
  });

  it('sends spin as { gameMode, betIndex } and never retries it on a 500', async () => {
    const conn = fakeConnection({ spin: [new Error('HubException: errorId: 500 tx failed'), ROUND] });
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    await c.connect();
    await expect(c.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: 500 });
    expect(conn.calls.filter(([m]) => m === 'spin')).toEqual([['spin', [{ gameMode: 'base', betIndex: 0 }]]]);
  });

  it('backs off and retries a 429 (on any method), and retries session on a 500', async () => {
    vi.useFakeTimers();
    const conn = fakeConnection({ session: [{ errorId: 429, message: 'slow down' }, new Error('HubException: errorId: 500 hiccup'), SESSION] });
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    await c.connect();
    const p = c.session();
    await vi.runAllTimersAsync();
    expect((await p).balance).toBe(10);
    expect(conn.calls.filter(([m]) => m === 'session')).toHaveLength(3);
    vi.useRealTimers();
  });

  it('turns a resolved error envelope into an RgsError', async () => {
    const conn = fakeConnection({ spin: [{ errorId: 503, message: 'no funds' }] });
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    await c.connect();
    await expect(c.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: 503 });
  });

  it('NotifyNewConnectionHasOpened: emits replaced and stops (auto-reconnect must not steal it back)', async () => {
    const conn = fakeConnection({});
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('replaced', () => seen.push('replaced'));
    c.on('balanceChanged', (b) => seen.push(`balance:${b.balance}`));
    await c.connect();
    conn.fire('NotifyBalanceChanged', { balance: 42, currency: 'EUR' });
    conn.fire('NotifyNewConnectionHasOpened');
    expect(seen).toEqual(['balance:42', 'replaced']);
    expect(conn.stopped).toBe(1);
    await expect(c.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: 501 });
  });

  it('a call while disconnected is a TRANSPORT error (outcome known: nothing was sent)', async () => {
    const conn = fakeConnection({});
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    await expect(c.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: undefined });
    expect(conn.calls).toHaveLength(0);
  });
});
